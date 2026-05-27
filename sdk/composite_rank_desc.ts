import type {
  CompositeFieldIntegerInput,
  CompositeNormalizationMode,
  CompositeRankDescConfig,
  CompositeRankDescParticipant,
  CompositeRankDescReplayEntry,
  CompositeRankDescReplayResult,
  ParsedCompositeRankDescArtifact,
  LamportsValue,
} from "./types.js";

export const FORMAT_VERSION_COMPOSITE_RANK_DESC = 8;
export const FORMULA_CODE_COMPOSITE_RANK_DESC = 6;
export const COMPOSITE_SCORING_VERSION = "vre_composite_rank_v1";
export const COMPOSITE_WEIGHT_SCALE = 1_000_000;
export const COMPOSITE_NORMALIZATION_SCALE = 1_000_000;
export const MAX_COMPOSITE_FIELDS = 16;
export const MAX_COMPOSITE_FIELD_KEY_BYTES = 32;
export const MAX_COMPOSITE_PARTICIPANT_ID_BYTES = 64;
export const MAX_COMPOSITE_ARTIFACT_BYTES = 8192;

const MAGIC = "W3O1";
const MAX_WINNERS = 32;
const MAX_U32 = 0xffffffff;
const MAX_U64 = (1n << 64n) - 1n;
const MIN_I64 = -(1n << 63n);
const MAX_I64 = (1n << 63n) - 1n;
const HEADER_BYTES = 46;
const FIELD_SPEC_BYTES = 1 + MAX_COMPOSITE_FIELD_KEY_BYTES + 4;
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;
const PRINTABLE_ASCII_RE = /^[\x20-\x7E]+$/;

type NormalizedFieldSpec = {
  key: string;
  weightPpm: number;
};

type NormalizedParticipant = {
  id: string;
  order: number;
  fieldValues: bigint[];
};

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function validateOutcomeId(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  const byteLen = Buffer.byteLength(value, "ascii");
  if (byteLen === 0 || byteLen > MAX_COMPOSITE_PARTICIPANT_ID_BYTES || !PRINTABLE_ASCII_RE.test(value)) {
    throw new RangeError(`${label} must be printable ASCII <= ${MAX_COMPOSITE_PARTICIPANT_ID_BYTES} bytes`);
  }
  return value;
}

function parseLamports(value: LamportsValue | undefined, label: string): bigint {
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
    return BigInt(value);
  }
  throw new TypeError(`${label} must be a bigint or safe integer number`);
}

function parseSignedI64(value: CompositeFieldIntegerInput, label: string): bigint {
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
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = BigInt(value);
    if (parsed < MIN_I64 || parsed > MAX_I64) {
      throw new RangeError(`${label} must fit in i64`);
    }
    return parsed;
  }
  throw new TypeError(`${label} must be an i64-compatible bigint, integer number, or decimal string`);
}

function validateOrder(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0xffff) {
    throw new RangeError(`${label} must be a u16-compatible integer`);
  }
  return value as number;
}

function validateFieldSpecs(fields: CompositeRankDescConfig["scoring_fields"]): NormalizedFieldSpec[] {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new RangeError("scoring_fields must be a non-empty array");
  }
  if (fields.length > MAX_COMPOSITE_FIELDS) {
    throw new RangeError(`scoring_fields must contain <= ${MAX_COMPOSITE_FIELDS} fields`);
  }
  const seen = new Set<string>();
  let sum = 0;
  const normalized = fields.map((field, index) => {
    assertObject(field, `scoring_fields[${index}]`);
    if (!FIELD_KEY_RE.test(field.key) || Buffer.byteLength(field.key, "ascii") > MAX_COMPOSITE_FIELD_KEY_BYTES) {
      throw new RangeError(`scoring_fields[${index}].key must match ${FIELD_KEY_RE} and fit in ASCII`);
    }
    if (!Number.isInteger(field.weight_ppm) || field.weight_ppm <= 0 || field.weight_ppm > MAX_U32) {
      throw new RangeError(`scoring_fields[${index}].weight_ppm must be an integer 1..${MAX_U32}`);
    }
    if (seen.has(field.key)) {
      throw new RangeError(`duplicate scoring field key: ${field.key}`);
    }
    seen.add(field.key);
    sum += field.weight_ppm;
    return {
      key: field.key,
      weightPpm: field.weight_ppm,
    };
  });
  if (sum !== COMPOSITE_WEIGHT_SCALE) {
    throw new RangeError(`sum(weight_ppm) must equal ${COMPOSITE_WEIGHT_SCALE}`);
  }
  return normalized;
}

