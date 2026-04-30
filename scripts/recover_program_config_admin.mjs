import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const RPC_URL = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F");
const BPF_UPGRADEABLE_LOADER = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);
const PROGRAM_CONFIG_SEED = Buffer.from("outcome_program_config");

function loadKeypair(filePath) {
  const fullPath = filePath.startsWith("~")
    ? path.join(process.env.HOME, filePath.slice(1))
    : filePath;
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(fullPath, "utf-8")))
  );
}

function requiredPubkey(name, fallback) {
  const value = String(process.env[name] || fallback || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return new PublicKey(value);
}

function discriminator(name) {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const upgradeAuthority = loadKeypair(process.env.ROOT_KEYPAIR || "~/.config/solana/esjx.json");
  const newAdmin = requiredPubkey(
    "NEW_ADMIN",
    "3oXKHoBgozc6BDBGvkhSSPAuzheudkg1qUX6cJGi43zm"
  );
  const newTreasury = requiredPubkey("NEW_TREASURY", newAdmin.toBase58());

  const [programDataAddress] = PublicKey.findProgramAddressSync(
    [PROGRAM_ID.toBuffer()],
    BPF_UPGRADEABLE_LOADER
  );
  const [programConfigPda] = PublicKey.findProgramAddressSync(
    [PROGRAM_CONFIG_SEED],
    PROGRAM_ID
  );

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: programConfigPda, isSigner: false, isWritable: true },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: programDataAddress, isSigner: false, isWritable: false },
      { pubkey: upgradeAuthority.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([
      discriminator("recover_program_config_admin"),
      Buffer.from(newAdmin.toBytes()),
      Buffer.from(newTreasury.toBytes()),
    ]),
  });

  const sig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    [upgradeAuthority],
    { commitment: "confirmed" }
  );

  console.log("✅ Recovery tx:", sig);
  console.log("New admin:", newAdmin.toBase58());
  console.log("New treasury:", newTreasury.toBase58());
  console.log("ProgramConfig PDA:", programConfigPda.toBase58());
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
