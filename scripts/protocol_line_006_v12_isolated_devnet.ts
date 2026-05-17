import fs from "fs";
import path from "path";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveInline } from "../sdk/operator.js";
import {
  buildOutcomeStandardV12ProofManifest,
  buildOutcomeStandardV12SnapshotManifest,
  buildSnapshotHash,
  buildSnapshotMerkleProofFromFile,
} from "../sdk/snapshot.js";
import { verifyOutcome } from "../sdk/verify.js";
import type { SnapshotParticipant } from "../sdk/types.js";

const CANONICAL_PROGRAM_ID = "9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F";

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

function participants(count: number): SnapshotParticipant[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `isolated-row-${String(index + 1).padStart(4, "0")}`,
    order: index,
    score: count - index,
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rpcUrl = args.rpc ?? "https://api.devnet.solana.com";
  const programId = required(args, "program-id");
  const walletPath = required(args, "wallet");
  const deploySignature = required(args, "deploy-sig");
  if (programId === CANONICAL_PROGRAM_ID) {
    throw new Error("Refusing to run against canonical hackathon-facing program");
  }

  const outputDir = path.resolve(args["output-dir"] ?? "artifacts/protocol_line_006_v12_isolated_devnet");
  fs.mkdirSync(outputDir, { recursive: true });

  const connection = new Connection(rpcUrl, "confirmed");
  const [version, epochInfo, programInfo] = await Promise.all([
    connection.getVersion(),
    connection.getEpochInfo("confirmed"),
    connection.getAccountInfo(new PublicKey(programId), "confirmed"),
  ]);
  if (!programInfo) {
    throw new Error(`Isolated program not found on devnet: ${programId}`);
  }

  const formula = "rank_desc" as const;
  const entryCount = 104;
  const winnersCount = 3;
  const snapshotPath = path.join(outputDir, "canonical_snapshot.jsonl");
  const built = buildSnapshotHash({
    formula,
    participants: participants(entryCount),
  });
  fs.writeFileSync(snapshotPath, built.canonicalSnapshot, "utf8");

  const config = {
    type: "outcome_standard_v1_2" as const,
    formula,
    input_lamports: 10,
    payout_lamports: 3,
    winners_count: winnersCount,
    snapshot_hash: built.snapshotHash,
    snapshot_count: built.snapshotCount,
    snapshot_uri: snapshotPath,
    merkle_root: built.merkleRoot,
  };

  const label = `protocol-line-006-v12-${Date.now()}`;
  const result = await resolveInline(config, {
    rpcUrl,
    programId,
    walletPath,
    outputDir,
    label,
  });

  const replay = await verifyOutcome({
    signature: result.signature,
    rpcUrl,
    programId,
    artifactPath: result.artifactPath,
  });

  const outcomeIds = result.outcomeIds ?? [result.outcome];
  const snapshotManifestPath = path.join(outputDir, "manifest.json");
  const proofManifestPath = path.join(outputDir, "proof_manifest.json");
  const snapshotManifest = buildOutcomeStandardV12SnapshotManifest({
    snapshotHash: built.snapshotHash,
    snapshotCount: built.snapshotCount,
    formula,
    winnersCount,
    snapshotUri: snapshotPath,
    merkleRoot: built.merkleRoot,
    payoutLamports: 3n,
    thresholdMode: "simple",
    publicationStatus: "skipped_unconfigured",
    proofStatus: "ready",
  });
  writeJson(snapshotManifestPath, snapshotManifest);
  const proofManifest = buildOutcomeStandardV12ProofManifest({
    signature: result.signature,
    programId,
    snapshotHash: built.snapshotHash,
    snapshotCount: built.snapshotCount,
    snapshotUri: snapshotPath,
    merkleRoot: built.merkleRoot,
    formula,
    selectedIds: outcomeIds,
    snapshotManifestUri: snapshotManifestPath,
    proofEndpointTemplate: "/api/partner/draw/:sig/proof?address=<id>",
    publicationStatus: "skipped_unconfigured",
    publicationUrl: null,
    proofStatus: "ready",
  });
  writeJson(proofManifestPath, proofManifest);
  const proof = await buildSnapshotMerkleProofFromFile({
    snapshotPath,
    formula,
    participantId: outcomeIds[0],
    expectedHash: built.snapshotHash,
    expectedCount: built.snapshotCount,
    expectedMerkleRoot: built.merkleRoot,
  });

  const evidence = {
    task_id: "PROTOCOL-LINE-006",
    standard_version: "1.2",
    internal_artifact_format_version_metadata: 6,
    rpc_url: rpcUrl,
    rpc_readiness: {
      solana_core: version["solana-core"],
      feature_set: version["feature-set"],
      epoch: epochInfo.epoch,
      slot: epochInfo.absoluteSlot,
    },
    canonical_program_guard: {
      canonical_program_id: CANONICAL_PROGRAM_ID,
      isolated_program_id: programId,
      canonical_touched: false,
    },
    isolated_deploy: {
      program_id: programId,
      deploy_signature: deploySignature,
      program_owner: programInfo.owner.toBase58(),
      executable: programInfo.executable,
      data_length: programInfo.data.length,
    },
    live_v12_transaction: {
      signature: result.signature,
      formula,
      entry_count: entryCount,
      winners_count: winnersCount,
      outcome_id: result.outcome,
      outcome_ids: outcomeIds,
      runtime_id: result.runtimeId,
      resolve_id: result.resolveId,
      compiled_artifact_hash: result.artifactHash,
      artifact_path: result.artifactPath,
      result_path: result.resultPath,
    },
    replay: {
      status: replay.status,
      reason: replay.reason,
      standard_version: replay.standard_version,
      internal_marker_metadata: replay.artifact_format_version ?? 6,
      outcome_id: replay.outcome_id,
      outcome_ids: replay.outcome_ids,
      winners_count: replay.winners_count,
      resolution_formula: replay.resolution_formula,
      snapshot_hash: replay.snapshot_hash,
      snapshot_count: replay.snapshot_count,
      snapshot_uri: replay.snapshot_uri,
      merkle_root: replay.merkle_root,
      publication_status: replay.publication_status ?? snapshotManifest.publication_status,
      proof_manifest_url: replay.proof_manifest_url ?? proofManifestPath,
      program_id: replay.program_id,
    },
    local_proof_surface: {
      snapshot_manifest_path: snapshotManifestPath,
      proof_manifest_path: proofManifestPath,
      merkle_proof_participant: proof.participant?.id ?? null,
      merkle_proof_included: Boolean(proof.participant),
      merkle_proof_nodes: proof.proof.length,
    },
  };

  const evidencePath = path.resolve("artifacts/protocol_line_006_v12_isolated_devnet.json");
  writeJson(evidencePath, evidence);
  console.log(JSON.stringify(evidence, null, 2));
}

await main();
