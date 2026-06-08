import crypto from "crypto";
import fs from "fs";
import readline from "readline";

import type {
  CompactNamedEntry,
  CompactNamedEntryDrawConfig,
  FormulaParticipant,
  SnapshotMerkleProofNode,
  SnapshotProofStatus,
  SnapshotPublicationStatus,
  OutcomeStandardV12ProofManifest,
  OutcomeStandardV121ProofManifest,
  OutcomeStandardV121ScaleDrawConfig,
  OutcomeStandardV121SnapshotManifest,
  OutcomeStandardV12ScaleDrawConfig,
  OutcomeStandardV12SnapshotManifest,
  ResolutionFormula,
  SignedIntegerValue,
  SnapshotFormulaDrawConfig,
  SnapshotManifest,
  SnapshotParticipant,
} from "./types.js";

export const FORMAT_VERSION_V4 = 4;
export const FORMAT_VERSION_V5 = 5;
export const FORMAT_VERSION_V1_2_SCALE = 6;
export const FORMAT_VERSION_V1_2_1_SCALE = 7;
export const OUTCOME_STANDARD_V1_1 = "Outcome Standard V1.1";
export const OUTCOME_STANDARD_V1_2 = "1.2";
export const OUTCOME_STANDARD_V1_2_1 = "1.2.1";
export const WINNER_CLAIM_HASH_DOMAIN = "outcome-standard-v1.2.1/winner-claim";
export const MAX_OUTCOME_ID_BYTES = 64;
export const MAX_WINNERS = 32;
export const MAX_SNAPSHOT_URI_BYTES = 512;
export const MAX_COMPILED_ARTIFACT_BYTES = 8192;
export const V5_ENTRY_BYTES = 1 + MAX_OUTCOME_ID_BYTES + 4 + 8 + 2;
export const MAX_U32 = 0xffffffff;
export const MAX_U64 = (1n << 64n) - 1n;
export const MIN_I64 = -(1n << 63n);
export const MAX_I64 = (1n << 63n) - 1n;
export const EFFECT_TYPE_TRANSFER_SOL = 1;
export const MULTI_WINNER_DOMAIN = "VRE_MULTI_WINNER_V1";
export const SNAPSHOT_LEAF_HASH_SCHEME = "sha256d_jsonl_v1";
export const SNAPSHOT_MERKLE_HASH_SCHEME = "sha256_pair_v1";
export const V4_FLAG_HAS_MERKLE_ROOT = 0x01;
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
  formatVersion: typeof FORMAT_VERSION_V4;
  minInputLamports: bigint;
  maxInputLamports: bigint;
  winnersCount: number;
  formulaCode: number;
  targetScore: bigint;
  snapshotCount: number;
  payoutLamports: bigint;
  snapshotHash: Buffer;
  merkleRoot: Buffer | null;
  snapshotUri: string;
};

export type ParsedOutcomeStandardV12Artifact = Omit<
  ParsedSnapshotArtifactV4,
  "formatVersion"
> & {
  formatVersion: typeof FORMAT_VERSION_V1_2_SCALE;
  standardVersion: typeof OUTCOME_STANDARD_V1_2;
};

export type ParsedOutcomeStandardV121Artifact = Omit<
  ParsedSnapshotArtifactV4,
  "formatVersion"
> & {
  formatVersion: typeof FORMAT_VERSION_V1_2_1_SCALE;
  standardVersion: typeof OUTCOME_STANDARD_V1_2_1;
};

export type CompactNamedEntryRecord = {
  id: string;
  order: number;
  weight: number;
  score: bigint;
};

export type ParsedCompactNamedEntryArtifactV5 = {
  formatVersion: 5;
  standardVersion: typeof OUTCOME_STANDARD_V1_1;
  minInputLamports: bigint;
  maxInputLamports: bigint;
  winnersCount: number;
  formulaCode: number;
  targetScore: bigint;
  entryCount: number;
  payoutLamports: bigint;
  entries: CompactNamedEntryRecord[];
};

export type SnapshotClaim = {
  outcomeIds: string[];
  winnersCount: number;
  totalOutputLamports: bigint;
  effectCount: number;
  effectsDigest: Buffer;
  winnerClaimHash: Buffer;
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

function normalizeHex32(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new RangeError(`${label} must be a 32-byte hex string`);
  }
  return value.toLowerCase();
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
  if (offset.value + len > buf.length) {
    throw new Error("Invalid artifact length");
  }
  const out = buf.subarray(offset.value, offset.value + len);
  offset.value += len;
  return out;
}

