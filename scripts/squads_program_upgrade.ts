/**
 * HACKATHON-SQUADS-PROGRAM-UPGRADE-001
 * Upgrade canonical VRE program via Squads multisig proposal.
 *
 * Usage:
 *   yarn ts-node scripts/squads_program_upgrade.ts
 *
 * Requires:
 *   - Buffer already written and authority transferred to Squads PDA
 *   - Buffer: 2kUKihQoDbCLjxRg14h5shScmQR8BRBkBP4B8DMfJgLx
 */

import * as multisig from "@sqds/multisig";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import fs from "fs";
import path from "path";

const RPC_URL = "https://api.devnet.solana.com";
const MULTISIG_KEY = new PublicKey("7jtA1fkZNrg7ZntGQtpXtAi9JxZEzgRjGRuGvdScZQqQ");
const PROGRAM_ID = new PublicKey("9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F");
const BUFFER_ADDRESS = new PublicKey("2kUKihQoDbCLjxRg14h5shScmQR8BRBkBP4B8DMfJgLx");
const SPILL_ADDRESS = new PublicKey("ESjxDsMvG2SkPpK1FdcD6Lce4RUfMM8Bvg6sfFBUsXkT");
const VAULT_INDEX = 0;

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");

  // Load keypair
  const keypairPath = path.join(process.env.HOME!, ".config/solana/esjx.json");
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  console.log("Signer:", keypair.publicKey.toBase58());

  // Derive vault PDA
  const [vaultPda] = multisig.getVaultPda({
    multisigPda: MULTISIG_KEY,
    index: VAULT_INDEX,
  });
  console.log("Vault PDA:", vaultPda.toBase58());

  // Derive program data address
  const [programDataAddress] = PublicKey.findProgramAddressSync(
    [PROGRAM_ID.toBuffer()],
    new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
  );
  console.log("ProgramData:", programDataAddress.toBase58());

  // Build BPF upgradeable loader upgrade instruction manually
  // Accounts: programData, program, buffer, spill, rent, clock, upgradeAuthority
  const BPF_UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  const upgradeInstruction = new TransactionInstruction({
    programId: BPF_UPGRADEABLE_LOADER,
    keys: [
      { pubkey: programDataAddress, isSigner: false, isWritable: true },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: true },
      { pubkey: BUFFER_ADDRESS, isSigner: false, isWritable: true },
      { pubkey: SPILL_ADDRESS, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: vaultPda, isSigner: true, isWritable: false },
    ],
    // instruction discriminator for Upgrade = 3 (u32 LE)
    data: Buffer.from([3, 0, 0, 0]),
  });

  // Get current multisig state for transaction index
  const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    MULTISIG_KEY
  );
  const transactionIndex = Number(multisigAccount.transactionIndex) + 1;
  console.log("Transaction index:", transactionIndex);

  // Step 1: Create vault transaction
  console.log("\n[1/3] Creating vault transaction (program upgrade proposal)...");
  const createTx = await multisig.instructions.vaultTransactionCreate({
    multisigPda: MULTISIG_KEY,
    transactionIndex: BigInt(transactionIndex),
    creator: keypair.publicKey,
    vaultIndex: VAULT_INDEX,
    ephemeralSigners: 0,
    transactionMessage: new TransactionMessage({
      payerKey: vaultPda,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
      instructions: [upgradeInstruction],
    }),
    memo: "VRE W3O1 v3 formula support upgrade",
  });

  const createSig = await sendAndConfirm(connection, keypair, [createTx]);
  console.log("✅ Vault transaction created:", createSig);

  // Step 2: Create proposal
  console.log("\n[1b/3] Creating proposal...");
  const proposalCreateIx = await multisig.instructions.proposalCreate({
    multisigPda: MULTISIG_KEY,
    transactionIndex: BigInt(transactionIndex),
    creator: keypair.publicKey,
  });
  const proposalSig = await sendAndConfirm(connection, keypair, [proposalCreateIx]);
  console.log("✅ Proposal created:", proposalSig);

  // Step 3: Approve proposal
  console.log("\n[2/3] Approving proposal...");
  const approveIx = await multisig.instructions.proposalApprove({
    multisigPda: MULTISIG_KEY,
    transactionIndex: BigInt(transactionIndex),
    member: keypair.publicKey,
  });
  const approveSig = await sendAndConfirm(connection, keypair, [approveIx]);
  console.log("✅ Proposal approved:", approveSig);

  // Step 4: Execute vault transaction
  console.log("\n[3/3] Executing vault transaction (program upgrade)...");
  const executeResult = await multisig.instructions.vaultTransactionExecute({
    connection,
    multisigPda: MULTISIG_KEY,
    transactionIndex: BigInt(transactionIndex),
    member: keypair.publicKey,
  });
  // vaultTransactionExecute returns { instruction, lookupTableAccounts }
  const executeIx = (executeResult as any).instruction ?? executeResult;
  const executeLuts = (executeResult as any).lookupTableAccounts ?? [];
  const executeSig = await sendAndConfirm(connection, keypair, [executeIx], executeLuts);
  console.log("✅ Program upgrade executed:", executeSig);

  // Summary
  console.log("\n=== SQUADS UPGRADE EVIDENCE ===");
  console.log({
    multisig: MULTISIG_KEY.toBase58(),
    program_id: PROGRAM_ID.toBase58(),
    buffer: BUFFER_ADDRESS.toBase58(),
    vault_pda: vaultPda.toBase58(),
    transaction_index: transactionIndex,
    create_tx: createSig,
    proposal_tx: proposalSig,
    approve_tx: approveSig,
    execute_tx: executeSig,
  });

  // Write evidence artifact
  const evidence = {
    task: "HACKATHON-SQUADS-PROGRAM-UPGRADE-001",
    timestamp: new Date().toISOString(),
    multisig: MULTISIG_KEY.toBase58(),
    canonical_program_id: PROGRAM_ID.toBase58(),
    buffer_address: BUFFER_ADDRESS.toBase58(),
    vault_pda: vaultPda.toBase58(),
    transaction_index: transactionIndex,
    transactions: {
      vault_transaction_create: createSig,
      proposal_create: proposalSig,
      proposal_approve: approveSig,
      vault_transaction_execute: executeSig,
    },
    narrative: "VRE W3O1 v3 formula support upgrade via Squads multisig governance",
  };
  fs.writeFileSync(
    "artifacts/squads_upgrade_evidence.json",
    JSON.stringify(evidence, null, 2)
  );
  console.log("\n✅ Evidence written to artifacts/squads_upgrade_evidence.json");
}

async function sendAndConfirm(
  connection: Connection,
  payer: Keypair,
  instructions: any[],
  lookupTableAccounts: any[] = []
): Promise<string> {
  const { blockhash } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTableAccounts);
  const tx = new VersionedTransaction(message);
  tx.sign([payer]);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
