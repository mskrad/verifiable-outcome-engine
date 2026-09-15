import * as anchor from "@coral-xyz/anchor";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { PublicKey } from "@solana/web3.js";

import {
  buildSnapshotClaimFromFile,
  formulaNameFromArtifactV4,
  inspectSnapshotFile,
  parseArtifactV4,
  parseArtifactV12,
  parseArtifactV121,
  FORMAT_VERSION_V4,
  FORMAT_VERSION_V5,
  FORMAT_VERSION_V1_2_SCALE,
  FORMAT_VERSION_V1_2_1_SCALE,
  OUTCOME_STANDARD_V1_1,
  OUTCOME_STANDARD_V1_2,
  OUTCOME_STANDARD_V1_2_1,
  OUTCOME_STANDARD_V1_3_2,
  V5_ENTRY_BYTES,
} from "./snapshot.js";
import {
  FORMULA_CODE_COMPOSITE_RANK_DESC,
  FORMAT_VERSION_COMPOSITE_RANK_DESC,
  parseCompositeRankDescArtifact,
  replayCompositeRankDescArtifact,
} from "./composite_rank_desc.js";
import {
  parseConditionsArtifact,
  resolveConditionsArtifact,
  winnersDigest,
  factsRefRoot,
  winningScoreSum,
  FORMAT_VERSION_CONDITIONS,
  FORMULA_CODE_CONDITIONS,
} from "./conditions.js";
import {
  parseSlotArtifact,
  replaySpin,
  maxWinCap,
  FORMAT_VERSION_SLOT,
} from "./slot.js";
import type {
  RuntimeResolutionFormula,
  VerifyOutcomeOptions,
  VerifyResult,
} from "./types.js";
import { OUTCOME_IDL } from "./idl.js";
import {
  DEFAULT_SNAPSHOT_MIRRORS,
  DEFAULT_SNAPSHOT_TIMEOUT_MS,
  SnapshotUnavailableError,
  fetchCommittedSnapshot,
} from "./snapshot_source.js";

const DEFAULT_PROGRAM_ID = "6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B";
const CHUNK_SIZE = 1024;
const MAX_OUTCOME_ID_BYTES = 64;
const EFFECT_ENTRY_BYTES = 16;
const FORMAT_VERSION_V1 = 1;
const FORMAT_VERSION_V2 = 2;
const FORMAT_VERSION_V3 = 3;
const MAX_WINNERS = 32;
const MULTI_WINNER_DOMAIN = "VRE_MULTI_WINNER_V1";
const MAGIC = "W3O1";
const STATUS_PENDING = 0;
const STATUS_APPROVED = 1;
const STATUS_DEPRECATED = 3;
const EFFECT_TYPE_TRANSFER_SOL = 1;
const FORMULA_WEIGHTED_RANDOM = 1;
const FORMULA_RANK_DESC = 2;
const FORMULA_RANK_ASC = 3;
const FORMULA_FIRST_N = 4;
const FORMULA_CLOSEST_TO = 5;
const RNG_VERSION_V2 = 2;
const RNG_V2_STATUS_SETTLED = 2;
const RNG_V2_DOMAIN = "VRE_RNG_V2";
function u32le(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value, 0);
  return out;
}

function u64le(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value, 0);
  return out;
}

function sha256(bytes: Buffer): Buffer {
  return crypto.createHash("sha256").update(bytes).digest();
}

function toHex(bytes: number[] | Buffer): string {
  return Buffer.from(bytes).toString("hex");
}

function deriveProgramConfigPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("outcome_program_config")],
    programId
  )[0];
}

function deriveApprovedArtifactPda(
  programId: PublicKey,
  compiledArtifactHash: Buffer
): PublicKey {
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
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("approved_outcome_artifact_chunk"),
      compiledArtifactHash,
      u32le(chunkIndex),
    ],
    programId
  )[0];
}

function deriveOutcomeConfigPda(
  programId: PublicKey,
  runtimeId: Buffer
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("outcome_config"), runtimeId],
    programId
  )[0];
}

function deriveOutcomeResolutionPda(
  programId: PublicKey,
  runtimeId: Buffer,
  resolveId: bigint
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("outcome_resolution"), runtimeId, u64le(resolveId)],
    programId
  )[0];
}

function deriveRngV2StatePda(
  programId: PublicKey,
  runtimeId: Buffer,
  resolveId: bigint
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("rng_v2_state"), runtimeId, u64le(resolveId)],
    programId
  )[0];
}

type OutcomeResolvedEvent = {
  runtimeId: Buffer;
  resolveId: bigint;
  actor: PublicKey;
  inputLamports: bigint;
  totalOutputLamports: bigint;
  masterSeed?: Buffer;
  rngVersion?: number;
  randomness: Buffer;
  compiledArtifactHash: Buffer;
  artifactFormatVersion: number;
  winnerCount: number;
  outcomeIdLen: number;
  outcomeId: Buffer;
  outcomeIdLens: number[];
  outcomeIds: Buffer[];
  winnerClaimHash?: Buffer;
  effectCount: number;
  effectsDigest: Buffer;
  snapshotHash?: Buffer;
  resolvedSlots?: bigint[];
  slotHashes?: Buffer[];
  operatorCommitPresent?: boolean;
  operatorCommitHash?: Buffer;
  operatorRevealLen?: number;
  operatorReveal?: Buffer;
  entropySource?: number;
  protocolRevision?: number;
};

type RngV2StateAccount = {
  runtimeId: Buffer;
  resolveId: bigint;
  actor: PublicKey;
  inputLamports: bigint;
  status: number;
  compiledArtifactHash: Buffer;
  artifactFormatVersion: number;
  snapshotHash: Buffer;
  targetSlots: bigint[];
  expirySlot: bigint;
  operatorCommitPresent: boolean;
  operatorCommitHash: Buffer;
  operatorRevealLen: number;
  operatorReveal: Buffer;
  resolvedSlots: bigint[];
  slotHashes: Buffer[];
};

type ParsedOutcome = {
  outcomeIdLen: number;
  outcomeId: Buffer;
  weight: number;
  score: bigint;
  order: number;
  firstEffectIndex: number;
  effectCount: number;
};

type ParsedEffect = {
  amountLamports: bigint;
};

type ParsedArtifact = {
  formatVersion: number;
  winnersCount: number;
  minInputLamports: bigint;
  maxInputLamports: bigint;
  formulaCode: number;
  formulaName?: RuntimeResolutionFormula;
  targetScore: bigint;
  payoutLamports: bigint;
  entryCount?: number;
  standardVersion?: "Outcome Standard V1.1";
  totalEffectCount: number;
  outcomes: ParsedOutcome[];
  effects: ParsedEffect[];
  effectsOffset: number;
};

type SelectedOutcome = {
  totalOutputLamports: bigint;
  outcomeIdLen: number;
  outcomeId: Buffer;
  outcomeIdLens: number[];
  outcomeIds: Buffer[];
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

function loadIdl(): any {
  return JSON.parse(JSON.stringify(OUTCOME_IDL));
}

function anchorEventDiscriminator(name: string): Buffer {
  return sha256(Buffer.from(`event:${name}`, "utf8")).subarray(0, 8);
}

function anchorAccountDiscriminator(name: string): Buffer {
  return sha256(Buffer.from(`account:${name}`, "utf8")).subarray(0, 8);
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

function readI64LE(buf: Buffer, offset: { value: number }): bigint {
  const value = buf.readBigInt64LE(offset.value);
  offset.value += 8;
  return value;
}

function readU128LE(buf: Buffer, offset: { value: number }): bigint {
  const lo = buf.readBigUInt64LE(offset.value);
  const hi = buf.readBigUInt64LE(offset.value + 8);
  offset.value += 16;
  return lo + (hi << 64n);
}

function readBytes(buf: Buffer, offset: { value: number }, len: number): Buffer {
  const out = buf.subarray(offset.value, offset.value + len);
  offset.value += len;
  return out;
}

function readVecU8(buf: Buffer, offset: { value: number }): number[] {
  const len = readU32LE(buf, offset);
  return [...readBytes(buf, offset, len)];
}

function readFixedU64Array(buf: Buffer, offset: { value: number }, len: number): bigint[] {
  const out: bigint[] = [];
  for (let index = 0; index < len; index += 1) {
    out.push(readU64LE(buf, offset));
  }
  return out;
}

function readFixedHashArray(buf: Buffer, offset: { value: number }, len: number): Buffer[] {
  const out: Buffer[] = [];
  for (let index = 0; index < len; index += 1) {
    out.push(readBytes(buf, offset, 32));
  }
  return out;
}

function readVecOutcomeIds(buf: Buffer, offset: { value: number }): Buffer[] {
  const len = readU32LE(buf, offset);
  const out: Buffer[] = [];
  for (let index = 0; index < len; index += 1) {
    out.push(readBytes(buf, offset, MAX_OUTCOME_ID_BYTES));
  }
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

function formulaCodeToName(code: number): RuntimeResolutionFormula {
  switch (code) {
    case FORMULA_WEIGHTED_RANDOM:
      return "weighted_random";
    case FORMULA_RANK_DESC:
      return "rank_desc";
    case FORMULA_RANK_ASC:
      return "rank_asc";
    case FORMULA_FIRST_N:
      return "first_n";
    case FORMULA_CLOSEST_TO:
      return "closest_to";
    case FORMULA_CODE_COMPOSITE_RANK_DESC:
      return "composite_rank_desc";
    default:
      throw new Error(`Unsupported formula code: ${code}`);
  }
}

function signedBigIntToSafeNumber(value: bigint, label: string): number {
  const asNumber = Number(value);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error(`${label} exceeds JavaScript safe integer range`);
  }
  return asNumber;
}

function expectZeroPadding(bytes: Buffer, from: number, code: string): void {
  for (let i = from; i < bytes.length; i += 1) {
    if (bytes[i] !== 0) mismatch(code, "Non-zero padding outside canonical slice");
  }
}

function outcomeIdString(outcomeId: Buffer, outcomeIdLen: number): string {
  return outcomeId.subarray(0, outcomeIdLen).toString("ascii");
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
    artifactFormatVersion: FORMAT_VERSION_V1,
    winnerCount: 1,
    outcomeIdLen,
    outcomeId,
    outcomeIdLens: [outcomeIdLen],
    outcomeIds: [outcomeId],
    effectCount,
    effectsDigest,
  };
}

function decodeOutcomeResolvedV2(line: string): OutcomeResolvedEvent | null {
  if (!line.startsWith("Program data: ")) return null;
  const encoded = line.slice("Program data: ".length).trim();
  const buf = Buffer.from(encoded, "base64");
  const discriminator = anchorEventDiscriminator("OutcomeResolvedV2");
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
  const artifactFormatVersion = readU16LE(buf, offset);
  const winnerCount = readU16LE(buf, offset);
  const outcomeIdLens = readVecU8(buf, offset);
  const outcomeIds = readVecOutcomeIds(buf, offset);
  const effectCount = readU16LE(buf, offset);
  const effectsDigest = readBytes(buf, offset, 32);
  const outcomeIdLen = outcomeIdLens[0] ?? 0;
  const outcomeId = outcomeIds[0] ?? Buffer.alloc(MAX_OUTCOME_ID_BYTES, 0);

  return {
    runtimeId,
    resolveId,
    actor,
    inputLamports,
    totalOutputLamports,
    masterSeed,
    randomness,
    compiledArtifactHash,
    artifactFormatVersion,
    winnerCount,
    outcomeIdLen,
    outcomeId,
    outcomeIdLens,
    outcomeIds,
    effectCount,
    effectsDigest,
  };
}

function decodeOutcomeResolvedV3(line: string): OutcomeResolvedEvent | null {
  if (!line.startsWith("Program data: ")) return null;
  const encoded = line.slice("Program data: ".length).trim();
  const buf = Buffer.from(encoded, "base64");
  const discriminator = anchorEventDiscriminator("OutcomeResolvedV3");
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
  const artifactFormatVersion = readU16LE(buf, offset);
  const winnerCount = readU16LE(buf, offset);
  const winnerClaimHash = readBytes(buf, offset, 32);
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
    artifactFormatVersion,
    winnerCount,
    outcomeIdLen,
    outcomeId,
    outcomeIdLens: [outcomeIdLen],
    outcomeIds: [outcomeId],
    winnerClaimHash,
    effectCount,
    effectsDigest,
  };
}

