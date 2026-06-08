import fs from "fs";
import os from "os";
import path from "path";

import { buildArtifact } from "../sdk/artifact.js";
import { replayCompositeRankDescArtifact } from "../sdk/composite_rank_desc.js";
import { verifyOutcome } from "../sdk/verify.js";
import type { BuildArtifactConfig, CompositeRankDescConfig } from "../sdk/types.js";

const PROGRAM_ID = "GLEABWCYxgBhs2VKdefpCyHeZJ1T3Rb1u4HajgA3PPfP";
const SIGNATURE = "46M9tnEHANiDvB3V25uYpNztkn24a6QSAjh4p7zSpgN1ayaQ6kDuLpNePEaaD23q7f1NJFaS9ZGBppY728jPxMF";
const RPC_URL = "https://api.devnet.solana.com";
const OUTPUT_PATH = path.resolve("artifacts/protocol_infra_002_verifier_fix.json");

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function config(): CompositeRankDescConfig {
  return {
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
  };
}

async function main(): Promise<void> {
  const boundedConfig = config();
  const rebuiltArtifact = buildArtifact(boundedConfig as BuildArtifactConfig);
  const artifactPath = path.join(os.tmpdir(), "protocol-infra-002-composite-rank-desc-verifier-fix.bin");
  fs.writeFileSync(artifactPath, rebuiltArtifact);
  const dedicatedReplay = replayCompositeRankDescArtifact(rebuiltArtifact);
  const verified = await verifyOutcome({
    signature: SIGNATURE,
    rpcUrl: RPC_URL,
    programId: PROGRAM_ID,
    artifactPath,
  });

  assert(verified.status === "MATCH", `verifyOutcome expected MATCH, got ${verified.status}/${verified.reason}`);
  assert(
    JSON.stringify(verified.outcome_ids ?? [verified.outcome_id]) === JSON.stringify(dedicatedReplay.winner_ids),
    "generic verifier winner_ids do not match dedicated composite replay"
  );

  const output = {
    task_id: "PROTOCOL-INFRA-002",
    status: "verifier_fix_ready",
    formula: "composite_rank_desc",
    bounded_scope: {
      composite_rank_desc_only: true,
      on_chain_program_changed_in_this_fix: false,
    },
    regression: {
      artifact_path: artifactPath,
      live_signature: SIGNATURE,
      program_id: PROGRAM_ID,
      dedicated_replay: {
        ordered_ids: dedicatedReplay.ordered_ids,
        winner_ids: dedicatedReplay.winner_ids,
      },
      generic_live_verify: {
        status: verified.status,
        reason: verified.reason,
        outcome_id: verified.outcome_id,
        outcome_ids: verified.outcome_ids ?? [verified.outcome_id],
        winners_count: verified.winners_count ?? 1,
        resolution_formula: verified.resolution_formula,
        artifact_format_version: verified.artifact_format_version ?? null,
      },
    },
  };

  writeJson(OUTPUT_PATH, output);
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
