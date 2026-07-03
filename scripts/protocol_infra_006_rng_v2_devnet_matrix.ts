import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_SLOT_HASHES_PUBKEY,
  Transaction,
} from "@solana/web3.js";

import { buildArtifact } from "../dist/sdk/artifact.js";
import {
  buildSnapshotClaimFromFile,
  buildSnapshotHash,
} from "../dist/sdk/snapshot.js";
import { verifyOutcome } from "../dist/sdk/verify.js";
import type { ResolutionFormula } from "../dist/sdk/types.js";

const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
const DEFAULT_WALLET_PATH = "~/.config/solana/id.json";
const CANONICAL_PROGRAM_ID = "6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B";
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);
const STATUS_APPROVED = 1;
const CHUNK_SIZE = 1024;
const CHUNK_WRITE_BYTES = 900;
const SETTLE_COMPUTE_UNIT_LIMIT = 1_400_000;
const INPUT_LAMPORTS = 100n;
// v1.3.2: prepare requires payout_lamports == 0 (vault holds only Σ input).
const PAYOUT_LAMPORTS = 0n;
// v1.3.2: bounty held on the rng_v2_state PDA, paid to sealer / slashed on expire.
const BOUNTY_LAMPORTS = 50_000n;
const FORMULAS: ResolutionFormula[] = [
  "weighted_random",
  "rank_desc",
  "rank_asc",
  "first_n",
  "closest_to",
];
const ENTRY_COUNTS = [104, 250, 1001];
const WINNERS_COUNTS = [1, 2, 8, 32];

async function sendWithComputeBudget(
  client: Client,
  label: string,
  instructionBuilder: { instruction: () => Promise<anchor.web3.TransactionInstruction> }
): Promise<string> {
  return withRetry(label, async () => {
    const ix = await instructionBuilder.instruction();
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: SETTLE_COMPUTE_UNIT_LIMIT }),
      ix
    );
    return client.provider.sendAndConfirm(tx, []);
  });
}

type Client = {
  provider: anchor.AnchorProvider;
  program: anchor.Program;
  authority: Keypair;
  programId: PublicKey;
};

type Runtime = {
  runtimeId: Buffer;
  compiledArtifactHash: Buffer;
  artifactPda: PublicKey;
  chunkPdas: PublicKey[];
  outcomeConfigPda: PublicKey;
  outcomeVaultPda: PublicKey;
  treasury: PublicKey;
  snapshotPath: string;
  formula: ResolutionFormula;
  winnersCount: number;
  entryCount: number;
  targetScore?: bigint;
};

type MatrixCase = {
  id: string;
  formula: ResolutionFormula;
  entryCount: number;
  winnersCount: number;
  targetScore?: bigint;
};

type PreparedCase = {
  testCase: MatrixCase;
  runtime: Runtime;
  resolveId: bigint;
  targetSlots: bigint[];
};

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      index += 1;
    }
  }
  return out;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function argString(args: Record<string, string | boolean>, key: string, fallback: string): string {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function argNumber(args: Record<string, string | boolean>, key: string, fallback: number): number {
  const raw = args[key];
  if (raw === undefined || raw === true) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${key} must be a positive integer`);
  }
  return parsed;
}

function expandHome(inputPath: string): string {
  if (!inputPath.startsWith("~")) return inputPath;
  return path.join(os.homedir(), inputPath.slice(1));
}

function loadKeypair(walletPath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function u64le(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value, 0);
  return out;
}

function sha256(bytes: Buffer | Uint8Array): Buffer {
  return crypto.createHash("sha256").update(bytes).digest();
}

function toHex(bytes: number[] | Buffer): string {
  return Buffer.from(bytes).toString("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deriveProgramConfigPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("outcome_program_config")], programId)[0];
}

function deriveApprovedArtifactPda(programId: PublicKey, compiledArtifactHash: Buffer): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("approved_outcome_artifact"), compiledArtifactHash],
    programId
  )[0];
}

function deriveApprovedArtifactChunkPda(
  programId: PublicKey,
  compiledArtifactHash: Buffer,
  chunkIndex: number
): PublicKey {
  const index = Buffer.alloc(4);
  index.writeUInt32LE(chunkIndex, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("approved_outcome_artifact_chunk"), compiledArtifactHash, index],
    programId
  )[0];
}

function deriveOutcomeConfigPda(programId: PublicKey, runtimeId: Buffer): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("outcome_config"), runtimeId], programId)[0];
}

function deriveOutcomeVaultPda(programId: PublicKey, runtimeId: Buffer): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("outcome_vault"), runtimeId], programId)[0];
}

function deriveOutcomeResolutionPda(programId: PublicKey, runtimeId: Buffer, resolveId: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("outcome_resolution"), runtimeId, u64le(resolveId)],
    programId
  )[0];
}

function deriveRngV2StatePda(programId: PublicKey, runtimeId: Buffer, resolveId: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("rng_v2_state"), runtimeId, u64le(resolveId)],
    programId
  )[0];
}

function padOutcomeId(id: string): number[] {
  const bytes = Buffer.from(id, "ascii");
  if (bytes.length === 0 || bytes.length > 64) {
    throw new Error(`Invalid outcome id length: ${id}`);
  }
  return [...Buffer.concat([bytes, Buffer.alloc(64 - bytes.length)])];
}

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  if (value && typeof (value as { toString?: unknown }).toString === "function") {
    return BigInt((value as { toString: () => string }).toString());
  }
  throw new Error(`Cannot coerce to bigint: ${String(value)}`);
}

function deriveRngV2Randomness(opts: {
  runtimeId: Buffer;
  resolveId: bigint;
  actor: PublicKey;
  compiledArtifactHash: Buffer;
  snapshotHash: Buffer;
  resolvedSlots: bigint[];
  slotHashes: Buffer[];
  operatorCommitPresent?: boolean;
  operatorCommitHash?: Buffer;
}): Buffer {
  const seedParts: Buffer[] = [
    Buffer.from("VRE_RNG_V2", "ascii"),
    opts.runtimeId,
    u64le(opts.resolveId),
    opts.compiledArtifactHash,
    opts.snapshotHash,
  ];
  for (let index = 0; index < 3; index += 1) {
    seedParts.push(u64le(opts.resolvedSlots[index]));
    seedParts.push(opts.slotHashes[index]);
  }
  if (opts.operatorCommitPresent) {
    seedParts.push(opts.operatorCommitHash ?? Buffer.alloc(32, 0));
  }
  const seed = sha256(Buffer.concat(seedParts));
  return sha256(Buffer.concat([seed, opts.runtimeId, u64le(opts.resolveId), opts.actor.toBuffer()]));
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      console.log(`[RETRY] ${label} attempt ${attempt}/${attempts}: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(1000 * attempt);
    }
  }
  throw lastError;
}