function decodeOutcomeResolvedV4(line: string): OutcomeResolvedEvent | null {
  if (!line.startsWith("Program data: ")) return null;
  const encoded = line.slice("Program data: ".length).trim();
  const buf = Buffer.from(encoded, "base64");
  const discriminator = anchorEventDiscriminator("OutcomeResolvedV4");
  if (buf.length < 8 || !buf.subarray(0, 8).equals(discriminator)) return null;

  const offset = { value: 8 };
  const runtimeId = readBytes(buf, offset, 16);
  const resolveId = readU64LE(buf, offset);
  const actor = new PublicKey(readBytes(buf, offset, 32));
  const inputLamports = readU64LE(buf, offset);
  const totalOutputLamports = readU64LE(buf, offset);
  const rngVersion = readU8(buf, offset);
  const randomness = readBytes(buf, offset, 32);
  const compiledArtifactHash = readBytes(buf, offset, 32);
  const artifactFormatVersion = readU16LE(buf, offset);
  const winnerCount = readU16LE(buf, offset);
  const winnerClaimHash = readBytes(buf, offset, 32);
  const outcomeIdLen = readU8(buf, offset);
  const outcomeId = readBytes(buf, offset, MAX_OUTCOME_ID_BYTES);
  const effectCount = readU16LE(buf, offset);
  const effectsDigest = readBytes(buf, offset, 32);
  const snapshotHash = readBytes(buf, offset, 32);
  const resolvedSlots = readFixedU64Array(buf, offset, 3);
  const slotHashes = readFixedHashArray(buf, offset, 3);
  const operatorCommitPresent = readU8(buf, offset) !== 0;
  const operatorCommitHash = readBytes(buf, offset, 32);
  const operatorRevealLen = readU8(buf, offset);
  const operatorReveal = readBytes(buf, offset, 32);
  const entropySource = offset.value < buf.length ? readU8(buf, offset) : undefined;

  return {
    runtimeId,
    resolveId,
    actor,
    inputLamports,
    totalOutputLamports,
    rngVersion,
    randomness,
    compiledArtifactHash,
    artifactFormatVersion,
    winnerCount,
    outcomeIdLen,
    outcomeId,
    outcomeIdLens: [outcomeIdLen],
    outcomeIds: [outcomeId],
    winnerClaimHash,
    effectCount,
    effectsDigest,
    snapshotHash,
    resolvedSlots,
    slotHashes,
    operatorCommitPresent,
    operatorCommitHash,
    operatorRevealLen,
    operatorReveal,
    ...(entropySource === undefined ? {} : { entropySource }),
  };
}

// rng_v2 resolution of a compact artifact (fmt 1/2/3/5/8): V4 prefix + entropy/revision +
// the program-selected winner list. `winner_claim_hash` is the on-chain digest of that list.
function decodeOutcomeResolvedV5(line: string): OutcomeResolvedEvent | null {
  if (!line.startsWith("Program data: ")) return null;
  const encoded = line.slice("Program data: ".length).trim();
  const buf = Buffer.from(encoded, "base64");
  const discriminator = anchorEventDiscriminator("OutcomeResolvedV5");
  if (buf.length < 8 || !buf.subarray(0, 8).equals(discriminator)) return null;

  const offset = { value: 8 };
  const runtimeId = readBytes(buf, offset, 16);
  const resolveId = readU64LE(buf, offset);
  const actor = new PublicKey(readBytes(buf, offset, 32));
  const inputLamports = readU64LE(buf, offset);
  const totalOutputLamports = readU64LE(buf, offset);
  const rngVersion = readU8(buf, offset);
  const randomness = readBytes(buf, offset, 32);
  const compiledArtifactHash = readBytes(buf, offset, 32);
  const artifactFormatVersion = readU16LE(buf, offset);
  const winnerCount = readU16LE(buf, offset);
  const winnerClaimHash = readBytes(buf, offset, 32);
  const outcomeIdLen = readU8(buf, offset);
  const outcomeId = readBytes(buf, offset, MAX_OUTCOME_ID_BYTES);
  const effectCount = readU16LE(buf, offset);
  const effectsDigest = readBytes(buf, offset, 32);
  const snapshotHash = readBytes(buf, offset, 32);
  const resolvedSlots = readFixedU64Array(buf, offset, 3);
  const slotHashes = readFixedHashArray(buf, offset, 3);
  const operatorCommitPresent = readU8(buf, offset) !== 0;
  const operatorCommitHash = readBytes(buf, offset, 32);
  const operatorRevealLen = readU8(buf, offset);
  const operatorReveal = readBytes(buf, offset, 32);
  const entropySource = readU8(buf, offset);
  const protocolRevision = readU8(buf, offset);
  const outcomeIdLens = readVecU8(buf, offset);
  const outcomeIds = readVecOutcomeIds(buf, offset);

  return {
    runtimeId,
    resolveId,
    actor,
    inputLamports,
    totalOutputLamports,
    rngVersion,
    randomness,
    compiledArtifactHash,
    artifactFormatVersion,
    winnerCount,
    outcomeIdLen,
    outcomeId,
    outcomeIdLens,
    outcomeIds,
    winnerClaimHash,
    effectCount,
    effectsDigest,
    snapshotHash,
    resolvedSlots,
    slotHashes,
    operatorCommitPresent,
    operatorCommitHash,
    operatorRevealLen,
    operatorReveal,
    entropySource,
    protocolRevision,
  };
}

// Mirror of `rng_v2::winner_claim_digest`: SHA256(domain ‖ count:u16le ‖ Σ(len:u8 ‖ id[..len])).
const RNG_V2_WINNERS_DOMAIN = "VRE_RNG_V2_WINNERS";
export function winnerClaimDigest(outcomeIdLens: number[], outcomeIds: Buffer[]): Buffer {
  const count = Buffer.alloc(2);
  count.writeUInt16LE(outcomeIdLens.length, 0);
  const chunks: Buffer[] = [Buffer.from(RNG_V2_WINNERS_DOMAIN, "ascii"), count];
  outcomeIdLens.forEach((len, index) => {
    chunks.push(Buffer.from([len]));
    chunks.push(outcomeIds[index].subarray(0, len));
  });
  return sha256(Buffer.concat(chunks));
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
    const event =
      decodeOutcomeResolvedV5(line) ??
      decodeOutcomeResolvedV4(line) ??
      decodeOutcomeResolvedV3(line) ??
      decodeOutcomeResolvedV2(line) ??
      decodeOutcomeResolvedV1(line);
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
      `OutcomeResolved event was emitted by ${outcomeEventProgramMismatch}, not expected program ${expectedProgramId}`
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
      "Program data was found for expected program, but OutcomeResolved discriminator did not match"
    );
  }
  mismatch(
    "ERR_EVENT_NOT_FOUND_FOR_PROGRAM",
    `OutcomeResolved event not found for program ${expectedProgramId}`
  );
}

// ---- conditions (fc7/fv9) attestation event ----

type ConditionsResolvedEvent = {
  runtimeId: Buffer;
  operator: PublicKey;
  compiledArtifactHash: Buffer;
  entrantCount: number;
  winnerCount: number;
  winningScoreSum: bigint;
  winnersDigest: Buffer;
  factsRefRoot: Buffer;
};

function decodeConditionsResolvedV1(line: string): ConditionsResolvedEvent | null {
  if (!line.startsWith("Program data: ")) return null;
  const encoded = line.slice("Program data: ".length).trim();
  const buf = Buffer.from(encoded, "base64");
  const discriminator = anchorEventDiscriminator("ConditionsResolvedV1");
  if (buf.length < 8 || !buf.subarray(0, 8).equals(discriminator)) return null;

  const offset = { value: 8 };
  const runtimeId = readBytes(buf, offset, 16);
  const operator = new PublicKey(readBytes(buf, offset, 32));
  const compiledArtifactHash = readBytes(buf, offset, 32);
  const entrantCount = readU32LE(buf, offset);
  const winnerCount = readU16LE(buf, offset);
  const winningScoreSum = readU128LE(buf, offset);
  const winnersDigestBytes = readBytes(buf, offset, 32);
  const factsRefRoot = readBytes(buf, offset, 32);
  return {
    runtimeId,
    operator,
    compiledArtifactHash,
    entrantCount,
    winnerCount,
    winningScoreSum,
    winnersDigest: winnersDigestBytes,
    factsRefRoot,
  };
}

