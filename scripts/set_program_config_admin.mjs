#!/usr/bin/env node

/**
 * Move ProgramConfig.admin to another key, preserving every other field.
 *
 * The admin is the only signer `review_compiled_artifact` accepts, so whoever holds it is
 * the operator that can complete a draw. Keeping that separate from the program's upgrade
 * authority means an operator box can be compromised without putting the program at risk.
 *
 * Dry run by default; pass APPLY=1 to send the transaction.
 *
 *   ROOT_KEYPAIR=~/.config/solana/protocol-infra-002/fresh-authority.json \
 *   NEW_ADMIN=<pubkey> \
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   VRE_PROGRAM_ID=6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B \
 *   node scripts/set_program_config_admin.mjs
 */

import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const REF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROGRAM_CONFIG_SEED = Buffer.from("outcome_program_config");
const EVIDENCE_PATH = path.join(REF_ROOT, "artifacts", "program_config_admin_transfer.json");

function expandHome(inputPath) {
  return inputPath.startsWith("~") ? path.join(os.homedir(), inputPath.slice(1)) : inputPath;
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function loadKeypair(keypairPath) {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(expandHome(keypairPath), "utf8")))
  );
}

function readIdl(programId) {
  const raw = JSON.parse(
    fs.readFileSync(path.join(REF_ROOT, "artifacts", "outcome_idl.json"), "utf8")
  );
  raw.address = programId.toBase58();
  return raw;
}

async function main() {
  const root = loadKeypair(requiredEnv("ROOT_KEYPAIR"));
  const newAdmin = new PublicKey(requiredEnv("NEW_ADMIN"));
  const programId = new PublicKey(requiredEnv("VRE_PROGRAM_ID"));
  const rpcUrl = requiredEnv("ANCHOR_PROVIDER_URL");
  const apply = String(process.env.APPLY || "") === "1";

  const connection = new Connection(rpcUrl, { commitment: "confirmed" });
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(root), {
    commitment: "confirmed",
  });
  const program = new anchor.Program(readIdl(programId), provider);
  const programConfigPda = PublicKey.findProgramAddressSync([PROGRAM_CONFIG_SEED], programId)[0];
  const config = await program.account.programConfig.fetch(programConfigPda);
  const currentAdmin = new PublicKey(config.admin);

  const plan = {
    program_id: programId.toBase58(),
    program_config: programConfigPda.toBase58(),
    current_admin: currentAdmin.toBase58(),
    new_admin: newAdmin.toBase58(),
    signer: root.publicKey.toBase58(),
    preserved: {
      allow_unreviewed_binding: Boolean(config.allowUnreviewedBinding),
      fee_lamports: config.feeLamports.toString(),
      treasury: new PublicKey(config.treasury).toBase58(),
    },
  };
  console.log(JSON.stringify(plan, null, 2));

  if (currentAdmin.equals(newAdmin)) {
    console.log("\nadmin already equals NEW_ADMIN — nothing to do");
    return;
  }
  if (!currentAdmin.equals(root.publicKey)) {
    throw new Error(
      `ROOT_KEYPAIR ${root.publicKey.toBase58()} is not the current admin ${currentAdmin.toBase58()}`
    );
  }
  if (!apply) {
    console.log("\ndry run — re-run with APPLY=1 to send");
    return;
  }

  const signature = await program.methods
    .setProgramConfig({
      newAdmin,
      allowUnreviewedBinding: Boolean(config.allowUnreviewedBinding),
      feeLamports: new BN(config.feeLamports.toString()),
      treasury: new PublicKey(config.treasury),
    })
    .accounts({ programConfig: programConfigPda, admin: root.publicKey })
    .rpc();

  const after = await program.account.programConfig.fetch(programConfigPda);
  const record = {
    ...plan,
    applied: true,
    signature,
    admin_after: new PublicKey(after.admin).toBase58(),
  };
  fs.writeFileSync(EVIDENCE_PATH, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`\nsignature: ${signature}`);
  console.log(`admin now: ${record.admin_after}`);
  console.log(`evidence : ${path.relative(REF_ROOT, EVIDENCE_PATH)}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