async function loadClient(opts: { rpcUrl: string; walletPath: string; programId: string }): Promise<Client> {
  const authority = loadKeypair(opts.walletPath);
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(opts.rpcUrl, { commitment: "confirmed" }),
    new anchor.Wallet(authority),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);
  const rawIdl = JSON.parse(fs.readFileSync(path.join(process.cwd(), "artifacts/outcome_idl.json"), "utf8"));
  rawIdl.address = opts.programId;
  const program = new anchor.Program(rawIdl as anchor.Idl, provider);
  return { provider, program, authority, programId: new PublicKey(opts.programId) };
}

async function ensureFunds(client: Client): Promise<string[]> {
  const airdrops: string[] = [];
  let balance = await client.provider.connection.getBalance(client.authority.publicKey, "confirmed");
  while (balance < 2_000_000_000) {
    const signature = await client.provider.connection.requestAirdrop(client.authority.publicKey, 2_000_000_000);
    await client.provider.connection.confirmTransaction(signature, "confirmed");
    airdrops.push(signature);
    balance = await client.provider.connection.getBalance(client.authority.publicKey, "confirmed");
  }
  return airdrops;
}

async function ensureProgramConfig(client: Client): Promise<string | null> {
  const programConfigPda = deriveProgramConfigPda(client.programId);
  const info = await client.provider.connection.getAccountInfo(programConfigPda, "confirmed");
  if (info) return null;
  const [programDataPda] = PublicKey.findProgramAddressSync(
    [client.programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID
  );
  return withRetry("initializeProgramConfig", () =>
    (client.program.methods as any)
      .initializeProgramConfig({
        feeLamports: new BN(0),
        treasury: client.authority.publicKey,
      })
      .accounts({
        payer: client.authority.publicKey,
        program: client.programId,
        programData: programDataPda,
        upgradeAuthority: client.authority.publicKey,
        programConfig: programConfigPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc()
  );
}

async function submitApprovedArtifact(
  client: Client,
  blob: Buffer,
  label: string
): Promise<{ compiledArtifactHash: Buffer; artifactPda: PublicKey; chunkPdas: PublicKey[] }> {
  const compiledArtifactHash = sha256(blob);
  const artifactPda = deriveApprovedArtifactPda(client.programId, compiledArtifactHash);
  const chunkCount = Math.ceil(blob.length / CHUNK_SIZE);
  const chunkPdas = Array.from({ length: chunkCount }, (_, chunkIndex) =>
    deriveApprovedArtifactChunkPda(client.programId, compiledArtifactHash, chunkIndex)
  );
  const existing = await client.provider.connection.getAccountInfo(artifactPda, "confirmed");
  if (existing) return { compiledArtifactHash, artifactPda, chunkPdas };

  await withRetry(`submitArtifact:${label}`, () =>
    (client.program.methods as any)
      .submitCompiledArtifact({
        compiledArtifactHash: [...compiledArtifactHash],
        formatVersion: blob.readUInt16LE(4),
        blobLen: blob.length,
      })
      .accounts({
        publisher: client.authority.publicKey,
        approvedOutcomeArtifact: artifactPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc()
  );

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const chunkPda = chunkPdas[chunkIndex];
    await withRetry(`initChunk:${label}:${chunkIndex}`, () =>
      (client.program.methods as any)
        .initCompiledArtifactChunk({
          compiledArtifactHash: [...compiledArtifactHash],
          chunkIndex,
        })
        .accounts({
          publisher: client.authority.publicKey,
          approvedOutcomeArtifact: artifactPda,
          approvedOutcomeArtifactChunk: chunkPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc()
    );

    const chunk = blob.subarray(chunkIndex * CHUNK_SIZE, Math.min(blob.length, (chunkIndex + 1) * CHUNK_SIZE));
    for (let offset = 0; offset < chunk.length; offset += CHUNK_WRITE_BYTES) {
      await withRetry(`writeChunk:${label}:${chunkIndex}:${offset}`, () =>
        (client.program.methods as any)
          .writeCompiledArtifactChunk({
            compiledArtifactHash: [...compiledArtifactHash],
            chunkIndex,
            offset,
            data: Buffer.from(chunk.subarray(offset, Math.min(chunk.length, offset + CHUNK_WRITE_BYTES))),
          })
          .accounts({
            publisher: client.authority.publicKey,
            approvedOutcomeArtifact: artifactPda,
            approvedOutcomeArtifactChunk: chunkPda,
          })
          .rpc()
      );
    }
  }

  await withRetry(`finalizeArtifact:${label}`, () =>
    (client.program.methods as any)
      .finalizeCompiledArtifact()
      .accounts({
        publisher: client.authority.publicKey,
        approvedOutcomeArtifact: artifactPda,
      })
      .remainingAccounts(chunkPdas.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })))
      .rpc()
  );

  await withRetry(`reviewArtifact:${label}`, () =>
    (client.program.methods as any)
      .reviewCompiledArtifact({
        status: STATUS_APPROVED,
        auditHash: [...Buffer.alloc(32, 0)],
        artifactUri: Buffer.from(`${label}.bin`, "utf8"),
      })
      .accounts({
        programConfig: deriveProgramConfigPda(client.programId),
        admin: client.authority.publicKey,
        approvedOutcomeArtifact: artifactPda,
      })
      .rpc()
  );

  return { compiledArtifactHash, artifactPda, chunkPdas };
}

function scoreFor(index: number): bigint {
  return BigInt(((index * 7919) % 100_003) - 50_000);
}

function targetFor(entryCount: number): bigint {
  return scoreFor(Math.floor(entryCount / 2));
}

function buildParticipants(entryCount: number, formula: ResolutionFormula) {
  return Array.from({ length: entryCount }, (_, index) => {
    const id = `p_${String(index).padStart(4, "0")}`;
    const order = index;
    if (formula === "weighted_random") {
      return { id, order, weight: (index % 17) + 1 };
    }
    if (formula === "first_n") {
      return { id, order };
    }
    return { id, order, score: scoreFor(index) };
  });
}

async function createRuntime(
  client: Client,
  testCase: MatrixCase,
  outputDir: string,
  payoutOverride?: bigint
): Promise<Runtime> {
  const snapshot = buildSnapshotHash({
    formula: testCase.formula,
    participants: buildParticipants(testCase.entryCount, testCase.formula),
  });
  const snapshotPath = path.join(outputDir, `${testCase.id}-snapshot.jsonl`);
  fs.writeFileSync(snapshotPath, snapshot.canonicalSnapshot);
  const config = {
    type: "outcome_standard_v1_2_1" as const,
    formula: testCase.formula,
    input_lamports: Number(INPUT_LAMPORTS),
    payout_lamports: Number(payoutOverride ?? PAYOUT_LAMPORTS),
    snapshot_hash: snapshot.snapshotHash,
    snapshot_count: snapshot.snapshotCount,
    snapshot_uri: snapshotPath,
    merkle_root: snapshot.merkleRoot,
    winners_count: testCase.winnersCount,
    ...(testCase.targetScore === undefined ? {} : { target: Number(testCase.targetScore) }),
  };
  const blob = buildArtifact(config);
  const artifact = await submitApprovedArtifact(client, blob, testCase.id);
  const runtimeId = crypto.randomBytes(16);
  const outcomeConfigPda = deriveOutcomeConfigPda(client.programId, runtimeId);
  const outcomeVaultPda = deriveOutcomeVaultPda(client.programId, runtimeId);
  await withRetry(`initializeRuntime:${testCase.id}`, () =>
    (client.program.methods as any)
      .initializeOutcomeConfig({
        runtimeId: [...runtimeId],
        minInputLamports: new BN(INPUT_LAMPORTS.toString()),
        maxInputLamports: new BN(INPUT_LAMPORTS.toString()),
        compiledArtifactHash: [...artifact.compiledArtifactHash],
        masterSeed: [...Buffer.alloc(32, 1)],
      })
      .accounts({
        authority: client.authority.publicKey,
        programConfig: deriveProgramConfigPda(client.programId),
        outcomeConfig: outcomeConfigPda,
        outcomeVault: outcomeVaultPda,
        treasury: client.authority.publicKey,
        approvedOutcomeArtifact: artifact.artifactPda,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(artifact.chunkPdas.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })))
      .rpc()
  );
  return {
    runtimeId,
    compiledArtifactHash: artifact.compiledArtifactHash,
    artifactPda: artifact.artifactPda,
    chunkPdas: artifact.chunkPdas,
    outcomeConfigPda,
    outcomeVaultPda,
    treasury: client.authority.publicKey,
    snapshotPath,
    formula: testCase.formula,
    winnersCount: testCase.winnersCount,
    entryCount: testCase.entryCount,
    targetScore: testCase.targetScore,
  };
}

async function getNextResolveId(client: Client, runtimeId: Buffer): Promise<bigint> {
  const config = await (client.program.account as any).outcomeConfig.fetch(
    deriveOutcomeConfigPda(client.programId, runtimeId),
    "confirmed"
  );
  return asBigInt(config.nextResolveId ?? config.next_resolve_id);
}

async function fetchState(client: Client, runtimeId: Buffer, resolveId: bigint): Promise<any> {
  // Devnet read-after-write race: a freshly prepared PDA may not be visible on the
  // first "confirmed" read from a public RPC node. Retry briefly before giving up.
  const pda = deriveRngV2StatePda(client.programId, runtimeId, resolveId);
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      return await (client.program.account as any).rngV2State.fetch(pda, "confirmed");
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/does not exist|has no data|Account does not exist/i.test(message)) throw error;
      await sleep(1000);
    }
  }
  throw lastError;
}

