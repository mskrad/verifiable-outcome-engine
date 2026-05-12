import crypto from "crypto";
import fs from "fs";
import readline from "readline";

import type {
  FormulaParticipant,
  ResolutionFormula,
  SignedIntegerValue,
  SnapshotFormulaDrawConfig,
  SnapshotManifest,
  SnapshotParticipant,
} from "./types.js";

export const FORMAT_VERSION_V4 = 4;
export const MAX_OUTCOME_ID_BYTES = 64;
export const MAX_WINNERS = 32;
export const MAX_SNAPSHOT_URI_BYTES = 512;
export const MAX_U32 = 0xffffffff;
export const MAX_U64 = (1n << 64n) - 1n;
export const MIN_I64 = -(1n << 63n);
export const MAX_I64 = (1n << 63n) - 1n;
export const EFFECT_TYPE_TRANSFER_SOL = 1;
export const MULTI_WINNER_DOMAIN = "VRE_MULTI_WINNER_V1";
export const FORMULA_CODES: Record<ResolutionFormula, number> = {
  weighted_random: 1,
  rank_desc: 2,
  rank_asc: 3,
  first_n: 4,
  closest_to: 5,
};

const PRINTABLE_ASCII_RE = /^[\x20-\x7E]+$/;

export type SnapshotParticipantRecord = {
  id: string;
  order: number;
  weight: number;
  score: bigint;
};

export type ParsedSnapshotArtifactV4 = {
  formatVersion: 4;
  minInputLamports: bigint;
  maxInputLamports: bigint;
  winnersCount: number;
  formulaCode: number;
  targetScore: bigint;
  snapshotCount: number;
  payoutLamports: bigint;
  snapshotHash: Buffer;
  snapshotUri: string;
};

export type SnapshotClaim = {
  outcomeIds: string[];
  winnersCount: number;
  totalOutputLamports: bigint;
  effectCount: number;
  effectsDigest: Buffer;
};

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function validateFormula(value: unknown): ResolutionFormula {
  if (
    value !== "weighted_random" &&
    value !== "rank_desc" &&
    value !== "rank_asc" &&
    value !== "first_n" &&
    value !== "closest_to"
  ) {
    throw new RangeError("formula must be weighted_random, rank_desc, rank_asc, first_n, or closest_to");
  }
  return value;
}

function validateOutcomeId(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  const byteLen = Buffer.byteLength(value, "ascii");
  if (byteLen === 0 || byteLen > MAX_OUTCOME_ID_BYTES || !PRINTABLE_ASCII_RE.test(value)) {
    throw new RangeError(`${label} must be printable ASCII <= ${MAX_OUTCOME_ID_BYTES} bytes`);
  }
  return value;
}

function validateOutcomeIdLength(id: string): void {
  const byteLen = Buffer.byteLength(id, "ascii");
  if (byteLen === 0 || byteLen > MAX_OUTCOME_ID_BYTES || !PRINTABLE_ASCII_RE.test(id)) {
    throw new RangeError(`snapshot outcome id must be printable ASCII <= ${MAX_OUTCOME_ID_BYTES} bytes: ${id}`);
  }
}

function validateWeight(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > MAX_U32) {
    throw new RangeError(`${label} must be an integer 1..${MAX_U32}`);
  }
  return value as number;
}

