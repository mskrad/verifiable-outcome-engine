import * as multisig from "@sqds/multisig";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

const RPC_URL = "https://api.devnet.solana.com";
const MULTISIG_KEY = new PublicKey("7jtA1fkZNrg7ZntGQtpXtAi9JxZEzgRjGRuGvdScZQqQ");
const PROGRAM_ID = new PublicKey("9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F");
const VAULT_INDEX = 0;
const BPF_UPGRADEABLE_LOADER = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);
const PROGRAM_CONFIG_SEED = Buffer.from("outcome_program_config");

function parsePubkey(name: string, fallback?: string): PublicKey {
  const value = String(process.env[name] || fallback || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return new PublicKey(value);
}

function encodePubkey(value: PublicKey): Buffer {
  return Buffer.from(value.toBytes());
}

function instructionDiscriminator(name: string): Buffer {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

async function sendAndConfirm(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
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
  const signer = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        fs.readFileSync(path.join(process.env.HOME!, ".config/solana/esjx.json"), "utf-8")
      )
    )
  );

  const newAdmin = parsePubkey(
    "NEW_ADMIN",
    "3oXKHoBgozc6BDBGvkhSSPAuzheudkg1qUX6cJGi43zm"
  );
  const newTreasury = parsePubkey(
    "NEW_TREASURY",
    newAdmin.toBase58()
  );

  const [vaultPda] = multisig.getVaultPda({
    multisigPda: MULTISIG_KEY,
    index: VAULT_INDEX,
  });
  const [programDataAddress] = PublicKey.findProgramAddressSync(
    [PROGRAM_ID.toBuffer()],
    BPF_UPGRADEABLE_LOADER
  );
  const [programConfigPda] = PublicKey.findProgramAddressSync(
    [PROGRAM_CONFIG_SEED],
    PROGRAM_ID
  );

  const data = Buffer.concat([
    instructionDiscriminator("recover_program_config_admin"),
    encodePubkey(newAdmin),
    encodePubkey(newTreasury),
  ]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: programConfigPda, isSigner: false, isWritable: true },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: programDataAddress, isSigner: false, isWritable: false },
      { pubkey: vaultPda, isSigner: true, isWritable: false },
    ],
    data,
  });

  const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    MULTISIG_KEY
  );
  const transactionIndex = Number(multisigAccount.transactionIndex) + 1;

  console.log("Signer:", signer.publicKey.toBase58());
  console.log("Vault PDA:", vaultPda.toBase58());
  console.log("ProgramConfig PDA:", programConfigPda.toBase58());
  console.log("ProgramData:", programDataAddress.toBase58());
  console.log("New admin:", newAdmin.toBase58());
  console.log("New treasury:", newTreasury.toBase58());
  console.log("Transaction index:", transactionIndex);

  const createIx = await multisig.instructions.vaultTransactionCreate({
    multisigPda: MULTISIG_KEY,
    transactionIndex: BigInt(transactionIndex),
    creator: signer.publicKey,
    vaultIndex: VAULT_INDEX,
    ephemeralSigners: 0,
    transactionMessage: new TransactionMessage({
      payerKey: vaultPda,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
      instructions: [ix],
    }),
    memo: "Recover ProgramConfig admin to fresh Swig actor",
  });
  const createSig = await sendAndConfirm(connection, signer, [createIx]);
  console.log("✅ Vault tx created:", createSig);

  const proposalIx = multisig.instructions.proposalCreate({
    multisigPda: MULTISIG_KEY,
    transactionIndex: BigInt(transactionIndex),
    creator: signer.publicKey,
  });
  const proposalSig = await sendAndConfirm(connection, signer, [proposalIx]);
  console.log("✅ Proposal created:", proposalSig);

  const approveIx = multisig.instructions.proposalApprove({
    multisigPda: MULTISIG_KEY,
    transactionIndex: BigInt(transactionIndex),
    member: signer.publicKey,
  });
  const approveSig = await sendAndConfirm(connection, signer, [approveIx]);
  console.log("✅ Approved:", approveSig);

  const executeResult = await multisig.instructions.vaultTransactionExecute({
    connection,
    multisigPda: MULTISIG_KEY,
    transactionIndex: BigInt(transactionIndex),
    member: signer.publicKey,
  });
  const executeIx = (executeResult as any).instruction ?? executeResult;
  const executeLuts = (executeResult as any).lookupTableAccounts ?? [];
  const executeSig = await sendAndConfirm(connection, signer, [executeIx], executeLuts);
  console.log("✅ Executed:", executeSig);
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
