/**
 * Update Swig delegate role: replace programLimit(3b7TFK...) → programLimit(9tEramtR...)
 * Then transfer ProgramConfig admin on new canonical program to Swig actor.
 *
 * Usage:
 *   VRE_PROGRAM_ID=9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F \
 *   node scripts/update_swig_program.mjs
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import swigPkg from "@swig-wallet/classic";
const {
  fetchSwig,
  findSwigPda,
  getUpdateAuthorityInstructions,
  updateAuthorityReplaceAllActions,
  Actions,
} = swigPkg;
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RPC_URL = "https://api.devnet.solana.com";
const SWIG_ADDRESS = new PublicKey("gkgwSUqijr6aYazVdGFXVVbNyETPv9w6r24BNUabYyZ");
const DELEGATE_PUBKEY = new PublicKey("CuHMxp83PDaQgHrBaRYLc9NoW2U73Yu8r5x8zNd3C9Cc");
const SWIG_ACTOR = new PublicKey("E8wB17KxBi89Noz74eypjbcrAJXhmPeA7e7oYHZSbjzf");
const OLD_PROGRAM_ID = new PublicKey("3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq");
const NEW_PROGRAM_ID = new PublicKey(
  process.env.VRE_PROGRAM_ID || "9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F"
);

const DEFAULT_DAILY_LIMIT_LAMPORTS = BigInt(
  process.env.SWIG_DAILY_LIMIT_LAMPORTS || "2000000000"
); // 2 SOL/day by default, aligned with live raffle evidence
const DEFAULT_WINDOW_SLOTS = BigInt(
  process.env.SWIG_WINDOW_SLOTS || "216000"
); // ~24h at 400ms/slot

function loadKeypair(p) {
  const expanded = p.replace("~", process.env.HOME);
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(expanded, "utf-8")))
  );
}

async function send(connection, instructions, signers) {
  const { blockhash } = await connection.getLatestBlockhash();
  const msg = new TransactionMessage({
    payerKey: signers[0].publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign(signers);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

async function main() {
  const connection = new Connection(RPC_URL, { commitment: "confirmed" });
  const root = loadKeypair("~/.config/solana/esjx.json");
  console.log("Root (esjx):", root.publicKey.toBase58());
  console.log("Old program:", OLD_PROGRAM_ID.toBase58());
  console.log("New program:", NEW_PROGRAM_ID.toBase58());

  // 1. Fetch current Swig state
  const swig = await fetchSwig(connection, SWIG_ADDRESS, { commitment: "confirmed" });
  const rootRole = swig.findRolesByEd25519SignerPk(root.publicKey)[0];
  if (!rootRole) throw new Error("Root role not found for esjx");

  const delegateRoles = swig.findRolesByEd25519SignerPk(DELEGATE_PUBKEY);
  const delegateRole = delegateRoles[delegateRoles.length - 1];
  if (!delegateRole) throw new Error("Delegate role not found");
  console.log("Delegate role ID:", delegateRole.id);

  // 2. Build new actions: programLimit(newProgram) + solRecurringLimit
  const newActions = Actions.set()
    .programLimit({ programId: NEW_PROGRAM_ID })
    .solRecurringLimit({
      recurringAmount: DEFAULT_DAILY_LIMIT_LAMPORTS,
      window: DEFAULT_WINDOW_SLOTS,
    })
    .get();

  // 3. Replace all actions on the delegate role
  const updatePayload = updateAuthorityReplaceAllActions(newActions);
  const updateInstructions = await getUpdateAuthorityInstructions(
    swig,
    rootRole.id,
    delegateRole.id,
    updatePayload,
    { payer: root.publicKey }
  );

  console.log("\n[1/2] Updating Swig delegate role programLimit...");
  const updateSig = await send(connection, updateInstructions, [root]);
  console.log("✅ Swig role updated:", updateSig);
  console.log(`    programLimit: ${OLD_PROGRAM_ID.toBase58()} → ${NEW_PROGRAM_ID.toBase58()}`);

  // 4. Transfer ProgramConfig admin on new program: esjx → Swig actor
  console.log("\n[2/2] Transferring ProgramConfig admin to Swig actor...");

  const idlPath = path.join(__dirname, "../artifacts/outcome_idl.json");
  const rawIdl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  rawIdl.address = NEW_PROGRAM_ID.toBase58();

  const wallet = new anchor.Wallet(root);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new anchor.Program(rawIdl, provider);

  const [programConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("outcome_program_config")],
    NEW_PROGRAM_ID
  );

  const currentProgramConfig = await program.account.programConfig.fetch(programConfigPda);
  if (currentProgramConfig.admin.equals(SWIG_ACTOR)) {
    console.log("ℹ ProgramConfig admin is already set to Swig actor; skipping transfer.");
    console.log(`    admin: ${SWIG_ACTOR.toBase58()}`);
    console.log("\n=== DONE ===");
    console.log("Swig wallet:", SWIG_ADDRESS.toBase58());
    console.log("Swig actor:", SWIG_ACTOR.toBase58());
    console.log("Canonical program:", NEW_PROGRAM_ID.toBase58());
    console.log("\nUpdate swig_operator_evidence.json and restart VPS.");
    return;
  }

  const adminSig = await program.methods
    .setProgramConfig({
      newAdmin: SWIG_ACTOR,
      allowUnreviewedBinding: false,
      feeLamports: new BN(0),
      treasury: SWIG_ACTOR,
    })
    .accounts({ programConfig: programConfigPda, admin: root.publicKey })
    .rpc();

  console.log("✅ ProgramConfig admin transferred:", adminSig);
  console.log(`    admin: esjx → ${SWIG_ACTOR.toBase58()}`);

  console.log("\n=== DONE ===");
  console.log("Swig wallet:", SWIG_ADDRESS.toBase58());
  console.log("Swig actor:", SWIG_ACTOR.toBase58());
  console.log("Canonical program:", NEW_PROGRAM_ID.toBase58());
  console.log("\nUpdate swig_operator_evidence.json and restart VPS.");
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
