import * as anchor from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";
import { PublicKey } from "@solana/web3.js";

import {
  CHUNK_SIZE,
  DEFAULT_PROGRAM_ID,
  DEFAULT_RPC_URL,
  deriveApprovedArtifactChunkPda,
  deriveApprovedArtifactPda,
  deriveOutcomeConfigPda,
  deriveOutcomeResolutionPda,
  deriveProgramConfigPda,
  outcomeIdlPath,
  sha256,
  toHex,
} from "./outcome_public_sdk.ts";

const MAX_OUTCOME_ID_BYTES = 64;
const EFFECT_ENTRY_BYTES = 16;
const FORMAT_VERSION_V1 = 1;
const MAGIC = "W3O1";
const STATUS_PENDING = 0;
const STATUS_APPROVED = 1;
const STATUS_DEPRECATED = 3;
const EFFECT_TYPE_TRANSFER_SOL = 1;

type CliArgs = Record<string, string | boolean>;

type ReplayOutput = {
  verification_result: "MATCH" | "MISMATCH";
  verification_reason: string;
  signature: string;
  program_id: string;
  runtime_id: string;
  resolve_id: string;
  compiled_artifact_hash: string;
};

type OutcomeResolvedEvent = {
  runtimeId: Buffer;
  resolveId: bigint;
  actor: PublicKey;
  inputLamports: bigint;
  totalOutputLamports: bigint;
  masterSeed: Buffer;
  randomness: Buffer;
  compiledArtifactHash: Buffer;
  outcomeIdLen: number;
  outcomeId: Buffer;
  effectCount: number;
  effectsDigest: Buffer;
};

type ParsedOutcome = {
  outcomeIdLen: number;
  outcomeId: Buffer;
  weight: number;
  firstEffectIndex: number;
  effectCount: number;
};

type ParsedEffect = {
  amountLamports: bigint;
};

type ParsedArtifact = {
  minInputLamports: bigint;
  maxInputLamports: bigint;
  totalEffectCount: number;
  outcomes: ParsedOutcome[];
  effects: ParsedEffect[];
  effectsOffset: number;
};

type SelectedOutcome = {
  totalOutputLamports: bigint;
  outcomeIdLen: number;
  outcomeId: Buffer;
  effectCount: number;
  effectsDigest: Buffer;
};

class ReplayMismatchError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function mismatch(code: string, message: string): never {
  throw new ReplayMismatchError(code, message);
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json" || arg === "--help" || arg === "-h") {
      out[arg.replace(/^-+/, "")] = true;
      continue;
    }
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    out[key] = value;
    i += 1;
  }
  return out;
}

function loadIdl(): any {
  return JSON.parse(fs.readFileSync(outcomeIdlPath(), "utf8"));
}

function anchorEventDiscriminator(name: string): Buffer {
  return sha256(Buffer.from(`event:${name}`, "utf8")).subarray(0, 8);
}

function parseProgramInvoke(line: string): string | null {
  const match = line.match(/^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[\d+\]$/);
  return match ? match[1] : null;
}

function parseProgramFinish(line: string): string | null {
  const match = line.match(/^Program ([1-9A-HJ-NP-Za-km-z]+) (success|failed:.*)$/);
  return match ? match[1] : null;
}

function readU8(buf: Buffer, offset: { value: number }): number {
  const value = buf.readUInt8(offset.value);
  offset.value += 1;
  return value;
}

function readU16LE(buf: Buffer, offset: { value: number }): number {
  const value = buf.readUInt16LE(offset.value);
  offset.value += 2;
  return value;
}

function readU32LE(buf: Buffer, offset: { value: number }): number {
  const value = buf.readUInt32LE(offset.value);
  offset.value += 4;
  return value;
}

function readU64LE(buf: Buffer, offset: { value: number }): bigint {
  const value = buf.readBigUInt64LE(offset.value);
  offset.value += 8;
  return value;
}

function readBytes(buf: Buffer, offset: { value: number }, len: number): Buffer {
  const out = buf.subarray(offset.value, offset.value + len);
  offset.value += len;
  return out;
}

function pick<T>(obj: any, snake: string, camel: string): T {
  if (obj && obj[snake] !== undefined) return obj[snake] as T;
  if (obj && obj[camel] !== undefined) return obj[camel] as T;
  return undefined as T;
}

