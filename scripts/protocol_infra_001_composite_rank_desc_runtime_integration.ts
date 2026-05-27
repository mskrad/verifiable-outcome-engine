import fs from "fs";
import path from "path";

import {
  buildArtifact,
  buildCompositeRankDescArtifact,
  parseCompositeRankDescArtifact,
  replayCompositeRankDescArtifact,
} from "../sdk/index.js";
import type { BuildArtifactConfig, CompositeRankDescConfig } from "../sdk/types.js";

const OUTPUT_PATH = path.resolve("artifacts/protocol_infra_001_composite_rank_desc_runtime_integration.json");

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(value, (_, candidate) => (typeof candidate === "bigint" ? candidate.toString() : candidate), 2)}\n`
  );
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function cases(): Array<{
  case_id: string;
  config: CompositeRankDescConfig;
  expected_winner_ids: string[];
}> {
  return [
    {
      case_id: "generic_builder_normalized",
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
      case_id: "generic_builder_zero_power",
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
  ];
}

function main(): void {
  const valid = cases().map(({ case_id, config, expected_winner_ids }) => {
    const genericArtifact = buildArtifact(config as BuildArtifactConfig);
    const dedicatedArtifact = buildCompositeRankDescArtifact(config);
    assert(genericArtifact.equals(dedicatedArtifact), `${case_id}: generic buildArtifact output mismatch`);
    const parsed = parseCompositeRankDescArtifact(genericArtifact);
    const replay = replayCompositeRankDescArtifact(genericArtifact);
    assert(
      JSON.stringify(replay.winner_ids) === JSON.stringify(expected_winner_ids),
      `${case_id}: winner ids mismatch`
    );
    return {
      case_id,
      result: "pass",
      artifact_format_version: parsed.formatVersion,
      normalization_mode: parsed.normalizationMode,
      participant_count: parsed.participantCount,
      winners_count: parsed.winnersCount,
      artifact_byte_size: genericArtifact.length,
      winner_ids: replay.winner_ids,
      ordered_ids: replay.ordered_ids,
    };
  });

  const output = {
    task_id: "PROTOCOL-INFRA-001",
    status: "runtime_integration_ready",
    scope: "bounded_runtime_integration",
    formula: "composite_rank_desc",
    summary: {
      valid_cases: valid.length,
      passed: valid.length,
    },
    checks: [
      "buildArtifact routes composite_rank_desc into the bounded composite artifact builder",
      "generic buildArtifact bytes equal dedicated composite builder bytes",
      "replay still recomputes composite score from raw fields and scoring metadata",
    ],
    valid_cases: valid,
  };

  writeJson(OUTPUT_PATH, output);
  console.log(JSON.stringify(output, null, 2));
}

main();
