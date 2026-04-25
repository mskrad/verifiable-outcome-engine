import * as anchor from "@coral-xyz/anchor";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PublicKey } from "@solana/web3.js";

import type { VerifyOutcomeOptions, VerifyResult } from "./types.js";

const DEFAULT_PROGRAM_ID = "3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq";
const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
const CHUNK_SIZE = 1024;
const MAX_OUTCOME_ID_BYTES = 64;
const EFFECT_ENTRY_BYTES = 16;
const FORMAT_VERSION_V1 = 1;
const FORMAT_VERSION_V2 = 2;
const MAX_WINNERS = 32;
const MULTI_WINNER_DOMAIN = "VRE_MULTI_WINNER_V1";
const MAGIC = "W3O1";
const STATUS_PENDING = 0;
const STATUS_APPROVED = 1;
const STATUS_DEPRECATED = 3;
const EFFECT_TYPE_TRANSFER_SOL = 1;

const OUTCOME_ACCOUNT_IDL = {
  address: DEFAULT_PROGRAM_ID,
  metadata: {
    name: "outcome",
    version: "0.1.0",
    spec: "0.1.0",
  },
  instructions: [],
  accounts: [
    { name: "ApprovedOutcomeArtifact", discriminator: [110, 158, 83, 35, 113, 203, 146, 35] },
    { name: "ApprovedOutcomeArtifactChunk", discriminator: [172, 72, 71, 77, 233, 238, 194, 12] },
    { name: "OutcomeConfig", discriminator: [140, 119, 82, 148, 43, 47, 24, 122] },
    { name: "OutcomeResolution", discriminator: [117, 184, 192, 23, 132, 189, 98, 178] },
    { name: "OutcomeResolutionV2", discriminator: [255, 71, 158, 89, 88, 61, 199, 217] },
    { name: "ProgramConfig", discriminator: [196, 210, 90, 231, 144, 149, 140, 63] },
  ],
  types: [
    {
      name: "ApprovedOutcomeArtifact",
      type: {
        kind: "struct",
        fields: [
          { name: "compiled_artifact_hash", type: { array: ["u8", 32] } },
          { name: "publisher", type: "pubkey" },
          { name: "status", type: "u8" },
          { name: "is_finalized", type: "bool" },
          { name: "format_version", type: "u16" },
          { name: "blob_len", type: "u32" },
          { name: "chunk_count", type: "u16" },
          { name: "artifact_uri_len", type: "u16" },
          { name: "artifact_uri", type: { array: ["u8", 200] } },
          { name: "audit_hash", type: { array: ["u8", 32] } },
          { name: "created_at", type: "i64" },
          { name: "updated_at", type: "i64" },
          { name: "bump", type: "u8" },
          { name: "reserved", type: { array: ["u8", 31] } },
        ],
      },
    },
    {
      name: "ApprovedOutcomeArtifactChunk",
      type: {
        kind: "struct",
        fields: [
          { name: "compiled_artifact_hash", type: { array: ["u8", 32] } },
          { name: "chunk_index", type: "u32" },
          { name: "written_len", type: "u16" },
          { name: "data", type: { array: ["u8", 1024] } },
        ],
      },
    },
    {
      name: "OutcomeConfig",
      type: {
        kind: "struct",
        fields: [
          { name: "runtime_id", type: { array: ["u8", 16] } },
          { name: "authority", type: "pubkey" },
          { name: "treasury", type: "pubkey" },
          { name: "min_input_lamports", type: "u64" },
          { name: "max_input_lamports", type: "u64" },
          { name: "next_resolve_id", type: "u64" },
          { name: "is_paused", type: "bool" },
          { name: "bump", type: "u8" },
          { name: "vault_bump", type: "u8" },
          { name: "compiled_artifact_hash", type: { array: ["u8", 32] } },
          { name: "master_seed", type: { array: ["u8", 32] } },
          { name: "last_seed_slot", type: "u64" },
          { name: "reserved", type: { array: ["u8", 63] } },
        ],
      },
    },
    {
      name: "OutcomeResolution",
      type: {
        kind: "struct",
        fields: [
          { name: "runtime_id", type: { array: ["u8", 16] } },
          { name: "resolve_id", type: "u64" },
          { name: "actor", type: "pubkey" },
          { name: "input_lamports", type: "u64" },
          { name: "status", type: "u8" },
          { name: "total_output_lamports", type: "u64" },
          { name: "compiled_artifact_hash", type: { array: ["u8", 32] } },
          { name: "randomness", type: { array: ["u8", 32] } },
          { name: "outcome_id_len", type: "u8" },
          { name: "outcome_id", type: { array: ["u8", 64] } },
          { name: "effect_count", type: "u16" },
          { name: "effects_digest", type: { array: ["u8", 32] } },
          { name: "bump", type: "u8" },
          { name: "reserved", type: { array: ["u8", 31] } },
        ],
      },
    },
    {
      name: "OutcomeResolutionV2",
      type: {
        kind: "struct",
        fields: [
          { name: "runtime_id", type: { array: ["u8", 16] } },
          { name: "resolve_id", type: "u64" },
          { name: "actor", type: "pubkey" },
          { name: "input_lamports", type: "u64" },
          { name: "status", type: "u8" },
          { name: "artifact_format_version", type: "u16" },
          { name: "winner_count", type: "u16" },
          { name: "total_output_lamports", type: "u64" },
          { name: "compiled_artifact_hash", type: { array: ["u8", 32] } },
          { name: "randomness", type: { array: ["u8", 32] } },
          { name: "outcome_id_len", type: "u8" },
          { name: "outcome_id", type: { array: ["u8", 64] } },
          { name: "outcome_id_lens", type: { vec: "u8" } },
          { name: "outcome_ids", type: { vec: { array: ["u8", 64] } } },
          { name: "effect_count", type: "u16" },
          { name: "effects_digest", type: { array: ["u8", 32] } },
          { name: "bump", type: "u8" },
          { name: "reserved", type: { array: ["u8", 29] } },
        ],
      },
    },
    {
      name: "ProgramConfig",
      type: {
        kind: "struct",
        fields: [
          { name: "admin", type: "pubkey" },
          { name: "allow_unreviewed_binding", type: "bool" },
          { name: "bump", type: "u8" },
          { name: "fee_lamports", type: "u64" },
          { name: "treasury", type: "pubkey" },
          { name: "reserved", type: { array: ["u8", 22] } },
        ],
      },
    },
  ],
};

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

