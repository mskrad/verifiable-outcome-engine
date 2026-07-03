// OddSol operator flow for VRE conditions (canonical 6QtLot, variant B — VRE reviews per round).
// Takes the fc7 artifact bytes you already get from Path 1 (`/api/conditions/score` → artifact.hex),
// submits + finalizes them with YOUR key, waits for VRE to approve the hash, then binds an
// OutcomeConfig and calls resolve_conditions with YOUR key. Prints the tx signature for the
// <vre-verify> widget. No VRE key is used here — approval happens on VRE's side in parallel.
//
//   VRE_WALLET=/path/to/euq7.json \
//   npx ts-node --esm --transpile-only scripts/oddsol_conditions_operator.ts --artifact-hex <fc7_hex>
//
// (or --artifact-file <path.bin>). Send VRE the printed compiled_artifact_hash so they approve it.
import * as anchor from "@coral-xyz/anchor";
const BN = (anchor as any).BN ?? (anchor as any).default.BN;
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import {
  deriveProgramConfigPda, deriveApprovedArtifactPda, deriveApprovedArtifactChunkPda,
  deriveOutcomeConfigPda, deriveOutcomeVaultPda,
} from "../dist/sdk/internals.js";

const RPC = process.env.VRE_RPC ?? "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(process.env.VRE_PROGRAM_ID ?? "6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B");
const WALLET_PATH = process.env.VRE_WALLET ?? `${os.homedir()}/.config/solana/id.json`;
const CHUNK_SIZE = 1024;
const CHUNK_WRITE_BYTES = 900;
const STATUS_APPROVED = 1;
const APPROVE_POLL_MS = 4000;
const APPROVE_TIMEOUT_MS = 300_000;
// sha256("global:resolve_conditions")[..8]
const RESOLVE_CONDITIONS_DISCRIMINATOR = Buffer.from("444dcad7b1c92860", "hex");
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const hexArg = arg("artifact-hex");
  const fileArg = arg("artifact-file");
  const blob = hexArg
    ? Buffer.from(hexArg.replace(/^0x/, ""), "hex")
    : fileArg
      ? fs.readFileSync(fileArg)
      : (() => { throw new Error("provide --artifact-hex <fc7 hex> or --artifact-file <path>"); })();
  if (blob.subarray(0, 4).toString("ascii") !== "W3O1" || blob.readUInt16LE(4) !== 9) {
    throw new Error("not an fc7/fv9 conditions artifact (expect magic W3O1 + format_version 9)");
  }

  const wallet = new anchor.Wallet(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8")))));
  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed", maxRetries: 5 });
  const idl = JSON.parse(fs.readFileSync("target/idl/outcome.json", "utf8"));
  idl.address = PROGRAM_ID.toBase58();
  const program = new anchor.Program(idl as anchor.Idl, provider);
  const m = program.methods as any;
  const authority = wallet.publicKey;

  const compiledArtifactHash = sha256(blob);
  const hashHex = compiledArtifactHash.toString("hex");
  const artifactPda = deriveApprovedArtifactPda(PROGRAM_ID, compiledArtifactHash);
  const programConfigPda = deriveProgramConfigPda(PROGRAM_ID);
  const chunkCount = Math.ceil(blob.length / CHUNK_SIZE);
  const chunkPdas = Array.from({ length: chunkCount }, (_, i) => deriveApprovedArtifactChunkPda(PROGRAM_ID, compiledArtifactHash, i));
  console.log("operator:", authority.toBase58(), "\nartifact hash:", hashHex, `(${blob.length} bytes, ${chunkCount} chunk(s))`);

  // Phase 1 — submit + finalize (your key). Idempotent on the artifact hash.
  if (!(await connection.getAccountInfo(artifactPda))) {
    await m.submitCompiledArtifact({ compiledArtifactHash: [...compiledArtifactHash], formatVersion: 9, blobLen: blob.length })
      .accounts({ publisher: authority, approvedOutcomeArtifact: artifactPda, systemProgram: SystemProgram.programId }).rpc();
    for (let ci = 0; ci < chunkCount; ci++) {
      await m.initCompiledArtifactChunk({ compiledArtifactHash: [...compiledArtifactHash], chunkIndex: ci })
        .accounts({ publisher: authority, approvedOutcomeArtifact: artifactPda, approvedOutcomeArtifactChunk: chunkPdas[ci], systemProgram: SystemProgram.programId }).rpc();
      const chunk = blob.subarray(ci * CHUNK_SIZE, Math.min(blob.length, (ci + 1) * CHUNK_SIZE));
      for (let off = 0; off < chunk.length; off += CHUNK_WRITE_BYTES) {
        await m.writeCompiledArtifactChunk({ compiledArtifactHash: [...compiledArtifactHash], chunkIndex: ci, offset: off, data: Buffer.from(chunk.subarray(off, Math.min(chunk.length, off + CHUNK_WRITE_BYTES))) })
          .accounts({ publisher: authority, approvedOutcomeArtifact: artifactPda, approvedOutcomeArtifactChunk: chunkPdas[ci] }).rpc();
      }
    }
    await m.finalizeCompiledArtifact().accounts({ publisher: authority, approvedOutcomeArtifact: artifactPda })
      .remainingAccounts(chunkPdas.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }))).rpc();
    console.log("submitted + finalized. Send this hash to VRE for approval:", hashHex);
  } else {
    console.log("artifact already on-chain, reusing");
  }

  // Wait for VRE to approve (status → APPROVED). VRE runs review_conditions_artifact.ts on their side.
  const deadline = Date.now() + APPROVE_TIMEOUT_MS;
  while (true) {
    const acc: any = await (program.account as any).approvedOutcomeArtifact.fetch(artifactPda);
    if (Number(acc.status) === STATUS_APPROVED) { console.log("VRE approved the artifact."); break; }
    if (Date.now() > deadline) throw new Error("timed out waiting for VRE approval");
    console.log("waiting for VRE approval…");
    await sleep(APPROVE_POLL_MS);
  }

  // Phase 2 — bind OutcomeConfig (authority = your key) + resolve_conditions (your key).
  const runtimeId = Buffer.from(createHash("sha256").update(`oddsol-${hashHex}-${Date.now()}`).digest().subarray(0, 16));
  const outcomeConfigPda = deriveOutcomeConfigPda(PROGRAM_ID, runtimeId);
  const outcomeVaultPda = deriveOutcomeVaultPda(PROGRAM_ID, runtimeId);
  await m.initializeOutcomeConfig({ runtimeId: [...runtimeId], minInputLamports: new BN(0), maxInputLamports: new BN(0), compiledArtifactHash: [...compiledArtifactHash], masterSeed: [...Buffer.alloc(32, 0)] })
    .accounts({ authority, programConfig: programConfigPda, outcomeConfig: outcomeConfigPda, outcomeVault: outcomeVaultPda, treasury: authority, approvedOutcomeArtifact: artifactPda, systemProgram: SystemProgram.programId })
    .remainingAccounts(chunkPdas.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }))).rpc();

  const keys = [
    { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: programConfigPda, isSigner: false, isWritable: false },
    { pubkey: outcomeConfigPda, isSigner: false, isWritable: false },
    { pubkey: artifactPda, isSigner: false, isWritable: false },
    ...chunkPdas.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })),
  ];
  const ix = new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.concat([RESOLVE_CONDITIONS_DISCRIMINATOR, runtimeId]) });
  const sig = await provider.sendAndConfirm(new Transaction().add(ix), []);
  console.log("\nresolve_conditions signature:", sig);
  console.log(`verify:\n  yarn -s replay --sig ${sig} --program-id ${PROGRAM_ID.toBase58()} --url ${RPC}`);
  console.log(`widget:\n  <vre-verify program-id="${PROGRAM_ID.toBase58()}" sig="${sig}">`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
