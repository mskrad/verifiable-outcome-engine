import fs from "fs";
import path from "path";

import {
  buildCompositeRankDescArtifact,
  canonicalCompositeParticipantJsonLine,
  COMPOSITE_NORMALIZATION_SCALE,
  COMPOSITE_SCORING_VERSION,
  COMPOSITE_WEIGHT_SCALE,
  MAX_COMPOSITE_FIELDS,
  parseCompositeRankDescArtifact,
  replayCompositeRankDescArtifact,
} from "../sdk/index.js";
import type { CompositeRankDescConfig } from "../sdk/types.js";

const OUTPUT_PATH = path.resolve("artifacts/protocol_infra_001_composite_rank_desc_implementation.json");
const CASE_ARTIFACT_DIR = path.resolve("artifacts/protocol_infra_001_composite_rank_desc_cases");

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(value, (_, candidate) => (typeof candidate === "bigint" ? candidate.toString() : candidate), 2)}\n`
  );
}

function writeBinary(filePath: string, value: Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function validCases(): Array<{
  case_id: string;
  config: CompositeRankDescConfig;
  expected_winner_ids: string[];
}> {
  return [
    {
      case_id: "normalized_composite_ranking",
      expected_winner_ids: ["desk_gamma", "desk_alpha"],
      config: {
        formula: "composite_rank_desc",
        normalization_mode: "min_max",
        input_lamports: 10,
        payout_lamports: 3,
        winners_count: 2,
        scoring_fields: [
          { key: "pnl", weight_ppm: 700_000 },
          { key: "volume", weight_ppm: 300_000 },
        ],
        participants: [
          { id: "desk_alpha", order: 0, fields: { pnl: "1542050", volume: "8300000" } },
          { id: "desk_beta", order: 1, fields: { pnl: "1230000", volume: "12100000" } },
          { id: "desk_gamma", order: 2, fields: { pnl: "1800000", volume: "4000000" } },
        ],
      },
    },
    {
      case_id: "max_equals_min",
      expected_winner_ids: ["wallet_c", "wallet_a"],
      config: {
        formula: "composite_rank_desc",
        normalization_mode: "min_max",
        input_lamports: 10,
        payout_lamports: 3,
        winners_count: 2,
        scoring_fields: [
          { key: "pnl", weight_ppm: 600_000 },
          { key: "volume", weight_ppm: 300_000 },
          { key: "tier", weight_ppm: 100_000 },
        ],
        participants: [
          { id: "wallet_a", order: 0, fields: { pnl: "900", volume: "40000", tier: "7" } },
          { id: "wallet_b", order: 1, fields: { pnl: "850", volume: "70000", tier: "7" } },
          { id: "wallet_c", order: 2, fields: { pnl: "930", volume: "20000", tier: "7" } },
        ],
      },
    },
    {
      case_id: "stable_tie_break_by_order_asc",
      expected_winner_ids: ["trader_top", "trader_early"],
      config: {
        formula: "composite_rank_desc",
        normalization_mode: "none",
        input_lamports: 10,
        payout_lamports: 3,
        winners_count: 2,
        scoring_fields: [
          { key: "pnl", weight_ppm: 500_000 },
          { key: "volume", weight_ppm: 500_000 },
        ],
        participants: [
          { id: "trader_late", order: 5, fields: { pnl: "1000", volume: "0" } },
          { id: "trader_early", order: 1, fields: { pnl: "0", volume: "1000" } },
          { id: "trader_top", order: 0, fields: { pnl: "2000", volume: "100" } },
        ],
      },
    },
  ];
}

function invalidCases(): Array<{
  case_id: string;
  config: CompositeRankDescConfig;
  expected_error: string;
}> {
  return [
    {
      case_id: "invalid_weight_sum",
      expected_error: "sum(weight_ppm) must equal 1000000",
      config: {
        formula: "composite_rank_desc",
        normalization_mode: "min_max",
        input_lamports: 10,
        winners_count: 1,
        scoring_fields: [
          { key: "pnl", weight_ppm: 600_000 },
          { key: "volume", weight_ppm: 200_000 },
        ],
        participants: [
          { id: "wallet_a", order: 0, fields: { pnl: "10", volume: "20" } },
        ],
      },
    },
    {
      case_id: "invalid_field_key",
      expected_error: "scoring_fields[0].key must match",
      config: {
        formula: "composite_rank_desc",
        normalization_mode: "none",
        input_lamports: 10,
        winners_count: 1,
        scoring_fields: [
          { key: "PnL", weight_ppm: 1_000_000 },
        ],
        participants: [
          { id: "wallet_a", order: 0, fields: { PnL: "10" } },
        ],
      },
    },
    {
      case_id: "unsupported_field_count",
      expected_error: `scoring_fields must contain <= ${MAX_COMPOSITE_FIELDS} fields`,
      config: {
        formula: "composite_rank_desc",
        normalization_mode: "none",
        input_lamports: 10,
        winners_count: 1,
        scoring_fields: Array.from({ length: MAX_COMPOSITE_FIELDS + 1 }, (_, index) => ({
          key: `f${index}`.replace(/^f/, "field_"),
          weight_ppm: index === MAX_COMPOSITE_FIELDS ? 40_000 : 60_000,
        })),
        participants: [
          {
            id: "wallet_a",
            order: 0,
            fields: Object.fromEntries(
              Array.from({ length: MAX_COMPOSITE_FIELDS + 1 }, (_, index) => [`field_${index}`, "1"])
            ),
          },
        ],
      },
    },
  ];
}

function main(): void {
  const valid = validCases().map(({ case_id, config, expected_winner_ids }) => {
    const artifact = buildCompositeRankDescArtifact(config);
    const artifactPath = path.join(CASE_ARTIFACT_DIR, `${case_id}.bin`);
    writeBinary(artifactPath, artifact);
    const parsed = parseCompositeRankDescArtifact(artifact);
    const replay = replayCompositeRankDescArtifact(artifact);
    assert(
      JSON.stringify(replay.winner_ids) === JSON.stringify(expected_winner_ids),
      `${case_id}: winner ids mismatch`
    );
    assert(parsed.scoringVersion === COMPOSITE_SCORING_VERSION, `${case_id}: scoring version mismatch`);
    assert(parsed.weightScale === COMPOSITE_WEIGHT_SCALE, `${case_id}: weight scale mismatch`);
    assert(
      parsed.normalizationScale === COMPOSITE_NORMALIZATION_SCALE,
      `${case_id}: normalization scale mismatch`
    );
    if (case_id === "max_equals_min") {
      const zeroPower = replay.participant_replay.every((entry) =>
        entry.field_replay.some((field) => field.field === "tier" && field.zero_ordering_power)
      );
      assert(zeroPower, `${case_id}: expected zero_ordering_power on tier`);
    }
    if (case_id === "stable_tie_break_by_order_asc") {
      assert(replay.winner_ids[1] === "trader_early", `${case_id}: tie-break did not use order asc`);
    }
    return {
      case_id,
      result: "pass",
      artifact_path: path.relative(path.resolve("."), artifactPath),
      artifact_byte_size: artifact.length,
      parsed_header: {
        format_version: parsed.formatVersion,
        winners_count: parsed.winnersCount,
        participant_count: parsed.participantCount,
        normalization_mode: parsed.normalizationMode,
      },
      canonical_json_lines: config.participants.map((participant) =>
        canonicalCompositeParticipantJsonLine(participant, config.scoring_fields)
      ),
      winner_ids: replay.winner_ids,
      ordered_ids: replay.ordered_ids,
      participant_replay: replay.participant_replay,
    };
  });

  const invalid = invalidCases().map(({ case_id, config, expected_error }) => {
    try {
      buildCompositeRankDescArtifact(config);
      throw new Error("unexpected_pass");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assert(message.includes(expected_error), `${case_id}: unexpected error message: ${message}`);
      return {
        case_id,
        result: "fail_as_expected",
        error: message,
      };
    }
  });

  const output = {
    task_id: "PROTOCOL-INFRA-001",
    status: "implementation_ready",
    formula: "composite_rank_desc",
    summary: {
      valid_cases: valid.length,
      invalid_cases: invalid.length,
      passed: valid.length + invalid.length,
    },
    canonical_constraints: {
      scoring_version: COMPOSITE_SCORING_VERSION,
      weight_scale: COMPOSITE_WEIGHT_SCALE,
      normalization_scale: COMPOSITE_NORMALIZATION_SCALE,
      max_fields: MAX_COMPOSITE_FIELDS,
      tie_break: ["composite_score desc", "order asc"],
    },
    valid_cases: valid,
    invalid_cases: invalid,
  };
  writeJson(OUTPUT_PATH, output);
  console.log(JSON.stringify(output, null, 2));
}

main();