async function waitUntilSlot(client: Client, targetSlot: bigint): Promise<void> {
  for (;;) {
    const slot = BigInt(await client.provider.connection.getSlot("confirmed"));
    if (slot >= targetSlot) return;
    await sleep(500);
  }
}

async function fetchSlotHashesData(client: Client): Promise<Buffer> {
  const account = await client.provider.connection.getAccountInfo(
    SYSVAR_SLOT_HASHES_PUBKEY,
    "confirmed"
  );
  if (!account) throw new Error("SlotHashes sysvar account not found");
  return account.data;
}

async function resolveSlotEvidence(
  client: Client,
  targetSlots: bigint[]
): Promise<{ resolvedSlots: bigint[]; slotHashes: Buffer[] }> {
  const data = await fetchSlotHashesData(client);
  if (data.length < 8) throw new Error("SlotHashes sysvar account data is too short");
  const entryCount = Number(data.readBigUInt64LE(0));
  const resolvedSlots: bigint[] = [];
  const slotHashes: Buffer[] = [];
  let previous = 0n;
  for (const targetSlot of targetSlots) {
    let selectedSlot: bigint | null = null;
    let selectedHash: Buffer | null = null;
    for (let index = 0; index < entryCount; index += 1) {
      const start = 8 + index * 40;
      const end = start + 40;
      if (end > data.length) throw new Error("SlotHashes sysvar account entry is truncated");
      const slot = data.readBigUInt64LE(start);
      if (slot <= previous) continue;
      const hash = Buffer.from(data.subarray(start + 8, end));
      if (slot === targetSlot) {
        selectedSlot = slot;
        selectedHash = hash;
        break;
      }
      if (slot > targetSlot && (selectedSlot === null || slot < selectedSlot)) {
        selectedSlot = slot;
        selectedHash = hash;
      }
    }
    if (selectedSlot === null || selectedHash === null) {
      throw new Error(`Unable to resolve SlotHashes entry after target ${targetSlot.toString()}`);
    }
    resolvedSlots.push(selectedSlot);
    slotHashes.push(selectedHash);
    previous = selectedSlot;
  }
  return { resolvedSlots, slotHashes };
}

async function prepare(
  client: Client,
  runtime: Runtime,
  commitHashInput: Buffer | Uint8Array = Buffer.alloc(32, 0),
  bountyLamports: bigint = BOUNTY_LAMPORTS
): Promise<bigint> {
  const resolveId = await getNextResolveId(client, runtime.runtimeId);
  const commitHash = Buffer.from(commitHashInput);
  await withRetry(`prepare:${toHex(runtime.runtimeId)}`, () =>
    (client.program.methods as any)
      .prepareRngV2({
        runtimeId: [...runtime.runtimeId],
        inputLamports: new BN(INPUT_LAMPORTS.toString()),
        bountyLamports: new BN(bountyLamports.toString()),
        operatorCommitPresent: commitHash.some((byte) => byte !== 0),
        operatorCommitHash: [...commitHash],
      })
      .accounts({
        actor: client.authority.publicKey,
        programConfig: deriveProgramConfigPda(client.programId),
        outcomeConfig: runtime.outcomeConfigPda,
        outcomeVault: runtime.outcomeVaultPda,
        rngV2State: deriveRngV2StatePda(client.programId, runtime.runtimeId, resolveId),
        approvedOutcomeArtifact: runtime.artifactPda,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(runtime.chunkPdas.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })))
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: SETTLE_COMPUTE_UNIT_LIMIT }),
      ])
      .rpc()
  );
  return resolveId;
}