function compareId(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "ascii"), Buffer.from(right, "ascii"));
}

function normalizeParticipants(
  participants: CompositeRankDescParticipant[],
  scoringFields: NormalizedFieldSpec[]
): NormalizedParticipant[] {
  if (!Array.isArray(participants) || participants.length === 0) {
    throw new RangeError("participants must be a non-empty array");
  }
  const fieldKeys = scoringFields.map((field) => field.key);
  const fieldSet = new Set(fieldKeys);
  const seenIds = new Set<string>();
  const seenOrders = new Set<number>();
  const normalized = participants.map((participant, index) => {
    assertObject(participant, `participants[${index}]`);
    const id = validateOutcomeId(participant.id, `participants[${index}].id`);
    if (seenIds.has(id)) {
      throw new RangeError(`duplicate participant id: ${id}`);
    }
    seenIds.add(id);
    const order = validateOrder(participant.order, `participants[${index}].order`);
    if (seenOrders.has(order)) {
      throw new RangeError(`participant order must be unique, duplicate: ${order}`);
    }
    seenOrders.add(order);
    assertObject(participant.fields, `participants[${index}].fields`);
    const participantFieldKeys = Object.keys(participant.fields);
    if (participantFieldKeys.length !== fieldKeys.length) {
      throw new RangeError(`participants[${index}].fields must match scoring_fields exactly`);
    }
    for (const field of participantFieldKeys) {
      if (!fieldSet.has(field)) {
        throw new RangeError(`participants[${index}].fields contains unsupported field: ${field}`);
      }
    }
    return {
      id,
      order,
      fieldValues: fieldKeys.map((field) =>
        parseSignedI64(
          participant.fields[field],
          `participants[${index}].fields.${field}`
        )
      ),
    };
  });
  normalized.sort((left, right) => compareId(left.id, right.id));
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].id === normalized[index].id) {
      throw new RangeError(`duplicate participant id: ${normalized[index].id}`);
    }
  }
  return normalized;
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
    throw new Error("Invalid composite_rank_desc artifact length");
  }
  const out = buf.subarray(offset.value, offset.value + len);
  offset.value += len;
  return out;
}

function normalizationModeCode(mode: CompositeNormalizationMode): number {
  switch (mode) {
    case "none":
      return 0;
    case "min_max":
      return 1;
    default:
      throw new Error(`Unsupported normalization_mode: ${String(mode)}`);
  }
}

function normalizationModeFromCode(code: number): CompositeNormalizationMode {
  switch (code) {
    case 0:
      return "none";
    case 1:
      return "min_max";
    default:
      throw new Error(`Unsupported composite normalization mode: ${code}`);
  }
}

function participantBytesPerEntry(fieldCount: number): number {
  return 1 + MAX_COMPOSITE_PARTICIPANT_ID_BYTES + 2 + fieldCount * 8;
}

export function canonicalCompositeParticipantJsonLine(
  participant: CompositeRankDescParticipant,
  scoringFields: Array<{ key: string }>
): string {
  const fieldPairs = scoringFields.map((field) => {
    const rawValue = participant.fields[field.key];
    const value = parseSignedI64(rawValue, `participant.fields.${field.key}`).toString();
    return `${JSON.stringify(field.key)}:${JSON.stringify(value)}`;
  });
  return `{"id":${JSON.stringify(participant.id)},"order":${participant.order},"fields":{${fieldPairs.join(",")}}}\n`;
}