function ensureV5FormulaFields(
  raw: CompactNamedEntry | FormulaParticipant,
  index: number,
  formula: ResolutionFormula
): CompactNamedEntryRecord {
  assertObject(raw, `participants[${index}]`);
  const id = validateOutcomeId(raw.id, `participants[${index}].id`);
  const rawOrder = "order" in raw ? raw.order : undefined;
  const order = rawOrder === undefined ? index : validateOrder(rawOrder, `participants[${index}].order`);
  if (order > 0xffff) {
    throw new RangeError(`participants[${index}].order must fit in u16`);
  }

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

  if (raw.weight !== undefined && raw.weight !== 1) {
    throw new TypeError(`participants[${index}].weight must be omitted or 1 outside weighted_random`);
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

function normalizeCompactNamedEntries(
  participants: Array<CompactNamedEntry | FormulaParticipant>,
  formulaInput: ResolutionFormula
): CompactNamedEntryRecord[] {
  const formula = validateFormula(formulaInput);
  if (!Array.isArray(participants) || participants.length === 0) {
    throw new RangeError("participants must be a non-empty array");
  }
  if (participants.length > 0xffff) {
    throw new RangeError("v5 entry_count must fit in u16");
  }
  const out = participants.map((participant, index) =>
    ensureV5FormulaFields(participant, index, formula)
  );
  const seenOrders = new Set<number>();
  for (const entry of out) {
    if (entry.order >= out.length) {
      throw new RangeError("v5 entry order must be in 0..entry_count-1");
    }
    if (seenOrders.has(entry.order)) {
      throw new Error("v5 entry order must be unique");
    }
    seenOrders.add(entry.order);
  }
  out.sort((left, right) => compareId(left.id, right.id));
  let previousId: string | null = null;
  for (const entry of out) {
    if (entry.id === previousId) {
      throw new Error(`duplicate v5 entry id: ${entry.id}`);
    }
    previousId = entry.id;
  }
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

export function hashSnapshotLeafLine(line: string): Buffer {
  return sha256(sha256(Buffer.from(line, "utf8")));
}

export function hashSnapshotLeaf(
  entry: SnapshotParticipantRecord,
  formula: ResolutionFormula
): Buffer {
  return hashSnapshotLeafLine(canonicalSnapshotLine(entry, formula));
}

function buildNextMerkleLevel(level: Buffer[]): Buffer[] {
  const next: Buffer[] = [];
  for (let index = 0; index < level.length; index += 2) {
    const left = level[index];
    const right = level[index + 1] ?? left;
    next.push(sha256(Buffer.concat([left, right])));
  }
  return next;
}

export function buildMerkleLevels(leafHashes: Buffer[]): Buffer[][] {
  if (!Array.isArray(leafHashes) || leafHashes.length === 0) {
    throw new Error("leafHashes must contain at least one entry");
  }
  const levels: Buffer[][] = [leafHashes.map((leaf) => Buffer.from(leaf))];
  while (levels[levels.length - 1].length > 1) {
    levels.push(buildNextMerkleLevel(levels[levels.length - 1]));
  }
  return levels;
}

export function buildMerkleRoot(leafHashes: Buffer[]): Buffer {
  const levels = buildMerkleLevels(leafHashes);
  return levels[levels.length - 1][0];
}

export function buildMerkleProof(
  levels: Buffer[][],
  leafIndex: number
): SnapshotMerkleProofNode[] {
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= levels[0].length) {
    throw new RangeError("leafIndex is out of bounds");
  }
  const proof: SnapshotMerkleProofNode[] = [];
  let currentIndex = leafIndex;
  for (let levelIndex = 0; levelIndex < levels.length - 1; levelIndex += 1) {
    const level = levels[levelIndex];
    const isRightNode = currentIndex % 2 === 1;
    const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;
    const sibling = level[siblingIndex] ?? level[currentIndex];
    proof.push({
      position: isRightNode ? "left" : "right",
      sibling: sibling.toString("hex"),
    });
    currentIndex = Math.floor(currentIndex / 2);
  }
  return proof;
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
  merkleRoot: string;
  canonicalSnapshot: string;
} {
  const formula = validateFormula(opts.formula);
  const normalized = normalizeSnapshotParticipants(opts.participants, formula);
  const hash = crypto.createHash("sha256");
  const lines: string[] = [];
  const leafHashes: Buffer[] = [];
  for (const entry of normalized) {
    const line = canonicalSnapshotLine(entry, formula);
    lines.push(line);
    hash.update(line, "utf8");
    leafHashes.push(hashSnapshotLeafLine(line));
  }
  return {
    snapshotHash: hash.digest("hex"),
    snapshotCount: normalized.length,
    merkleRoot: buildMerkleRoot(leafHashes).toString("hex"),
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
  merkleRoot?: string;
  proofManifestUrl?: string;
  irysUrl?: string;
  publicationStatus?: SnapshotPublicationStatus;
  publicationError?: string;
  proofStatus?: SnapshotProofStatus;
}): SnapshotManifest {
  const snapshotHash = normalizeHex32(opts.snapshotHash, "snapshotHash");
  const formula = validateFormula(opts.formula);
  const winnersCount = validateWinnersCount(opts.winnersCount, opts.snapshotCount);
  return {
    version: "vre_snapshot_manifest_v1",
    artifact_format_version: FORMAT_VERSION_V4,
    snapshot_hash: snapshotHash,
    snapshot_count: opts.snapshotCount,
    formula,
    winners_count: winnersCount,
    snapshot_uri: opts.snapshotUri,
    created_at: new Date().toISOString(),
    ...(opts.merkleRoot === undefined
      ? {}
      : {
          merkle_root: normalizeHex32(opts.merkleRoot, "merkleRoot"),
          leaf_hash_scheme: SNAPSHOT_LEAF_HASH_SCHEME,
          merkle_hash_scheme: SNAPSHOT_MERKLE_HASH_SCHEME,
        }),
    ...(opts.proofManifestUrl === undefined ? {} : { proof_manifest_url: opts.proofManifestUrl }),
    ...(opts.irysUrl === undefined ? {} : { irys_url: opts.irysUrl }),
    ...(opts.publicationStatus === undefined ? {} : { publication_status: opts.publicationStatus }),
    ...(opts.publicationError === undefined ? {} : { publication_error: opts.publicationError }),
    ...(opts.proofStatus === undefined ? {} : { proof_status: opts.proofStatus }),
    payout_lamports: opts.payoutLamports.toString(),
    ...(opts.targetScore === undefined ? {} : { target: opts.targetScore.toString() }),
    ...(opts.thresholdMode === undefined ? {} : { threshold_mode: opts.thresholdMode }),
  };
}

export function buildOutcomeStandardV12SnapshotManifest(opts: {
  snapshotHash: string;
  snapshotCount: number;
  formula: ResolutionFormula;
  winnersCount: number;
  snapshotUri: string;
  merkleRoot: string;
  payoutLamports?: bigint;
  targetScore?: bigint;
  thresholdMode?: OutcomeStandardV12SnapshotManifest["threshold_mode"];
  publicationStatus?: SnapshotPublicationStatus;
  publicationUrl?: string | null;
  proofManifestUrl?: string | null;
  publicationError?: string;
  proofStatus?: SnapshotProofStatus;
}): OutcomeStandardV12SnapshotManifest {
  const snapshotHash = normalizeHex32(opts.snapshotHash, "snapshotHash");
  const merkleRoot = normalizeHex32(opts.merkleRoot, "merkleRoot");
  const formula = validateFormula(opts.formula);
  const winnersCount = validateWinnersCount(opts.winnersCount, opts.snapshotCount);
  return {
    version: "outcome_standard_snapshot_manifest_v1",
    standard_version: OUTCOME_STANDARD_V1_2,
    standard_kind: "scale_snapshot",
    entry_model: "named_entry",
    entry_hash_scheme: "sha256d_canonical_named_entry_v1",
    merkle_hash_scheme: SNAPSHOT_MERKLE_HASH_SCHEME,
    snapshot_hash: snapshotHash,
    snapshot_count: opts.snapshotCount,
    formula,
    winners_count: winnersCount,
    snapshot_uri: opts.snapshotUri,
    created_at: new Date().toISOString(),
    merkle_root: merkleRoot,
    publication_status: opts.publicationStatus ?? "pending",
    publication_url: opts.publicationUrl ?? null,
    proof_manifest_url: opts.proofManifestUrl ?? null,
    proof_status: opts.proofStatus ?? "pending",
    ...(opts.payoutLamports === undefined ? {} : { payout_lamports: opts.payoutLamports.toString() }),
    ...(opts.targetScore === undefined ? {} : { target: opts.targetScore.toString() }),
    ...(opts.thresholdMode === undefined ? {} : { threshold_mode: opts.thresholdMode }),
    ...(opts.publicationError === undefined ? {} : { publication_error: opts.publicationError }),
  };
}

export function buildOutcomeStandardV12ProofManifest(opts: {
  signature: string;
  programId: string;
  snapshotHash: string;
  snapshotCount: number;
  snapshotUri: string;
  merkleRoot: string;
  formula: ResolutionFormula;
  selectedIds: string[];
  snapshotManifestUri: string;
  proofEndpointTemplate: string;
  publicationStatus?: SnapshotPublicationStatus;
  publicationUrl?: string | null;
  target?: SignedIntegerValue;
  publicationError?: string;
  proofStatus?: SnapshotProofStatus;
}): OutcomeStandardV12ProofManifest {
  const formula = validateFormula(opts.formula);
  const selectedIds = opts.selectedIds.map((id, index) =>
    validateOutcomeId(id, `selectedIds[${index}]`)
  );
  if (selectedIds.length === 0 || selectedIds.length > MAX_WINNERS) {
    throw new RangeError(`selectedIds length must be 1..${MAX_WINNERS}`);
  }
  return {
    version: "outcome_standard_proof_manifest_v1",
    standard_version: OUTCOME_STANDARD_V1_2,
    standard_kind: "scale_snapshot",
    signature: opts.signature,
    program_id: opts.programId,
    snapshot_hash: normalizeHex32(opts.snapshotHash, "snapshotHash"),
    snapshot_count: opts.snapshotCount,
    snapshot_uri: opts.snapshotUri,
    merkle_root: normalizeHex32(opts.merkleRoot, "merkleRoot"),
    formula,
    winners_count: selectedIds.length,
    selected_ids: selectedIds,
    proof_endpoint_template: opts.proofEndpointTemplate,
    publication_status: opts.publicationStatus ?? "pending",
    publication_url: opts.publicationUrl ?? null,
    snapshot_manifest_uri: opts.snapshotManifestUri,
    proof_status: opts.proofStatus ?? "pending",
    ...(opts.target === undefined
      ? {}
      : { target: parseSignedInteger(opts.target, "target").toString() }),
    ...(opts.publicationError === undefined ? {} : { publication_error: opts.publicationError }),
  };
}

export function buildOutcomeStandardV121SnapshotManifest(opts: Parameters<typeof buildOutcomeStandardV12SnapshotManifest>[0] & {
  winnerClaimHash: string;
}): OutcomeStandardV121SnapshotManifest {
  return {
    ...buildOutcomeStandardV12SnapshotManifest(opts),
    standard_version: OUTCOME_STANDARD_V1_2_1,
    winner_claim_hash: normalizeHex32(opts.winnerClaimHash, "winnerClaimHash"),
  };
}

export function buildOutcomeStandardV121ProofManifest(opts: Parameters<typeof buildOutcomeStandardV12ProofManifest>[0] & {
  winnerClaimHash: string;
}): OutcomeStandardV121ProofManifest {
  return {
    ...buildOutcomeStandardV12ProofManifest(opts),
    standard_version: OUTCOME_STANDARD_V1_2_1,
    winner_claim_hash: normalizeHex32(opts.winnerClaimHash, "winnerClaimHash"),
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
  return buildSnapshotArtifact(config, FORMAT_VERSION_V4);
}

export function buildArtifactV12(config: OutcomeStandardV12ScaleDrawConfig): Buffer {
  return buildSnapshotArtifact(config, FORMAT_VERSION_V1_2_SCALE);
}

export function buildArtifactV121(config: OutcomeStandardV121ScaleDrawConfig): Buffer {
  return buildSnapshotArtifact(config, FORMAT_VERSION_V1_2_1_SCALE);
}

function buildSnapshotArtifact(
  config:
    | SnapshotFormulaDrawConfig
    | OutcomeStandardV12ScaleDrawConfig
    | OutcomeStandardV121ScaleDrawConfig,
  formatVersion:
    | typeof FORMAT_VERSION_V4
    | typeof FORMAT_VERSION_V1_2_SCALE
    | typeof FORMAT_VERSION_V1_2_1_SCALE
): Buffer {
  const formula = validateFormula(config.formula);
  const inputLamports = parsePositiveLamports(config.input_lamports, "input_lamports");
  const payoutLamports = parseOptionalLamports(config.payout_lamports, 3n, "payout_lamports");
  const snapshotHash = normalizeHex32(config.snapshot_hash, "snapshot_hash");
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
  const merkleRoot = config.merkle_root === undefined
    ? null
    : Buffer.from(normalizeHex32(config.merkle_root, "merkle_root"), "hex");
  const reserved = Buffer.alloc(5, 0);
  if (merkleRoot) {
    reserved[0] |= V4_FLAG_HAS_MERKLE_ROOT;
  }
  const minInputLamports = inputLamports;
  const maxInputLamports = inputLamports;
  const parts: Buffer[] = [
    Buffer.from("W3O1", "ascii"),
    u16le(formatVersion),
    u64le(minInputLamports),
    u64le(maxInputLamports),
    u16le(winnersCount),
    Buffer.from([FORMULA_CODES[formula]]),
    reserved,
    i64le(targetScore),
    u32le(config.snapshot_count),
    u64le(payoutLamports),
    Buffer.from(snapshotHash, "hex"),
    ...(merkleRoot ? [merkleRoot] : []),
    u16le(snapshotUriBytes.length),
    snapshotUriBytes,
  ];
  return Buffer.concat(parts);
}

export function parseArtifactV4(blob: Buffer): ParsedSnapshotArtifactV4 {
  return parseSnapshotArtifact(blob, FORMAT_VERSION_V4) as ParsedSnapshotArtifactV4;
}

export function parseArtifactV12(blob: Buffer): ParsedOutcomeStandardV12Artifact {
  const parsed = parseSnapshotArtifact(blob, FORMAT_VERSION_V1_2_SCALE);
  return {
    ...parsed,
    formatVersion: FORMAT_VERSION_V1_2_SCALE,
    standardVersion: OUTCOME_STANDARD_V1_2,
  };
}

export function parseArtifactV121(blob: Buffer): ParsedOutcomeStandardV121Artifact {
  const parsed = parseSnapshotArtifact(blob, FORMAT_VERSION_V1_2_1_SCALE);
  return {
    ...parsed,
    formatVersion: FORMAT_VERSION_V1_2_1_SCALE,
    standardVersion: OUTCOME_STANDARD_V1_2_1,
  };
}

function parseSnapshotArtifact(
  blob: Buffer,
  expectedFormatVersion:
    | typeof FORMAT_VERSION_V4
    | typeof FORMAT_VERSION_V1_2_SCALE
    | typeof FORMAT_VERSION_V1_2_1_SCALE
): ParsedSnapshotArtifactV4 | ParsedOutcomeStandardV12Artifact | ParsedOutcomeStandardV121Artifact {
  if (blob.length < 84) {
    throw new Error("Invalid snapshot artifact length");
  }
  if (blob.subarray(0, 4).toString("ascii") !== "W3O1") {
    throw new Error("Invalid artifact magic");
  }
  const offset = { value: 4 };
  const formatVersion = readU16LE(blob, offset);
  if (formatVersion !== expectedFormatVersion) {
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
  const reserved = readBytes(blob, offset, 5);
  const flags = reserved.readUInt8(0);
  if (flags & ~V4_FLAG_HAS_MERKLE_ROOT) {
    throw new Error("Unsupported v4 snapshot flags");
  }
  if (!reserved.subarray(1).equals(Buffer.alloc(4, 0))) {
    throw new Error("Reserved header bytes must be zero");
  }
  const targetScore = readI64LE(blob, offset);
  const snapshotCount = readU32LE(blob, offset);
  const payoutLamports = readU64LE(blob, offset);
  const snapshotHash = readBytes(blob, offset, 32);
  const merkleRoot =
    flags & V4_FLAG_HAS_MERKLE_ROOT ? readBytes(blob, offset, 32) : null;
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
    formatVersion: expectedFormatVersion,
    minInputLamports,
    maxInputLamports,
    winnersCount,
    formulaCode,
    targetScore,
    snapshotCount,
    payoutLamports,
    snapshotHash,
    merkleRoot,
    snapshotUri,
    ...(expectedFormatVersion === FORMAT_VERSION_V1_2_SCALE
      ? { standardVersion: OUTCOME_STANDARD_V1_2 }
      : expectedFormatVersion === FORMAT_VERSION_V1_2_1_SCALE
        ? { standardVersion: OUTCOME_STANDARD_V1_2_1 }
        : {}),
  } as ParsedSnapshotArtifactV4 | ParsedOutcomeStandardV12Artifact | ParsedOutcomeStandardV121Artifact;
}

export function buildArtifactV5(config: CompactNamedEntryDrawConfig): Buffer {
  const formula = validateFormula(config.formula);
  const entries = normalizeCompactNamedEntries(config.participants, formula);
  const inputLamports = parsePositiveLamports(config.input_lamports, "input_lamports");
  const payoutLamports = parseOptionalLamports(config.payout_lamports, 3n, "payout_lamports");
  const winnersCount = validateWinnersCount(config.winners_count, entries.length);
  const targetScore =
    formula === "closest_to"
      ? parseSignedInteger(config.target, "target")
      : config.target === undefined
      ? 0n
      : parseSignedInteger(config.target, "target");
  const parts: Buffer[] = [
    Buffer.from("W3O1", "ascii"),
    u16le(FORMAT_VERSION_V5),
    u64le(inputLamports),
    u64le(inputLamports),
    u16le(winnersCount),
    Buffer.from([FORMULA_CODES[formula]]),
    Buffer.alloc(5, 0),
    i64le(targetScore),
    u16le(entries.length),
    u64le(payoutLamports),
  ];
  for (const entry of entries) {
    const idBytes = Buffer.from(entry.id, "ascii");
    parts.push(Buffer.from([idBytes.length]));
    const fixed = Buffer.alloc(MAX_OUTCOME_ID_BYTES, 0);
    idBytes.copy(fixed);
    parts.push(fixed);
    parts.push(u32le(entry.weight));
    parts.push(i64le(entry.score));
    parts.push(u16le(entry.order));
  }
  const blob = Buffer.concat(parts);
  if (blob.length > MAX_COMPILED_ARTIFACT_BYTES) {
    throw new RangeError(
      `Outcome Standard V1.1 compact artifact is ${blob.length} bytes; route larger draws to Outcome Standard V1.2`
    );
  }
  return blob;
}

export function parseArtifactV5(blob: Buffer): ParsedCompactNamedEntryArtifactV5 {
  if (blob.length < 48 || blob.length > MAX_COMPILED_ARTIFACT_BYTES) {
    throw new Error("Invalid v5 artifact length");
  }
  if (blob.subarray(0, 4).toString("ascii") !== "W3O1") {
    throw new Error("Invalid artifact magic");
  }
  const offset = { value: 4 };
  const formatVersion = readU16LE(blob, offset);
  if (formatVersion !== FORMAT_VERSION_V5) {
    throw new Error("Unsupported compact named-entry artifact format version");
  }
  const minInputLamports = readU64LE(blob, offset);
  const maxInputLamports = readU64LE(blob, offset);
  if (minInputLamports > maxInputLamports) {
    throw new Error("v5 artifact bounds are invalid");
  }
  const winnersCount = readU16LE(blob, offset);
  const formulaCode = readU8(blob, offset);
  if (!Object.values(FORMULA_CODES).includes(formulaCode)) {
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
  const entries: CompactNamedEntryRecord[] = [];
  const seenOrders = new Set<number>();
  let previousId: Buffer | null = null;
  for (let index = 0; index < entryCount; index += 1) {
    const idLen = readU8(blob, offset);
    if (idLen < 1 || idLen > MAX_OUTCOME_ID_BYTES) {
      throw new Error("Invalid v5 id length");
    }
    const idBuffer = readBytes(blob, offset, MAX_OUTCOME_ID_BYTES);
    const canonicalId = idBuffer.subarray(0, idLen);
    if (!canonicalId.every((byte) => byte >= 32 && byte <= 126)) {
      throw new Error("v5 id must be printable ASCII");
    }
    if (!idBuffer.subarray(idLen).equals(Buffer.alloc(MAX_OUTCOME_ID_BYTES - idLen, 0))) {
      throw new Error("v5 id padding must be zero");
    }
    if (previousId && Buffer.compare(previousId, canonicalId) >= 0) {
      throw new Error("v5 ids must be strictly sorted");
    }
    previousId = Buffer.from(canonicalId);
    const weight = readU32LE(blob, offset);
    if (weight <= 0) {
      throw new Error("v5 weight must be positive");
    }
    const score = readI64LE(blob, offset);
    const order = readU16LE(blob, offset);
    if (order >= entryCount || seenOrders.has(order)) {
      throw new Error("v5 order must be unique and in range");
    }
    seenOrders.add(order);
    entries.push({
      id: canonicalId.toString("ascii"),
      weight,
      score,
      order,
    });
  }
  if (offset.value !== blob.length) {
    throw new Error("Unknown trailing bytes in v5 artifact");
  }
  return {
    formatVersion: FORMAT_VERSION_V5,
    standardVersion: OUTCOME_STANDARD_V1_1,
    minInputLamports,
    maxInputLamports,
    winnersCount,
    formulaCode,
    targetScore,
    entryCount,
    payoutLamports,
    entries,
  };
}

export function formulaNameFromArtifactV4(
  parsed:
    | ParsedSnapshotArtifactV4
    | ParsedOutcomeStandardV12Artifact
    | ParsedOutcomeStandardV121Artifact
): ResolutionFormula {
  return formulaCodeToName(parsed.formulaCode);
}

export function formulaNameFromArtifactV5(parsed: ParsedCompactNamedEntryArtifactV5): ResolutionFormula {
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
  expectedMerkleRoot?: string;
}): Promise<{ snapshotHash: string; snapshotCount: number; merkleRoot: string }> {
  const formula = validateFormula(opts.formula);
  const hash = crypto.createHash("sha256");
  let previousId: string | null = null;
  let count = 0;
  const leafHashes: Buffer[] = [];
  for await (const entry of readCanonicalSnapshotEntries(opts.snapshotPath, formula)) {
    if (previousId !== null && compareId(previousId, entry.id) >= 0) {
      throw new Error("Snapshot entries must be strictly sorted by id");
    }
    previousId = entry.id;
    const line = canonicalSnapshotLine(entry, formula);
    hash.update(line, "utf8");
    leafHashes.push(hashSnapshotLeafLine(line));
    count += 1;
  }
  if (count === 0) {
    throw new Error("Snapshot must not be empty");
  }
  const snapshotHash = hash.digest("hex");
  const merkleRoot = buildMerkleRoot(leafHashes).toString("hex");
  if (opts.expectedHash && snapshotHash !== opts.expectedHash.toLowerCase()) {
    throw new Error("Snapshot hash does not match committed snapshot_hash");
  }
  if (opts.expectedCount !== undefined && count !== opts.expectedCount) {
    throw new Error("Snapshot count does not match committed snapshot_count");
  }
  if (
    opts.expectedMerkleRoot &&
    merkleRoot !== normalizeHex32(opts.expectedMerkleRoot, "expectedMerkleRoot")
  ) {
    throw new Error("Snapshot merkle root does not match committed merkle_root");
  }
  return { snapshotHash, snapshotCount: count, merkleRoot };
}

export async function buildSnapshotMerkleProofFromFile(opts: {
  snapshotPath: string;
  formula: ResolutionFormula;
  participantId: string;
  expectedHash?: string;
  expectedCount?: number;
  expectedMerkleRoot?: string;
}): Promise<{
  snapshotHash: string;
  snapshotCount: number;
  merkleRoot: string;
  participant: SnapshotParticipantRecord | null;
  leafHash: string | null;
  proof: SnapshotMerkleProofNode[];
}> {
  const formula = validateFormula(opts.formula);
  const participantId = validateOutcomeId(opts.participantId, "participantId");
  const hash = crypto.createHash("sha256");
  let previousId: string | null = null;
  let count = 0;
  let participant: SnapshotParticipantRecord | null = null;
  let participantIndex = -1;
  const leafHashes: Buffer[] = [];
  for await (const entry of readCanonicalSnapshotEntries(opts.snapshotPath, formula)) {
    if (previousId !== null && compareId(previousId, entry.id) >= 0) {
      throw new Error("Snapshot entries must be strictly sorted by id");
    }
    previousId = entry.id;
    const line = canonicalSnapshotLine(entry, formula);
    hash.update(line, "utf8");
    leafHashes.push(hashSnapshotLeafLine(line));
    if (entry.id === participantId) {
      participant = entry;
      participantIndex = count;
    }
    count += 1;
  }
  if (count === 0) {
    throw new Error("Snapshot must not be empty");
  }
  const snapshotHash = hash.digest("hex");
  const levels = buildMerkleLevels(leafHashes);
  const merkleRoot = levels[levels.length - 1][0].toString("hex");
  if (opts.expectedHash && snapshotHash !== opts.expectedHash.toLowerCase()) {
    throw new Error("Snapshot hash does not match committed snapshot_hash");
  }
  if (opts.expectedCount !== undefined && count !== opts.expectedCount) {
    throw new Error("Snapshot count does not match committed snapshot_count");
  }
  if (
    opts.expectedMerkleRoot &&
    merkleRoot !== normalizeHex32(opts.expectedMerkleRoot, "expectedMerkleRoot")
  ) {
    throw new Error("Snapshot merkle root does not match committed merkle_root");
  }
  if (!participant || participantIndex < 0) {
    return {
      snapshotHash,
      snapshotCount: count,
      merkleRoot,
      participant: null,
      leafHash: null,
      proof: [],
    };
  }
  return {
    snapshotHash,
    snapshotCount: count,
    merkleRoot,
    participant,
    leafHash: leafHashes[participantIndex].toString("hex"),
    proof: buildMerkleProof(levels, participantIndex),
  };
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

export function buildWinnerClaimHash(winnerIds: string[]): Buffer {
  if (!Array.isArray(winnerIds) || winnerIds.length === 0) {
    throw new Error("winnerIds must be a non-empty array");
  }
  if (winnerIds.length > MAX_WINNERS) {
    throw new RangeError(`winnerIds length must be <= ${MAX_WINNERS}`);
  }
  if (new Set(winnerIds).size !== winnerIds.length) {
    throw new Error("winnerIds must be distinct");
  }
  const parts: Buffer[] = [
    Buffer.from(WINNER_CLAIM_HASH_DOMAIN, "utf8"),
    u16le(winnerIds.length),
  ];
  for (const [index, winnerId] of winnerIds.entries()) {
    validateOutcomeIdLength(winnerId);
    const idBytes = Buffer.from(winnerId, "ascii");
    if (idBytes.length > 0xff) {
      throw new RangeError(`winnerIds[${index}] must fit in u8 length prefix`);
    }
    parts.push(Buffer.from([idBytes.length]), idBytes);
  }
  return sha256(Buffer.concat(parts));
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
    winnerClaimHash: buildWinnerClaimHash(winnerIds),
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

export function buildCompactNamedEntryClaimFromArtifactV5(
  parsed: ParsedCompactNamedEntryArtifactV5,
  randomness: Buffer
): SnapshotClaim {
  const formula = formulaNameFromArtifactV5(parsed);
  const targetScore = parsed.targetScore;
  if (formula === "weighted_random") {
    const remaining = [...parsed.entries];
    const winners: string[] = [];
    for (let round = 0; round < parsed.winnersCount; round += 1) {
      const totalWeight = remaining.reduce((sum, entry) => sum + BigInt(entry.weight), 0n);
      if (totalWeight <= 0n) {
        throw new Error("Weighted v5 artifact has no remaining weight");
      }
      const rolled = rollForRound(randomness, round) % totalWeight;
      let cursor = 0n;
      let selectedIndex = -1;
      for (let index = 0; index < remaining.length; index += 1) {
        cursor += BigInt(remaining[index].weight);
        if (rolled < cursor) {
          selectedIndex = index;
          break;
        }
      }
      if (selectedIndex < 0) {
        throw new Error("Failed to select weighted v5 winner");
      }
      winners.push(remaining[selectedIndex].id);
      remaining.splice(selectedIndex, 1);
    }
    return buildSnapshotClaimFromWinnerIds(winners, parsed.payoutLamports);
  }
  const winners = [...parsed.entries]
    .sort((left, right) => compareFormulaEntries(left, right, formula, targetScore))
    .slice(0, parsed.winnersCount)
    .map((entry) => entry.id);
  if (winners.length !== parsed.winnersCount) {
    throw new Error("v5 entry count is below winners_count");
  }
  return buildSnapshotClaimFromWinnerIds(winners, parsed.payoutLamports);
}