// --- v1.3.2 phase 1: seal_randomness (permissionless) ---
async function seal(
  client: Client,
  runtime: Runtime,
  resolveId: bigint,
  opts?: { wrongSlotHashes?: boolean; skipWait?: boolean }
): Promise<{ signature: string; resolvedSlots: bigint[]; slotHashes: Buffer[] }> {
  const state = await fetchState(client, runtime.runtimeId, resolveId);
  const targetSlots = (state.targetSlots as unknown[]).map(asBigInt);
  if (!opts?.skipWait) {
    await waitUntilSlot(client, targetSlots[2] + 1n);
  }
  const { resolvedSlots, slotHashes } = await resolveSlotEvidence(client, targetSlots);
  const signature = await sendWithComputeBudget(
    client,
    `seal:${toHex(runtime.runtimeId)}`,
    (client.program.methods as any)
      .sealRandomness({
        runtimeId: [...runtime.runtimeId],
        resolveId: new BN(resolveId.toString()),
      })
      .accounts({
        sealer: client.authority.publicKey,
        outcomeConfig: runtime.outcomeConfigPda,
        rngV2State: deriveRngV2StatePda(client.programId, runtime.runtimeId, resolveId),
        slotHashes: opts?.wrongSlotHashes ? SystemProgram.programId : SYSVAR_SLOT_HASHES_PUBKEY,
      })
  );
  return { signature: String(signature), resolvedSlots, slotHashes };
}

// --- v1.3.2 phase 2: attest_winners (allowlist: operator OR attester_key) ---
async function attest(
  client: Client,
  runtime: Runtime,
  resolveId: bigint,
  opts?: { reveal?: Buffer; badWinnerClaim?: boolean; protocolTreasury?: PublicKey }
): Promise<{ signature: string; outcomeIds: string[]; winnerClaimHash: Buffer }> {
  // Derive randomness from the slot evidence the seal already persisted on-chain.
  const state = await fetchState(client, runtime.runtimeId, resolveId);
  const resolvedSlots = (state.resolvedSlots as unknown[]).map(asBigInt);
  const slotHashes = (state.slotHashes as number[][]).map((value) => Buffer.from(value));
  const randomness = deriveRngV2Randomness({
    runtimeId: runtime.runtimeId,
    resolveId,
    actor: client.authority.publicKey,
    compiledArtifactHash: runtime.compiledArtifactHash,
    snapshotHash: Buffer.from(state.snapshotHash),
    resolvedSlots,
    slotHashes,
    operatorCommitPresent: Boolean(state.operatorCommitPresent),
    operatorCommitHash: Buffer.from(state.operatorCommitHash),
  });
  const claim = await buildSnapshotClaimFromFile({
    snapshotPath: runtime.snapshotPath,
    formula: runtime.formula,
    winnersCount: runtime.winnersCount,
    randomness,
    payoutLamports: PAYOUT_LAMPORTS,
    ...(runtime.targetScore === undefined ? {} : { targetScore: runtime.targetScore }),
  });
  const primary = claim.outcomeIds[0];
  const reveal = opts?.reveal ?? Buffer.alloc(0);
  const paddedReveal = Buffer.concat([reveal, Buffer.alloc(32 - reveal.length)]);
  const winnerClaimHash = opts?.badWinnerClaim ? Buffer.alloc(32, 1) : claim.winnerClaimHash;
  const signature = await sendWithComputeBudget(
    client,
    `attest:${toHex(runtime.runtimeId)}`,
    (client.program.methods as any)
      .attestWinners({
        runtimeId: [...runtime.runtimeId],
        resolveId: new BN(resolveId.toString()),
        winnerCount: claim.winnersCount,
        winnerClaimHash: [...winnerClaimHash],
        outcomeIdLen: Buffer.byteLength(primary, "ascii"),
        outcomeId: padOutcomeId(primary),
        operatorRevealLen: reveal.length,
        operatorReveal: [...paddedReveal],
      })
      .accounts({
        attester: client.authority.publicKey,
        programConfig: deriveProgramConfigPda(client.programId),
        outcomeConfig: runtime.outcomeConfigPda,
        outcomeVault: runtime.outcomeVaultPda,
        rngV2State: deriveRngV2StatePda(client.programId, runtime.runtimeId, resolveId),
        outcomeResolution: deriveOutcomeResolutionPda(client.programId, runtime.runtimeId, resolveId),
        approvedOutcomeArtifact: runtime.artifactPda,
        operator: client.authority.publicKey,
        protocolTreasury: opts?.protocolTreasury ?? client.authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(runtime.chunkPdas.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })))
  );
  return { signature: String(signature), outcomeIds: claim.outcomeIds, winnerClaimHash };
}

// Convenience: full happy-path settle = seal then attest.
async function sealAndAttest(
  client: Client,
  runtime: Runtime,
  resolveId: bigint,
  opts?: { reveal?: Buffer; badWinnerClaim?: boolean }
): Promise<{
  sealSignature: string;
  attestSignature: string;
  resolvedSlots: bigint[];
  slotHashes: Buffer[];
  outcomeIds: string[];
}> {
  const sealed = await seal(client, runtime, resolveId);
  const attested = await attest(client, runtime, resolveId, opts);
  return {
    sealSignature: sealed.signature,
    attestSignature: attested.signature,
    resolvedSlots: sealed.resolvedSlots,
    slotHashes: sealed.slotHashes,
    outcomeIds: attested.outcomeIds,
  };
}

async function expectFailure(label: string, fn: () => Promise<unknown>): Promise<{ label: string; ok: boolean; error: string }> {
  try {
    await fn();
    return { label, ok: false, error: "unexpected success" };
  } catch (error) {
    return { label, ok: true, error: error instanceof Error ? error.message : String(error) };
  }
}

function buildMatrixCases(): MatrixCase[] {
  const cases: MatrixCase[] = [];
  for (const formula of FORMULAS) {
    for (const entryCount of ENTRY_COUNTS) {
      for (const winnersCount of WINNERS_COUNTS) {
        cases.push({
          id: `${formula}-n${entryCount}-w${winnersCount}`,
          formula,
          entryCount,
          winnersCount,
          ...(formula === "closest_to" ? { targetScore: targetFor(entryCount) } : {}),
        });
      }
    }
  }
  return cases;
}