function validateOrder(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function parseSignedInteger(value: SignedIntegerValue | undefined, label: string): bigint {
  if (typeof value === "bigint") {
    if (value < MIN_I64 || value > MAX_I64) {
      throw new RangeError(`${label} must fit in i64`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`${label} must be a signed safe integer`);
    }
    const parsed = BigInt(value);
    if (parsed < MIN_I64 || parsed > MAX_I64) {
      throw new RangeError(`${label} must fit in i64`);
    }
    return parsed;
  }
  throw new TypeError(`${label} must be a bigint or signed safe integer number`);
}

function parsePositiveLamports(value: bigint | number | undefined, label: string): bigint {
  if (typeof value === "bigint") {
    if (value <= 0n || value > MAX_U64) {
      throw new RangeError(`${label} must be between 1 and u64::MAX`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${label} must be a positive safe integer`);
    }
    const parsed = BigInt(value);
    if (parsed > MAX_U64) {
      throw new RangeError(`${label} must fit in u64`);
    }
    return parsed;
  }
  throw new TypeError(`${label} must be a bigint or safe integer number`);
}

function parseOptionalLamports(value: bigint | number | undefined, fallback: bigint, label: string): bigint {
  return value === undefined ? fallback : parsePositiveLamports(value, label);
}

function sha256(bytes: Buffer): Buffer {
  return crypto.createHash("sha256").update(bytes).digest();
}

function u16le(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value, 0);
  return out;
}

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

function i64le(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigInt64LE(value, 0);
  return out;
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

function readBytes(buf: Buffer, offset: { value: number }, len: number): Buffer {
  const out = buf.subarray(offset.value, offset.value + len);
  offset.value += len;
  return out;
}

function formulaCodeToName(code: number): ResolutionFormula {
  switch (code) {
    case FORMULA_CODES.weighted_random:
      return "weighted_random";
    case FORMULA_CODES.rank_desc:
      return "rank_desc";
    case FORMULA_CODES.rank_asc:
      return "rank_asc";
    case FORMULA_CODES.first_n:
      return "first_n";
    case FORMULA_CODES.closest_to:
      return "closest_to";
    default:
      throw new Error(`Unsupported formula code: ${code}`);
  }
}

function compareId(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "ascii"), Buffer.from(right, "ascii"));
}

export function canonicalSnapshotLine(entry: SnapshotParticipantRecord, formula: ResolutionFormula): string {
  if (formula === "weighted_random") {
    return `${JSON.stringify({ id: entry.id, order: entry.order, weight: entry.weight })}\n`;
  }
  if (formula === "first_n") {
    return `${JSON.stringify({ id: entry.id, order: entry.order })}\n`;
  }
  return `${JSON.stringify({ id: entry.id, order: entry.order, score: entry.score.toString() })}\n`;
}

function normalizeSnapshotParticipant(
  raw: FormulaParticipant | SnapshotParticipant,
  index: number,
  formula: ResolutionFormula
): SnapshotParticipantRecord {
  assertObject(raw, `participants[${index}]`);
  const id = validateOutcomeId(raw.id, `participants[${index}].id`);
  const rawOrder = "order" in raw ? raw.order : undefined;
  const order =
    rawOrder === undefined
      ? index
      : validateOrder(rawOrder, `participants[${index}].order`);
  if (formula === "weighted_random") {
    if (raw.score !== undefined) {
      throw new TypeError(`participants[${index}].score is not supported for weighted_random`);
    }
    return {
      id,
      order,
      weight: raw.weight === undefined ? 1 : validateWeight(raw.weight, `participants[${index}].weight`),
      score: 0n,
    };
  }
  if (raw.weight !== undefined) {
    throw new TypeError(`participants[${index}].weight is only supported for weighted_random`);
  }
  if (formula === "first_n") {
    if (raw.score !== undefined) {
      throw new TypeError(`participants[${index}].score is not supported for first_n`);
    }
    return { id, order, weight: 1, score: 0n };
  }
  return {
    id,
    order,
    weight: 1,
    score: parseSignedInteger(raw.score, `participants[${index}].score`),
  };
}

export function normalizeSnapshotParticipants(
  participants: Array<FormulaParticipant | SnapshotParticipant>,
  formulaInput: ResolutionFormula
): SnapshotParticipantRecord[] {
  const formula = validateFormula(formulaInput);
  if (!Array.isArray(participants) || participants.length === 0) {
    throw new RangeError("participants must be a non-empty array");
  }
  const out = participants.map((participant, index) =>
    normalizeSnapshotParticipant(participant, index, formula)
  );
  out.sort((left, right) => compareId(left.id, right.id));
  let previousId: string | null = null;
  for (const entry of out) {
    if (entry.id === previousId) {
      throw new Error(`duplicate participant id: ${entry.id}`);
    }
    previousId = entry.id;
  }
  return out;
}

export function buildSnapshotHash(opts: {
  formula: ResolutionFormula;
  participants: Array<FormulaParticipant | SnapshotParticipant>;
}): {
  snapshotHash: string;
  snapshotCount: number;
  canonicalSnapshot: string;
} {
  const formula = validateFormula(opts.formula);
  const normalized = normalizeSnapshotParticipants(opts.participants, formula);
  const hash = crypto.createHash("sha256");
  const lines: string[] = [];
  for (const entry of normalized) {
    const line = canonicalSnapshotLine(entry, formula);
    lines.push(line);
    hash.update(line, "utf8");
  }
  return {
    snapshotHash: hash.digest("hex"),
    snapshotCount: normalized.length,
    canonicalSnapshot: lines.join(""),
  };
}

export function buildSnapshotManifest(opts: {
  snapshotHash: string;
  snapshotCount: number;
  formula: ResolutionFormula;
  winnersCount: number;
  snapshotUri: string;
  payoutLamports: bigint;
  targetScore?: bigint;
  thresholdMode?: SnapshotManifest["threshold_mode"];
}): SnapshotManifest {
  if (!/^[0-9a-f]{64}$/i.test(opts.snapshotHash)) {
    throw new RangeError("snapshotHash must be a 32-byte hex string");
  }
  const formula = validateFormula(opts.formula);
  const winnersCount = validateWinnersCount(opts.winnersCount, opts.snapshotCount);
  return {
    version: "vre_snapshot_manifest_v1",
    artifact_format_version: FORMAT_VERSION_V4,
    snapshot_hash: opts.snapshotHash.toLowerCase(),
    snapshot_count: opts.snapshotCount,
    formula,
    winners_count: winnersCount,
    snapshot_uri: opts.snapshotUri,
    created_at: new Date().toISOString(),
    payout_lamports: opts.payoutLamports.toString(),
    ...(opts.targetScore === undefined ? {} : { target: opts.targetScore.toString() }),
    ...(opts.thresholdMode === undefined ? {} : { threshold_mode: opts.thresholdMode }),
  };
}

export function validateWinnersCount(value: unknown, participantCount: number): number {
  const winnersCount = value === undefined ? 1 : value;
  if (!Number.isInteger(winnersCount)) {
    throw new TypeError("winners_count must be an integer");
  }
  if ((winnersCount as number) <= 0) {
    throw new RangeError("winners_count must be > 0");
  }
  if ((winnersCount as number) > participantCount) {
    throw new RangeError("winners_count must be <= participant count");
  }
  if ((winnersCount as number) > MAX_WINNERS) {
    throw new RangeError(`winners_count must be <= ${MAX_WINNERS}`);
  }
  return winnersCount as number;
}

export function buildArtifactV4(config: SnapshotFormulaDrawConfig): Buffer {
  const formula = validateFormula(config.formula);
  const inputLamports = parsePositiveLamports(config.input_lamports, "input_lamports");
  const payoutLamports = parseOptionalLamports(config.payout_lamports, 3n, "payout_lamports");
  if (!/^[0-9a-f]{64}$/i.test(config.snapshot_hash)) {
    throw new RangeError("snapshot_hash must be a 32-byte hex string");
  }
  if (!Number.isInteger(config.snapshot_count) || config.snapshot_count <= 0 || config.snapshot_count > MAX_U32) {
    throw new RangeError(`snapshot_count must be an integer 1..${MAX_U32}`);
  }
  if (typeof config.snapshot_uri !== "string" || !config.snapshot_uri.trim()) {
    throw new TypeError("snapshot_uri must be a non-empty string");
  }
  const snapshotUri = config.snapshot_uri.trim();
  const snapshotUriBytes = Buffer.from(snapshotUri, "utf8");
  if (snapshotUriBytes.length > MAX_SNAPSHOT_URI_BYTES) {
    throw new RangeError(`snapshot_uri must be <= ${MAX_SNAPSHOT_URI_BYTES} bytes`);
  }
  const winnersCount = validateWinnersCount(config.winners_count, config.snapshot_count);
  const targetScore =
    formula === "closest_to"
      ? parseSignedInteger(config.target, "target")
      : config.target === undefined
      ? 0n
      : parseSignedInteger(config.target, "target");
  const minInputLamports = inputLamports;
  const maxInputLamports = inputLamports;
  const parts: Buffer[] = [
    Buffer.from("W3O1", "ascii"),
    u16le(FORMAT_VERSION_V4),
    u64le(minInputLamports),
    u64le(maxInputLamports),
    u16le(winnersCount),
    Buffer.from([FORMULA_CODES[formula]]),
    Buffer.alloc(5, 0),
    i64le(targetScore),
    u32le(config.snapshot_count),
    u64le(payoutLamports),
    Buffer.from(config.snapshot_hash, "hex"),
    u16le(snapshotUriBytes.length),
    snapshotUriBytes,
  ];
  return Buffer.concat(parts);
}

export function parseArtifactV4(blob: Buffer): ParsedSnapshotArtifactV4 {
  if (blob.length < 84) {
    throw new Error("Invalid snapshot artifact length");
  }
  if (blob.subarray(0, 4).toString("ascii") !== "W3O1") {
    throw new Error("Invalid artifact magic");
  }
  const offset = { value: 4 };
  const formatVersion = readU16LE(blob, offset);
  if (formatVersion !== FORMAT_VERSION_V4) {
    throw new Error("Unsupported snapshot artifact format version");
  }
  const minInputLamports = readU64LE(blob, offset);
  const maxInputLamports = readU64LE(blob, offset);
  if (minInputLamports > maxInputLamports) {
    throw new Error("Snapshot artifact bounds are invalid");
  }
  const winnersCount = readU16LE(blob, offset);
  const formulaCode = readU8(blob, offset);
  if (!Object.values(FORMULA_CODES).includes(formulaCode)) {
    throw new Error("Invalid formula code");
  }
  if (!readBytes(blob, offset, 5).equals(Buffer.alloc(5, 0))) {
    throw new Error("Reserved header bytes must be zero");
  }
  const targetScore = readI64LE(blob, offset);
  const snapshotCount = readU32LE(blob, offset);
  const payoutLamports = readU64LE(blob, offset);
  const snapshotHash = readBytes(blob, offset, 32);
  const snapshotUriLen = readU16LE(blob, offset);
  if (snapshotUriLen === 0 || snapshotUriLen > MAX_SNAPSHOT_URI_BYTES || offset.value + snapshotUriLen !== blob.length) {
    throw new Error("Invalid snapshot_uri length");
  }
  const snapshotUri = readBytes(blob, offset, snapshotUriLen).toString("utf8");
  if (!snapshotUri.trim()) {
    throw new Error("snapshot_uri must not be empty");
  }
  if (winnersCount < 1 || winnersCount > snapshotCount || winnersCount > MAX_WINNERS) {
    throw new Error("Invalid winners_count");
  }
  if (snapshotCount < 1) {
    throw new Error("Invalid snapshot_count");
  }
  return {
    formatVersion: FORMAT_VERSION_V4,
    minInputLamports,
    maxInputLamports,
    winnersCount,
    formulaCode,
    targetScore,
    snapshotCount,
    payoutLamports,
    snapshotHash,
    snapshotUri,
  };
}

export function formulaNameFromArtifactV4(parsed: ParsedSnapshotArtifactV4): ResolutionFormula {
  return formulaCodeToName(parsed.formulaCode);
}

export function deriveResolveRandomness(
  masterSeed: Buffer,
  runtimeId: Buffer,
  resolveId: bigint,
  actor: Buffer
): Buffer {
  const resolveIdBytes = Buffer.alloc(8);
  resolveIdBytes.writeBigUInt64LE(resolveId, 0);
  return sha256(Buffer.concat([masterSeed, runtimeId, resolveIdBytes, actor]));
}

export function rollForRound(randomness: Buffer, round: number): bigint {
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

function compareFormulaEntries(
  left: SnapshotParticipantRecord,
  right: SnapshotParticipantRecord,
  formula: ResolutionFormula,
  targetScore: bigint
): number {
  switch (formula) {
    case "rank_desc":
      if (left.score !== right.score) return left.score > right.score ? -1 : 1;
      return left.order - right.order;
    case "rank_asc":
      if (left.score !== right.score) return left.score < right.score ? -1 : 1;
      return left.order - right.order;
    case "first_n":
      return left.order - right.order;
    case "closest_to": {
      const leftDistance = left.score - targetScore;
      const rightDistance = right.score - targetScore;
      const absLeft = leftDistance < 0n ? -leftDistance : leftDistance;
      const absRight = rightDistance < 0n ? -rightDistance : rightDistance;
      if (absLeft !== absRight) return absLeft < absRight ? -1 : 1;
      return left.order - right.order;
    }
    default:
      return 0;
  }
}

async function *readCanonicalSnapshotEntries(
  snapshotPath: string,
  formula: ResolutionFormula
): AsyncGenerator<SnapshotParticipantRecord> {
  const stream = fs.createReadStream(snapshotPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const rawLine of rl) {
      const line = rawLine.trim();
      if (!line) continue;
      lineNumber += 1;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        throw new Error(
          `Invalid snapshot JSONL at line ${lineNumber}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      assertObject(parsed, `snapshot line ${lineNumber}`);
      const id = validateOutcomeId(parsed.id, `snapshot line ${lineNumber}.id`);
      const order = validateOrder(parsed.order, `snapshot line ${lineNumber}.order`);
      if (formula === "weighted_random") {
        yield {
          id,
          order,
          weight: validateWeight(parsed.weight, `snapshot line ${lineNumber}.weight`),
          score: 0n,
        };
        continue;
      }
      if (formula === "first_n") {
        yield { id, order, weight: 1, score: 0n };
        continue;
      }
      yield {
        id,
        order,
        weight: 1,
        score: parseSignedInteger(
          typeof parsed.score === "string" ? BigInt(parsed.score) : (parsed.score as SignedIntegerValue),
          `snapshot line ${lineNumber}.score`
        ),
      };
    }
  } finally {
    rl.close();
    stream.close();
  }
}

export async function inspectSnapshotFile(opts: {
  snapshotPath: string;
  formula: ResolutionFormula;
  expectedHash?: string;
  expectedCount?: number;
}): Promise<{ snapshotHash: string; snapshotCount: number }> {
  const formula = validateFormula(opts.formula);
  const hash = crypto.createHash("sha256");
  let previousId: string | null = null;
  let count = 0;
  for await (const entry of readCanonicalSnapshotEntries(opts.snapshotPath, formula)) {
    if (previousId !== null && compareId(previousId, entry.id) >= 0) {
      throw new Error("Snapshot entries must be strictly sorted by id");
    }
    previousId = entry.id;
    const line = canonicalSnapshotLine(entry, formula);
    hash.update(line, "utf8");
    count += 1;
  }
  if (count === 0) {
    throw new Error("Snapshot must not be empty");
  }
  const snapshotHash = hash.digest("hex");
  if (opts.expectedHash && snapshotHash !== opts.expectedHash.toLowerCase()) {
    throw new Error("Snapshot hash does not match committed snapshot_hash");
  }
  if (opts.expectedCount !== undefined && count !== opts.expectedCount) {
    throw new Error("Snapshot count does not match committed snapshot_count");
  }
  return { snapshotHash, snapshotCount: count };
}

function buildSyntheticEffects(payoutLamports: bigint, winnersCount: number): Buffer {
  if (payoutLamports === 0n || winnersCount === 0) {
    return Buffer.alloc(0);
  }
  const parts: Buffer[] = [];
  for (let index = 0; index < winnersCount; index += 1) {
    parts.push(Buffer.from([EFFECT_TYPE_TRANSFER_SOL]));
    parts.push(Buffer.alloc(7, 0));
    parts.push(u64le(payoutLamports));
  }
  return Buffer.concat(parts);
}

export function buildSnapshotClaimFromWinnerIds(
  winnerIds: string[],
  payoutLamports: bigint
): SnapshotClaim {
  if (!Array.isArray(winnerIds) || winnerIds.length === 0) {
    throw new Error("winnerIds must be a non-empty array");
  }
  for (const winnerId of winnerIds) {
    validateOutcomeIdLength(winnerId);
  }
  if (new Set(winnerIds).size !== winnerIds.length) {
    throw new Error("winnerIds must be distinct");
  }
  const winnersCount = winnerIds.length;
  const syntheticEffects = buildSyntheticEffects(payoutLamports, winnersCount);
  return {
    outcomeIds: winnerIds,
    winnersCount,
    totalOutputLamports: payoutLamports * BigInt(winnersCount),
    effectCount: payoutLamports === 0n ? 0 : winnersCount,
    effectsDigest: sha256(syntheticEffects),
  };
}

export async function buildSnapshotClaimFromFile(opts: {
  snapshotPath: string;
  formula: ResolutionFormula;
  winnersCount: number;
  randomness: Buffer;
  payoutLamports: bigint;
  targetScore?: bigint;
}): Promise<SnapshotClaim> {
  const formula = validateFormula(opts.formula);
  const winnersCount = validateWinnersCount(opts.winnersCount, Number.MAX_SAFE_INTEGER);
  const targetScore = opts.targetScore ?? 0n;

  if (formula === "weighted_random") {
    const selected = new Set<string>();
    const winners: string[] = [];
    for (let round = 0; round < winnersCount; round += 1) {
      let totalWeight = 0n;
      for await (const entry of readCanonicalSnapshotEntries(opts.snapshotPath, formula)) {
        if (selected.has(entry.id)) continue;
        totalWeight += BigInt(entry.weight);
      }
      if (totalWeight <= 0n) {
        throw new Error("Weighted snapshot has no remaining weight");
      }
      const rolled = rollForRound(opts.randomness, round) % totalWeight;
      let cursor = 0n;
      let winnerId: string | null = null;
      for await (const entry of readCanonicalSnapshotEntries(opts.snapshotPath, formula)) {
        if (selected.has(entry.id)) continue;
        cursor += BigInt(entry.weight);
        if (rolled < cursor) {
          winnerId = entry.id;
          break;
        }
      }
      if (!winnerId) {
        throw new Error("Failed to select weighted snapshot winner");
      }
      selected.add(winnerId);
      winners.push(winnerId);
    }
    return buildSnapshotClaimFromWinnerIds(winners, opts.payoutLamports);
  }

  const best: SnapshotParticipantRecord[] = [];
  for await (const entry of readCanonicalSnapshotEntries(opts.snapshotPath, formula)) {
    best.push(entry);
    best.sort((left, right) => compareFormulaEntries(left, right, formula, targetScore));
    if (best.length > winnersCount) {
      best.length = winnersCount;
    }
  }
  if (best.length !== winnersCount) {
    throw new Error("Snapshot participant count is below winners_count");
  }
  return buildSnapshotClaimFromWinnerIds(best.map((entry) => entry.id), opts.payoutLamports);
}