function asBigInt(value: any): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  if (value && typeof value.toString === "function") return BigInt(value.toString());
  throw new Error(`Cannot coerce to bigint: ${String(value)}`);
}

function expectZeroPadding(bytes: Buffer, from: number, code: string): void {
  for (let i = from; i < bytes.length; i += 1) {
    if (bytes[i] !== 0) mismatch(code, "Non-zero padding outside canonical slice");
  }
}

function decodeOutcomeResolvedV1(line: string): OutcomeResolvedEvent | null {
  if (!line.startsWith("Program data: ")) return null;
  const encoded = line.slice("Program data: ".length).trim();
  const buf = Buffer.from(encoded, "base64");
  const discriminator = anchorEventDiscriminator("OutcomeResolvedV1");
  if (buf.length < 8 || !buf.subarray(0, 8).equals(discriminator)) return null;

  const offset = { value: 8 };
  const runtimeId = readBytes(buf, offset, 16);
  const resolveId = readU64LE(buf, offset);
  const actor = new PublicKey(readBytes(buf, offset, 32));
  const inputLamports = readU64LE(buf, offset);
  const totalOutputLamports = readU64LE(buf, offset);
  const masterSeed = readBytes(buf, offset, 32);
  const randomness = readBytes(buf, offset, 32);
  const compiledArtifactHash = readBytes(buf, offset, 32);
  const outcomeIdLen = readU8(buf, offset);
  const outcomeId = readBytes(buf, offset, MAX_OUTCOME_ID_BYTES);
  const effectCount = readU16LE(buf, offset);
  const effectsDigest = readBytes(buf, offset, 32);

  return {
    runtimeId,
    resolveId,
    actor,
    inputLamports,
    totalOutputLamports,
    masterSeed,
    randomness,
    compiledArtifactHash,
    outcomeIdLen,
    outcomeId,
    effectCount,
    effectsDigest,
  };
}

function findOutcomeResolvedEvent(
  logs: string[],
  expectedProgramId: string
): OutcomeResolvedEvent {
  const stack: string[] = [];
  let sawExpectedInvoke = false;
  let sawProgramDataForExpected = false;
  let outcomeEventProgramMismatch: string | null = null;

  for (const line of logs) {
    const invoke = parseProgramInvoke(line);
    if (invoke) {
      stack.push(invoke);
      if (invoke === expectedProgramId) sawExpectedInvoke = true;
      continue;
    }

    const finish = parseProgramFinish(line);
    if (finish) {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index] === finish) {
          stack.splice(index, 1);
          break;
        }
      }
      continue;
    }

    if (!line.startsWith("Program data: ")) continue;
    if (stack.length === 0) continue;
    const currentProgramId = stack[stack.length - 1];
    const event = decodeOutcomeResolvedV1(line);
    if (currentProgramId === expectedProgramId) {
      sawProgramDataForExpected = true;
      if (event) return event;
      continue;
    }
    if (event && !outcomeEventProgramMismatch) {
      outcomeEventProgramMismatch = currentProgramId;
    }
  }

  if (outcomeEventProgramMismatch) {
    mismatch(
      "ERR_PROGRAM_ID_MISMATCH",
      `OutcomeResolvedV1 was emitted by ${outcomeEventProgramMismatch}, not expected program ${expectedProgramId}`
    );
  }

  if (!sawExpectedInvoke) {
    mismatch(
      "ERR_PROGRAM_ID_MISMATCH",
      `Expected program ${expectedProgramId} is not present in transaction logs`
    );
  }
  if (sawProgramDataForExpected) {
    mismatch(
      "ERR_EVENT_DISCRIMINATOR_MISMATCH",
      "Program data was found for expected program, but OutcomeResolvedV1 discriminator did not match"
    );
  }
  mismatch(
    "ERR_EVENT_NOT_FOUND_FOR_PROGRAM",
    `OutcomeResolvedV1 not found for program ${expectedProgramId}`
  );
}

async function fetchTransactionLogs(
  connection: anchor.web3.Connection,
  signature: string
): Promise<string[]> {
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx?.meta?.logMessages) {
    mismatch(
      "ERR_TX_NOT_FOUND_OR_NO_LOGS",
      "Transaction not found or logs are unavailable"
    );
  }
  return tx.meta.logMessages;
}