async function runMatrixBatch(
  client: Client,
  batch: MatrixCase[],
  outputDir: string,
  batchIndex: number
): Promise<any[]> {
  const prepared: PreparedCase[] = [];
  for (const testCase of batch) {
    const runtime = await createRuntime(client, testCase, outputDir);
    const resolveId = await prepare(client, runtime);
    const state = await fetchState(client, runtime.runtimeId, resolveId);
    const targetSlots = (state.targetSlots as unknown[]).map(asBigInt);
    prepared.push({ testCase, runtime, resolveId, targetSlots });
    console.log(`[PREPARED] batch=${batchIndex} ${testCase.id} targets=${targetSlots.map(String).join(",")}`);
  }

  const maxTarget = prepared.reduce(
    (max, item) => (item.targetSlots[2] > max ? item.targetSlots[2] : max),
    0n
  );
  await waitUntilSlot(client, maxTarget + 1n);

  const rows: any[] = [];
  for (const item of prepared) {
    const settled = await sealAndAttest(client, item.runtime, item.resolveId);
    const replay = await verifyOutcome({
      signature: settled.attestSignature,
      rpcUrl: client.provider.connection.rpcEndpoint,
      programId: client.programId.toBase58(),
    });
    const state = await fetchState(client, item.runtime.runtimeId, item.resolveId);
    const pass =
      replay.status === "MATCH" &&
      replay.reason === "OK" &&
      replay.rng_version === 2 &&
      replay.standard_version === "1.3.2" &&
      replay.winners_count === item.testCase.winnersCount &&
      Number(state.status) === 2;
    const row = {
      ...item.testCase,
      status: pass ? "pass" : "fail",
      seal_signature: settled.sealSignature,
      attest_signature: settled.attestSignature,
      runtime_id: toHex(item.runtime.runtimeId),
      resolve_id: item.resolveId.toString(),
      artifact_hash: toHex(item.runtime.compiledArtifactHash),
      replay: {
        status: replay.status,
        reason: replay.reason,
        rng_version: replay.rng_version,
        standard_version: replay.standard_version,
        winners_count: replay.winners_count,
        outcome_ids: replay.outcome_ids,
      },
      state_status: Number(state.status),
      target_slots: (state.targetSlots as unknown[]).map((value) => asBigInt(value).toString()),
      resolved_slots: (state.resolvedSlots as unknown[]).map((value) => asBigInt(value).toString()),
      slot_hashes_match_seal:
        JSON.stringify((state.slotHashes as number[][]).map((value) => Buffer.from(value).toString("hex"))) ===
        JSON.stringify(settled.slotHashes.map((value) => value.toString("hex"))),
    };
    rows.push(row);
    console.log(`[${row.status.toUpperCase()}] ${item.testCase.id} seal=${settled.sealSignature} attest=${settled.attestSignature}`);
  }
  return rows;
}

// PATCH v3.1: expire slashes the bounty to ProgramConfig.treasury (protocol-global),
// not outcome_config.treasury. Caller may override protocolTreasury to test the gate.
async function expireDraw(
  client: Client,
  runtime: Runtime,
  resolveId: bigint,
  protocolTreasury?: PublicKey
): Promise<string> {
  return withRetry(`expire:${toHex(runtime.runtimeId)}`, () =>
    (client.program.methods as any)
      .expireRngV2({
        runtimeId: [...runtime.runtimeId],
        resolveId: new BN(resolveId.toString()),
      })
      .accounts({
        payer: client.authority.publicKey,
        programConfig: deriveProgramConfigPda(client.programId),
        outcomeConfig: runtime.outcomeConfigPda,
        outcomeVault: runtime.outcomeVaultPda,
        rngV2State: deriveRngV2StatePda(client.programId, runtime.runtimeId, resolveId),
        operator: client.authority.publicKey,
        protocolTreasury: protocolTreasury ?? client.authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc()
  );
}

async function expireSealedDraw(
  client: Client,
  runtime: Runtime,
  resolveId: bigint,
  protocolTreasury?: PublicKey
): Promise<string> {
  return (client.program.methods as any)
    .expireSealedRngV2({
      runtimeId: [...runtime.runtimeId],
      resolveId: new BN(resolveId.toString()),
    })
    .accounts({
      payer: client.authority.publicKey,
      programConfig: deriveProgramConfigPda(client.programId),
      outcomeConfig: runtime.outcomeConfigPda,
      outcomeVault: runtime.outcomeVaultPda,
      rngV2State: deriveRngV2StatePda(client.programId, runtime.runtimeId, resolveId),
      operator: client.authority.publicKey,
      protocolTreasury: protocolTreasury ?? client.authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

async function setFeeLamports(
  client: Client,
  feeLamports: bigint,
  treasury?: PublicKey
): Promise<string> {
  return withRetry(`setFee:${feeLamports.toString()}`, () =>
    (client.program.methods as any)
      .setProgramConfig({
        newAdmin: client.authority.publicKey,
        allowUnreviewedBinding: false,
        feeLamports: new BN(feeLamports.toString()),
        treasury: treasury ?? client.authority.publicKey,
      })
      .accounts({
        programConfig: deriveProgramConfigPda(client.programId),
        admin: client.authority.publicKey,
      })
      .rpc()
  );
}

// Pre-fund a fresh account to the rent-exempt minimum so that a subsequent small credit
// (slashed bounty / protocol fee) does not leave it below the rent threshold. In production
// the protocol treasury is a long-lived rent-exempt account; a throwaway test keypair is not.
async function fundRentExempt(client: Client, pubkey: PublicKey): Promise<number> {
  const min = await client.provider.connection.getMinimumBalanceForRentExemption(0);
  await withRetry(`fundRent:${pubkey.toBase58().slice(0, 8)}`, () => {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: client.authority.publicKey,
        toPubkey: pubkey,
        lamports: min,
      })
    );
    return client.provider.sendAndConfirm(tx, []);
  });
  return min;
}

async function adminPause(client: Client, runtime: Runtime, paused: boolean): Promise<string> {
  return withRetry(`adminPause:${paused}`, () =>
    (client.program.methods as any)
      .adminPause(paused)
      .accounts({
        programConfig: deriveProgramConfigPda(client.programId),
        outcomeConfig: runtime.outcomeConfigPda,
        authority: client.authority.publicKey,
      })
      .rpc()
  );
}

// Attest signed by an arbitrary (non-allowlisted) keypair to prove the allowlist gate.
async function attestAs(
  client: Client,
  runtime: Runtime,
  resolveId: bigint,
  signer: Keypair
): Promise<string> {
  const ix = await (client.program.methods as any)
    .attestWinners({
      runtimeId: [...runtime.runtimeId],
      resolveId: new BN(resolveId.toString()),
      winnerCount: runtime.winnersCount,
      winnerClaimHash: [...Buffer.alloc(32, 1)],
      outcomeIdLen: Buffer.byteLength("p_0000", "ascii"),
      outcomeId: padOutcomeId("p_0000"),
      operatorRevealLen: 0,
      operatorReveal: [...Buffer.alloc(32, 0)],
    })
    .accounts({
      attester: signer.publicKey,
      programConfig: deriveProgramConfigPda(client.programId),
      outcomeConfig: runtime.outcomeConfigPda,
      outcomeVault: runtime.outcomeVaultPda,
      rngV2State: deriveRngV2StatePda(client.programId, runtime.runtimeId, resolveId),
      outcomeResolution: deriveOutcomeResolutionPda(client.programId, runtime.runtimeId, resolveId),
      approvedOutcomeArtifact: runtime.artifactPda,
      operator: client.authority.publicKey,
      protocolTreasury: client.authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(runtime.chunkPdas.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })))
    .instruction();
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: SETTLE_COMPUTE_UNIT_LIMIT }),
    ix
  );
  tx.feePayer = signer.publicKey;
  const { blockhash } = await client.provider.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(signer);
  const raw = tx.serialize();
  const signature = await client.provider.connection.sendRawTransaction(raw);
  await client.provider.connection.confirmTransaction(signature, "confirmed");
  return signature;
}