export function buildCompositeRankDescArtifact(config: CompositeRankDescConfig): Buffer {
  if (config.formula !== "composite_rank_desc") {
    throw new RangeError("formula must be composite_rank_desc");
  }
  if ((config.scoring_version ?? COMPOSITE_SCORING_VERSION) !== COMPOSITE_SCORING_VERSION) {
    throw new RangeError(`scoring_version must be ${COMPOSITE_SCORING_VERSION}`);
  }
  const scoringFields = validateFieldSpecs(config.scoring_fields);
  const participants = normalizeParticipants(config.participants, scoringFields);
  const inputLamports = parseLamports(config.input_lamports, "input_lamports");
  const payoutLamports =
    config.payout_lamports === undefined
      ? 3n
      : parseLamports(config.payout_lamports, "payout_lamports");
  const winnersCount = config.winners_count ?? 1;
  if (!Number.isInteger(winnersCount) || winnersCount <= 0 || winnersCount > participants.length || winnersCount > MAX_WINNERS) {
    throw new RangeError(`winners_count must be an integer 1..${Math.min(participants.length, MAX_WINNERS)}`);
  }
  const expectedLength =
    HEADER_BYTES +
    scoringFields.length * FIELD_SPEC_BYTES +
    participants.length * participantBytesPerEntry(scoringFields.length);
  if (expectedLength > MAX_COMPOSITE_ARTIFACT_BYTES) {
    throw new RangeError(`composite_rank_desc artifact is ${expectedLength} bytes; exceeds ${MAX_COMPOSITE_ARTIFACT_BYTES}`);
  }

  const parts: Buffer[] = [
    Buffer.from(MAGIC, "ascii"),
    u16le(FORMAT_VERSION_COMPOSITE_RANK_DESC),
    u64le(inputLamports),
    u64le(inputLamports),
    u16le(winnersCount),
    Buffer.from([FORMULA_CODE_COMPOSITE_RANK_DESC]),
    Buffer.from([normalizationModeCode(config.normalization_mode)]),
    Buffer.from([scoringFields.length]),
    Buffer.from([0]),
    u32le(COMPOSITE_WEIGHT_SCALE),
    u32le(COMPOSITE_NORMALIZATION_SCALE),
    u16le(participants.length),
    u64le(payoutLamports),
  ];

  for (const field of scoringFields) {
    const keyBytes = Buffer.from(field.key, "ascii");
    const padded = Buffer.alloc(MAX_COMPOSITE_FIELD_KEY_BYTES, 0);
    keyBytes.copy(padded);
    parts.push(Buffer.from([keyBytes.length]));
    parts.push(padded);
    parts.push(u32le(field.weightPpm));
  }

  for (const participant of participants) {
    const idBytes = Buffer.from(participant.id, "ascii");
    const padded = Buffer.alloc(MAX_COMPOSITE_PARTICIPANT_ID_BYTES, 0);
    idBytes.copy(padded);
    parts.push(Buffer.from([idBytes.length]));
    parts.push(padded);
    parts.push(u16le(participant.order));
    for (const value of participant.fieldValues) {
      parts.push(i64le(value));
    }
  }

  return Buffer.concat(parts);
}

