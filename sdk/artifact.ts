import { PublicKey } from "@solana/web3.js";

import type {
  AirdropConfig,
  ArtifactConfig,
  FormulaDrawConfig,
  LamportsValue,
  LootConfig,
  RaffleConfig,
  ResolutionFormula,
  SignedIntegerValue,
  W3O1Config,
  W3O1Effect,
  W3O1Outcome,
} from "./types.js";

const MAGIC = "W3O1";
const FORMAT_VERSION_V1 = 1;
const FORMAT_VERSION_V2 = 2;
const FORMAT_VERSION_V3 = 3;
const MAX_OUTCOME_ID_BYTES = 64;
const MAX_WINNERS = 32;
const EFFECT_TYPE_TRANSFER_SOL = 1;
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;
const MAX_U64 = (1n << 64n) - 1n;
const MIN_I64 = -(1n << 63n);
const MAX_I64 = (1n << 63n) - 1n;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
const PRINTABLE_ASCII_RE = /^[\x20-\x7E]+$/;
const DEFAULT_PAYOUT_LAMPORTS = 3n;
const FORMULA_CODES: Record<ResolutionFormula, number> = {
  weighted_random: 1,
  rank_desc: 2,
  rank_asc: 3,
  first_n: 4,
  closest_to: 5,
};

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
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
    const parsed = BigInt(value);
    if (parsed > MAX_U64) {
      throw new RangeError(`${label} must fit in u64`);
    }
    return parsed;
  }
  throw new TypeError(`${label} must be a bigint or safe integer number`);
}