// Returns the first `ConditionsResolvedV1` event emitted by the expected program, or null if the
// transaction has none under that program (so the caller can fall through to the OutcomeResolved
// path). Program-id scoping mirrors `findOutcomeResolvedEvent`.
function findConditionsResolvedEvent(
  logs: string[],
  expectedProgramId: string
): ConditionsResolvedEvent | null {
  const stack: string[] = [];
  for (const line of logs) {
    const invoke = parseProgramInvoke(line);
    if (invoke) {
      stack.push(invoke);
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
    if (stack.length === 0 || stack[stack.length - 1] !== expectedProgramId) continue;
    const event = decodeConditionsResolvedV1(line);
    if (event) return event;
  }
  return null;
}

// ---- SF1 slot spin (format 10) settle event ----

type SlotSpinResolvedEvent = {
  runtimeId: Buffer;
  resolveId: bigint;
  actor: PublicKey;
  inputLamports: bigint;
  payoutLamports: bigint;
  rawWinLamports: bigint;
  compiledArtifactHash: Buffer;
  randomness: Buffer;
  reelCount: number;
  reelStops: number[];
  resolvedSlots: bigint[];
  slotHashes: Buffer[];
  settledAtSlot: bigint;
};

function decodeSlotSpinResolvedV1(line: string): SlotSpinResolvedEvent | null {
  if (!line.startsWith("Program data: ")) return null;
  const encoded = line.slice("Program data: ".length).trim();
  const buf = Buffer.from(encoded, "base64");
  const discriminator = anchorEventDiscriminator("SlotSpinResolvedV1");
  if (buf.length < 8 || !buf.subarray(0, 8).equals(discriminator)) return null;

  const offset = { value: 8 };
  const runtimeId = readBytes(buf, offset, 16);
  const resolveId = readU64LE(buf, offset);
  const actor = new PublicKey(readBytes(buf, offset, 32));
  const inputLamports = readU64LE(buf, offset);
  const payoutLamports = readU64LE(buf, offset);
  const rawWinLamports = readU64LE(buf, offset);
  const compiledArtifactHash = readBytes(buf, offset, 32);
  const randomness = readBytes(buf, offset, 32);
  const reelCount = buf[offset.value];
  offset.value += 1;
  const reelStops: number[] = [];
  for (let index = 0; index < 16; index += 1) {
    reelStops.push(readU16LE(buf, offset));
  }
  const resolvedSlots = readFixedU64Array(buf, offset, 3);
  const slotHashes = readFixedHashArray(buf, offset, 3);
  const settledAtSlot = readU64LE(buf, offset);
  return {
    runtimeId,
    resolveId,
    actor,
    inputLamports,
    payoutLamports,
    rawWinLamports,
    compiledArtifactHash,
    randomness,
    reelCount,
    reelStops,
    resolvedSlots,
    slotHashes,
    settledAtSlot,
  };
}

// Returns the first `SlotSpinResolvedV1` event emitted by the expected program, or null so the
// caller can fall through to the other event paths. Program-id scoping mirrors
// `findOutcomeResolvedEvent`.
function findSlotSpinResolvedEvent(
  logs: string[],
  expectedProgramId: string
): SlotSpinResolvedEvent | null {
  const stack: string[] = [];
  for (const line of logs) {
    const invoke = parseProgramInvoke(line);
    if (invoke) {
      stack.push(invoke);
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
    if (stack.length === 0 || stack[stack.length - 1] !== expectedProgramId) continue;
    const event = decodeSlotSpinResolvedV1(line);
    if (event) return event;
  }
  return null;
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

function decodeOutcomeResolutionV4Account(data: Buffer): any {
  const discriminator = anchorAccountDiscriminator("OutcomeResolutionV4");
  if (data.length < 8 || !data.subarray(0, 8).equals(discriminator)) {
    throw new Error("OutcomeResolutionV4 discriminator mismatch");
  }
  const offset = { value: 8 };
  return {
    runtime_id: [...readBytes(data, offset, 16)],
    resolve_id: readU64LE(data, offset),
    actor: new PublicKey(readBytes(data, offset, 32)),
    input_lamports: readU64LE(data, offset),
    status: readU8(data, offset),
    rng_version: readU8(data, offset),
    artifact_format_version: readU16LE(data, offset),
    winner_count: readU16LE(data, offset),
    winner_claim_hash: [...readBytes(data, offset, 32)],
    total_output_lamports: readU64LE(data, offset),
    compiled_artifact_hash: [...readBytes(data, offset, 32)],
    randomness: [...readBytes(data, offset, 32)],
    outcome_id_len: readU8(data, offset),
    outcome_id: [...readBytes(data, offset, MAX_OUTCOME_ID_BYTES)],
    effect_count: readU16LE(data, offset),
    effects_digest: [...readBytes(data, offset, 32)],
    snapshot_hash: [...readBytes(data, offset, 32)],
    resolved_slots: readFixedU64Array(data, offset, 3),
    slot_hashes: readFixedHashArray(data, offset, 3).map((hash) => [...hash]),
    operator_commit_present: readU8(data, offset) !== 0,
    operator_commit_hash: [...readBytes(data, offset, 32)],
    operator_reveal_len: readU8(data, offset),
    operator_reveal: [...readBytes(data, offset, 32)],
    bump: readU8(data, offset),
    protocol_revision: readU8(data, offset),
    bounty_lamports: readU64LE(data, offset),
    reserved: [...readBytes(data, offset, 20)],
  };
}

function decodeRngV2StateAccount(data: Buffer): RngV2StateAccount {
  const discriminator = anchorAccountDiscriminator("RngV2State");
  if (data.length < 8 || !data.subarray(0, 8).equals(discriminator)) {
    throw new Error("RngV2State discriminator mismatch");
  }
  const offset = { value: 8 };
  const state: RngV2StateAccount = {
    runtimeId: readBytes(data, offset, 16),
    resolveId: readU64LE(data, offset),
    actor: new PublicKey(readBytes(data, offset, 32)),
    inputLamports: readU64LE(data, offset),
    status: readU8(data, offset),
    compiledArtifactHash: readBytes(data, offset, 32),
    artifactFormatVersion: readU16LE(data, offset),
    snapshotHash: readBytes(data, offset, 32),
    targetSlots: readFixedU64Array(data, offset, 3),
    expirySlot: readU64LE(data, offset),
    operatorCommitPresent: readU8(data, offset) !== 0,
    operatorCommitHash: readBytes(data, offset, 32),
    operatorRevealLen: readU8(data, offset),
    operatorReveal: readBytes(data, offset, 32),
    resolvedSlots: readFixedU64Array(data, offset, 3),
    slotHashes: readFixedHashArray(data, offset, 3),
  };
  readU8(data, offset); // bump
  readBytes(data, offset, 32); // reserved
  return state;
}

async function fetchDecodedRngV2State(
  connection: anchor.web3.Connection,
  pubkey: PublicKey
): Promise<RngV2StateAccount> {
  const info = await connection.getAccountInfo(pubkey, "confirmed");
  if (!info) {
    mismatch("ERR_RNG_V2_STATE_MISMATCH", `RngV2State not found: ${pubkey.toBase58()}`);
  }
  try {
    return decodeRngV2StateAccount(info.data);
  } catch (error) {
    mismatch(
      "ERR_RNG_V2_STATE_MISMATCH",
      `Failed to decode RngV2State: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function fetchDecodedOutcomeResolution(
  connection: anchor.web3.Connection,
  coder: any,
  pubkey: PublicKey
): Promise<{
  accountName:
    | "OutcomeResolution"
    | "OutcomeResolutionV2"
    | "OutcomeResolutionV3"
    | "OutcomeResolutionV4";
  decoded: any;
}> {
  const info = await connection.getAccountInfo(pubkey, "confirmed");
  if (!info) {
    mismatch(
      "ERR_RESOLUTION_ACCOUNT_NOT_FOUND",
      `OutcomeResolution not found: ${pubkey.toBase58()}`
    );
  }
  try {
    return {
      accountName: "OutcomeResolutionV4",
      decoded: decodeOutcomeResolutionV4Account(info.data),
    };
  } catch (_) {
    try {
      return {
        accountName: "OutcomeResolutionV3",
        decoded: coder.accounts.decode("OutcomeResolutionV3", info.data),
      };
    } catch (_) {
      try {
        return {
          accountName: "OutcomeResolutionV2",
          decoded: coder.accounts.decode("OutcomeResolutionV2", info.data),
        };
      } catch (error) {
        try {
          return {
            accountName: "OutcomeResolution",
            decoded: coder.accounts.decode("OutcomeResolution", info.data),
          };
        } catch (innerError) {
          mismatch(
            "ERR_RESOLUTION_ACCOUNT_NOT_FOUND",
            `Failed to decode OutcomeResolution account: ${
              innerError instanceof Error ? innerError.message : String(innerError)
            }`
          );
        }
      }
    }
  }
}

function expectedChunkLen(blobLen: number, chunkIndex: number): number {
  const chunkBase = chunkIndex * CHUNK_SIZE;
  return Math.min(CHUNK_SIZE, blobLen - chunkBase);
}

function parseCompiledArtifact(blob: Buffer): ParsedArtifact {
  if (blob.length === 0 || blob.length > 8192 || blob.length < 34) {
    throw new Error("Invalid artifact length");
  }
  if (blob.subarray(0, 4).toString("ascii") !== MAGIC) {
    throw new Error("Invalid artifact magic");
  }

  const offset = { value: 4 };
  const formatVersion = readU16LE(blob, offset);
  if (formatVersion === FORMAT_VERSION_COMPOSITE_RANK_DESC) {
    const parsedComposite = parseCompositeRankDescArtifact(blob);
    const replay = replayCompositeRankDescArtifact(blob);
    const replayById = new Map(
      replay.participant_replay.map((entry): [string, bigint] => [entry.id, BigInt(entry.composite_score)])
    );
    const outcomes: ParsedOutcome[] = parsedComposite.participants.map((participant) => ({
      outcomeIdLen: Buffer.byteLength(participant.id, "ascii"),
      outcomeId: Buffer.concat([
        Buffer.from(participant.id, "ascii"),
        Buffer.alloc(MAX_OUTCOME_ID_BYTES - Buffer.byteLength(participant.id, "ascii"), 0),
      ]),
      weight: 1,
      score: replayById.get(participant.id) ?? 0n,
      order: participant.order,
      firstEffectIndex: 0,
      effectCount: parsedComposite.payoutLamports === 0n ? 0 : 1,
    }));
    return {
      formatVersion,
      winnersCount: parsedComposite.winnersCount,
      minInputLamports: parsedComposite.minInputLamports,
      maxInputLamports: parsedComposite.maxInputLamports,
      formulaCode: FORMULA_CODE_COMPOSITE_RANK_DESC,
      formulaName: "composite_rank_desc",
      targetScore: 0n,
      payoutLamports: parsedComposite.payoutLamports,
      entryCount: parsedComposite.participantCount,
      totalEffectCount: 0,
      outcomes,
      effects: [],
      effectsOffset: blob.length,
    };
  }
  if (formatVersion === FORMAT_VERSION_V5) {
    const minInputLamports = readU64LE(blob, offset);
    const maxInputLamports = readU64LE(blob, offset);
    if (minInputLamports > maxInputLamports) {
      throw new Error("v5 artifact bounds are invalid");
    }
    const winnersCount = readU16LE(blob, offset);
    const formulaCode = readU8(blob, offset);
    if (
      formulaCode !== FORMULA_WEIGHTED_RANDOM &&
      formulaCode !== FORMULA_RANK_DESC &&
      formulaCode !== FORMULA_RANK_ASC &&
      formulaCode !== FORMULA_FIRST_N &&
      formulaCode !== FORMULA_CLOSEST_TO
    ) {
      throw new Error("Invalid formula code");
    }
    if (!readBytes(blob, offset, 5).equals(Buffer.alloc(5, 0))) {
      throw new Error("Reserved v5 header bytes must be zero");
    }
    const targetScore = readI64LE(blob, offset);
    const entryCount = readU16LE(blob, offset);
    const payoutLamports = readU64LE(blob, offset);
    if (entryCount < 1 || 48 + entryCount * V5_ENTRY_BYTES !== blob.length) {
      throw new Error("Invalid v5 entry_count or artifact byte size");
    }
    if (winnersCount < 1 || winnersCount > entryCount || winnersCount > MAX_WINNERS) {
      throw new Error("Invalid winners_count");
    }
    const outcomes: ParsedOutcome[] = [];
    const seenOrders = new Array<boolean>(entryCount).fill(false);
    let previousOutcomeId: Buffer | null = null;
    let weightSum = 0n;
    for (let index = 0; index < entryCount; index += 1) {
      const outcomeIdLen = readU8(blob, offset);
      if (outcomeIdLen < 1 || outcomeIdLen > MAX_OUTCOME_ID_BYTES) {
        throw new Error("Invalid v5 id length");
      }
      const outcomeId = readBytes(blob, offset, MAX_OUTCOME_ID_BYTES);
      const canonicalOutcomeId = outcomeId.subarray(0, outcomeIdLen);
      if (!canonicalOutcomeId.every((byte) => byte >= 32 && byte <= 126)) {
        throw new Error("v5 id must be printable ASCII");
      }
      if (!outcomeId.subarray(outcomeIdLen).equals(Buffer.alloc(MAX_OUTCOME_ID_BYTES - outcomeIdLen, 0))) {
        throw new Error("v5 id padding must be zero");
      }
      if (previousOutcomeId && Buffer.compare(previousOutcomeId, canonicalOutcomeId) >= 0) {
        throw new Error("v5 ids must be strictly sorted");
      }
      previousOutcomeId = Buffer.from(canonicalOutcomeId);
      const weight = readU32LE(blob, offset);
      if (weight <= 0) {
        throw new Error("v5 weight must be positive");
      }
      weightSum += BigInt(weight);
      const score = readI64LE(blob, offset);
      const order = readU16LE(blob, offset);
      if (order >= entryCount || seenOrders[order]) {
        throw new Error("v5 order must be unique and in range");
      }
      seenOrders[order] = true;
      outcomes.push({
        outcomeIdLen,
        outcomeId,
        weight,
        score,
        order,
        firstEffectIndex: 0,
        effectCount: payoutLamports === 0n ? 0 : 1,
      });
    }
    if (offset.value !== blob.length) {
      throw new Error("Unknown trailing bytes in v5 artifact");
    }
    if (weightSum <= 0n || !seenOrders.every(Boolean)) {
      throw new Error("Invalid v5 entry table");
    }
    return {
      formatVersion,
      winnersCount,
      minInputLamports,
      maxInputLamports,
      formulaCode,
      formulaName: formulaCodeToName(formulaCode),
      targetScore,
      payoutLamports,
      entryCount,
      standardVersion: OUTCOME_STANDARD_V1_1,
      totalEffectCount: 0,
      outcomes,
      effects: [],
      effectsOffset: offset.value,
    };
  }
  if (
    formatVersion !== FORMAT_VERSION_V1 &&
    formatVersion !== FORMAT_VERSION_V2 &&
    formatVersion !== FORMAT_VERSION_V3
  ) {
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
  let winnersCount = 1;
  let formulaCode = FORMULA_WEIGHTED_RANDOM;
  let targetScore = 0n;
  if (formatVersion === FORMAT_VERSION_V2) {
    winnersCount = readU16LE(blob, offset);
    if (!readBytes(blob, offset, 6).equals(Buffer.alloc(6, 0))) {
      throw new Error("Reserved header bytes must be zero");
    }
  } else if (formatVersion === FORMAT_VERSION_V3) {
    winnersCount = readU16LE(blob, offset);
    formulaCode = readU8(blob, offset);
    if (
      formulaCode !== FORMULA_WEIGHTED_RANDOM &&
      formulaCode !== FORMULA_RANK_DESC &&
      formulaCode !== FORMULA_RANK_ASC &&
      formulaCode !== FORMULA_FIRST_N &&
      formulaCode !== FORMULA_CLOSEST_TO
    ) {
      throw new Error("Invalid formula code");
    }
    if (!readBytes(blob, offset, 5).equals(Buffer.alloc(5, 0))) {
      throw new Error("Reserved header bytes must be zero");
    }
    targetScore = readI64LE(blob, offset);
  } else if (!readBytes(blob, offset, 8).equals(Buffer.alloc(8, 0))) {
    throw new Error("Reserved header bytes must be zero");
  }
  if (winnersCount < 1 || winnersCount > outcomeCount || winnersCount > MAX_WINNERS) {
    throw new Error("Invalid winners_count");
  }

  const outcomes: ParsedOutcome[] = [];
  const referencedEffects = new Array<boolean>(totalEffectCount).fill(false);
  const seenOrders = new Array<boolean>(outcomeCount).fill(false);
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

    let score = 0n;
    let order = index;
    if (formatVersion === FORMAT_VERSION_V3) {
      score = readI64LE(blob, offset);
      order = readU16LE(blob, offset);
      if (order < 0 || order >= outcomeCount) {
        throw new Error("Outcome order is out of bounds");
      }
      if (seenOrders[order]) {
        throw new Error("Outcome order must be unique");
      }
      seenOrders[order] = true;
    }

    const firstEffectIndex = readU16LE(blob, offset);
    const effectCount = readU16LE(blob, offset);
    const endEffectIndex = firstEffectIndex + effectCount;
    if (endEffectIndex > totalEffectCount) {
      throw new Error("Outcome effect slice is out of bounds");
    }
    for (let effectIndex = firstEffectIndex; effectIndex < endEffectIndex; effectIndex += 1) {
      if (formatVersion !== FORMAT_VERSION_V1 && referencedEffects[effectIndex]) {
        throw new Error("V2 outcome effect ranges must not overlap");
      }
      referencedEffects[effectIndex] = true;
    }

    outcomes.push({
      outcomeIdLen,
      outcomeId,
      weight,
      score,
      order,
      firstEffectIndex,
      effectCount,
    });
  }

  if (weightSum <= 0n) {
    throw new Error("Weight sum must be positive");
  }
  if (formatVersion === FORMAT_VERSION_V3 && !seenOrders.every(Boolean)) {
    throw new Error("Outcome order must be contiguous and unique");
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
    formatVersion,
    winnersCount,
    minInputLamports,
    maxInputLamports,
    formulaCode,
    formulaName: formulaCodeToName(formulaCode),
    targetScore,
    payoutLamports: 0n,
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

function rollForRound(randomness: Buffer, round: number): bigint {
  if (round === 0) return randomness.readBigUInt64LE(0);
  const roundBytes = Buffer.alloc(2);
  roundBytes.writeUInt16LE(round, 0);
  return sha256(
    Buffer.concat([
      Buffer.from(MULTI_WINNER_DOMAIN, "ascii"),
      randomness,
      roundBytes,
    ])
  ).readBigUInt64LE(0);
}

function compareFormulaOutcomes(
  left: ParsedOutcome,
  right: ParsedOutcome,
  parsed: ParsedArtifact
): number {
  switch (parsed.formulaCode) {
    case FORMULA_RANK_DESC:
    case FORMULA_CODE_COMPOSITE_RANK_DESC:
      if (left.score !== right.score) return left.score > right.score ? -1 : 1;
      return left.order - right.order;
    case FORMULA_RANK_ASC:
      if (left.score !== right.score) return left.score < right.score ? -1 : 1;
      return left.order - right.order;
    case FORMULA_FIRST_N:
      return left.order - right.order;
    case FORMULA_CLOSEST_TO: {
      const leftDistance = left.score - parsed.targetScore;
      const rightDistance = right.score - parsed.targetScore;
      const absLeft = leftDistance < 0n ? -leftDistance : leftDistance;
      const absRight = rightDistance < 0n ? -rightDistance : rightDistance;
      if (absLeft !== absRight) return absLeft < absRight ? -1 : 1;
      return left.order - right.order;
    }
    default:
      return 0;
  }
}

function selectOutcomes(
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

  const selectedIndices =
    parsed.formulaCode === FORMULA_WEIGHTED_RANDOM
      ? (() => {
          const remaining = parsed.outcomes.map((_, index) => index);
          const selected: number[] = [];
          for (let round = 0; round < parsed.winnersCount; round += 1) {
            const selectedRemainingIndex = chooseWeightedIndex(
              remaining.map((index) => parsed.outcomes[index].weight),
              rollForRound(randomness, round)
            );
            selected.push(remaining.splice(selectedRemainingIndex, 1)[0]);
          }
          return selected;
        })()
      : parsed.outcomes
          .map((_, index) => index)
          .sort((left, right) =>
            compareFormulaOutcomes(parsed.outcomes[left], parsed.outcomes[right], parsed)
          )
          .slice(0, parsed.winnersCount);

  const outcomeIdLens: number[] = [];
  const outcomeIds: Buffer[] = [];
  const effectChunks: Buffer[] = [];
  let totalOutputLamports = 0n;
  let effectCount = 0;

  for (const selectedIndex of selectedIndices) {
    const selected = parsed.outcomes[selectedIndex];
    outcomeIdLens.push(selected.outcomeIdLen);
    outcomeIds.push(selected.outcomeId);
    if (
      parsed.formatVersion === FORMAT_VERSION_V5 ||
      parsed.formatVersion === FORMAT_VERSION_COMPOSITE_RANK_DESC
    ) {
      if (parsed.payoutLamports > 0n) {
        const syntheticEffect = Buffer.alloc(EFFECT_ENTRY_BYTES, 0);
        syntheticEffect[0] = EFFECT_TYPE_TRANSFER_SOL;
        syntheticEffect.writeBigUInt64LE(parsed.payoutLamports, 8);
        effectChunks.push(syntheticEffect);
        effectCount += 1;
        totalOutputLamports += parsed.payoutLamports;
      }
    } else {
      const effectStart =
        parsed.effectsOffset + selected.firstEffectIndex * EFFECT_ENTRY_BYTES;
      const effectEnd = effectStart + selected.effectCount * EFFECT_ENTRY_BYTES;
      effectChunks.push(blob.subarray(effectStart, effectEnd));
      effectCount += selected.effectCount;
      for (
        let index = selected.firstEffectIndex;
        index < selected.firstEffectIndex + selected.effectCount;
        index += 1
      ) {
        totalOutputLamports += parsed.effects[index].amountLamports;
      }
    }
  }

  return {
    totalOutputLamports,
    outcomeIdLen: outcomeIdLens[0],
    outcomeId: outcomeIds[0],
    outcomeIdLens,
    outcomeIds,
    effectCount,
    effectsDigest: sha256(Buffer.concat(effectChunks)),
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

function mismatchResult(reason: string, programId: string): VerifyResult {
  return {
    status: "MISMATCH",
    reason,
    outcome_id: "",
    resolve_id: "",
    compiled_artifact_hash: "",
    runtime_id: "",
    program_id: programId,
  };
}

function deriveRngV2Seed(event: OutcomeResolvedEvent, snapshotHash: Buffer): Buffer {
  if (
    !event.resolvedSlots ||
    event.resolvedSlots.length !== 3 ||
    !event.slotHashes ||
    event.slotHashes.length !== 3
  ) {
    mismatch("ERR_RNG_V2_EVIDENCE_MISSING", "RNG v2 slot evidence is missing");
  }
  const chunks: Buffer[] = [
    Buffer.from(RNG_V2_DOMAIN, "ascii"),
    event.runtimeId,
    u64le(event.resolveId),
    event.compiledArtifactHash,
    snapshotHash,
  ];
  for (let index = 0; index < 3; index += 1) {
    chunks.push(u64le(event.resolvedSlots[index]));
    chunks.push(event.slotHashes[index]);
  }
  if (event.operatorCommitPresent) {
    if (!event.operatorCommitHash) {
      mismatch("ERR_RNG_V2_EVIDENCE_MISSING", "RNG v2 operator commit hash is missing");
    }
    chunks.push(event.operatorCommitHash);
  }
  return sha256(Buffer.concat(chunks));
}

function deriveRngV2Randomness(event: OutcomeResolvedEvent, snapshotHash: Buffer): Buffer {
  const seed = deriveRngV2Seed(event, snapshotHash);
  return sha256(
    Buffer.concat([seed, event.runtimeId, u64le(event.resolveId), event.actor.toBuffer()])
  );
}

function verifyRngV2StateBinding(
  state: RngV2StateAccount,
  event: OutcomeResolvedEvent
): void {
  if (
    event.rngVersion !== RNG_VERSION_V2 ||
    !event.snapshotHash ||
    !event.resolvedSlots ||
    !event.slotHashes
  ) {
    mismatch("ERR_RNG_V2_EVIDENCE_MISSING", "RNG v2 event evidence is missing");
  }

  if (
    state.status !== RNG_V2_STATUS_SETTLED ||
    !state.runtimeId.equals(event.runtimeId) ||
    state.resolveId !== event.resolveId ||
    !state.actor.equals(event.actor) ||
    state.inputLamports !== event.inputLamports ||
    !state.compiledArtifactHash.equals(event.compiledArtifactHash) ||
    state.artifactFormatVersion !== event.artifactFormatVersion ||
    !state.snapshotHash.equals(event.snapshotHash) ||
    state.operatorCommitPresent !== Boolean(event.operatorCommitPresent) ||
    !state.operatorCommitHash.equals(event.operatorCommitHash ?? Buffer.alloc(32, 0)) ||
    state.operatorRevealLen !== (event.operatorRevealLen ?? 0) ||
    !state.operatorReveal.equals(event.operatorReveal ?? Buffer.alloc(32, 0)) ||
    state.resolvedSlots.length !== event.resolvedSlots.length ||
    state.slotHashes.length !== event.slotHashes.length ||
    state.resolvedSlots.some((slot, index) => slot !== event.resolvedSlots![index]) ||
    state.slotHashes.some((hash, index) => !hash.equals(event.slotHashes![index]))
  ) {
    mismatch(
      "ERR_RNG_V2_STATE_MISMATCH",
      "RNG v2 state differs from event evidence"
    );
  }
}

function rngV2ResultFields(
  event: OutcomeResolvedEvent,
  state?: RngV2StateAccount
): Partial<VerifyResult> {
  if (event.rngVersion !== RNG_VERSION_V2) return {};
  return {
    rng_version: RNG_VERSION_V2,
    ...(state ? { target_slots: state.targetSlots.map((slot) => slot.toString()) } : {}),
    resolved_slots: (event.resolvedSlots ?? []).map((slot) => slot.toString()),
    slot_hashes: (event.slotHashes ?? []).map((hash) => hash.toString("hex")),
    ...(event.operatorCommitPresent && event.operatorCommitHash
      ? { operator_commit_hash: event.operatorCommitHash.toString("hex") }
      : {}),
  };
}

// Verify a `resolve_conditions` (fc7/fv9) attestation by replaying the committed artifact:
// reconstruct the fc7 blob from its on-chain chunk accounts, recompute S + ranking + the two
// digests via the conditions SDK, and compare to the emitted `ConditionsResolvedV1` event.
async function verifyConditions(
  connection: anchor.web3.Connection,
  coder: any,
  programId: PublicKey,
  event: ConditionsResolvedEvent
): Promise<VerifyResult> {
  const runtimeIdHex = toHex(event.runtimeId);
  const compiledArtifactHashHex = toHex(event.compiledArtifactHash);

  // OutcomeConfig binds runtime_id → compiled_artifact_hash (same hash the event carries).
  const outcomeConfigPda = deriveOutcomeConfigPda(programId, event.runtimeId);
  const outcomeConfig = await fetchDecodedAccount(
    connection,
    coder,
    outcomeConfigPda,
    "OutcomeConfig",
    "ERR_OUTCOME_CONFIG_NOT_FOUND"
  );
  const configHash = Buffer.from(
    pick<number[]>(outcomeConfig, "compiled_artifact_hash", "compiledArtifactHash")
  );
  if (!configHash.equals(event.compiledArtifactHash)) {
    mismatch("ERR_CONFIG_HASH_MISMATCH", "OutcomeConfig hash differs from event hash");
  }

  // Reconstruct + hash-verify the committed fc7 blob from its on-chain chunk accounts.
  const approvedArtifactPda = deriveApprovedArtifactPda(programId, event.compiledArtifactHash);
  const approvedArtifact = await fetchDecodedAccount(
    connection,
    coder,
    approvedArtifactPda,
    "ApprovedOutcomeArtifact",
    "ERR_ARTIFACT_HEADER_NOT_FOUND"
  );
  const headerHash = Buffer.from(
    pick<number[]>(approvedArtifact, "compiled_artifact_hash", "compiledArtifactHash")
  );
  if (!headerHash.equals(event.compiledArtifactHash)) {
    mismatch("ERR_ARTIFACT_HASH_MISMATCH", "ApprovedOutcomeArtifact hash differs from event hash");
  }
  if (!Boolean(pick(approvedArtifact, "is_finalized", "isFinalized"))) {
    mismatch("ERR_ARTIFACT_NOT_FINALIZED", "ApprovedOutcomeArtifact is not finalized");
  }
  const blob = await reconstructArtifactBlob(
    connection,
    coder,
    programId,
    event.compiledArtifactHash,
    approvedArtifact
  );
  if (!sha256(blob).equals(event.compiledArtifactHash)) {
    mismatch("ERR_ARTIFACT_HASH_MISMATCH", "Reconstructed fc7 blob hash differs from event hash");
  }

  // Parse fc7, replay, recompute the attestation, compare to the event.
  let artifact: ReturnType<typeof parseConditionsArtifact>;
  let ranked: ReturnType<typeof resolveConditionsArtifact>;
  try {
    artifact = parseConditionsArtifact(blob);
    ranked = resolveConditionsArtifact(artifact);
  } catch (error) {
    mismatch("ERR_REPLAY_UNHANDLED", error instanceof Error ? error.message : String(error));
  }
  if (
    artifact.formatVersion !== FORMAT_VERSION_CONDITIONS ||
    artifact.formulaCode !== FORMULA_CODE_CONDITIONS
  ) {
    mismatch("ERR_ARTIFACT_FORMAT_VERSION_MISMATCH", "Artifact is not fc7/fv9 conditions");
  }

  const winners = ranked.filter((r) => r.allHit);
  const recomputedSum = winningScoreSum(ranked);
  const recomputedWinnersDigest = winnersDigest(ranked);
  const recomputedFactsRoot = factsRefRoot(artifact);

  if (artifact.entrants.length !== event.entrantCount) {
    mismatch("ERR_CONDITIONS_ENTRANT_COUNT_MISMATCH", "Entrant count differs between artifact and event");
  }
  if (winners.length !== event.winnerCount) {
    mismatch("ERR_WINNER_COUNT_MISMATCH", "Winner count differs between replay and event");
  }
  if (recomputedSum !== event.winningScoreSum) {
    mismatch("ERR_CONDITIONS_SCORE_SUM_MISMATCH", "Winning score sum differs between replay and event");
  }
  if (!recomputedWinnersDigest.equals(event.winnersDigest)) {
    mismatch("ERR_CONDITIONS_WINNERS_DIGEST_MISMATCH", "Winners digest differs between replay and event");
  }
  if (!recomputedFactsRoot.equals(event.factsRefRoot)) {
    mismatch("ERR_CONDITIONS_FACTS_ROOT_MISMATCH", "Facts-ref root differs between replay and event");
  }

  return {
    status: "MATCH",
    reason: "OK",
    outcome_id: winners.length > 0 ? new PublicKey(winners[0].wallet).toBase58() : "",
    resolution_formula: "conditions",
    winners_count: winners.length,
    entrant_count: artifact.entrants.length,
    winning_score_sum: recomputedSum.toString(),
    winners_digest: recomputedWinnersDigest.toString("hex"),
    facts_ref_root: recomputedFactsRoot.toString("hex"),
    outcomes: [],
    resolve_id: "",
    compiled_artifact_hash: compiledArtifactHashHex,
    runtime_id: runtimeIdHex,
    program_id: programId.toBase58(),
  };
}

// SF1 slot spins carry no snapshot and no operator commit: the seed mixes the zero snapshot
// hash and omits the commit chunk, exactly as prepare_slot_spin wrote the state.
function deriveSlotSpinRandomness(event: SlotSpinResolvedEvent): Buffer {
  const chunks: Buffer[] = [
    Buffer.from(RNG_V2_DOMAIN, "ascii"),
    event.runtimeId,
    u64le(event.resolveId),
    event.compiledArtifactHash,
    Buffer.alloc(32, 0),
  ];
  for (let index = 0; index < 3; index += 1) {
    chunks.push(u64le(event.resolvedSlots[index]));
    chunks.push(event.slotHashes[index]);
  }
  const seed = sha256(Buffer.concat(chunks));
  return sha256(
    Buffer.concat([seed, event.runtimeId, u64le(event.resolveId), event.actor.toBuffer()])
  );
}

// Verify a `settle_slot_spin` (SF1/format 10) result by replaying the committed game:
// reconstruct the SF1 blob from its on-chain chunk accounts, re-derive the rng_v2 randomness
// from the frozen slot hashes, replay the spin (reel stops + line/scatter payout), clamp by the
// artifact max-win cap, and compare everything to the emitted `SlotSpinResolvedV1` event.
async function verifySlot(
  connection: anchor.web3.Connection,
  coder: any,
  programId: PublicKey,
  event: SlotSpinResolvedEvent
): Promise<VerifyResult> {
  const runtimeIdHex = toHex(event.runtimeId);
  const compiledArtifactHashHex = toHex(event.compiledArtifactHash);

  // OutcomeConfig binds runtime_id → compiled_artifact_hash (same hash the event carries).
  const outcomeConfigPda = deriveOutcomeConfigPda(programId, event.runtimeId);
  const outcomeConfig = await fetchDecodedAccount(
    connection,
    coder,
    outcomeConfigPda,
    "OutcomeConfig",
    "ERR_OUTCOME_CONFIG_NOT_FOUND"
  );
  const configHash = Buffer.from(
    pick<number[]>(outcomeConfig, "compiled_artifact_hash", "compiledArtifactHash")
  );
  if (!configHash.equals(event.compiledArtifactHash)) {
    mismatch("ERR_CONFIG_HASH_MISMATCH", "OutcomeConfig hash differs from event hash");
  }

  const approvedArtifactPda = deriveApprovedArtifactPda(programId, event.compiledArtifactHash);
  const approvedArtifact = await fetchDecodedAccount(
    connection,
    coder,
    approvedArtifactPda,
    "ApprovedOutcomeArtifact",
    "ERR_ARTIFACT_HEADER_NOT_FOUND"
  );
  const headerHash = Buffer.from(
    pick<number[]>(approvedArtifact, "compiled_artifact_hash", "compiledArtifactHash")
  );
  if (!headerHash.equals(event.compiledArtifactHash)) {
    mismatch("ERR_ARTIFACT_HASH_MISMATCH", "ApprovedOutcomeArtifact hash differs from event hash");
  }
  if (!Boolean(pick(approvedArtifact, "is_finalized", "isFinalized"))) {
    mismatch("ERR_ARTIFACT_NOT_FINALIZED", "ApprovedOutcomeArtifact is not finalized");
  }
  const blob = await reconstructArtifactBlob(
    connection,
    coder,
    programId,
    event.compiledArtifactHash,
    approvedArtifact
  );
  if (!sha256(blob).equals(event.compiledArtifactHash)) {
    mismatch("ERR_ARTIFACT_HASH_MISMATCH", "Reconstructed SF1 blob hash differs from event hash");
  }

  let spec: ReturnType<typeof parseSlotArtifact>;
  try {
    spec = parseSlotArtifact(blob);
  } catch (error) {
    mismatch("ERR_REPLAY_UNHANDLED", error instanceof Error ? error.message : String(error));
  }

  // Re-derive the randomness from the slot-hash evidence and check the event told the truth.
  const recomputedRandomness = deriveSlotSpinRandomness(event);
  if (!recomputedRandomness.equals(event.randomness)) {
    mismatch("ERR_SLOT_RANDOMNESS_MISMATCH", "Recomputed randomness differs from event");
  }

  // Replay the spin against the committed artifact.
  const outcome = replaySpin(spec, recomputedRandomness, event.inputLamports);
  if (
    event.reelCount !== spec.cols ||
    outcome.reelStops.some((stop, index) => stop !== event.reelStops[index]) ||
    event.reelStops.slice(spec.cols).some((stop) => stop !== 0)
  ) {
    mismatch("ERR_SLOT_REEL_STOPS_MISMATCH", "Replayed reel stops differ from event");
  }
  if (outcome.totalWinLamports !== event.rawWinLamports) {
    mismatch("ERR_SLOT_WIN_MISMATCH", "Replayed win differs from event raw win");
  }
  const cap = maxWinCap(event.inputLamports, spec.maxWinMultiplier);
  const expectedPayout =
    outcome.totalWinLamports < cap ? outcome.totalWinLamports : cap;
  if (expectedPayout !== event.payoutLamports) {
    mismatch("ERR_SLOT_PAYOUT_MISMATCH", "Clamped payout differs from event payout");
  }

  return {
    status: "MATCH",
    reason: "OK",
    outcome_id: "",
    resolution_formula: "slot",
    artifact_format_version: FORMAT_VERSION_SLOT,
    actor: event.actor.toBase58(),
    input_lamports: event.inputLamports.toString(),
    payout_lamports: event.payoutLamports.toString(),
    raw_win_lamports: event.rawWinLamports.toString(),
    reel_stops: outcome.reelStops,
    randomness: recomputedRandomness.toString("hex"),
    settled_at_slot: event.settledAtSlot.toString(),
    rng_version: RNG_VERSION_V2,
    resolved_slots: event.resolvedSlots.map((slot) => slot.toString()),
    slot_hashes: event.slotHashes.map((hash) => hash.toString("hex")),
    outcomes: [],
    resolve_id: event.resolveId.toString(),
    compiled_artifact_hash: compiledArtifactHashHex,
    runtime_id: runtimeIdHex,
    program_id: programId.toBase58(),
  };
}

function verifyRngV2ResolutionEvidence(
  outcomeResolutionAccount: { accountName: string },
  outcomeResolution: Record<string, unknown>,
  event: OutcomeResolvedEvent
): void {
  if (event.rngVersion === RNG_VERSION_V2) {
    if (outcomeResolutionAccount.accountName !== "OutcomeResolutionV4") {
      mismatch(
        "ERR_RNG_V2_RESOLUTION_MISMATCH",
        "RNG v2 event must be backed by OutcomeResolutionV4"
      );
    }
    const resolutionRngVersion = Number(
      pick(outcomeResolution, "rng_version", "rngVersion")
    );
    const resolutionSnapshotHash = Buffer.from(
      pick<number[]>(outcomeResolution, "snapshot_hash", "snapshotHash")
    );
    const resolutionResolvedSlots = (
      pick<any[]>(outcomeResolution, "resolved_slots", "resolvedSlots") ?? []
    ).map(asBigInt);
    const resolutionSlotHashes = (
      pick<number[][]>(outcomeResolution, "slot_hashes", "slotHashes") ?? []
    ).map((hash) => Buffer.from(hash));
    const eventResolvedSlots = event.resolvedSlots ?? [];
    const eventSlotHashes = event.slotHashes ?? [];
    if (
      resolutionRngVersion !== RNG_VERSION_V2 ||
      !event.snapshotHash ||
      !resolutionSnapshotHash.equals(event.snapshotHash) ||
      resolutionResolvedSlots.length !== eventResolvedSlots.length ||
      resolutionSlotHashes.length !== eventSlotHashes.length ||
      resolutionResolvedSlots.some((slot, index) => slot !== eventResolvedSlots[index]) ||
      resolutionSlotHashes.some((hash, index) => !hash.equals(eventSlotHashes[index]))
    ) {
      mismatch(
        "ERR_RNG_V2_RESOLUTION_MISMATCH",
        "RNG v2 evidence differs between event and resolution account"
      );
    }
    const resolutionCommitPresent = Boolean(
      pick(outcomeResolution, "operator_commit_present", "operatorCommitPresent")
    );
    const resolutionCommitHash = Buffer.from(
      pick<number[]>(outcomeResolution, "operator_commit_hash", "operatorCommitHash")
    );
    const resolutionRevealLen = Number(
      pick(outcomeResolution, "operator_reveal_len", "operatorRevealLen")
    );
    const resolutionReveal = Buffer.from(
      pick<number[]>(outcomeResolution, "operator_reveal", "operatorReveal")
    );
    if (
      resolutionCommitPresent !== Boolean(event.operatorCommitPresent) ||
      !resolutionCommitHash.equals(event.operatorCommitHash ?? Buffer.alloc(32, 0)) ||
      resolutionRevealLen !== (event.operatorRevealLen ?? 0) ||
      !resolutionReveal.equals(event.operatorReveal ?? Buffer.alloc(32, 0))
    ) {
      mismatch(
        "ERR_RNG_V2_OPERATOR_REVEAL_MISMATCH",
        "RNG v2 commit/reveal evidence differs between event and resolution account"
      );
    }
  }
}

async function verifyOutcomeStrict(opts: Required<VerifyOutcomeOptions>): Promise<VerifyResult> {
  const programId = new PublicKey(opts.programId);
  const connection = new anchor.web3.Connection(opts.rpcUrl, { commitment: "confirmed" });
  const rawIdl = loadIdl();
  const coder = new anchor.BorshCoder(rawIdl as anchor.Idl);

  const logs = await fetchTransactionLogs(connection, opts.signature);

  // conditions (fc7/fv9) resolutions emit ConditionsResolvedV1 (no OutcomeResolution account) —
  // branch to the dedicated replay before the OutcomeResolved path (which would not find its event).
  const conditionsEvent = findConditionsResolvedEvent(logs, programId.toBase58());
  if (conditionsEvent) {
    return await verifyConditions(connection, coder, programId, conditionsEvent);
  }

  // SF1 slot spins (format 10) emit SlotSpinResolvedV1 (no OutcomeResolution account) —
  // branch to the dedicated replay before the OutcomeResolved path.
  const slotEvent = findSlotSpinResolvedEvent(logs, programId.toBase58());
  if (slotEvent) {
    return await verifySlot(connection, coder, programId, slotEvent);
  }

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
  const rngV2StatePda =
    event.rngVersion === RNG_VERSION_V2
      ? deriveRngV2StatePda(programId, event.runtimeId, event.resolveId)
      : null;
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
  const outcomeResolutionAccount = await fetchDecodedOutcomeResolution(
    connection,
    coder,
    outcomeResolutionPda
  );
  const outcomeResolution = outcomeResolutionAccount.decoded;
  const rngV2State = rngV2StatePda
    ? await fetchDecodedRngV2State(connection, rngV2StatePda)
    : null;
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

  if (opts.artifactPath) {
    const resolvedArtifactPath = path.isAbsolute(opts.artifactPath)
      ? opts.artifactPath
      : path.resolve(process.cwd(), opts.artifactPath);
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

  const blobFormatVersion = blob.readUInt16LE(4);
  let parsed: ParsedArtifact | null = null;
  let parsedV4:
    | ReturnType<typeof parseArtifactV4>
    | ReturnType<typeof parseArtifactV12>
    | ReturnType<typeof parseArtifactV121>
    | null = null;
  try {
    if (blobFormatVersion === FORMAT_VERSION_V4) {
      parsedV4 = parseArtifactV4(blob);
    } else if (blobFormatVersion === FORMAT_VERSION_V1_2_SCALE) {
      parsedV4 = parseArtifactV12(blob);
    } else if (blobFormatVersion === FORMAT_VERSION_V1_2_1_SCALE) {
      parsedV4 = parseArtifactV121(blob);
    } else {
      parsed = parseCompiledArtifact(blob);
    }
  } catch (error) {
    mismatch(
      "ERR_REPLAY_UNHANDLED",
      error instanceof Error ? error.message : String(error)
    );
  }

  const recomputedRandomness =
    event.rngVersion === RNG_VERSION_V2
      ? (() => {
          // Scale (fmt 7) binds the Merkle snapshot hash; compact artifacts have no snapshot,
          // the seed is bound to compiled_artifact_hash and the snapshot field is all-zero.
          const expectedSnapshotHash = parsedV4 ? parsedV4.snapshotHash : Buffer.alloc(32, 0);
          if (!event.snapshotHash || !event.snapshotHash.equals(expectedSnapshotHash)) {
            mismatch(
              "ERR_RNG_V2_SNAPSHOT_HASH_MISMATCH",
              "RNG v2 snapshot hash differs between event and artifact"
            );
          }
          if (event.operatorCommitPresent) {
            if (
              !event.operatorCommitHash ||
              !event.operatorReveal ||
              !event.operatorRevealLen ||
              event.operatorRevealLen < 1 ||
              event.operatorRevealLen > 32
            ) {
              mismatch(
                "ERR_RNG_V2_OPERATOR_REVEAL_MISMATCH",
                "RNG v2 operator reveal is missing"
              );
            }
            const reveal = event.operatorReveal.subarray(0, event.operatorRevealLen);
            if (!sha256(reveal).equals(event.operatorCommitHash)) {
              mismatch(
                "ERR_RNG_V2_OPERATOR_REVEAL_MISMATCH",
                "RNG v2 operator reveal hash does not match commit"
              );
            }
          }
          return deriveRngV2Randomness(event, expectedSnapshotHash);
        })()
      : (() => {
          if (!event.masterSeed) {
            mismatch(
              "ERR_RANDOMNESS_MISMATCH",
              "Legacy replay requires master_seed in event"
            );
          }
          return sha256(
            Buffer.concat([
              event.masterSeed,
              event.runtimeId,
              u64le(event.resolveId),
              event.actor.toBuffer(),
            ])
          );
        })();

  if (event.rngVersion === RNG_VERSION_V2) {
    if (!rngV2State) {
      mismatch("ERR_RNG_V2_STATE_MISMATCH", "RNG v2 state is missing");
    }
    verifyRngV2StateBinding(rngV2State, event);
  }

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

  const resolutionArtifactFormatVersion =
    outcomeResolutionAccount.accountName === "OutcomeResolutionV2" ||
    outcomeResolutionAccount.accountName === "OutcomeResolutionV3" ||
    outcomeResolutionAccount.accountName === "OutcomeResolutionV4"
      ? Number(
          pick(
            outcomeResolution,
            "artifact_format_version",
            "artifactFormatVersion"
          )
        )
      : FORMAT_VERSION_V1;
  const resolutionWinnerCount =
    outcomeResolutionAccount.accountName === "OutcomeResolutionV2" ||
    outcomeResolutionAccount.accountName === "OutcomeResolutionV3" ||
    outcomeResolutionAccount.accountName === "OutcomeResolutionV4"
      ? Number(pick(outcomeResolution, "winner_count", "winnerCount"))
      : 1;

  if (
    event.artifactFormatVersion !== resolutionArtifactFormatVersion ||
    event.artifactFormatVersion !== blobFormatVersion
  ) {
    mismatch(
      "ERR_ARTIFACT_FORMAT_VERSION_MISMATCH",
      "Artifact format version differs between event, resolution, and artifact"
    );
  }

  if (parsedV4) {
    const formula = formulaNameFromArtifactV4(parsedV4);
    const expectedTarget = parsedV4.targetScore;
    const resolutionOutput = asBigInt(
      pick(outcomeResolution, "total_output_lamports", "totalOutputLamports")
    );
    const resolutionOutcomeIdLen = Number(
      pick(outcomeResolution, "outcome_id_len", "outcomeIdLen")
    );
    const resolutionOutcomeId = Buffer.from(
      pick<number[]>(outcomeResolution, "outcome_id", "outcomeId")
    );
    const resolutionOutcomeIdLens =
      outcomeResolutionAccount.accountName === "OutcomeResolutionV2"
        ? (pick<number[]>(outcomeResolution, "outcome_id_lens", "outcomeIdLens") ?? [])
        : [resolutionOutcomeIdLen];
    const resolutionOutcomeIds =
      outcomeResolutionAccount.accountName === "OutcomeResolutionV2"
        ? (pick<number[][]>(outcomeResolution, "outcome_ids", "outcomeIds") ?? []).map((id) =>
            Buffer.from(id)
          )
        : [resolutionOutcomeId];
    const resolutionEffectCount = Number(
      pick(outcomeResolution, "effect_count", "effectCount")
    );
    const resolutionEffectsDigest = Buffer.from(
      pick<number[]>(outcomeResolution, "effects_digest", "effectsDigest")
    );

    verifyRngV2ResolutionEvidence(outcomeResolutionAccount, outcomeResolution, event);

    let cleanupSnapshot = () => {};
    try {
      const snapshot = await fetchCommittedSnapshot({
        snapshotUri: parsedV4.snapshotUri,
        snapshotHash: parsedV4.snapshotHash.toString("hex"),
        mirrors: opts.snapshotMirrors,
        localFile: opts.snapshotFile || undefined,
        timeoutMs: opts.snapshotTimeoutMs,
      }).catch((error) => {
        if (error instanceof SnapshotUnavailableError) {
          mismatch("ERR_SNAPSHOT_UNAVAILABLE", error.message);
        }
        throw error;
      });
      const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), "vre-snapshot-"));
      const snapshotPath = path.join(snapshotDir, "snapshot.jsonl");
      fs.writeFileSync(snapshotPath, snapshot.bytes);
      cleanupSnapshot = () => {
        try {
          fs.rmSync(snapshotDir, { recursive: true, force: true });
        } catch (_) {
          // ignore temp cleanup errors
        }
      };
      const inspectedSnapshot = await inspectSnapshotFile({
        snapshotPath,
        formula,
        expectedHash: parsedV4.snapshotHash.toString("hex"),
        expectedCount: parsedV4.snapshotCount,
        ...(parsedV4.merkleRoot
          ? { expectedMerkleRoot: parsedV4.merkleRoot.toString("hex") }
          : {}),
      });
      const selected = await buildSnapshotClaimFromFile({
        snapshotPath,
        formula,
        winnersCount: parsedV4.winnersCount,
        randomness: recomputedRandomness,
        payoutLamports: parsedV4.payoutLamports,
        ...(formula === "closest_to" ? { targetScore: expectedTarget } : {}),
      });

      if (
        event.winnerCount !== resolutionWinnerCount ||
        event.winnerCount !== parsedV4.winnersCount ||
        event.winnerCount !== selected.outcomeIds.length
      ) {
        mismatch(
          "ERR_WINNER_COUNT_MISMATCH",
          "Winner count differs between event, resolution, artifact, and snapshot replay"
        );
      }
      if (
        event.totalOutputLamports !== resolutionOutput ||
        event.totalOutputLamports !== selected.totalOutputLamports
      ) {
        mismatch(
          "ERR_OUTPUT_MISMATCH",
          "Output lamports differ between event, resolution, and snapshot replay"
        );
      }
      if (parsedV4.formatVersion === FORMAT_VERSION_V1_2_1_SCALE) {
        const eventWinnerClaimHash = event.winnerClaimHash;
        const resolutionWinnerClaimHash = Buffer.from(
          pick<number[]>(outcomeResolution, "winner_claim_hash", "winnerClaimHash")
        );
        if (
          !eventWinnerClaimHash ||
          !eventWinnerClaimHash.equals(selected.winnerClaimHash) ||
          !resolutionWinnerClaimHash.equals(selected.winnerClaimHash)
        ) {
          mismatch(
            "ERR_WINNER_CLAIM_HASH_MISMATCH",
            "Winner claim hash differs between event, resolution, and snapshot replay"
          );
        }
        expectZeroPadding(event.outcomeId, event.outcomeIdLen, "ERR_OUTCOME_ID_MISMATCH");
        expectZeroPadding(
          resolutionOutcomeId,
          resolutionOutcomeIdLen,
          "ERR_OUTCOME_ID_MISMATCH"
        );
        if (
          outcomeIdString(event.outcomeId, event.outcomeIdLen) !== selected.outcomeIds[0] ||
          outcomeIdString(resolutionOutcomeId, resolutionOutcomeIdLen) !== selected.outcomeIds[0]
        ) {
          mismatch(
            "ERR_OUTCOME_ID_MISMATCH",
            "Primary outcome id differs between event, resolution, and snapshot replay"
          );
        }
        if (
          event.effectCount !== resolutionEffectCount ||
          event.effectCount !== selected.effectCount ||
          !event.effectsDigest.equals(resolutionEffectsDigest) ||
          !event.effectsDigest.equals(selected.effectsDigest)
        ) {
          mismatch(
            "ERR_EFFECTS_DIGEST_MISMATCH",
            "Effects digest differs between event, resolution, and snapshot replay"
          );
        }

        return {
          status: "MATCH",
          reason: "OK",
          outcome_id: selected.outcomeIds[0],
          outcome_ids: selected.outcomeIds,
          winners_count: selected.winnersCount,
          standard_version:
            Number(pick(outcomeResolution, "protocol_revision", "protocolRevision") ?? 0) >= 1
              ? OUTCOME_STANDARD_V1_3_2
              : OUTCOME_STANDARD_V1_2_1,
          resolution_formula: formula,
          ...(formula === "closest_to"
            ? {
                target: signedBigIntToSafeNumber(expectedTarget, "target"),
              }
            : {}),
          snapshot_hash: parsedV4.snapshotHash.toString("hex"),
          snapshot_count: parsedV4.snapshotCount,
          snapshot_uri: parsedV4.snapshotUri,
          ...(parsedV4.merkleRoot
            ? {
                merkle_root: parsedV4.merkleRoot.toString("hex"),
              }
            : {
                merkle_root: inspectedSnapshot.merkleRoot,
              }),
          ...rngV2ResultFields(event, rngV2State ?? undefined),
          outcomes: [],
          resolve_id: resolveId,
          compiled_artifact_hash: compiledArtifactHashHex,
          runtime_id: runtimeIdHex,
          program_id: programId.toBase58(),
        };
      }
      if (
        event.outcomeIdLens.length !== event.winnerCount ||
        event.outcomeIds.length !== event.winnerCount ||
        resolutionOutcomeIdLens.length !== event.winnerCount ||
        resolutionOutcomeIds.length !== event.winnerCount
      ) {
        mismatch(
          "ERR_OUTCOME_ID_MISMATCH",
          "Winner outcome array length differs from winner count"
        );
      }
      const seenOutcomeIds = new Set<string>();
      for (let index = 0; index < event.winnerCount; index += 1) {
        const expectedId = selected.outcomeIds[index];
        const eventId = event.outcomeIds[index];
        const resolutionId = resolutionOutcomeIds[index];
        const eventLen = event.outcomeIdLens[index];
        const resolutionLen = resolutionOutcomeIdLens[index];
        expectZeroPadding(eventId, eventLen, "ERR_OUTCOME_ID_MISMATCH");
        expectZeroPadding(resolutionId, resolutionLen, "ERR_OUTCOME_ID_MISMATCH");
        const eventString = outcomeIdString(eventId, eventLen);
        const resolutionString = outcomeIdString(resolutionId, resolutionLen);
        if (
          eventString !== expectedId ||
          resolutionString !== expectedId
        ) {
          mismatch(
            "ERR_OUTCOME_ID_MISMATCH",
            "Winner outcome id differs between event, resolution, and snapshot replay"
          );
        }
        if (seenOutcomeIds.has(expectedId)) {
          mismatch("ERR_OUTCOME_ID_MISMATCH", "Winner outcome ids must be distinct");
        }
        seenOutcomeIds.add(expectedId);
      }
      expectZeroPadding(event.outcomeId, event.outcomeIdLen, "ERR_OUTCOME_ID_MISMATCH");
      expectZeroPadding(
        resolutionOutcomeId,
        resolutionOutcomeIdLen,
        "ERR_OUTCOME_ID_MISMATCH"
      );
      if (
        outcomeIdString(event.outcomeId, event.outcomeIdLen) !== selected.outcomeIds[0] ||
        outcomeIdString(resolutionOutcomeId, resolutionOutcomeIdLen) !== selected.outcomeIds[0]
      ) {
        mismatch(
          "ERR_OUTCOME_ID_MISMATCH",
          "Primary outcome id differs between event, resolution, and snapshot replay"
        );
      }
      if (
        event.effectCount !== resolutionEffectCount ||
        event.effectCount !== selected.effectCount ||
        !event.effectsDigest.equals(resolutionEffectsDigest) ||
        !event.effectsDigest.equals(selected.effectsDigest)
      ) {
        mismatch(
          "ERR_EFFECTS_DIGEST_MISMATCH",
          "Effects digest differs between event, resolution, and snapshot replay"
        );
      }

      return {
        status: "MATCH",
        reason: "OK",
        outcome_id: selected.outcomeIds[0],
        outcome_ids: selected.outcomeIds,
        winners_count: selected.winnersCount,
        ...(parsedV4.formatVersion === FORMAT_VERSION_V1_2_SCALE
          ? { standard_version: OUTCOME_STANDARD_V1_2 }
          : { artifact_format_version: FORMAT_VERSION_V4 }),
        resolution_formula: formula,
        ...(formula === "closest_to"
          ? {
              target: signedBigIntToSafeNumber(expectedTarget, "target"),
            }
          : {}),
        snapshot_hash: parsedV4.snapshotHash.toString("hex"),
        snapshot_count: parsedV4.snapshotCount,
        snapshot_uri: parsedV4.snapshotUri,
        ...(parsedV4.merkleRoot
          ? {
              merkle_root: parsedV4.merkleRoot.toString("hex"),
            }
          : {
              merkle_root: inspectedSnapshot.merkleRoot,
            }),
        ...rngV2ResultFields(event, rngV2State ?? undefined),
        outcomes: [],
        resolve_id: resolveId,
        compiled_artifact_hash: compiledArtifactHashHex,
        runtime_id: runtimeIdHex,
        program_id: programId.toBase58(),
      };
    } finally {
      cleanupSnapshot();
    }
  }

  const selected = selectOutcomes(blob, parsed!, recomputedRandomness, replayInput);
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

  if (
    event.artifactFormatVersion !== resolutionArtifactFormatVersion ||
    event.artifactFormatVersion !== parsed!.formatVersion
  ) {
    mismatch(
      "ERR_ARTIFACT_FORMAT_VERSION_MISMATCH",
      "Artifact format version differs between event, resolution, and artifact"
    );
  }
  if (
    event.winnerCount !== resolutionWinnerCount ||
    event.winnerCount !== parsed!.winnersCount ||
    event.winnerCount !== selected.outcomeIds.length
  ) {
    mismatch(
      "ERR_WINNER_COUNT_MISMATCH",
      "Winner count differs between event, resolution, artifact, and replay recomputation"
    );
  }

  let resolutionOutcomeIdLens =
    outcomeResolutionAccount.accountName === "OutcomeResolutionV2"
      ? (pick<number[]>(outcomeResolution, "outcome_id_lens", "outcomeIdLens") ?? [])
      : [resolutionOutcomeIdLen];
  let resolutionOutcomeIds: Buffer[] =
    outcomeResolutionAccount.accountName === "OutcomeResolutionV2"
      ? (pick<number[][]>(outcomeResolution, "outcome_ids", "outcomeIds") ?? []).map((id) =>
          Buffer.from(id)
        )
      : [resolutionOutcomeId];
  if (event.rngVersion === RNG_VERSION_V2) {
    // Compact rng_v2 draw: OutcomeResolutionV4 stores the primary id plus the on-chain digest
    // of the full program-selected list; the list itself travels in OutcomeResolvedV5.
    verifyRngV2ResolutionEvidence(outcomeResolutionAccount, outcomeResolution, event);
    const expectedClaimHash = winnerClaimDigest(selected.outcomeIdLens, selected.outcomeIds);
    const resolutionWinnerClaimHash = Buffer.from(
      pick<number[]>(outcomeResolution, "winner_claim_hash", "winnerClaimHash")
    );
    if (
      !event.winnerClaimHash ||
      !event.winnerClaimHash.equals(expectedClaimHash) ||
      !resolutionWinnerClaimHash.equals(expectedClaimHash)
    ) {
      mismatch(
        "ERR_WINNER_CLAIM_HASH_MISMATCH",
        "Winner claim hash differs between event, resolution, and replay recomputation"
      );
    }
    resolutionOutcomeIdLens = selected.outcomeIdLens;
    resolutionOutcomeIds = selected.outcomeIds;
  }
  if (
    event.outcomeIdLens.length !== event.winnerCount ||
    event.outcomeIds.length !== event.winnerCount ||
    resolutionOutcomeIdLens.length !== event.winnerCount ||
    resolutionOutcomeIds.length !== event.winnerCount
  ) {
    mismatch(
      "ERR_OUTCOME_ID_MISMATCH",
      "Winner outcome array length differs from winner count"
    );
  }
  const seenOutcomeIds = new Set<string>();
  for (let index = 0; index < event.winnerCount; index += 1) {
    const eventId = event.outcomeIds[index];
    const resolutionId = resolutionOutcomeIds[index];
    const selectedId = selected.outcomeIds[index];
    const eventLen = event.outcomeIdLens[index];
    const resolutionLen = resolutionOutcomeIdLens[index];
    const selectedLen = selected.outcomeIdLens[index];
    expectZeroPadding(eventId, eventLen, "ERR_OUTCOME_ID_MISMATCH");
    expectZeroPadding(resolutionId, resolutionLen, "ERR_OUTCOME_ID_MISMATCH");
    expectZeroPadding(selectedId, selectedLen, "ERR_OUTCOME_ID_MISMATCH");
    if (
      eventLen !== resolutionLen ||
      eventLen !== selectedLen ||
      !eventId.equals(resolutionId) ||
      !eventId.equals(selectedId)
    ) {
      mismatch(
        "ERR_OUTCOME_ID_MISMATCH",
        "Winner outcome id differs between event, resolution, and replay recomputation"
      );
    }
    const canonical = outcomeIdString(eventId, eventLen);
    if (seenOutcomeIds.has(canonical)) {
      mismatch("ERR_OUTCOME_ID_MISMATCH", "Winner outcome ids must be distinct");
    }
    seenOutcomeIds.add(canonical);
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

  return {
    status: "MATCH",
    reason: "OK",
    outcome_id: outcomeIdString(event.outcomeId, event.outcomeIdLen),
    ...((event.winnerCount > 1 || parsed!.formatVersion === FORMAT_VERSION_V3 || parsed!.formatVersion === FORMAT_VERSION_V5 || parsed!.formatVersion === FORMAT_VERSION_COMPOSITE_RANK_DESC)
      ? {
          artifact_format_version: event.artifactFormatVersion,
        }
      : {}),
    ...(parsed!.formatVersion === FORMAT_VERSION_V5
      ? {
          standard_version: parsed!.standardVersion,
          entry_count: parsed!.entryCount,
        }
      : {}),
    ...(event.winnerCount > 1
      ? {
          outcome_ids: event.outcomeIds.map((id, index) =>
            outcomeIdString(id, event.outcomeIdLens[index])
          ),
          winners_count: event.winnerCount,
        }
      : {}),
    resolution_formula: parsed!.formatVersion === FORMAT_VERSION_V3 ||
      parsed!.formatVersion === FORMAT_VERSION_V5 ||
      parsed!.formatVersion === FORMAT_VERSION_COMPOSITE_RANK_DESC
      ? (parsed!.formulaName ?? formulaCodeToName(parsed!.formulaCode))
      : "weighted_random",
    ...(parsed!.formatVersion === FORMAT_VERSION_V3 || parsed!.formatVersion === FORMAT_VERSION_V5
      ? {
          target: signedBigIntToSafeNumber(parsed!.targetScore, "target"),
        }
      : {}),
    ...rngV2ResultFields(event, rngV2State ?? undefined),
    ...(event.rngVersion === RNG_VERSION_V2 && event.winnerClaimHash
      ? {
          winner_claim_hash: event.winnerClaimHash.toString("hex"),
          entropy_source: event.entropySource === 1 ? "unicorn_g" : "slot_hash",
          ...(event.protocolRevision === undefined
            ? {}
            : { protocol_revision: event.protocolRevision }),
        }
      : {}),
    outcomes: parsed!.outcomes.map((outcome) => ({
      id: outcomeIdString(outcome.outcomeId, outcome.outcomeIdLen),
      weight: outcome.weight,
      ...(parsed!.formatVersion === FORMAT_VERSION_V3 ||
      parsed!.formatVersion === FORMAT_VERSION_V5 ||
      parsed!.formatVersion === FORMAT_VERSION_COMPOSITE_RANK_DESC
        ? {
            score: signedBigIntToSafeNumber(outcome.score, `score:${outcomeIdString(outcome.outcomeId, outcome.outcomeIdLen)}`),
            order: outcome.order,
          }
        : {}),
    })),
    resolve_id: resolveId,
    compiled_artifact_hash: compiledArtifactHashHex,
    runtime_id: runtimeIdHex,
    program_id: programId.toBase58(),
  };
}

export type SnapshotCommitment = {
  signature: string;
  programId: string;
  runtimeId: string;
  resolveId: string;
  compiledArtifactHash: string;
  formatVersion: number;
  formula: string;
  winnersCount: number;
  snapshotCount: number;
  snapshotHash: string;
  merkleRoot: string | null;
  snapshotUri: string;
  rngVersion: number;
  /** First winner as recorded in the event. */
  primaryOutcomeId: string;
  /** Full winner list when the event carries it; null when the event records only winnerClaimHash. */
  outcomeIds: string[] | null;
  winnerClaimHash: string | null;
};

/**
 * Reads what a snapshot draw committed on-chain — snapshot hash, participant count, Merkle root and
 * snapshot URI — from the program accounts behind its resolution signature, without the snapshot
 * file and without the VRE server. Use `merkleRoot` with verifySnapshotMerkleProof.
 */
export async function fetchSnapshotCommitment(opts: {
  signature: string;
  rpcUrl: string;
  programId?: string;
}): Promise<SnapshotCommitment> {
  if (!opts || !opts.signature) {
    throw new Error("Provide signature");
  }
  if (!opts.rpcUrl) {
    throw new Error("Provide rpcUrl");
  }
  const programId = new PublicKey(opts.programId ?? DEFAULT_PROGRAM_ID);
  const connection = new anchor.web3.Connection(opts.rpcUrl, { commitment: "confirmed" });
  const coder = new anchor.BorshCoder(loadIdl() as anchor.Idl);

  const logs = await fetchTransactionLogs(connection, opts.signature);
  const event = findOutcomeResolvedEvent(logs, programId.toBase58());
  const header = await fetchDecodedAccount(
    connection,
    coder,
    deriveApprovedArtifactPda(programId, event.compiledArtifactHash),
    "ApprovedOutcomeArtifact",
    "ERR_ARTIFACT_HEADER_NOT_FOUND"
  );
  const blob = await reconstructArtifactBlob(
    connection,
    coder,
    programId,
    event.compiledArtifactHash,
    header
  );
  if (!sha256(blob).equals(event.compiledArtifactHash)) {
    mismatch(
      "ERR_ARTIFACT_HASH_MISMATCH",
      "Artifact bytes do not hash to the compiled artifact hash in the event"
    );
  }

  const formatVersion = blob.readUInt16LE(4);
  const parsed =
    formatVersion === FORMAT_VERSION_V4
      ? parseArtifactV4(blob)
      : formatVersion === FORMAT_VERSION_V1_2_SCALE
        ? parseArtifactV12(blob)
        : formatVersion === FORMAT_VERSION_V1_2_1_SCALE
          ? parseArtifactV121(blob)
          : null;
  if (!parsed) {
    throw new Error(`The transaction resolves artifact format ${formatVersion}, not a snapshot artifact`);
  }

  // Snapshot rng_v2 events carry the first winner plus winner_claim_hash, not the whole list.
  const outcomeIds = event.outcomeIds.length === parsed.winnersCount
    ? event.outcomeIds.map((id, index) =>
        id.subarray(0, event.outcomeIdLens[index] ?? id.length).toString("ascii")
      )
    : null;

  return {
    signature: opts.signature,
    programId: programId.toBase58(),
    runtimeId: toHex(event.runtimeId),
    resolveId: event.resolveId.toString(),
    compiledArtifactHash: toHex(event.compiledArtifactHash),
    formatVersion,
    formula: formulaNameFromArtifactV4(parsed as any),
    winnersCount: parsed.winnersCount,
    snapshotCount: parsed.snapshotCount,
    snapshotHash: parsed.snapshotHash.toString("hex"),
    merkleRoot: parsed.merkleRoot ? parsed.merkleRoot.toString("hex") : null,
    snapshotUri: parsed.snapshotUri,
    rngVersion: event.rngVersion ?? 1,
    primaryOutcomeId: event.outcomeId.subarray(0, event.outcomeIdLen).toString("ascii"),
    outcomeIds,
    winnerClaimHash: event.winnerClaimHash ? event.winnerClaimHash.toString("hex") : null,
  };
}

export async function verifyOutcome(opts: VerifyOutcomeOptions): Promise<VerifyResult> {
  if (!opts || typeof opts !== "object") {
    throw new TypeError("verify options must be an object");
  }
  if (!opts.signature) {
    throw new Error("Provide signature");
  }
  if (!opts.rpcUrl) {
    throw new Error("Provide rpcUrl");
  }

  const envMirrors = String(process.env.VRE_SNAPSHOT_MIRRORS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const normalized: Required<VerifyOutcomeOptions> = {
    signature: opts.signature,
    rpcUrl: opts.rpcUrl,
    programId: opts.programId ?? DEFAULT_PROGRAM_ID,
    artifactPath: opts.artifactPath ?? "",
    snapshotMirrors: opts.snapshotMirrors ?? (envMirrors.length ? envMirrors : DEFAULT_SNAPSHOT_MIRRORS),
    snapshotFile: opts.snapshotFile ?? "",
    snapshotTimeoutMs: opts.snapshotTimeoutMs ?? DEFAULT_SNAPSHOT_TIMEOUT_MS,
  };

  try {
    return await verifyOutcomeStrict(normalized);
  } catch (error) {
    if (error instanceof ReplayMismatchError) {
      return mismatchResult(error.code, normalized.programId);
    }
    return mismatchResult("ERR_REPLAY_UNHANDLED", normalized.programId);
  }
}
