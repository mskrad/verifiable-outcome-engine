// Localnet Unicorn-G e2e SETUP: program config -> approved artifact (payout=0) -> outcome
// config -> unicorn-g config -> prepare_rng_v2_unicorn. Prints runtime-id/resolve-id for the
// b8 seal harness. Reuses the SDK + the proven 006 flow. Run on a local validator only.
//   npx ts-node --esm --transpile-only scripts/localnet_unicorn_e2e.ts
import * as anchor from "@coral-xyz/anchor";
const BN = (anchor as any).BN ?? (anchor as any).default.BN;
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import { buildArtifact } from "../dist/sdk/artifact.js";
import { buildSnapshotHash } from "../dist/sdk/snapshot.js";
import {
  deriveProgramConfigPda,
  deriveApprovedArtifactPda,
  deriveApprovedArtifactChunkPda,
  deriveOutcomeConfigPda,
  deriveOutcomeVaultPda,
} from "../dist/sdk/internals.js";

const RPC = process.env.VRE_RPC ?? "http://127.0.0.1:8899";
const PROGRAM_ID = new PublicKey(process.env.VRE_PROGRAM_ID ?? "6QtLottR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F");
const WALLET_PATH = process.env.VRE_WALLET ?? `${os.homedir()}/.config/solana/id.json`;
const RSA_MODULUS_ID = Buffer.from("6ae9d033c1d76c4f535b5ad5c0073933a0b375b4120a75fbb66be814eab1a9ce", "hex");
const BPF_LOADER_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const INPUT_LAMPORTS = 100n;
const BOUNTY_LAMPORTS = 50_000n;
const CHUNK_SIZE = 1024;
const CHUNK_WRITE_BYTES = 900;
const STATUS_APPROVED = 1;
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();

function deriveRngV2StatePda(programId: PublicKey, runtimeId: Buffer, resolveId: bigint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("rng_v2_state"), runtimeId, new BN(resolveId.toString()).toArrayLike(Buffer, "le", 8)],
    programId
  )[0];
}
function deriveUnicornGConfigPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("unicorn_g_config")], programId)[0];
}
function deriveProgramDataPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([programId.toBuffer()], BPF_LOADER_UPGRADEABLE)[0];
}

