import fs from "fs";
import path from "path";

const TASK_ID = "PROTOCOL-INFRA-001";
const OUTPUT_PATH = path.resolve("artifacts/protocol_infra_001_composite_rank_desc_prototype.json");
const WEIGHT_SCALE = 1_000_000n;
const NORMALIZATION_SCALE = 1_000_000n;
const MAX_FIELDS = 16;
const MAX_FIELD_KEY_BYTES = 32;
const MIN_I64 = -(1n << 63n);
const MAX_I64 = (1n << 63n) - 1n;
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;

type NormalizationMode = "none" | "min_max";

type CompositeFieldSpec = {
  key: string;
  weight_ppm: bigint;
};

type CompositeParticipant = {
  id: string;
  order: number;
  fields: Record<string, bigint>;
};

type CompositeRankDescPrototype = {
  formula: "composite_rank_desc";
  scoring_version: "vre_composite_rank_v1";
  normalization_mode: NormalizationMode;
  weight_scale: bigint;
  normalization_scale: bigint;
  scoring_fields: CompositeFieldSpec[];
  participants: CompositeParticipant[];
  winners_count: number;
};

type FieldReplay = {
  field: string;
  raw_value: string;
  min_value: string;
  max_value: string;
  normalized_value: string;
  contribution: string;
  zero_ordering_power: boolean;
};

type ParticipantReplay = {
  id: string;
  order: number;
  composite_score: string;
  field_replay: FieldReplay[];
};

type PrototypeCase = {
  case_id: string;
  summary: string;
  config: {
    formula: "composite_rank_desc";
    scoring_version: "vre_composite_rank_v1";
    normalization_mode: NormalizationMode;
    weight_scale: string;
    normalization_scale: string;
    scoring_fields: Array<{ key: string; weight_ppm: string }>;
    winners_count: number;
    participants: Array<{
      id: string;
      order: number;
      fields: Record<string, string>;
    }>;
  };
  participant_replay: ParticipantReplay[];
  ordered_ids: string[];
  winner_ids: string[];
};

