import fs from "fs";
import path from "path";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveInline } from "../sdk/operator.js";
import { verifyOutcome } from "../sdk/verify.js";
import type { ArtifactConfig, CompositeRankDescConfig } from "../sdk/types.js";

const CANONICAL_PROGRAM_ID = "9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F";
const OUTPUT_PATH = path.resolve("artifacts/protocol_infra_002_devnet_validation.json");
const OUTPUT_DIR = path.resolve("artifacts/protocol_infra_002_devnet_validation");

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    out[key] = value;
    index += 1;
  }
  return out;
}

function required(args: Record<string, string>, key: string): string {
  const value = args[key]?.trim();
  if (!value) throw new Error(`Provide --${key}`);
  return value;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rpcUrl = args.rpc ?? "https://api.devnet.solana.com";
  const programId = required(args, "program-id");
  const walletPath = required(args, "wallet");
  const deploySignature = required(args, "deploy-sig");
  if (programId === CANONICAL_PROGRAM_ID) {
    throw new Error("Refusing to run against canonical program");
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const connection = new Connection(rpcUrl, "confirmed");
  const [version, epochInfo, programInfo, balance] = await Promise.all([
    connection.getVersion(),
    connection.getEpochInfo("confirmed"),
    connection.getAccountInfo(new PublicKey(programId), "confirmed"),
    connection.getBalance(new PublicKey(required(args, "authority")), "confirmed"),
  ]);
  if (!programInfo) {
    throw new Error(`Isolated program not found on devnet: ${programId}`);
  }

  const boundedConfig = config();
  const label = `protocol-infra-002-composite-rank-desc-${Date.now()}`;
  const live = await resolveInline(boundedConfig as unknown as ArtifactConfig, {
    rpcUrl,
    programId,
    walletPath,
    outputDir: OUTPUT_DIR,
    label,
  });

  const replay = await verifyOutcome({
    signature: live.signature,
    rpcUrl,
    programId,
    artifactPath: live.artifactPath,
  });

  const evidence = {
    task_id: "PROTOCOL-INFRA-002",
    status: replay.status === "MATCH" ? "bounded_live_validation_passed" : "bounded_live_validation_failed",
    formula: "composite_rank_desc",
    bounded_scope: {
      composite_rank_desc_only: true,
      canonical_untouched: true,
      broader_composite_opened: false,
    },
    rpc_url: rpcUrl,
    rpc_readiness: {
      solana_core: version["solana-core"],
      feature_set: version["feature-set"],
      epoch: epochInfo.epoch,
      slot: epochInfo.absoluteSlot,
    },
    isolated_surface: {
      program_id: programId,
      authority: required(args, "authority"),
      authority_balance_lamports_after_run: balance.toString(),
      deploy_signature: deploySignature,
      executable: programInfo.executable,
      owner: programInfo.owner.toBase58(),
      data_length: programInfo.data.length,
    },
    artifact_inputs_used: {
      config: boundedConfig,
      artifact_path: live.artifactPath,
      result_path: live.resultPath,
      compiled_artifact_hash: live.artifactHash,
    },
    live_transaction: {
      signature: live.signature,
      runtime_id: live.runtimeId,
      resolve_id: live.resolveId,
      outcome_id: live.outcome,
      outcome_ids: live.outcomeIds ?? [live.outcome],
      winners_count: live.winnersCount,
      artifact_format_version: live.artifactFormatVersion,
    },
    replay_result: {
      status: replay.status,
      reason: replay.reason,
      artifact_format_version: replay.artifact_format_version ?? null,
      standard_version: replay.standard_version ?? null,
      resolution_formula: replay.resolution_formula,
      outcome_id: replay.outcome_id,
      outcome_ids: replay.outcome_ids ?? [replay.outcome_id],
      winners_count: replay.winners_count ?? 1,
    },
  };

  writeJson(OUTPUT_PATH, evidence);
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