export function parseCompositeRankDescArtifact(blob: Buffer): ParsedCompositeRankDescArtifact {
  if (blob.length < HEADER_BYTES || blob.length > MAX_COMPOSITE_ARTIFACT_BYTES) {
    throw new Error("Invalid composite_rank_desc artifact length");
  }
  if (blob.subarray(0, 4).toString("ascii") !== MAGIC) {
    throw new Error("Invalid artifact magic");
  }
  const offset = { value: 4 };
  const formatVersion = readU16LE(blob, offset);
  if (formatVersion !== FORMAT_VERSION_COMPOSITE_RANK_DESC) {
    throw new Error("Unsupported composite_rank_desc artifact format version");
  }
  const minInputLamports = readU64LE(blob, offset);
  const maxInputLamports = readU64LE(blob, offset);
  if (minInputLamports > maxInputLamports) {
    throw new Error("Composite artifact bounds are invalid");
  }
  const winnersCount = readU16LE(blob, offset);
  const formulaCode = readU8(blob, offset);
  if (formulaCode !== FORMULA_CODE_COMPOSITE_RANK_DESC) {
    throw new Error("Invalid composite_rank_desc formula code");
  }
  const normalizationMode = normalizationModeFromCode(readU8(blob, offset));
  const fieldCount = readU8(blob, offset);
  if (fieldCount < 1 || fieldCount > MAX_COMPOSITE_FIELDS) {
    throw new Error(`Composite field_count must be 1..${MAX_COMPOSITE_FIELDS}`);
  }
  if (readU8(blob, offset) !== 0) {
    throw new Error("Reserved composite header byte must be zero");
  }
  const weightScale = readU32LE(blob, offset);
  const normalizationScale = readU32LE(blob, offset);
  const participantCount = readU16LE(blob, offset);
  const payoutLamports = readU64LE(blob, offset);
  if (weightScale !== COMPOSITE_WEIGHT_SCALE) {
    throw new Error(`Unsupported composite weight_scale: ${weightScale}`);
  }
  if (normalizationScale !== COMPOSITE_NORMALIZATION_SCALE) {
    throw new Error(`Unsupported composite normalization_scale: ${normalizationScale}`);
  }
  if (participantCount < 1) {
    throw new Error("Composite participant_count must be > 0");
  }
  if (winnersCount < 1 || winnersCount > participantCount || winnersCount > MAX_WINNERS) {
    throw new Error("Invalid winners_count");
  }
  const expectedLength =
    HEADER_BYTES +
    fieldCount * FIELD_SPEC_BYTES +
    participantCount * participantBytesPerEntry(fieldCount);
  if (expectedLength !== blob.length) {
    throw new Error("Composite artifact byte size does not match header counts");
  }

  const scoringFields: Array<{ key: string; weightPpm: number }> = [];
  const seenFieldKeys = new Set<string>();
  let weightSum = 0;
  for (let index = 0; index < fieldCount; index += 1) {
    const keyLen = readU8(blob, offset);
    if (keyLen < 1 || keyLen > MAX_COMPOSITE_FIELD_KEY_BYTES) {
      throw new Error("Invalid composite field key length");
    }
    const keyBuffer = readBytes(blob, offset, MAX_COMPOSITE_FIELD_KEY_BYTES);
    const keyBytes = keyBuffer.subarray(0, keyLen);
    if (!keyBuffer.subarray(keyLen).equals(Buffer.alloc(MAX_COMPOSITE_FIELD_KEY_BYTES - keyLen, 0))) {
      throw new Error("Composite field key padding must be zero");
    }
    const key = keyBytes.toString("ascii");
    if (!FIELD_KEY_RE.test(key)) {
      throw new Error(`Invalid composite field key: ${key}`);
    }
    if (seenFieldKeys.has(key)) {
      throw new Error(`Duplicate composite field key: ${key}`);
    }
    seenFieldKeys.add(key);
    const weightPpm = readU32LE(blob, offset);
    if (weightPpm <= 0) {
      throw new Error("Composite field weight must be positive");
    }
    weightSum += weightPpm;
    scoringFields.push({ key, weightPpm });
  }
  if (weightSum !== COMPOSITE_WEIGHT_SCALE) {
    throw new Error(`sum(weight_ppm) must equal ${COMPOSITE_WEIGHT_SCALE}`);
  }

  const participants: ParsedCompositeRankDescArtifact["participants"] = [];
  const seenOrders = new Set<number>();
  let previousId: Buffer | null = null;
  for (let index = 0; index < participantCount; index += 1) {
    const idLen = readU8(blob, offset);
    if (idLen < 1 || idLen > MAX_COMPOSITE_PARTICIPANT_ID_BYTES) {
      throw new Error("Invalid composite participant id length");
    }
    const idBuffer = readBytes(blob, offset, MAX_COMPOSITE_PARTICIPANT_ID_BYTES);
    const canonicalId = idBuffer.subarray(0, idLen);
    if (!canonicalId.every((byte) => byte >= 32 && byte <= 126)) {
      throw new Error("Composite participant id must be printable ASCII");
    }
    if (!idBuffer.subarray(idLen).equals(Buffer.alloc(MAX_COMPOSITE_PARTICIPANT_ID_BYTES - idLen, 0))) {
      throw new Error("Composite participant id padding must be zero");
    }
    if (previousId && Buffer.compare(previousId, canonicalId) >= 0) {
      throw new Error("Composite participant ids must be strictly sorted");
    }
    previousId = Buffer.from(canonicalId);
    const order = readU16LE(blob, offset);
    if (seenOrders.has(order)) {
      throw new Error("Composite participant order must be unique");
    }
    seenOrders.add(order);
    const fieldValues: bigint[] = [];
    for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex += 1) {
      fieldValues.push(readI64LE(blob, offset));
    }
    participants.push({
      id: canonicalId.toString("ascii"),
      order,
      fieldValues,
    });
  }

  return {
    formatVersion,
    formula: "composite_rank_desc",
    scoringVersion: COMPOSITE_SCORING_VERSION,
    normalizationMode,
    minInputLamports,
    maxInputLamports,
    winnersCount,
    participantCount,
    payoutLamports,
    weightScale,
    normalizationScale,
    scoringFields,
    participants,
  };
}