function asI64(value: bigint, label: string): bigint {
  if (value < MIN_I64 || value > MAX_I64) {
    throw new RangeError(`${label} must fit in i64`);
  }
  return value;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(value, (_, candidate) => (typeof candidate === "bigint" ? candidate.toString() : candidate), 2)}\n`
  );
}

function validateFieldSpecs(scoringFields: CompositeFieldSpec[]): void {
  if (!Array.isArray(scoringFields) || scoringFields.length === 0) {
    throw new RangeError("scoring_fields must be a non-empty array");
  }
  if (scoringFields.length > MAX_FIELDS) {
    throw new RangeError(`scoring_fields must contain <= ${MAX_FIELDS} fields`);
  }
  const seen = new Set<string>();
  let weightSum = 0n;
  for (const [index, field] of scoringFields.entries()) {
    if (!FIELD_KEY_RE.test(field.key) || Buffer.byteLength(field.key, "ascii") > MAX_FIELD_KEY_BYTES) {
      throw new RangeError(`scoring_fields[${index}].key must match ${FIELD_KEY_RE} and fit in ASCII`);
    }
    if (seen.has(field.key)) {
      throw new RangeError(`duplicate scoring field key: ${field.key}`);
    }
    seen.add(field.key);
    if (field.weight_ppm <= 0n || field.weight_ppm > WEIGHT_SCALE) {
      throw new RangeError(`scoring_fields[${index}].weight_ppm must be > 0 and <= ${WEIGHT_SCALE}`);
    }
    weightSum += field.weight_ppm;
  }
  if (weightSum !== WEIGHT_SCALE) {
    throw new RangeError(`sum(weight_ppm) must equal ${WEIGHT_SCALE}`);
  }
}

function validateParticipants(config: CompositeRankDescPrototype): void {
  const requiredFields = new Set(config.scoring_fields.map((field) => field.key));
  const seenIds = new Set<string>();
  const seenOrders = new Set<number>();
  for (const [index, participant] of config.participants.entries()) {
    if (participant.id.length === 0) {
      throw new RangeError(`participants[${index}].id must not be empty`);
    }
    if (seenIds.has(participant.id)) {
      throw new RangeError(`duplicate participant id: ${participant.id}`);
    }
    seenIds.add(participant.id);
    if (!Number.isInteger(participant.order) || participant.order < 0 || participant.order > 0xffff) {
      throw new RangeError(`participants[${index}].order must be a u16-compatible integer`);
    }
    if (seenOrders.has(participant.order)) {
      throw new RangeError(`participant order must be unique, duplicate: ${participant.order}`);
    }
    seenOrders.add(participant.order);
    const keys = Object.keys(participant.fields);
    if (keys.length !== requiredFields.size) {
      throw new RangeError(`participants[${index}].fields must match scoring_fields exactly`);
    }
    for (const field of keys) {
      if (!requiredFields.has(field)) {
        throw new RangeError(`participants[${index}].fields contains unknown field: ${field}`);
      }
      asI64(participant.fields[field], `participants[${index}].fields.${field}`);
    }
  }
  if (config.winners_count <= 0 || config.winners_count > config.participants.length) {
    throw new RangeError("winners_count must be > 0 and <= participant count");
  }
}

function minMaxForField(participants: CompositeParticipant[], field: string): { min: bigint; max: bigint } {
  let min = participants[0].fields[field];
  let max = participants[0].fields[field];
  for (const participant of participants) {
    const value = participant.fields[field];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

function normalizedValue(
  mode: NormalizationMode,
  rawValue: bigint,
  min: bigint,
  max: bigint
): { normalized: bigint; zeroOrderingPower: boolean } {
  if (mode === "none") {
    return { normalized: rawValue, zeroOrderingPower: false };
  }
  if (max === min) {
    return { normalized: 0n, zeroOrderingPower: true };
  }
  return {
    normalized: ((rawValue - min) * NORMALIZATION_SCALE) / (max - min),
    zeroOrderingPower: false,
  };
}

function replayCase(config: CompositeRankDescPrototype): PrototypeCase {
  validateFieldSpecs(config.scoring_fields);
  validateParticipants(config);
  const fieldRanges = new Map<string, { min: bigint; max: bigint }>();
  for (const field of config.scoring_fields) {
    fieldRanges.set(field.key, minMaxForField(config.participants, field.key));
  }

  const replay = config.participants.map((participant) => {
    const fieldReplay: FieldReplay[] = [];
    let compositeScore = 0n;
    for (const field of config.scoring_fields) {
      const range = fieldRanges.get(field.key)!;
      const rawValue = participant.fields[field.key];
      const normalized = normalizedValue(config.normalization_mode, rawValue, range.min, range.max);
      const contribution = normalized.normalized * field.weight_ppm;
      compositeScore += contribution;
      fieldReplay.push({
        field: field.key,
        raw_value: rawValue.toString(),
        min_value: range.min.toString(),
        max_value: range.max.toString(),
        normalized_value: normalized.normalized.toString(),
        contribution: contribution.toString(),
        zero_ordering_power: normalized.zeroOrderingPower,
      });
    }
    return {
      id: participant.id,
      order: participant.order,
      composite_score: compositeScore.toString(),
      field_replay: fieldReplay,
    };
  });

  const ordered = [...replay].sort((left, right) => {
    const scoreDiff = BigInt(right.composite_score) - BigInt(left.composite_score);
    if (scoreDiff !== 0n) {
      return scoreDiff > 0n ? 1 : -1;
    }
    return left.order - right.order;
  });

  return {
    case_id: "",
    summary: "",
    config: {
      formula: config.formula,
      scoring_version: config.scoring_version,
      normalization_mode: config.normalization_mode,
      weight_scale: config.weight_scale.toString(),
      normalization_scale: config.normalization_scale.toString(),
      scoring_fields: config.scoring_fields.map((field) => ({
        key: field.key,
        weight_ppm: field.weight_ppm.toString(),
      })),
      winners_count: config.winners_count,
      participants: config.participants.map((participant) => ({
        id: participant.id,
        order: participant.order,
        fields: Object.fromEntries(
          Object.entries(participant.fields).map(([field, value]) => [field, value.toString()])
        ),
      })),
    },
    participant_replay: replay,
    ordered_ids: ordered.map((entry) => entry.id),
    winner_ids: ordered.slice(0, config.winners_count).map((entry) => entry.id),
  };
}

function buildPrototypeCases(): PrototypeCase[] {
  const normalized = replayCase({
    formula: "composite_rank_desc",
    scoring_version: "vre_composite_rank_v1",
    normalization_mode: "min_max",
    weight_scale: WEIGHT_SCALE,
    normalization_scale: NORMALIZATION_SCALE,
    winners_count: 2,
    scoring_fields: [
      { key: "pnl", weight_ppm: 700_000n },
      { key: "volume", weight_ppm: 300_000n },
    ],
    participants: [
      { id: "desk_alpha", order: 0, fields: { pnl: 1_542_050n, volume: 8_300_000n } },
      { id: "desk_beta", order: 1, fields: { pnl: 1_230_000n, volume: 12_100_000n } },
      { id: "desk_gamma", order: 2, fields: { pnl: 1_800_000n, volume: 4_000_000n } },
    ],
  });
  normalized.case_id = "normalized_pnl_volume_desc";
  normalized.summary = "Deterministic min/max normalization over two integer fields.";

  const constantField = replayCase({
    formula: "composite_rank_desc",
    scoring_version: "vre_composite_rank_v1",
    normalization_mode: "min_max",
    weight_scale: WEIGHT_SCALE,
    normalization_scale: NORMALIZATION_SCALE,
    winners_count: 2,
    scoring_fields: [
      { key: "pnl", weight_ppm: 600_000n },
      { key: "volume", weight_ppm: 300_000n },
      { key: "tier", weight_ppm: 100_000n },
    ],
    participants: [
      { id: "wallet_a", order: 0, fields: { pnl: 900n, volume: 40_000n, tier: 7n } },
      { id: "wallet_b", order: 1, fields: { pnl: 850n, volume: 70_000n, tier: 7n } },
      { id: "wallet_c", order: 2, fields: { pnl: 930n, volume: 20_000n, tier: 7n } },
    ],
  });
  constantField.case_id = "max_equals_min_zero_power";
  constantField.summary = "Field tier has max == min and therefore contributes 0 ordering power.";

  const tieBreak = replayCase({
    formula: "composite_rank_desc",
    scoring_version: "vre_composite_rank_v1",
    normalization_mode: "none",
    weight_scale: WEIGHT_SCALE,
    normalization_scale: NORMALIZATION_SCALE,
    winners_count: 2,
    scoring_fields: [
      { key: "pnl", weight_ppm: 500_000n },
      { key: "volume", weight_ppm: 500_000n },
    ],
    participants: [
      { id: "trader_late", order: 5, fields: { pnl: 1_000n, volume: 0n } },
      { id: "trader_early", order: 1, fields: { pnl: 0n, volume: 1_000n } },
      { id: "trader_top", order: 0, fields: { pnl: 2_000n, volume: 100n } },
    ],
  });
  tieBreak.case_id = "stable_tie_break_order";
  tieBreak.summary = "Equal composite score resolves by order asc after score desc.";

  return [normalized, constantField, tieBreak];
}

function main(): void {
  const prototypeCases = buildPrototypeCases();
  const output = {
    task_id: TASK_ID,
    formula_boundary: "composite_rank_desc_only",
    status: "design_prototype_ready",
    canonical_scoring_model: {
      formula: "composite_rank_desc",
      scoring_version: "vre_composite_rank_v1",
      raw_field_type: "signed_i64",
      raw_field_json_encoding: "decimal_string",
      scoring_field_count_max: MAX_FIELDS,
      field_key_rules: {
        regex: FIELD_KEY_RE.source,
        max_ascii_bytes: MAX_FIELD_KEY_BYTES,
      },
      weight_encoding: {
        type: "u32_ppm",
        scale: WEIGHT_SCALE.toString(),
        per_field_range: ["1", WEIGHT_SCALE.toString()],
        sum_rule: `sum(weight_ppm) == ${WEIGHT_SCALE}`,
        negative_weights_allowed: false,
      },
      normalization: {
        modes: ["none", "min_max"],
        normalization_scale: NORMALIZATION_SCALE.toString(),
        max_equals_min_behavior: "field contributes normalized_value=0 and contribution=0",
        formula:
          "normalized_value = ((raw_value - min_value) * normalization_scale) / (max_value - min_value)",
        rounding: "integer division toward zero",
      },
      replay_sort: ["composite_score desc", "order asc"],
      accumulator_type: "i128",
    },
    artifact_schema_impact: {
      accepted_line_untouched: true,
      runtime_formula_addition_candidate_only: "composite_rank_desc",
      proposed_snapshot_entry_shape: {
        id: "string",
        order: "u16",
        fields: {
          "<field_key>": "decimal_string_i64",
        },
      },
      proposed_scoring_metadata_shape: {
        scoring_version: "vre_composite_rank_v1",
        normalization_mode: "none|min_max",
        weight_scale: WEIGHT_SCALE.toString(),
        normalization_scale: NORMALIZATION_SCALE.toString(),
        scoring_fields: [
          {
            key: "string",
            weight_ppm: "decimal_string_u32",
          },
        ],
      },
      replay_outputs: {
        canonical_ordering_inputs: ["raw participant fields", "scoring metadata", "participant order"],
        derived_debug_metadata: ["composite_score", "per-field normalized_value", "per-field contribution"],
      },
    },
    prototype_cases: prototypeCases,
  };
  writeJson(OUTPUT_PATH, output);
  console.log(JSON.stringify(output, null, 2));
}

main();
