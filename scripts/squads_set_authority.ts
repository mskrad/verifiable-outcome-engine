/**
 * Transfer program upgrade authority from Squads vault PDA back to esjx.json
 * so we can extend + deploy directly, then return authority to Squads.
 *
 * Usage:
 *   yarn ts-node scripts/squads_set_authority.ts --to esjx
 *   yarn ts-node scripts/squads_set_authority.ts --to squads
 */

import * as multisig from "@sqds/multisig";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import fs from "fs";
import path from "path";

const RPC_URL = "https://api.devnet.solana.com";
const MULTISIG_KEY = new PublicKey("7jtA1fkZNrg7ZntGQtpXtAi9JxZEzgRjGRuGvdScZQqQ");
const PROGRAM_ID = new PublicKey("9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F");
const ESJX_KEY = new PublicKey("ESjxDsMvG2SkPpK1FdcD6Lce4RUfMM8Bvg6sfFBUsXkT");
const VAULT_INDEX = 0;
const BPF_UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

async function sendAndConfirm(connection: Connection, payer: Keypair, instructions: any[], luts: any[] = []): Promise<string> {
  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new VersionedTransaction(
    new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions })
      .compileToV0Message(luts)
  );
  tx.sign([payer]);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

async function main() {
  const direction = process.argv.includes("--to")
    ? process.argv[process.argv.indexOf("--to") + 1]
    : "esjx";

  const connection = new Connection(RPC_URL, "confirmed");
  const keypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(
      path.join(process.env.HOME!, ".config/solana/esjx.json"), "utf-8"
    )))
  );

  const [vaultPda] = multisig.getVaultPda({ multisigPda: MULTISIG_KEY, index: VAULT_INDEX });
  const [programDataAddress] = PublicKey.findProgramAddressSync(
    [PROGRAM_ID.toBuffer()], BPF_UPGRADEABLE_LOADER
  );

  const newAuthority = direction === "squads" ? vaultPda : ESJX_KEY;
  console.log(`Setting upgrade authority → ${newAuthority.toBase58()}`);

  // BPF SetAuthority instruction (discriminator = 4)
  // Accounts: 0=programData(writable), 1=currentAuthority(signer), 2=newAuthority
  const setAuthIx = new TransactionInstruction({
    programId: BPF_UPGRADEABLE_LOADER,
    keys: [
      { pubkey: programDataAddress, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: true, isWritable: false },      // current authority
      { pubkey: newAuthority, isSigner: false, isWritable: false },  // new authority
    ],
    data: Buffer.from([4, 0, 0, 0]), // SetAuthority discriminator
  });

  // Get next tx index
  const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(connection, MULTISIG_KEY);
  const transactionIndex = Number(multisigAccount.transactionIndex) + 1;
  console.log("Transaction index:", transactionIndex);

  // Create vault transaction
  const createIx = await multisig.instructions.vaultTransactionCreate({
    multisigPda: MULTISIG_KEY,
    transactionIndex: BigInt(transactionIndex),
    creator: keypair.publicKey,
    vaultIndex: VAULT_INDEX,
    ephemeralSigners: 0,
    transactionMessage: new TransactionMessage({
      payerKey: vaultPda,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
      instructions: [setAuthIx],
    }),
    memo: direction === "squads" ? "Return upgrade authority to Squads" : "Temp: move upgrade authority to esjx for extend",
  });
  const createSig = await sendAndConfirm(connection, keypair, [createIx]);
  console.log("✅ Vault tx created:", createSig);

  // Propose
  const proposalSig = await sendAndConfirm(connection, keypair, [
    multisig.instructions.proposalCreate({
      multisigPda: MULTISIG_KEY, transactionIndex: BigInt(transactionIndex), creator: keypair.publicKey,
    })
  ]);
  console.log("✅ Proposal created:", proposalSig);

  // Approve
  const approveSig = await sendAndConfirm(connection, keypair, [
    multisig.instructions.proposalApprove({
      multisigPda: MULTISIG_KEY, transactionIndex: BigInt(transactionIndex), member: keypair.publicKey,
    })
  ]);
  console.log("✅ Approved:", approveSig);

  // Execute
  const executeResult = await multisig.instructions.vaultTransactionExecute({
    connection, multisigPda: MULTISIG_KEY, transactionIndex: BigInt(transactionIndex), member: keypair.publicKey,
  });
  const executeSig = await sendAndConfirm(
    connection, keypair,
    [(executeResult as any).instruction ?? executeResult],
    (executeResult as any).lookupTableAccounts ?? []
  );
  console.log("✅ Executed:", executeSig);
  console.log(`\nUpgrade authority is now: ${newAuthority.toBase58()}`);
}

main().catch((err) => { console.error("Error:", err.message ?? err); process.exit(1); });