function parseOptionalLamports(value: LamportsValue | undefined, label: string): bigint {
  return value === undefined ? DEFAULT_PAYOUT_LAMPORTS : parseLamports(value, label);
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

function validateWeight(value: unknown, label: string): number {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${label} must be an integer`);
  }
  if ((value as number) <= 0 || (value as number) > MAX_U32) {
    throw new RangeError(`${label} must be > 0 and <= 0xffffffff`);
  }
  return value as number;
}

function validateOutcomeCount(count: number, label: string): void {
  if (count === 0) {
    throw new RangeError(`${label} must not be empty`);
  }
  if (count > MAX_U16) {
    throw new RangeError(`${label} exceeds u16 limit`);
  }
}

function validateWinnersCount(value: unknown, outcomeCount: number): number {
  const winnersCount = value === undefined ? 1 : value;
  if (!Number.isInteger(winnersCount)) {
    throw new TypeError("winners_count must be an integer");
  }
  if ((winnersCount as number) <= 0) {
    throw new RangeError("winners_count must be > 0");
  }
  if ((winnersCount as number) > outcomeCount) {
    throw new RangeError("winners_count must be <= outcome count");
  }
  if ((winnersCount as number) > MAX_WINNERS) {
    throw new RangeError(`winners_count must be <= ${MAX_WINNERS}`);
  }
  return winnersCount as number;
}

function validateAddress(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  if (value.length < 32 || value.length > 44 || !BASE58_RE.test(value)) {
    throw new RangeError(`${label} must be a base58 public key string`);
  }
  try {
    new PublicKey(value);
  } catch (error) {
    throw new RangeError(
      `${label} must be a valid Solana public key: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
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

function validateOrder(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_U16) {
    throw new RangeError(`${label} must be an integer between 0 and ${MAX_U16}`);
  }
  return value;
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

function fixedAscii(text: string, len: number): Buffer {
  const bytes = Buffer.from(text, "ascii");
  if (bytes.length > len) {
    throw new RangeError(`ASCII payload too large: ${text}`);
  }
  const out = Buffer.alloc(len, 0);
  bytes.copy(out, 0);
  return out;
}

function normalizeEntries(
  idsAndWeights: Array<{ id: string; weight: number; payoutLamports: bigint }>,
  inputLamports: bigint,
  winnersCount = 1
): W3O1Config {
  validateOutcomeCount(idsAndWeights.length, "outcomes");
  validateWinnersCount(winnersCount, idsAndWeights.length);
  const sorted = [...idsAndWeights].sort((left, right) =>
    Buffer.compare(Buffer.from(left.id, "ascii"), Buffer.from(right.id, "ascii"))
  );

  const outcomes: W3O1Outcome[] = [];
  const effects: W3O1Effect[] = [];
  let previousId: string | null = null;
  for (const entry of sorted) {
    if (previousId === entry.id) {
      throw new Error(`duplicate outcome id: ${entry.id}`);
    }
    previousId = entry.id;
    const effectIndex = effects.length;
    effects.push({ type: "transfer_sol", amount_lamports: entry.payoutLamports });
    outcomes.push({
      id: entry.id,
      weight: entry.weight,
      first_effect_index: effectIndex,
      effect_count: 1,
    });
  }

  if (effects.length > MAX_U16) {
    throw new RangeError("effects exceeds u16 limit");
  }

  return {
    format_version: winnersCount > 1 ? FORMAT_VERSION_V2 : FORMAT_VERSION_V1,
    winners_count: winnersCount,
    min_input_lamports: inputLamports,
    max_input_lamports: inputLamports,
    outcomes,
    effects,
  };
}

function normalizeFormulaEntries(
  entries: Array<{
    id: string;
    weight: number;
    score: bigint;
    order: number;
    payoutLamports: bigint;
  }>,
  inputLamports: bigint,
  winnersCount: number,
  formula: ResolutionFormula,
  targetScore: bigint
): W3O1Config {
  validateOutcomeCount(entries.length, "participants");
  validateWinnersCount(winnersCount, entries.length);
  const sorted = [...entries].sort((left, right) =>
    Buffer.compare(Buffer.from(left.id, "ascii"), Buffer.from(right.id, "ascii"))
  );

  const outcomes: W3O1Outcome[] = [];
  const effects: W3O1Effect[] = [];
  let previousId: string | null = null;
  for (const entry of sorted) {
    if (previousId === entry.id) {
      throw new Error(`duplicate outcome id: ${entry.id}`);
    }
    previousId = entry.id;
    const effectIndex = effects.length;
    effects.push({ type: "transfer_sol", amount_lamports: entry.payoutLamports });
    outcomes.push({
      id: entry.id,
      weight: entry.weight,
      score: entry.score,
      order: entry.order,
      first_effect_index: effectIndex,
      effect_count: 1,
    });
  }

  if (effects.length > MAX_U16) {
    throw new RangeError("effects exceeds u16 limit");
  }

  return {
    format_version: FORMAT_VERSION_V3,
    winners_count: winnersCount,
    min_input_lamports: inputLamports,
    max_input_lamports: inputLamports,
    resolution_formula: formula,
    target_score: targetScore,
    outcomes,
    effects,
  };
}

function buildRaffleConfig(config: RaffleConfig): W3O1Config {
  assertArray(config.participants, "participants");
  validateOutcomeCount(config.participants.length, "participants");
  const inputLamports = parseLamports(config.input_lamports, "input_lamports");
  const payoutLamports = parseOptionalLamports(config.payout_lamports, "payout_lamports");
  const entries = config.participants.map((raw, index) => {
    assertObject(raw, `participants[${index}]`);
    return {
      id: validateAddress(raw.address, `participants[${index}].address`),
      weight: validateWeight(raw.weight, `participants[${index}].weight`),
      payoutLamports,
    };
  });
  return normalizeEntries(
    entries,
    inputLamports,
    validateWinnersCount(config.winners_count, entries.length)
  );
}

function buildLootConfig(config: LootConfig): W3O1Config {
  assertArray(config.outcomes, "outcomes");
  validateOutcomeCount(config.outcomes.length, "outcomes");
  const inputLamports = parseLamports(config.input_lamports, "input_lamports");
  const entries = config.outcomes.map((raw, index) => {
    assertObject(raw, `outcomes[${index}]`);
    return {
      id: validateOutcomeId(raw.id, `outcomes[${index}].id`),
      weight: validateWeight(raw.weight, `outcomes[${index}].weight`),
      payoutLamports: parseLamports(
        raw.payout_lamports as LamportsValue | undefined,
        `outcomes[${index}].payout_lamports`
      ),
    };
  });
  return normalizeEntries(entries, inputLamports);
}

function buildAirdropConfig(config: AirdropConfig): W3O1Config {
  if (!Number.isInteger(config.slots)) {
    throw new TypeError("slots must be an integer");
  }
  if (config.slots <= 0) {
    throw new RangeError("slots must be > 0");
  }
  assertArray(config.eligible, "eligible");
  validateOutcomeCount(config.eligible.length, "eligible");
  const inputLamports = parseLamports(config.input_lamports, "input_lamports");
  const payoutLamports = parseOptionalLamports(config.payout_lamports, "payout_lamports");
  const entries = config.eligible.map((raw, index) => {
    assertObject(raw, `eligible[${index}]`);
    return {
      id: validateAddress(raw.address, `eligible[${index}].address`),
      weight: validateWeight(raw.weight, `eligible[${index}].weight`),
      payoutLamports,
    };
  });
  return normalizeEntries(
    entries,
    inputLamports,
    validateWinnersCount(config.winners_count, entries.length)
  );
}

function buildFormulaDrawConfig(config: FormulaDrawConfig): W3O1Config {
  assertArray(config.participants, "participants");
  validateOutcomeCount(config.participants.length, "participants");
  const formula = validateFormula(config.formula);
  const inputLamports = parseLamports(config.input_lamports, "input_lamports");
  const payoutLamports = parseOptionalLamports(config.payout_lamports, "payout_lamports");
  const winnersCount = validateWinnersCount(config.winners_count, config.participants.length);
  const targetScore =
    formula === "closest_to"
      ? parseSignedInteger(config.target, "target")
      : config.target === undefined
      ? 0n
      : parseSignedInteger(config.target, "target");

  const entries = config.participants.map((raw, index) => {
    assertObject(raw, `participants[${index}]`);
    const id = validateOutcomeId(raw.id, `participants[${index}].id`);
    const order = validateOrder(index, `participants[${index}].order`);

    if (formula === "weighted_random") {
      if (raw.score !== undefined) {
        throw new TypeError(`participants[${index}].score is not supported for weighted_random`);
      }
      return {
        id,
        weight:
          raw.weight === undefined
            ? 1
            : validateWeight(raw.weight, `participants[${index}].weight`),
        score: 0n,
        order,
        payoutLamports,
      };
    }

    if (raw.weight !== undefined) {
      throw new TypeError(`participants[${index}].weight is only supported for weighted_random`);
    }

    if (formula === "first_n") {
      if (raw.score !== undefined) {
        throw new TypeError(`participants[${index}].score is not supported for first_n`);
      }
      return {
        id,
        weight: 1,
        score: 0n,
        order,
        payoutLamports,
      };
    }

    return {
      id,
      weight: 1,
      score: parseSignedInteger(raw.score, `participants[${index}].score`),
      order,
      payoutLamports,
    };
  });

  return normalizeFormulaEntries(
    entries,
    inputLamports,
    winnersCount,
    formula,
    targetScore
  );
}

function toW3O1Config(config: ArtifactConfig): W3O1Config {
  assertObject(config, "config");
  if (config.type === "raffle") return buildRaffleConfig(config);
  if (config.type === "loot") return buildLootConfig(config);
  if (config.type === "airdrop") return buildAirdropConfig(config);
  if (config.type === "formula_draw") return buildFormulaDrawConfig(config);
  throw new TypeError(
    `unknown artifact config type: ${String((config as Record<string, unknown>).type)}`
  );
}

function serializeW3O1(config: W3O1Config): Buffer {
  validateOutcomeCount(config.outcomes.length, "outcomes");
  validateOutcomeCount(config.effects.length, "effects");
  validateWinnersCount(config.winners_count, config.outcomes.length);
  if (
    config.format_version !== FORMAT_VERSION_V1 &&
    config.format_version !== FORMAT_VERSION_V2 &&
    config.format_version !== FORMAT_VERSION_V3
  ) {
    throw new RangeError("format_version must be 1, 2, or 3");
  }
  if (config.format_version === FORMAT_VERSION_V1 && config.winners_count > 1) {
    throw new RangeError("winners_count > 1 requires W3O1 format version 2 or 3");
  }
  if (config.format_version === FORMAT_VERSION_V3 && !config.resolution_formula) {
    throw new RangeError("format_version 3 requires resolution_formula");
  }

  const parts: Buffer[] = [];
  parts.push(Buffer.from(MAGIC, "ascii"));
  parts.push(u16le(config.format_version));
  parts.push(u64le(config.min_input_lamports));
  parts.push(u64le(config.max_input_lamports));
  parts.push(u16le(config.outcomes.length));
  parts.push(u16le(config.effects.length));

  if (config.format_version === FORMAT_VERSION_V1) {
    parts.push(Buffer.alloc(8, 0));
  } else if (config.format_version === FORMAT_VERSION_V2) {
    parts.push(u16le(config.winners_count));
    parts.push(Buffer.alloc(6, 0));
  } else {
    parts.push(u16le(config.winners_count));
    parts.push(Buffer.from([FORMULA_CODES[config.resolution_formula!]]));
    parts.push(Buffer.alloc(5, 0));
    parts.push(i64le(config.target_score ?? 0n));
  }

  for (const outcome of config.outcomes) {
    const outcomeIdBytes = Buffer.from(outcome.id, "ascii");
    parts.push(Buffer.from([outcomeIdBytes.length]));
    parts.push(fixedAscii(outcome.id, MAX_OUTCOME_ID_BYTES));
    parts.push(u32le(outcome.weight));
    if (config.format_version === FORMAT_VERSION_V3) {
      parts.push(i64le(outcome.score ?? 0n));
      parts.push(u16le(validateOrder(outcome.order ?? 0, `outcome(${outcome.id}).order`)));
    }
    parts.push(u16le(outcome.first_effect_index));
    parts.push(u16le(outcome.effect_count));
  }

  for (const effect of config.effects) {
    if (effect.type !== "transfer_sol") {
      throw new TypeError(`unsupported effect type: ${String(effect.type)}`);
    }
    parts.push(Buffer.from([EFFECT_TYPE_TRANSFER_SOL]));
    parts.push(Buffer.alloc(7, 0));
    parts.push(u64le(effect.amount_lamports));
  }

  return Buffer.concat(parts);
}

export function buildArtifact(config: ArtifactConfig): Buffer {
  return serializeW3O1(toW3O1Config(config));
}
