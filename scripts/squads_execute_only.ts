/**
 * Execute already-approved Squads vault transaction (index 2)
 */

import * as multisig from "@sqds/multisig";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import fs from "fs";
import path from "path";

const RPC_URL = "https://api.devnet.solana.com";
const MULTISIG_KEY = new PublicKey("7jtA1fkZNrg7ZntGQtpXtAi9JxZEzgRjGRuGvdScZQqQ");
const TRANSACTION_INDEX = BigInt(2);

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const keypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(
      path.join(process.env.HOME!, ".config/solana/esjx.json"), "utf-8"
    )))
  );
  console.log("Signer:", keypair.publicKey.toBase58());
  console.log("Executing transaction index:", TRANSACTION_INDEX.toString());

  const executeResult = await multisig.instructions.vaultTransactionExecute({
    connection,
    multisigPda: MULTISIG_KEY,
    transactionIndex: TRANSACTION_INDEX,
    member: keypair.publicKey,
  });
  const executeIx = (executeResult as any).instruction ?? executeResult;
  const executeLuts = (executeResult as any).lookupTableAccounts ?? [];

  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: keypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [executeIx],
    }).compileToV0Message(executeLuts)
  );
  tx.sign([keypair]);

  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction(sig, "confirmed");
  console.log("✅ Execute tx:", sig);

  // Write evidence
  const evidencePath = "artifacts/squads_upgrade_evidence.json";
  const evidence = fs.existsSync(evidencePath)
    ? JSON.parse(fs.readFileSync(evidencePath, "utf-8"))
    : { task: "HACKATHON-SQUADS-PROGRAM-UPGRADE-001" };
  evidence.transactions = { ...(evidence.transactions ?? {}), vault_transaction_execute: sig };
  evidence.timestamp = new Date().toISOString();
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log("✅ Evidence written to artifacts/squads_upgrade_evidence.json");
}

main().catch((err) => { console.error("Error:", err.message ?? err); process.exit(1); });
