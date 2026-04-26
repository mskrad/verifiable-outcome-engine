#!/usr/bin/env node

import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import swigClassic from "@swig-wallet/classic";

const {
  Actions,
  createEd25519AuthorityInfo,
  fetchSwig,
  findSwigPda,
  getAddAuthorityInstructions,
  getCreateSwigInstruction,
  getSwigWalletAddress,
} = swigClassic;

const REF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_PATH = path.join(REF_ROOT, "artifacts", "swig_operator_evidence.json");
const PROGRAM_CONFIG_SEED = Buffer.from("outcome_program_config");
const DEFAULT_DAILY_LIMIT_LAMPORTS = 2_000_000_000n;
const DEFAULT_WINDOW_SLOTS = 86_400n;

function expandHome(inputPath) {
  if (!inputPath.startsWith("~")) return inputPath;
  return path.join(os.homedir(), inputPath.slice(1));
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function loadKeypair(keypairPath) {
  const raw = JSON.parse(fs.readFileSync(expandHome(keypairPath), "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function readIdl(programId) {
  const raw = JSON.parse(
    fs.readFileSync(path.join(REF_ROOT, "artifacts", "outcome_idl.json"), "utf8")
  );
  raw.address = programId.toBase58();
  return raw;
}

function deriveProgramConfigPda(programId) {
  return PublicKey.findProgramAddressSync([PROGRAM_CONFIG_SEED], programId)[0];
}

async function send(connection, instructions, signers) {
  const tx = new Transaction().add(...instructions);
  return sendAndConfirmTransaction(connection, tx, signers, {
    commitment: "confirmed",
  });
}

async function maybeTransferProgramConfigAdmin({
  connection,
  root,
  programId,
  swigWalletAddress,
}) {
  if (process.env.SWIG_TRANSFER_PROGRAM_CONFIG_ADMIN !== "1") {
    return undefined;
  }

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(root),
    { commitment: "confirmed" }
  );
  const program = new anchor.Program(readIdl(programId), provider);
  const programConfigPda = deriveProgramConfigPda(programId);
  const config = await program.account.programConfig.fetch(programConfigPda);
  const currentAdmin = new PublicKey(config.admin);
  if (currentAdmin.equals(swigWalletAddress)) {
    return {
      skipped: true,
      reason: "ProgramConfig admin already equals Swig wallet address",
    };
  }
  if (!currentAdmin.equals(root.publicKey)) {
    throw new Error(
      `ProgramConfig admin mismatch: expected root ${root.publicKey.toBase58()} or swig ${swigWalletAddress.toBase58()}, got ${currentAdmin.toBase58()}`
    );
  }

  const tx = await program.methods
    .setProgramConfig({
      newAdmin: swigWalletAddress,
      allowUnreviewedBinding: Boolean(config.allowUnreviewedBinding),
      feeLamports: new BN(config.feeLamports.toString()),
      treasury: new PublicKey(config.treasury),
    })
    .accounts({
      programConfig: programConfigPda,
      admin: root.publicKey,
    })
    .rpc();

  return {
    skipped: false,
    tx,
    new_admin: swigWalletAddress.toBase58(),
  };
}

async function main() {
  const root = loadKeypair(requiredEnv("ROOT_KEYPAIR"));
  const delegate = loadKeypair(requiredEnv("SWIG_DELEGATE_KEYPAIR"));
  const rpcUrl = requiredEnv("ANCHOR_PROVIDER_URL");
  const programId = new PublicKey(requiredEnv("VRE_PROGRAM_ID"));
  const connection = new Connection(rpcUrl, { commitment: "confirmed" });
  const existingSwigAddress = String(process.env.EXISTING_SWIG_ADDRESS || "").trim();
  const swigId = existingSwigAddress ? undefined : crypto.randomBytes(32);
  const swigAddress = existingSwigAddress
    ? new PublicKey(existingSwigAddress)
    : findSwigPda(swigId);

  const createTx = existingSwigAddress
    ? undefined
    : await send(
        connection,
        [
          await getCreateSwigInstruction({
            payer: root.publicKey,
            id: swigId,
            actions: Actions.set().all().get(),
            authorityInfo: createEd25519AuthorityInfo(root.publicKey),
          }),
        ],
        [root]
      );

  let swig = await fetchSwig(connection, swigAddress, { commitment: "confirmed" });
  const swigWalletAddress = await getSwigWalletAddress(swig);
  const rootRole = swig.findRolesByEd25519SignerPk(root.publicKey)[0];
  if (!rootRole) {
    throw new Error(`Root role not found for ${root.publicKey.toBase58()}`);
  }

  const defaultFundLamports = existingSwigAddress ? "0" : "3000000000";
  const fundLamports = BigInt(process.env.SWIG_WALLET_FUND_LAMPORTS || defaultFundLamports);
  const fundTx =
    fundLamports > 0n
      ? await send(
          connection,
          [
            SystemProgram.transfer({
              fromPubkey: root.publicKey,
              toPubkey: swigWalletAddress,
              lamports: Number(fundLamports),
            }),
          ],
          [root]
        )
      : undefined;

  const addDelegateInstructions = await getAddAuthorityInstructions(
    swig,
    rootRole.id,
    createEd25519AuthorityInfo(delegate.publicKey),
    Actions.set()
      .programLimit({ programId })
      .solRecurringLimit({
        recurringAmount: DEFAULT_DAILY_LIMIT_LAMPORTS,
        window: DEFAULT_WINDOW_SLOTS,
      })
      .get(),
    { payer: root.publicKey }
  );
  const addDelegateTx = await send(connection, addDelegateInstructions, [root]);

  swig = await fetchSwig(connection, swigAddress, { commitment: "confirmed" });
  const delegateRoles = swig.findRolesByEd25519SignerPk(delegate.publicKey);
  const delegateRole = delegateRoles[delegateRoles.length - 1];
  if (!delegateRole) {
    throw new Error(`Delegate role not found for ${delegate.publicKey.toBase58()}`);
  }

  const adminTransfer = await maybeTransferProgramConfigAdmin({
    connection,
    root,
    programId,
    swigWalletAddress,
  });

  const evidence = {
    swig_address: swigAddress.toBase58(),
    swig_wallet_address: swigWalletAddress.toBase58(),
    delegate_pubkey: delegate.publicKey.toBase58(),
    role_id: delegateRole.id,
    create_tx: createTx,
    add_delegate_tx: addDelegateTx,
    fund_tx: fundTx,
    program_config_admin_transfer: adminTransfer,
    policy: {
      programLimit: {
        programId: programId.toBase58(),
      },
      solRecurringLimit: {
        recurring_amount_lamports: DEFAULT_DAILY_LIMIT_LAMPORTS.toString(),
        window_slots: DEFAULT_WINDOW_SLOTS.toString(),
      },
      programScopeRecurringLimit: {
        used: false,
        reason:
          "Swig 1.9.1 programScopeRecurringLimit requires one target account; live raffle creates and writes multiple VRE accounts.",
      },
    },
    network: "devnet",
    rpc_url: rpcUrl,
    created_at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
  fs.writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);

  console.log(`SWIG_ADDRESS=${swigAddress.toBase58()}`);
  console.log(`SWIG_WALLET_ADDRESS=${swigAddress.toBase58()}`);
  console.log(`SWIG_ACTOR_WALLET_ADDRESS=${swigWalletAddress.toBase58()}`);
  console.log(`SWIG_ROLE_ID=${delegateRole.id}`);
  console.log(`CREATE_TX=${createTx}`);
  console.log(`ADD_DELEGATE_TX=${addDelegateTx}`);
  if (fundTx) console.log(`FUND_TX=${fundTx}`);
  if (adminTransfer?.tx) console.log(`PROGRAM_CONFIG_ADMIN_TRANSFER_TX=${adminTransfer.tx}`);
  console.log(`EVIDENCE_PATH=${EVIDENCE_PATH}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