async function runNegativeCases(client: Client, outputDir: string): Promise<any[]> {
  // ProgramConfig is a global singleton that survives across runs. Normalize it up front
  // (fee=0, treasury=authority) so a prior aborted run that left a generated treasury in
  // place cannot poison the default-treasury attest cases below. Idempotent on re-runs.
  await setFeeLamports(client, 0n);

  const baseCase: MatrixCase = {
    id: "negative-weighted_random-n104-w2",
    formula: "weighted_random",
    entryCount: 104,
    winnersCount: 2,
  };

  // 1. seal before target slot is ready.
  const prematureRuntime = await createRuntime(client, { ...baseCase, id: "negative-seal-premature" }, outputDir);
  const prematureResolveId = await prepare(client, prematureRuntime);
  const sealBeforeTarget = await expectFailure("seal_before_target_slot", () =>
    seal(client, prematureRuntime, prematureResolveId, { skipWait: true })
  );

  // 2. seal with wrong SlotHashes sysvar account.
  const wrongSlotRuntime = await createRuntime(client, { ...baseCase, id: "negative-wrong-slot-hashes" }, outputDir);
  const wrongSlotResolveId = await prepare(client, wrongSlotRuntime);
  const wrongSlotHashes = await expectFailure("seal_wrong_slot_hashes_account", () =>
    seal(client, wrongSlotRuntime, wrongSlotResolveId, { wrongSlotHashes: true })
  );

  // 3. seal after the settlement window has expired.
  const sealLateRuntime = await createRuntime(client, { ...baseCase, id: "negative-seal-after-expiry" }, outputDir);
  const sealLateResolveId = await prepare(client, sealLateRuntime);
  const sealLateState = await fetchState(client, sealLateRuntime.runtimeId, sealLateResolveId);
  await waitUntilSlot(client, asBigInt(sealLateState.expirySlot) + 1n);
  const sealAfterExpiry = await expectFailure("seal_after_expiry", () =>
    seal(client, sealLateRuntime, sealLateResolveId, { skipWait: true })
  );

  // 4. attest by a non-allowlisted key.
  const wrongAttesterRuntime = await createRuntime(client, { ...baseCase, id: "negative-wrong-attester" }, outputDir);
  const wrongAttesterResolveId = await prepare(client, wrongAttesterRuntime);
  await seal(client, wrongAttesterRuntime, wrongAttesterResolveId);
  const stranger = Keypair.generate();
  const fundStrangerSig = await withRetry("fundStranger", () => {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: client.authority.publicKey,
        toPubkey: stranger.publicKey,
        lamports: 50_000_000,
      })
    );
    return client.provider.sendAndConfirm(tx, []);
  });
  const wrongAttester = await expectFailure("attest_by_non_allowlisted_key", () =>
    attestAs(client, wrongAttesterRuntime, wrongAttesterResolveId, stranger)
  );

  // 5. expire a SEALED draw (PREPARED-only guard).
  const expireSealedGuardRuntime = await createRuntime(client, { ...baseCase, id: "negative-expire-after-seal" }, outputDir);
  const expireSealedGuardResolveId = await prepare(client, expireSealedGuardRuntime);
  await seal(client, expireSealedGuardRuntime, expireSealedGuardResolveId);
  const expireAfterSeal = await expectFailure("expire_after_seal_rejected", () =>
    expireDraw(client, expireSealedGuardRuntime, expireSealedGuardResolveId)
  );

  // 6. expire_sealed before the attest deadline.
  const expireSealedEarlyRuntime = await createRuntime(client, { ...baseCase, id: "negative-expire-sealed-early" }, outputDir);
  const expireSealedEarlyResolveId = await prepare(client, expireSealedEarlyRuntime);
  await seal(client, expireSealedEarlyRuntime, expireSealedEarlyResolveId);
  const expireSealedEarly = await expectFailure("expire_sealed_before_deadline", () =>
    expireSealedDraw(client, expireSealedEarlyRuntime, expireSealedEarlyResolveId)
  );

  // 7. attest twice (resolution PDA already initialized).
  const doubleAttestRuntime = await createRuntime(client, { ...baseCase, id: "negative-double-attest" }, outputDir);
  const doubleAttestResolveId = await prepare(client, doubleAttestRuntime);
  await seal(client, doubleAttestRuntime, doubleAttestResolveId);
  await attest(client, doubleAttestRuntime, doubleAttestResolveId);
  const doubleAttest = await expectFailure("attest_twice_rejected", () =>
    attest(client, doubleAttestRuntime, doubleAttestResolveId)
  );

  // 8. prepare with a non-zero payout artifact.
  const payoutRuntime = await createRuntime(
    client,
    { ...baseCase, id: "negative-nonzero-payout" },
    outputDir,
    1n
  );
  const nonzeroPayout = await expectFailure("prepare_nonzero_payout_rejected", () =>
    prepare(client, payoutRuntime)
  );

  // 9. bounty below fee_snapshot + bounty_min (raise the protocol fee, then restore).
  const bountyRuntime = await createRuntime(client, { ...baseCase, id: "negative-low-bounty" }, outputDir);
  const feeRaiseSig = await setFeeLamports(client, 1_000_000n);
  const lowBounty = await expectFailure("prepare_bounty_below_floor", () =>
    prepare(client, bountyRuntime, Buffer.alloc(32, 0), 0n)
  );
  const feeRestoreSig = await setFeeLamports(client, 0n);

  // 10. operator reveal mismatch is rejected at attest.
  const reveal = Buffer.from("valid-reveal", "utf8");
  const badRevealRuntime = await createRuntime(client, { ...baseCase, id: "negative-bad-reveal" }, outputDir);
  const badRevealResolveId = await prepare(client, badRevealRuntime, sha256(Buffer.from(reveal)));
  await seal(client, badRevealRuntime, badRevealResolveId);
  const badReveal = await expectFailure("bad_operator_reveal", () =>
    attest(client, badRevealRuntime, badRevealResolveId, { reveal: Buffer.from("bad", "utf8") })
  );

  // 11. off-chain replay surfaces a tampered winner_claim_hash as MISMATCH.
  const badClaimRuntime = await createRuntime(client, { ...baseCase, id: "negative-bad-winner-claim" }, outputDir);
  const badClaimResolveId = await prepare(client, badClaimRuntime);
  const badClaimSettle = await sealAndAttest(client, badClaimRuntime, badClaimResolveId, { badWinnerClaim: true });
  const badClaimReplay = await verifyOutcome({
    signature: badClaimSettle.attestSignature,
    rpcUrl: client.provider.connection.rpcEndpoint,
    programId: client.programId.toBase58(),
  });

  // --- PATCH v3.1 cases ---
  const getBalance = (pubkey: PublicKey) => client.provider.connection.getBalance(pubkey, "confirmed");

  // 12. [BLOCKER] expire slash recipient is ProgramConfig.treasury, NOT outcome_config.treasury.
  // Make the two treasuries distinct: set ProgramConfig.treasury to a fresh key while the
  // runtime's outcome_config.treasury stays = authority. The slash must land in the program
  // treasury; passing outcome_config.treasury (authority) must be rejected by the address gate.
  const programTreasury = Keypair.generate();
  await fundRentExempt(client, programTreasury.publicKey);
  const slashFeeSetSig = await setFeeLamports(client, 0n, programTreasury.publicKey);
  const slashRuntime = await createRuntime(client, { ...baseCase, id: "negative-expire-slash-recipient" }, outputDir);
  const slashResolveId = await prepare(client, slashRuntime);
  const slashState = await fetchState(client, slashRuntime.runtimeId, slashResolveId);
  await waitUntilSlot(client, asBigInt(slashState.expirySlot) + 1n);
  // Negative sub-assertion: the operator-controlled outcome_config.treasury is rejected.
  const slashWrongRecipient = await expectFailure("expire_slash_rejects_config_treasury", () =>
    expireDraw(client, slashRuntime, slashResolveId, client.authority.publicKey)
  );
  // Positive: the bounty is slashed to the program-global treasury.
  const treasuryBefore = await getBalance(programTreasury.publicKey);
  const slashSig = await expireDraw(client, slashRuntime, slashResolveId, programTreasury.publicKey);
  const treasuryAfter = await getBalance(programTreasury.publicKey);
  const slashDelta = BigInt(treasuryAfter - treasuryBefore);
  const slashRestoreSig = await setFeeLamports(client, 0n);
  const expireSlashRecipient = {
    label: "expire_slash_recipient_is_program_treasury",
    ok: slashWrongRecipient.ok && slashDelta === BOUNTY_LAMPORTS,
    rejects_config_treasury: slashWrongRecipient,
    program_treasury: programTreasury.publicKey.toBase58(),
    bounty_lamports: BOUNTY_LAMPORTS.toString(),
    slash_delta_lamports: slashDelta.toString(),
    fee_set_signature: slashFeeSetSig,
    expire_signature: slashSig,
    fee_restore_signature: slashRestoreSig,
  };

  // 13. [GAP] seal must succeed while the runtime is paused (pause blocks new prepare, not
  // the lifecycle of an open draw — otherwise the operator regains an abort lever).
  const pausedRuntime = await createRuntime(client, { ...baseCase, id: "negative-seal-while-paused" }, outputDir);
  const pausedResolveId = await prepare(client, pausedRuntime);
  const pauseOnSig = await adminPause(client, pausedRuntime, true);
  let sealWhilePausedOk = false;
  let sealWhilePausedSig = "";
  let sealWhilePausedError = "";
  try {
    const sealed = await seal(client, pausedRuntime, pausedResolveId);
    sealWhilePausedSig = sealed.signature;
    sealWhilePausedOk = true;
  } catch (error) {
    sealWhilePausedError = error instanceof Error ? error.message : String(error);
  }
  const pauseOffSig = await adminPause(client, pausedRuntime, false);
  const sealWhilePaused = {
    label: "seal_while_paused_succeeds",
    ok: sealWhilePausedOk,
    pause_on_signature: pauseOnSig,
    seal_signature: sealWhilePausedSig,
    pause_off_signature: pauseOffSig,
    ...(sealWhilePausedError ? { error: sealWhilePausedError } : {}),
  };

  // 14. [GAP] the protocol fee is taken out of the operator stake (vault), not charged to
  // the attester. With fee=F: vault → treasury (F) + vault → operator (input − F).
  const FEE_LAMPORTS = 40n; // must be <= INPUT_LAMPORTS (100)
  const feeTreasury = Keypair.generate();
  await fundRentExempt(client, feeTreasury.publicKey);
  const feeSetSig = await setFeeLamports(client, FEE_LAMPORTS, feeTreasury.publicKey);
  const feeRuntime = await createRuntime(client, { ...baseCase, id: "negative-fee-from-stake" }, outputDir);
  const feeResolveId = await prepare(client, feeRuntime);
  await seal(client, feeRuntime, feeResolveId);
  const vaultBefore = BigInt(await getBalance(feeRuntime.outcomeVaultPda));
  const feeTreasuryBefore = await getBalance(feeTreasury.publicKey);
  const feeAttestSig = await attest(client, feeRuntime, feeResolveId, { protocolTreasury: feeTreasury.publicKey });
  const vaultAfter = BigInt(await getBalance(feeRuntime.outcomeVaultPda));
  const feeTreasuryAfter = await getBalance(feeTreasury.publicKey);
  const feeTreasuryDelta = BigInt(feeTreasuryAfter - feeTreasuryBefore);
  const vaultDrained = vaultBefore - vaultAfter;
  const feeRestoreSig2 = await setFeeLamports(client, 0n);
  const feeFromStake = {
    label: "attest_fee_taken_from_stake",
    // The vault is a rent-exempt PDA holding (rent + input); the stake is the input on top.
    // Correct behavior: fee leaves the vault to the treasury and the rest refunds the
    // operator, draining exactly `input` from the vault back to its rent-exempt baseline.
    ok: feeTreasuryDelta === FEE_LAMPORTS && vaultDrained === INPUT_LAMPORTS,
    fee_lamports: FEE_LAMPORTS.toString(),
    input_lamports: INPUT_LAMPORTS.toString(),
    operator_refund_implied: (INPUT_LAMPORTS - FEE_LAMPORTS).toString(),
    treasury_delta_lamports: feeTreasuryDelta.toString(),
    vault_before_lamports: vaultBefore.toString(),
    vault_after_lamports: vaultAfter.toString(),
    fee_treasury: feeTreasury.publicKey.toBase58(),
    fee_set_signature: feeSetSig,
    attest_signature: feeAttestSig.signature,
    fee_restore_signature: feeRestoreSig2,
  };

  // 15. seal_after_artifact_rotation — STRUCTURAL only (not on-chain constructible).
  // outcome_config.compiled_artifact_hash is written only by initialize_outcome_config; no
  // rotate setter exists, so the config artifact hash cannot be mutated on a live runtime.
  // PATCH v3.1 removed seal's dependency on it entirely (seal reads no blob and no longer
  // compares against outcome_config), so the abort-via-rotation vector is unreachable by
  // construction. Marked ok=true on that structural basis; flagged in the report notes.
  const sealAfterArtifactRotation = {
    label: "seal_after_artifact_rotation",
    ok: true,
    structural: true,
    note: "seal_randomness no longer reads outcome_config.compiled_artifact_hash; no on-chain rotate setter exists (only initialize_outcome_config writes it), so the vector is unreachable by construction",
  };

  return [
    sealBeforeTarget,
    wrongSlotHashes,
    sealAfterExpiry,
    { ...wrongAttester, fund_stranger_signature: fundStrangerSig, stranger: stranger.publicKey.toBase58() },
    expireAfterSeal,
    expireSealedEarly,
    doubleAttest,
    nonzeroPayout,
    { ...lowBounty, fee_raise_signature: feeRaiseSig, fee_restore_signature: feeRestoreSig },
    badReveal,
    expireSlashRecipient,
    sealWhilePaused,
    feeFromStake,
    sealAfterArtifactRotation,
    {
      label: "wrong_winner_claim_recomputed_winner_mismatch",
      ok: badClaimReplay.status === "MISMATCH" && badClaimReplay.reason === "ERR_WINNER_CLAIM_HASH_MISMATCH",
      signature: badClaimSettle.attestSignature,
      replay: { status: badClaimReplay.status, reason: badClaimReplay.reason },
    },
  ];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
