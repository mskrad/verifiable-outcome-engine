// VRE-side review step for partner (OddSol) conditions integration, variant B: the partner
// submits + finalizes their fc7 artifact with their own key; VRE (program_config admin) then
// approves it by hash so the partner can bind an OutcomeConfig and resolve. Canon stays strict
// (no allow_unreviewed_binding). One call per round.
//
//   VRE_WALLET=/path/to/admin.json \
//   npx ts-node --esm --transpile-only scripts/review_conditions_artifact.ts --hash <compiled_artifact_hash_hex>
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import { deriveProgramConfigPda, deriveApprovedArtifactPda } from "../dist/sdk/internals.js";

const RPC = process.env.VRE_RPC ?? "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(process.env.VRE_PROGRAM_ID ?? "6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B");
const WALLET_PATH = process.env.VRE_WALLET ?? `${os.homedir()}/.config/solana/id.json`;
const STATUS_APPROVED = 1;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const hashHex = arg("hash");
  if (!hashHex || !/^[0-9a-fA-F]{64}$/.test(hashHex)) {
    throw new Error("provide --hash <64-hex compiled_artifact_hash>");
  }
  const hash = Buffer.from(hashHex, "hex");
  const wallet = new anchor.Wallet(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8")))));
  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const idl = JSON.parse(fs.readFileSync("target/idl/outcome.json", "utf8"));
  idl.address = PROGRAM_ID.toBase58();
  const program = new anchor.Program(idl as anchor.Idl, provider);
  const m = program.methods as any;

  const programConfigPda = deriveProgramConfigPda(PROGRAM_ID);
  const artifactPda = deriveApprovedArtifactPda(PROGRAM_ID, hash);
  if (!(await connection.getAccountInfo(artifactPda))) {
    throw new Error(`artifact not found on-chain for hash ${hashHex} (partner must submit+finalize first)`);
  }

  const sig = await m
    .reviewCompiledArtifact({ status: STATUS_APPROVED, auditHash: [...Buffer.alloc(32, 0)], artifactUri: Buffer.from("oddsol-conditions") })
    .accounts({ programConfig: programConfigPda, admin: wallet.publicKey, approvedOutcomeArtifact: artifactPda })
    .rpc();
  console.log("approved artifact:", hashHex);
  console.log("review signature:", sig);
  console.log("partner may now initialize_outcome_config + resolve_conditions with their key.");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