type OutcomeResolvedEvent = {
  runtimeId: Buffer;
  resolveId: bigint;
  actor: PublicKey;
  inputLamports: bigint;
  totalOutputLamports: bigint;
  masterSeed: Buffer;
  randomness: Buffer;
  compiledArtifactHash: Buffer;
  artifactFormatVersion: number;
  winnerCount: number;
  outcomeIdLen: number;
  outcomeId: Buffer;
  outcomeIdLens: number[];
  outcomeIds: Buffer[];
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
  formatVersion: number;
  winnersCount: number;
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
  return OUTCOME_ACCOUNT_IDL;
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

function readVecU8(buf: Buffer, offset: { value: number }): number[] {
  const len = readU32LE(buf, offset);
  return [...readBytes(buf, offset, len)];
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
    const event = decodeOutcomeResolvedV2(line) ?? decodeOutcomeResolvedV1(line);
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

async function fetchDecodedOutcomeResolution(
  connection: anchor.web3.Connection,
  coder: any,
  pubkey: PublicKey
): Promise<{ accountName: "OutcomeResolution" | "OutcomeResolutionV2"; decoded: any }> {
  const info = await connection.getAccountInfo(pubkey, "confirmed");
  if (!info) {
    mismatch(
      "ERR_RESOLUTION_ACCOUNT_NOT_FOUND",
      `OutcomeResolution not found: ${pubkey.toBase58()}`
    );
  }
  try {
    return {
      accountName: "OutcomeResolutionV2",
      decoded: coder.accounts.decode("OutcomeResolutionV2", info.data),
    };
  } catch (_) {
    try {
      return {
        accountName: "OutcomeResolution",
        decoded: coder.accounts.decode("OutcomeResolution", info.data),
      };
    } catch (error) {
      mismatch(
        "ERR_RESOLUTION_ACCOUNT_NOT_FOUND",
        `Failed to decode OutcomeResolution account: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
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
  if (formatVersion !== FORMAT_VERSION_V1 && formatVersion !== FORMAT_VERSION_V2) {
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
  if (formatVersion === FORMAT_VERSION_V2) {
    winnersCount = readU16LE(blob, offset);
    if (!readBytes(blob, offset, 6).equals(Buffer.alloc(6, 0))) {
      throw new Error("Reserved header bytes must be zero");
    }
  } else if (!readBytes(blob, offset, 8).equals(Buffer.alloc(8, 0))) {
    throw new Error("Reserved header bytes must be zero");
  }
  if (winnersCount < 1 || winnersCount > outcomeCount || winnersCount > MAX_WINNERS) {
    throw new Error("Invalid winners_count");
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
      if (formatVersion === FORMAT_VERSION_V2 && referencedEffects[effectIndex]) {
        throw new Error("V2 outcome effect ranges must not overlap");
      }
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
    formatVersion,
    winnersCount,
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

  const remaining = parsed.outcomes.map((_, index) => index);
  const outcomeIdLens: number[] = [];
  const outcomeIds: Buffer[] = [];
  const effectChunks: Buffer[] = [];
  let totalOutputLamports = 0n;
  let effectCount = 0;

  for (let round = 0; round < parsed.winnersCount; round += 1) {
    const selectedRemainingIndex = chooseWeightedIndex(
      remaining.map((index) => parsed.outcomes[index].weight),
      rollForRound(randomness, round)
    );
    const selectedIndex = remaining.splice(selectedRemainingIndex, 1)[0];
    const selected = parsed.outcomes[selectedIndex];
    const effectStart =
      parsed.effectsOffset + selected.firstEffectIndex * EFFECT_ENTRY_BYTES;
    const effectEnd = effectStart + selected.effectCount * EFFECT_ENTRY_BYTES;
    effectChunks.push(blob.subarray(effectStart, effectEnd));
    outcomeIdLens.push(selected.outcomeIdLen);
    outcomeIds.push(selected.outcomeId);
    effectCount += selected.effectCount;
    for (
      let index = selected.firstEffectIndex;
      index < selected.firstEffectIndex + selected.effectCount;
      index += 1
    ) {
      totalOutputLamports += parsed.effects[index].amountLamports;
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

async function verifyOutcomeStrict(opts: Required<VerifyOutcomeOptions>): Promise<VerifyResult> {
  const programId = new PublicKey(opts.programId);
  const connection = new anchor.web3.Connection(opts.rpcUrl, { commitment: "confirmed" });
  const rawIdl = loadIdl();
  const coder = new (anchor as any).BorshCoder(rawIdl as anchor.Idl);

  const logs = await fetchTransactionLogs(connection, opts.signature);
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
  const outcomeResolutionAccount = await fetchDecodedOutcomeResolution(
    connection,
    coder,
    outcomeResolutionPda
  );
  const outcomeResolution = outcomeResolutionAccount.decoded;
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

  const selected = selectOutcomes(blob, parsed, recomputedRandomness, replayInput);
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

  const resolutionArtifactFormatVersion =
    outcomeResolutionAccount.accountName === "OutcomeResolutionV2"
      ? Number(
          pick(
            outcomeResolution,
            "artifact_format_version",
            "artifactFormatVersion"
          )
        )
      : FORMAT_VERSION_V1;
  const resolutionWinnerCount =
    outcomeResolutionAccount.accountName === "OutcomeResolutionV2"
      ? Number(pick(outcomeResolution, "winner_count", "winnerCount"))
      : 1;
  if (
    event.artifactFormatVersion !== resolutionArtifactFormatVersion ||
    event.artifactFormatVersion !== parsed.formatVersion
  ) {
    mismatch(
      "ERR_ARTIFACT_FORMAT_VERSION_MISMATCH",
      "Artifact format version differs between event, resolution, and artifact"
    );
  }
  if (
    event.winnerCount !== resolutionWinnerCount ||
    event.winnerCount !== parsed.winnersCount ||
    event.winnerCount !== selected.outcomeIds.length
  ) {
    mismatch(
      "ERR_WINNER_COUNT_MISMATCH",
      "Winner count differs between event, resolution, artifact, and replay recomputation"
    );
  }

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
    ...(event.winnerCount > 1
      ? {
          outcome_ids: event.outcomeIds.map((id, index) =>
            outcomeIdString(id, event.outcomeIdLens[index])
          ),
          winners_count: event.winnerCount,
          artifact_format_version: event.artifactFormatVersion,
        }
      : {}),
    outcomes: parsed.outcomes.map((outcome) => ({
      id: outcomeIdString(outcome.outcomeId, outcome.outcomeIdLen),
      weight: outcome.weight,
    })),
    resolve_id: resolveId,
    compiled_artifact_hash: compiledArtifactHashHex,
    runtime_id: runtimeIdHex,
    program_id: programId.toBase58(),
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

  const normalized: Required<VerifyOutcomeOptions> = {
    signature: opts.signature,
    rpcUrl: opts.rpcUrl,
    programId: opts.programId ?? DEFAULT_PROGRAM_ID,
    artifactPath: opts.artifactPath ?? "",
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
