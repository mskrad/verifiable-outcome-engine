/**
 * HACKATHON-SQUADS-PROGRAM-UPGRADE-001
 * Create proposal + approve + execute for program upgrade via Squads.
 * Buffer: 3m2FRBnVQiDsiuoWpaMH34cooJ97moGGpKEy6M7YdfYr (authority = vault PDA)
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
const BUFFER_ADDRESS = new PublicKey("3m2FRBnVQiDsiuoWpaMH34cooJ97moGGpKEy6M7YdfYr");
const SPILL_ADDRESS = new PublicKey("ESjxDsMvG2SkPpK1FdcD6Lce4RUfMM8Bvg6sfFBUsXkT");
const VAULT_INDEX = 0;
const BPF_UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

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
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const keypairPath = path.join(process.env.HOME!, ".config/solana/esjx.json");
  const keypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf-8")))
  );
  console.log("Signer:", keypair.publicKey.toBase58());

  // Vault PDA
  const [vaultPda] = multisig.getVaultPda({ multisigPda: MULTISIG_KEY, index: VAULT_INDEX });
  console.log("Vault PDA:", vaultPda.toBase58());

  // ProgramData address
  const [programDataAddress] = PublicKey.findProgramAddressSync(
    [PROGRAM_ID.toBuffer()],
    BPF_UPGRADEABLE_LOADER
  );
  console.log("ProgramData:", programDataAddress.toBase58());

  // Get next transaction index
  const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    MULTISIG_KEY
  );
  const transactionIndex = Number(multisigAccount.transactionIndex) + 1;
  console.log("Transaction index:", transactionIndex);

  // Build upgrade instruction (vault PDA as upgrade authority)
  const upgradeIx = new TransactionInstruction({
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
    data: Buffer.from([3, 0, 0, 0]), // Upgrade discriminator
  });

  // Step 1: Create vault transaction
  console.log("\n[1/4] Creating vault transaction...");
  const createIx = await multisig.instructions.vaultTransactionCreate({
    multisigPda: MULTISIG_KEY,
    transactionIndex: BigInt(transactionIndex),
    creator: keypair.publicKey,
    vaultIndex: VAULT_INDEX,
    ephemeralSigners: 0,
    transactionMessage: new TransactionMessage({
      payerKey: vaultPda,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
      instructions: [upgradeIx],
    }),
    memo: "VRE W3O1 v3 formula upgrade",
  });
  const createSig = await sendAndConfirm(connection, keypair, [createIx]);
  console.log("✅ Vault tx created:", createSig);

  // Step 2: Create proposal
  console.log("\n[2/4] Creating proposal...");
  const proposalIx = multisig.instructions.proposalCreate({
    multisigPda: MULTISIG_KEY,
    transactionIndex: BigInt(transactionIndex),
    creator: keypair.publicKey,
  });
  const proposalSig = await sendAndConfirm(connection, keypair, [proposalIx]);
  console.log("✅ Proposal created:", proposalSig);

  // Step 3: Approve
  console.log("\n[3/4] Approving...");
  const approveIx = multisig.instructions.proposalApprove({
    multisigPda: MULTISIG_KEY,
    transactionIndex: BigInt(transactionIndex),
    member: keypair.publicKey,
  });
  const approveSig = await sendAndConfirm(connection, keypair, [approveIx]);
  console.log("✅ Approved:", approveSig);

  // Step 4: Execute
  console.log("\n[4/4] Executing...");
  const executeResult = await multisig.instructions.vaultTransactionExecute({
    connection,
    multisigPda: MULTISIG_KEY,
    transactionIndex: BigInt(transactionIndex),
    member: keypair.publicKey,
  });
  const executeIx = (executeResult as any).instruction ?? executeResult;
  const executeLuts = (executeResult as any).lookupTableAccounts ?? [];
  const executeSig = await sendAndConfirm(connection, keypair, [executeIx], executeLuts);
  console.log("✅ Executed:", executeSig);

  // Write evidence
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
  fs.writeFileSync("artifacts/squads_upgrade_evidence.json", JSON.stringify(evidence, null, 2));
  console.log("\n✅ Evidence written to artifacts/squads_upgrade_evidence.json");
  console.log("\n=== DONE ===");
  console.log("Execute tx:", executeSig);
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