async function fetchDecodedAccount(
  connection: anchor.web3.Connection,
  coder: any,
  pubkey: PublicKey,
  accountName: string,
  notFoundCode: string
): Promise<any> {
  const info = await connection.getAccountInfo(pubkey, "confirmed");
  if (!info) {
    mismatch(notFoundCode, `${accountName} not found: ${pubkey.toBase58()}`);
  }
  try {
    return coder.accounts.decode(accountName, info.data);
  } catch (error) {
    mismatch(
      notFoundCode,
      `Failed to decode ${accountName}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function expectedChunkLen(blobLen: number, chunkIndex: number): number {
  const chunkBase = chunkIndex * CHUNK_SIZE;
  return Math.min(CHUNK_SIZE, blobLen - chunkBase);
}

function parseCompiledArtifact(blob: Buffer): ParsedArtifact {
  if (blob.length === 0 || blob.length > 8192 || blob.length < 26) {
    throw new Error("Invalid artifact length");
  }
  if (blob.subarray(0, 4).toString("ascii") !== MAGIC) {
    throw new Error("Invalid artifact magic");
  }

  const offset = { value: 4 };
  const formatVersion = readU16LE(blob, offset);
  if (formatVersion !== FORMAT_VERSION_V1) {
    throw new Error("Unsupported format version");
  }
  const minInputLamports = readU64LE(blob, offset);
  const maxInputLamports = readU64LE(blob, offset);
  if (minInputLamports > maxInputLamports) {
    throw new Error("Artifact bounds are invalid");
  }
  const outcomeCount = readU16LE(blob, offset);
  const totalEffectCount = readU16LE(blob, offset);
  if (outcomeCount === 0) {
    throw new Error("Outcome directory is empty");
  }
  if (!readBytes(blob, offset, 8).equals(Buffer.alloc(8, 0))) {
    throw new Error("Reserved header bytes must be zero");
  }

  const outcomes: ParsedOutcome[] = [];
  const referencedEffects = new Array<boolean>(totalEffectCount).fill(false);
  let previousOutcomeId: Buffer | null = null;
  let weightSum = 0n;

  for (let index = 0; index < outcomeCount; index += 1) {
    const outcomeIdLen = readU8(blob, offset);
    if (outcomeIdLen < 1 || outcomeIdLen > MAX_OUTCOME_ID_BYTES) {
      throw new Error("Invalid outcome_id_len");
    }

    const outcomeId = readBytes(blob, offset, MAX_OUTCOME_ID_BYTES);
    const canonicalOutcomeId = outcomeId.subarray(0, outcomeIdLen);
    if (!canonicalOutcomeId.every((byte) => byte >= 32 && byte <= 126)) {
      throw new Error("Outcome id must be ASCII");
    }
    if (!outcomeId.subarray(outcomeIdLen).equals(Buffer.alloc(MAX_OUTCOME_ID_BYTES - outcomeIdLen, 0))) {
      throw new Error("Outcome id padding must be zero");
    }
    if (previousOutcomeId && Buffer.compare(previousOutcomeId, canonicalOutcomeId) >= 0) {
      throw new Error("Outcome ids must be strictly sorted");
    }
    previousOutcomeId = Buffer.from(canonicalOutcomeId);

    const weight = readU32LE(blob, offset);
    if (weight <= 0) {
      throw new Error("Outcome weight must be positive");
    }
    weightSum += BigInt(weight);

    const firstEffectIndex = readU16LE(blob, offset);
    const effectCount = readU16LE(blob, offset);
    const endEffectIndex = firstEffectIndex + effectCount;
    if (endEffectIndex > totalEffectCount) {
      throw new Error("Outcome effect slice is out of bounds");
    }
    for (let effectIndex = firstEffectIndex; effectIndex < endEffectIndex; effectIndex += 1) {
      referencedEffects[effectIndex] = true;
    }

    outcomes.push({
      outcomeIdLen,
      outcomeId,
      weight,
      firstEffectIndex,
      effectCount,
    });
  }

  if (weightSum <= 0n) {
    throw new Error("Weight sum must be positive");
  }

  const effectsOffset = offset.value;
  const effects: ParsedEffect[] = [];
  for (let index = 0; index < totalEffectCount; index += 1) {
    const effectType = readU8(blob, offset);
    if (effectType !== EFFECT_TYPE_TRANSFER_SOL) {
      throw new Error("Unsupported effect type");
    }
    if (!readBytes(blob, offset, 7).equals(Buffer.alloc(7, 0))) {
      throw new Error("Effect reserved bytes must be zero");
    }
    const amountLamports = readU64LE(blob, offset);
    effects.push({ amountLamports });
  }

  if (offset.value !== blob.length) {
    throw new Error("Unknown trailing bytes in artifact");
  }
  if (!referencedEffects.every((isReferenced) => isReferenced)) {
    throw new Error("Artifact contains orphan effect entries");
  }

  return {
    minInputLamports,
    maxInputLamports,
    totalEffectCount,
    outcomes,
    effects,
    effectsOffset,
  };
}

function chooseWeightedIndex(weights: number[], rolled: bigint): number {
  if (weights.length === 0) {
    throw new Error("Weights are empty");
  }
  let total = 0n;
  for (const weight of weights) {
    if (weight <= 0) throw new Error("Weight must be positive");
    total += BigInt(weight);
  }
  const bounded = rolled % total;
  let cursor = 0n;
  for (let index = 0; index < weights.length; index += 1) {
    cursor += BigInt(weights[index]);
    if (bounded < cursor) return index;
  }
  throw new Error("Weighted choice failed");
}

function selectOutcome(
  blob: Buffer,
  parsed: ParsedArtifact,
  randomness: Buffer,
  inputLamports: bigint
): SelectedOutcome {
  if (
    inputLamports < parsed.minInputLamports ||
    inputLamports > parsed.maxInputLamports
  ) {
    throw new Error("Replay input is outside artifact bounds");
  }

  const selectedIndex = chooseWeightedIndex(
    parsed.outcomes.map((outcome) => outcome.weight),
    randomness.readBigUInt64LE(0)
  );
  const selected = parsed.outcomes[selectedIndex];
  const effectStart =
    parsed.effectsOffset + selected.firstEffectIndex * EFFECT_ENTRY_BYTES;
  const effectEnd = effectStart + selected.effectCount * EFFECT_ENTRY_BYTES;
  const effectsDigest = sha256(blob.subarray(effectStart, effectEnd));

  let totalOutputLamports = 0n;
  for (
    let index = selected.firstEffectIndex;
    index < selected.firstEffectIndex + selected.effectCount;
    index += 1
  ) {
    totalOutputLamports += parsed.effects[index].amountLamports;
  }

  return {
    totalOutputLamports,
    outcomeIdLen: selected.outcomeIdLen,
    outcomeId: selected.outcomeId,
    effectCount: selected.effectCount,
    effectsDigest,
  };
}

async function reconstructArtifactBlob(
  connection: anchor.web3.Connection,
  coder: any,
  programId: PublicKey,
  compiledArtifactHash: Buffer,
  artifactHeader: any
): Promise<Buffer> {
  const blobLen = Number(pick(artifactHeader, "blob_len", "blobLen"));
  const chunkCount = Number(pick(artifactHeader, "chunk_count", "chunkCount"));
  const parts: Buffer[] = [];

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const chunkPda = deriveApprovedArtifactChunkPda(
      programId,
      compiledArtifactHash,
      chunkIndex
    );
    const info = await connection.getAccountInfo(chunkPda, "confirmed");
    if (!info) {
      mismatch(
        "ERR_ARTIFACT_CHUNK_MISSING",
        `Artifact chunk missing: ${chunkPda.toBase58()}`
      );
    }
    let decoded: any;
    try {
      decoded = coder.accounts.decode("ApprovedOutcomeArtifactChunk", info.data);
    } catch (error) {
      mismatch(
        "ERR_ARTIFACT_CHUNK_MISSING",
        `Failed to decode artifact chunk: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const chunkHash = Buffer.from(
      pick<number[]>(decoded, "compiled_artifact_hash", "compiledArtifactHash")
    );
    if (!chunkHash.equals(compiledArtifactHash)) {
      mismatch(
        "ERR_ARTIFACT_CHUNK_MISSING",
        "Artifact chunk hash binding is invalid"
      );
    }

    const storedChunkIndex = Number(pick(decoded, "chunk_index", "chunkIndex"));
    if (storedChunkIndex !== chunkIndex) {
      mismatch(
        "ERR_ARTIFACT_CHUNK_MISSING",
        "Artifact chunk index does not match PDA order"
      );
    }

    const writtenLen = Number(pick(decoded, "written_len", "writtenLen"));
    const expectedLen = expectedChunkLen(blobLen, chunkIndex);
    if (writtenLen !== expectedLen) {
      mismatch(
        "ERR_ARTIFACT_CHUNK_MISSING",
        "Artifact chunk is not fully written"
      );
    }

    const data = Buffer.from(pick<number[]>(decoded, "data", "data"));
    parts.push(data.subarray(0, writtenLen));
  }

  const blob = Buffer.concat(parts);
  if (blob.length !== blobLen) {
    mismatch(
      "ERR_ARTIFACT_CHUNK_MISSING",
      "Reconstructed artifact blob length is invalid"
    );
  }
  return blob;
}

function buildReplayOutput(
  result: "MATCH" | "MISMATCH",
  reason: string,
  signature: string,
  programId: string,
  runtimeId: string,
  resolveId: string,
  compiledArtifactHash: string
): ReplayOutput {
  return {
    verification_result: result,
    verification_reason: reason,
    signature,
    program_id: programId,
    runtime_id: runtimeId,
    resolve_id: resolveId,
    compiled_artifact_hash: compiledArtifactHash,
  };
}

function printOutput(output: ReplayOutput, asJson: boolean): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
    return;
  }
  console.log("verification_result :", output.verification_result);
  console.log("verification_reason :", output.verification_reason);
  console.log("signature           :", output.signature);
  console.log("program_id          :", output.program_id);
  console.log("runtime_id          :", output.runtime_id);
  console.log("resolve_id          :", output.resolve_id);
  console.log("compiled_artifact_hash :", output.compiled_artifact_hash);
}