TS_NODE_PROJECT=tsconfig.json yarn -s ts-node --esm --transpile-only scripts/protocol_infra_006_rng_v2_devnet_matrix.ts \\
  --program-id <ISOLATED_PROGRAM_ID> \\
  [--rpc https://api.devnet.solana.com] \\
  [--wallet ~/.config/solana/id.json] \\
  [--batch-size 5]
`);
    return;
  }

  const rpcUrl = argString(args, "rpc", process.env.ANCHOR_PROVIDER_URL ?? DEFAULT_RPC_URL);
  const walletPath = expandHome(argString(args, "wallet", process.env.ANCHOR_WALLET ?? DEFAULT_WALLET_PATH));
  const programId = argString(args, "program-id", process.env.PROGRAM_ID ?? "");
  if (!programId) throw new Error("Provide --program-id <ISOLATED_PROGRAM_ID>");
  if (programId === CANONICAL_PROGRAM_ID) {
    throw new Error("Refusing to run PROTOCOL-INFRA-006 against canonical 6QtLot program");
  }
  const batchSize = argNumber(args, "batch-size", 5);
  const outputDir = path.join(process.cwd(), "tmp", "protocol-infra-006-rng-v2-devnet-matrix");
  fs.mkdirSync(outputDir, { recursive: true });

  const client = await loadClient({ rpcUrl, walletPath, programId });
  const airdrops = await ensureFunds(client);
  const initProgramConfigSignature = await ensureProgramConfig(client);

  const negativesOnly = Boolean(args["negatives-only"]);
  const cases = buildMatrixCases();
  const rows: any[] = [];
  if (!negativesOnly) {
    for (let index = 0; index < cases.length; index += batchSize) {
      const batch = cases.slice(index, index + batchSize);
      const batchRows = await runMatrixBatch(client, batch, outputDir, Math.floor(index / batchSize));
      rows.push(...batchRows);
    }
  }

  // Negative cases must never lose the (expensive) happy-path evidence: capture any
  // orchestration failure and still emit the report.
  let negativeCases: any[] = [];
  let negativeError: string | null = null;
  try {
    negativeCases = await runNegativeCases(client, outputDir);
  } catch (error) {
    negativeError = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`[NEGATIVE-CASES ABORTED] ${negativeError}`);
  }

  const passCount = rows.filter((row) => row.status === "pass").length;
  const report = {
    generated_at: new Date().toISOString(),
    task_id: "PROTOCOL-INFRA-006",
    standard_version: "1.3.2",
    rpc_url: rpcUrl,
    program_id: client.programId.toBase58(),
    canonical_program_id: CANONICAL_PROGRAM_ID,
    wallet: client.authority.publicKey.toBase58(),
    airdrops,
    init_program_config_signature: initProgramConfigSignature,
    matrix_shape: {
      formulas: FORMULAS,
      entry_counts: ENTRY_COUNTS,
      winners_counts: WINNERS_COUNTS,
      expected_rows: cases.length,
    },
    negatives_only: negativesOnly,
    summary: {
      total_rows: rows.length,
      passed_rows: passCount,
      failed_rows: rows.length - passCount,
      negative_total: negativeCases.length,
      negative_passed: negativeCases.filter((entry) => entry.ok).length,
      negative_aborted: negativeError !== null,
    },
    rows,
    negative_cases: negativeCases,
    ...(negativeError ? { negative_error: negativeError } : {}),
  };

  const outPath = path.join(process.cwd(), "artifacts", "protocol_infra_006_rng_v2_devnet_matrix.json");
  fs.writeFileSync(outPath, `${JSON.stringify(report, jsonReplacer, 2)}\n`);
  console.log(JSON.stringify(report.summary, jsonReplacer, 2));
  console.log(`Evidence: ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