async function main() {
  const wallet = new anchor.Wallet(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8")))));
  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const idl = JSON.parse(fs.readFileSync("target/idl/outcome.json", "utf8"));
  idl.address = PROGRAM_ID.toBase58();
  const program = new anchor.Program(idl as anchor.Idl, provider);
  const m = program.methods as any;
  const authority = wallet.publicKey;

  // 1. program config (idempotent)
  const programConfigPda = deriveProgramConfigPda(PROGRAM_ID);
  if (!(await connection.getAccountInfo(programConfigPda))) {
    await m.initializeProgramConfig({ feeLamports: new BN(0), treasury: authority })
      .accounts({ payer: authority, program: PROGRAM_ID, programData: deriveProgramDataPda(PROGRAM_ID),
        upgradeAuthority: authority, programConfig: programConfigPda, systemProgram: SystemProgram.programId }).rpc();
    console.log("program config initialized");
  }

  // 2. artifact blob (payout=0 -> rng_v2/unicorn) via SDK
  const snapshot = buildSnapshotHash({
    formula: "first_n",
    participants: Array.from({ length: 4 }, (_, i) => ({ id: `p_${i}`, order: i })),
  });
  const blob: Buffer = buildArtifact({
    type: "outcome_standard_v1_2_1",
    formula: "first_n",
    input_lamports: Number(INPUT_LAMPORTS),
    payout_lamports: 0,
    snapshot_hash: snapshot.snapshotHash,
    snapshot_count: snapshot.snapshotCount,
    snapshot_uri: "localnet-unicorn.bin",
    merkle_root: snapshot.merkleRoot,
    winners_count: 1,
  } as any);
  const compiledArtifactHash = sha256(blob);
  const artifactPda = deriveApprovedArtifactPda(PROGRAM_ID, compiledArtifactHash);
  const chunkCount = Math.ceil(blob.length / CHUNK_SIZE);
  const chunkPdas = Array.from({ length: chunkCount }, (_, i) => deriveApprovedArtifactChunkPda(PROGRAM_ID, compiledArtifactHash, i));

  if (!(await connection.getAccountInfo(artifactPda))) {
    await m.submitCompiledArtifact({ compiledArtifactHash: [...compiledArtifactHash], formatVersion: blob.readUInt16LE(4), blobLen: blob.length })
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
    await m.reviewCompiledArtifact({ status: STATUS_APPROVED, auditHash: [...Buffer.alloc(32, 0)], artifactUri: Buffer.from("localnet-unicorn.bin") })
      .accounts({ programConfig: programConfigPda, admin: authority, approvedOutcomeArtifact: artifactPda }).rpc();
    console.log("artifact submitted + finalized + approved");
  }

  // 3. outcome config
  const runtimeId = Buffer.from(createHash("sha256").update(`localnet-unicorn-${Date.now()}`).digest().subarray(0, 16));
  const outcomeConfigPda = deriveOutcomeConfigPda(PROGRAM_ID, runtimeId);
  const outcomeVaultPda = deriveOutcomeVaultPda(PROGRAM_ID, runtimeId);
  await m.initializeOutcomeConfig({ runtimeId: [...runtimeId], minInputLamports: new BN(INPUT_LAMPORTS.toString()), maxInputLamports: new BN(INPUT_LAMPORTS.toString()), compiledArtifactHash: [...compiledArtifactHash], masterSeed: [...Buffer.alloc(32, 1)] })
    .accounts({ authority, programConfig: programConfigPda, outcomeConfig: outcomeConfigPda, outcomeVault: outcomeVaultPda, treasury: authority, approvedOutcomeArtifact: artifactPda, systemProgram: SystemProgram.programId })
    .remainingAccounts(chunkPdas.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }))).rpc();
  console.log("outcome config initialized:", outcomeConfigPda.toBase58());

  // 4. unicorn-g config (idempotent)
  const unicornCfg = deriveUnicornGConfigPda(PROGRAM_ID);
  if (!(await connection.getAccountInfo(unicornCfg))) {
    await m.initializeUnicornGConfig({ enabled: true, rsaModulusId: [...RSA_MODULUS_ID], delayT: new BN(1000), delaySlots: new BN(3) })
      .accounts({ admin: authority, programConfig: programConfigPda, unicornGConfig: unicornCfg, systemProgram: SystemProgram.programId }).rpc();
    console.log("unicorn-g config initialized");
  }

  // 5. prepare_rng_v2_unicorn
  const resolveId = 0n;
  const rngState = deriveRngV2StatePda(PROGRAM_ID, runtimeId, resolveId);
  await m.prepareRngV2Unicorn({ runtimeId: [...runtimeId], inputLamports: new BN(INPUT_LAMPORTS.toString()), bountyLamports: new BN(BOUNTY_LAMPORTS.toString()), operatorCommitPresent: false, operatorCommitHash: [...Buffer.alloc(32, 0)] })
    .accounts({ actor: authority, programConfig: programConfigPda, unicornGConfig: unicornCfg, outcomeConfig: outcomeConfigPda, outcomeVault: outcomeVaultPda, rngV2State: rngState, approvedOutcomeArtifact: artifactPda, systemProgram: SystemProgram.programId })
    .remainingAccounts(chunkPdas.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }))).rpc();

  const state = await (program.account as any).rngV2State.fetch(rngState);
  console.log("\n=== PREPARED ===");
  console.log("runtime-id:", runtimeId.toString("hex"));
  console.log("resolve-id:", resolveId.toString());
  console.log("entropy_source:", state.entropySource, "target_slots:", state.targetSlots.map((s: any) => s.toString()));
  fs.writeFileSync("/tmp/localnet_prepared.json", JSON.stringify({ runtimeId: runtimeId.toString("hex"), resolveId: resolveId.toString(), targetSlots: state.targetSlots.map((s: any) => s.toString()) }, null, 2));
}
main().catch((e) => { console.error(e?.stack ?? String(e)); process.exit(1); });