async function verifyReplay(args: CliArgs): Promise<ReplayOutput> {
  const signature = args.sig as string | undefined;
  if (!signature) {
    throw new Error("Provide --sig <TX_SIG>");
  }

  const url =
    (args.url as string | undefined) ??
    process.env.ANCHOR_PROVIDER_URL ??
    DEFAULT_RPC_URL;
  const programId = new PublicKey(
    (args["program-id"] as string | undefined) ?? DEFAULT_PROGRAM_ID
  );
  const connection = new anchor.web3.Connection(url, { commitment: "confirmed" });
  const rawIdl = loadIdl();
  const coder = new (anchor as any).BorshCoder(rawIdl as anchor.Idl);

  const logs = await fetchTransactionLogs(connection, signature);
  const event = findOutcomeResolvedEvent(logs, programId.toBase58());

  const runtimeIdHex = toHex(event.runtimeId);
  const resolveId = event.resolveId.toString();
  const compiledArtifactHashHex = toHex(event.compiledArtifactHash);

  const outcomeConfigPda = deriveOutcomeConfigPda(programId, event.runtimeId);
  const outcomeResolutionPda = deriveOutcomeResolutionPda(
    programId,
    event.runtimeId,
    event.resolveId
  );
  const approvedArtifactPda = deriveApprovedArtifactPda(
    programId,
    event.compiledArtifactHash
  );

  const outcomeConfig = await fetchDecodedAccount(
    connection,
    coder,
    outcomeConfigPda,
    "OutcomeConfig",
    "ERR_OUTCOME_CONFIG_NOT_FOUND"
  );
  const outcomeResolution = await fetchDecodedAccount(
    connection,
    coder,
    outcomeResolutionPda,
    "OutcomeResolution",
    "ERR_RESOLUTION_ACCOUNT_NOT_FOUND"
  );
  const approvedArtifact = await fetchDecodedAccount(
    connection,
    coder,
    approvedArtifactPda,
    "ApprovedOutcomeArtifact",
    "ERR_ARTIFACT_HEADER_NOT_FOUND"
  );

  const configHash = Buffer.from(
    pick<number[]>(outcomeConfig, "compiled_artifact_hash", "compiledArtifactHash")
  );
  if (!configHash.equals(event.compiledArtifactHash)) {
    mismatch(
      "ERR_CONFIG_HASH_MISMATCH",
      "OutcomeConfig.compiled_artifact_hash differs from event hash"
    );
  }

  const resolutionHash = Buffer.from(
    pick<number[]>(outcomeResolution, "compiled_artifact_hash", "compiledArtifactHash")
  );
  if (!resolutionHash.equals(event.compiledArtifactHash)) {
    mismatch(
      "ERR_RESOLUTION_HASH_MISMATCH",
      "OutcomeResolution.compiled_artifact_hash differs from event hash"
    );
  }

  const resolutionRuntimeId = Buffer.from(
    pick<number[]>(outcomeResolution, "runtime_id", "runtimeId")
  );
  const resolutionResolveId = asBigInt(
    pick(outcomeResolution, "resolve_id", "resolveId")
  );
  if (!resolutionRuntimeId.equals(event.runtimeId) || resolutionResolveId !== event.resolveId) {
    mismatch(
      "ERR_RESOLUTION_HASH_MISMATCH",
      "OutcomeResolution runtime/resolve binding differs from event"
    );
  }

  const headerHash = Buffer.from(
    pick<number[]>(
      approvedArtifact,
      "compiled_artifact_hash",
      "compiledArtifactHash"
    )
  );
  if (!headerHash.equals(event.compiledArtifactHash)) {
    mismatch(
      "ERR_ARTIFACT_HASH_MISMATCH",
      "ApprovedOutcomeArtifact hash differs from event hash"
    );
  }

  const isFinalized = Boolean(
    pick(approvedArtifact, "is_finalized", "isFinalized")
  );
  if (!isFinalized) {
    mismatch(
      "ERR_ARTIFACT_NOT_FINALIZED",
      "ApprovedOutcomeArtifact is not finalized"
    );
  }

  const status = Number(pick(approvedArtifact, "status", "status"));
  let allowUnreviewedBinding = false;
  if (status === STATUS_PENDING) {
    const programConfigPda = deriveProgramConfigPda(programId);
    const programConfigInfo = await connection.getAccountInfo(
      programConfigPda,
      "confirmed"
    );
    if (programConfigInfo) {
      try {
        const programConfig = coder.accounts.decode(
          "ProgramConfig",
          programConfigInfo.data
        );
        allowUnreviewedBinding = Boolean(
          pick(programConfig, "allow_unreviewed_binding", "allowUnreviewedBinding")
        );
      } catch (_) {
        allowUnreviewedBinding = false;
      }
    }
  }
  const statusAllowed =
    status === STATUS_APPROVED ||
    status === STATUS_DEPRECATED ||
    (status === STATUS_PENDING && allowUnreviewedBinding);
  if (!statusAllowed) {
    mismatch(
      "ERR_ARTIFACT_STATUS_INVALID",
      "ApprovedOutcomeArtifact status does not allow binding"
    );
  }

  const blob = await reconstructArtifactBlob(
    connection,
    coder,
    programId,
    event.compiledArtifactHash,
    approvedArtifact
  );
  if (!sha256(blob).equals(event.compiledArtifactHash)) {
    mismatch(
      "ERR_ARTIFACT_HASH_MISMATCH",
      "Reconstructed artifact blob hash differs from event hash"
    );
  }

  const artifactPath = args.artifact as string | undefined;
  if (artifactPath) {
    const resolvedArtifactPath = path.isAbsolute(artifactPath)
      ? artifactPath
      : path.resolve(process.cwd(), artifactPath);
    if (!fs.existsSync(resolvedArtifactPath)) {
      mismatch(
        "ERR_ARTIFACT_HASH_MISMATCH",
        `Artifact file not found: ${resolvedArtifactPath}`
      );
    }
    const localArtifactHash = sha256(fs.readFileSync(resolvedArtifactPath));
    if (!localArtifactHash.equals(event.compiledArtifactHash)) {
      mismatch(
        "ERR_ARTIFACT_HASH_MISMATCH",
        "Local artifact hash differs from event hash"
      );
    }
  }

  let parsed: ParsedArtifact;
  try {
    parsed = parseCompiledArtifact(blob);
  } catch (error) {
    mismatch(
      "ERR_REPLAY_UNHANDLED",
      error instanceof Error ? error.message : String(error)
    );
  }

  const recomputedRandomness = sha256(
    Buffer.concat([
      event.masterSeed,
      event.runtimeId,
      (() => {
        const buffer = Buffer.alloc(8);
        buffer.writeBigUInt64LE(event.resolveId, 0);
        return buffer;
      })(),
      event.actor.toBuffer(),
    ])
  );

  const resolutionRandomness = Buffer.from(
    pick<number[]>(outcomeResolution, "randomness", "randomness")
  );
  if (
    !recomputedRandomness.equals(event.randomness) ||
    !recomputedRandomness.equals(resolutionRandomness)
  ) {
    mismatch(
      "ERR_RANDOMNESS_MISMATCH",
      "Randomness differs between event, resolution, and replay recomputation"
    );
  }

  const replayInput = event.inputLamports;
  const resolutionInput = asBigInt(
    pick(outcomeResolution, "input_lamports", "inputLamports")
  );
  if (event.inputLamports !== resolutionInput || event.inputLamports !== replayInput) {
    mismatch(
      "ERR_INPUT_MISMATCH",
      "Input lamports differ between event, resolution, and replay"
    );
  }

  const selected = selectOutcome(blob, parsed, recomputedRandomness, replayInput);
  const resolutionOutput = asBigInt(
    pick(outcomeResolution, "total_output_lamports", "totalOutputLamports")
  );
  if (
    event.totalOutputLamports !== resolutionOutput ||
    event.totalOutputLamports !== selected.totalOutputLamports
  ) {
    mismatch(
      "ERR_OUTPUT_MISMATCH",
      "Output lamports differ between event, resolution, and replay recomputation"
    );
  }

  const resolutionOutcomeIdLen = Number(
    pick(outcomeResolution, "outcome_id_len", "outcomeIdLen")
  );
  const resolutionOutcomeId = Buffer.from(
    pick<number[]>(outcomeResolution, "outcome_id", "outcomeId")
  );
  expectZeroPadding(event.outcomeId, event.outcomeIdLen, "ERR_OUTCOME_ID_MISMATCH");
  expectZeroPadding(
    resolutionOutcomeId,
    resolutionOutcomeIdLen,
    "ERR_OUTCOME_ID_MISMATCH"
  );
  if (
    event.outcomeIdLen !== resolutionOutcomeIdLen ||
    event.outcomeIdLen !== selected.outcomeIdLen ||
    !event.outcomeId.equals(resolutionOutcomeId) ||
    !event.outcomeId.equals(selected.outcomeId)
  ) {
    mismatch(
      "ERR_OUTCOME_ID_MISMATCH",
      "Outcome id differs between event, resolution, and replay recomputation"
    );
  }

  const resolutionEffectCount = Number(
    pick(outcomeResolution, "effect_count", "effectCount")
  );
  const resolutionEffectsDigest = Buffer.from(
    pick<number[]>(outcomeResolution, "effects_digest", "effectsDigest")
  );
  if (
    event.effectCount !== resolutionEffectCount ||
    event.effectCount !== selected.effectCount ||
    !event.effectsDigest.equals(resolutionEffectsDigest) ||
    !event.effectsDigest.equals(selected.effectsDigest)
  ) {
    mismatch(
      "ERR_EFFECTS_DIGEST_MISMATCH",
      "Effects digest differs between event, resolution, and replay recomputation"
    );
  }

  return buildReplayOutput(
    "MATCH",
    "OK",
    signature,
    programId.toBase58(),
    runtimeIdHex,
    resolveId,
    compiledArtifactHashHex
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(`Usage:
  yarn -s replay --sig <TX_SIG> [--url <RPC_URL>] [--program-id <PUBKEY>] [--artifact <PATH>] [--json]
`);
    return;
  }

  const asJson = Boolean(args.json);
  const signature = (args.sig as string | undefined) ?? "";
  const programId =
    (args["program-id"] as string | undefined) ?? DEFAULT_PROGRAM_ID;

  try {
    const output = await verifyReplay(args);
    printOutput(output, asJson);
  } catch (error) {
    if (error instanceof ReplayMismatchError) {
      const mismatchOutput = buildReplayOutput(
        "MISMATCH",
        error.code,
        signature,
        programId,
        "",
        "",
        ""
      );
      printOutput(mismatchOutput, asJson);
      process.exit(1);
      return;
    }

    const mismatchOutput = buildReplayOutput(
      "MISMATCH",
      "ERR_REPLAY_UNHANDLED",
      signature,
      programId,
      "",
      "",
      ""
    );
    printOutput(mismatchOutput, asJson);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