function rangeForField(participants: ParsedCompositeRankDescArtifact["participants"], fieldIndex: number): { min: bigint; max: bigint } {
  let min = participants[0].fieldValues[fieldIndex];
  let max = participants[0].fieldValues[fieldIndex];
  for (const participant of participants) {
    const value = participant.fieldValues[fieldIndex];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

function effectiveValue(
  mode: CompositeNormalizationMode,
  rawValue: bigint,
  min: bigint,
  max: bigint
): { value: bigint; zeroOrderingPower: boolean } {
  if (mode === "none") {
    return { value: rawValue, zeroOrderingPower: false };
  }
  if (max === min) {
    return { value: 0n, zeroOrderingPower: true };
  }
  return {
    value: ((rawValue - min) * BigInt(COMPOSITE_NORMALIZATION_SCALE)) / (max - min),
    zeroOrderingPower: false,
  };
}

export function replayCompositeRankDescArtifact(blob: Buffer): CompositeRankDescReplayResult {
  const parsed = parseCompositeRankDescArtifact(blob);
  const ranges = parsed.scoringFields.map((_, index) => rangeForField(parsed.participants, index));
  const participantReplay: CompositeRankDescReplayEntry[] = parsed.participants.map((participant) => {
    let compositeScore = 0n;
    const fieldReplay = parsed.scoringFields.map((field, index) => {
      const rawValue = participant.fieldValues[index];
      const range = ranges[index];
      const effective = effectiveValue(parsed.normalizationMode, rawValue, range.min, range.max);
      const contribution = effective.value * BigInt(field.weightPpm);
      compositeScore += contribution;
      return {
        field: field.key,
        raw_value: rawValue.toString(),
        min_value: range.min.toString(),
        max_value: range.max.toString(),
        effective_value: effective.value.toString(),
        contribution: contribution.toString(),
        zero_ordering_power: effective.zeroOrderingPower,
      };
    });
    return {
      id: participant.id,
      order: participant.order,
      composite_score: compositeScore.toString(),
      field_replay: fieldReplay,
    };
  });
  const ordered = [...participantReplay].sort((left, right) => {
    const scoreDiff = BigInt(right.composite_score) - BigInt(left.composite_score);
    if (scoreDiff !== 0n) {
      return scoreDiff > 0n ? 1 : -1;
    }
    return left.order - right.order;
  });
  return {
    ordered_ids: ordered.map((entry) => entry.id),
    winner_ids: ordered.slice(0, parsed.winnersCount).map((entry) => entry.id),
    winners_count: parsed.winnersCount,
    total_output_lamports: (parsed.payoutLamports * BigInt(parsed.winnersCount)).toString(),
    participant_replay: participantReplay,
  };
}
