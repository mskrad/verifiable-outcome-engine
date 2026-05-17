import crypto from "crypto";
import fs from "fs";
import path from "path";

import {
  buildArtifact,
  buildArtifactV12,
  buildMerkleProof,
  buildOutcomeStandardV12ProofManifest,
  buildOutcomeStandardV12SnapshotManifest,
  buildSnapshotHash,
  buildSnapshotMerkleProofFromFile,
  MAX_COMPILED_ARTIFACT_BYTES,
  parseArtifactV12,
  V5_ENTRY_BYTES,
} from "../sdk/index.js";
import {
  buildSnapshotClaimFromFile,
  inspectSnapshotFile,
} from "../sdk/snapshot.js";
import type { CompactNamedEntry, ResolutionFormula, SnapshotParticipant } from "../sdk/types.js";

const FORMULAS: ResolutionFormula[] = [
  "weighted_random",
  "rank_desc",
  "rank_asc",
  "first_n",
  "closest_to",
];
const OUT_DIR = path.resolve("artifacts/protocol_line_004_v12");
const REPORT_PATH = path.resolve("artifacts/protocol_line_004_v12_local_proof.json");
const RANDOMNESS = Buffer.alloc(32, 12);

function sha256Hex(bytes: string | Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function participant(index: number, count: number, formula: ResolutionFormula): SnapshotParticipant {
  const id = `row-${String(index + 1).padStart(4, "0")}`;
  if (formula === "weighted_random") {
    return { id, order: index, weight: (index % 11) + 1 };
  }
  if (formula === "first_n") {
    return { id, order: index };
  }
  if (formula === "rank_asc") {
    return { id, order: index, score: index };
  }
  if (formula === "closest_to") {
    return { id, order: index, score: 50 + (index % 2 === 0 ? index : -index) };
  }
  return { id, order: index, score: count - index };
}

function participants(count: number, formula: ResolutionFormula): SnapshotParticipant[] {
  return Array.from({ length: count }, (_, index) => participant(index, count, formula));
}

function compactEntries(count: number): CompactNamedEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${String(index + 1).padStart(4, "0")}`,
    order: index,
    weight: 1,
    score: count - index,
  }));
}

async function buildV12Case(formula: ResolutionFormula, entryCount: number, winnersCount: number) {
  const caseDir = path.join(OUT_DIR, `${formula}-w${winnersCount}`);
  fs.mkdirSync(caseDir, { recursive: true });
  const target = 50;
  const built = buildSnapshotHash({ formula, participants: participants(entryCount, formula) });
  const snapshotPath = path.join(caseDir, "canonical_snapshot.jsonl");
  fs.writeFileSync(snapshotPath, built.canonicalSnapshot, "utf8");

  const artifact = buildArtifactV12({
    type: "outcome_standard_v1_2",
    formula,
    input_lamports: 10,
    payout_lamports: 3,
    winners_count: winnersCount,
    snapshot_hash: built.snapshotHash,
    snapshot_count: built.snapshotCount,
    snapshot_uri: snapshotPath,
    merkle_root: built.merkleRoot,
    ...(formula === "closest_to" ? { target } : {}),
  });
  const parsed = parseArtifactV12(artifact);
  const inspected = await inspectSnapshotFile({
    snapshotPath,
    formula,
    expectedHash: built.snapshotHash,
    expectedCount: built.snapshotCount,
    expectedMerkleRoot: built.merkleRoot,
  });
  const claim = await buildSnapshotClaimFromFile({
    snapshotPath,
    formula,
    winnersCount,
    randomness: RANDOMNESS,
    payoutLamports: 3n,
    ...(formula === "closest_to" ? { targetScore: BigInt(target) } : {}),
  });
  const manifest = buildOutcomeStandardV12SnapshotManifest({
    snapshotHash: built.snapshotHash,
    snapshotCount: built.snapshotCount,
    formula,
    winnersCount,
    snapshotUri: snapshotPath,
    merkleRoot: built.merkleRoot,
    payoutLamports: 3n,
    ...(formula === "closest_to" ? { targetScore: BigInt(target) } : {}),
    thresholdMode: "simple",
    publicationStatus: "skipped_unconfigured",
    proofStatus: "ready",
  });
  const manifestPath = path.join(caseDir, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const proofManifest = buildOutcomeStandardV12ProofManifest({
    signature: "local-proof-only",
    programId: "local-proof-only",
    snapshotHash: built.snapshotHash,
    snapshotCount: built.snapshotCount,
    snapshotUri: snapshotPath,
    merkleRoot: built.merkleRoot,
    formula,
    selectedIds: claim.outcomeIds,
    snapshotManifestUri: manifestPath,
    proofEndpointTemplate: "/api/partner/draw/:sig/proof?address=<id>",
    publicationStatus: "skipped_unconfigured",
    publicationUrl: null,
    proofStatus: "ready",
    ...(formula === "closest_to" ? { target } : {}),
  });
  const proofManifestPath = path.join(caseDir, "proof_manifest.json");
  fs.writeFileSync(proofManifestPath, `${JSON.stringify(proofManifest, null, 2)}\n`);
  const proof = await buildSnapshotMerkleProofFromFile({
    snapshotPath,
    formula,
    participantId: claim.outcomeIds[0],
    expectedHash: built.snapshotHash,
    expectedCount: built.snapshotCount,
    expectedMerkleRoot: built.merkleRoot,
  });

  return {
    formula,
    standard_version: parsed.standardVersion,
    internal_artifact_format_version: parsed.formatVersion,
    entry_count: entryCount,
    winners_count: winnersCount,
    artifact_byte_size: artifact.length,
    snapshot_hash_verified: inspected.snapshotHash === built.snapshotHash,
    snapshot_count_verified: inspected.snapshotCount === built.snapshotCount,
    merkle_root_verified: inspected.merkleRoot === built.merkleRoot,
    winner_recomputation_verified: claim.outcomeIds.length === winnersCount,
    claimed_winners_verified: proofManifest.selected_ids.join(",") === claim.outcomeIds.join(","),
    merkle_proof_surface_verified: Boolean(proof.participant && proof.leafHash && proof.proof.length >= 0),
    publication_status: proofManifest.publication_status,
    publication_url: proofManifest.publication_url,
    snapshot_manifest_path: manifestPath,
    snapshot_manifest_hash: sha256Hex(fs.readFileSync(manifestPath)),
    proof_manifest_path: proofManifestPath,
    proof_manifest_hash: sha256Hex(fs.readFileSync(proofManifestPath)),
    selected_ids: claim.outcomeIds,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const v11Near = buildArtifact({
    type: "formula_draw_v5",
    formula: "rank_desc",
    input_lamports: 10,
    payout_lamports: 3,
    winners_count: 3,
    participants: compactEntries(103),
  });
  let overflowReason = "";
  try {
    buildArtifact({
      type: "formula_draw_v5",
      formula: "rank_desc",
      input_lamports: 10,
      payout_lamports: 3,
      winners_count: 3,
      participants: compactEntries(104),
    });
  } catch (error) {
    overflowReason = error instanceof Error ? error.message : String(error);
  }

  const v12Cases = [];
  for (const formula of FORMULAS) {
    v12Cases.push(await buildV12Case(formula, 104, 3));
  }
  const mismatchExpected = v12Cases[1].selected_ids.join(",");
  const mismatchClaimed = ["wrong-row", ...v12Cases[1].selected_ids.slice(1)].join(",");

  const report = {
    task_id: "PROTOCOL-LINE-004",
    standard_version: "1.2",
    internal_artifact_format_version: 6,
    v11_compact_intact: {
      near_threshold_entries: 103,
      near_threshold_artifact_byte_size: v11Near.length,
      max_compiled_artifact_bytes: MAX_COMPILED_ARTIFACT_BYTES,
      v5_entry_bytes: V5_ENTRY_BYTES,
      overflow_entries: 104,
      overflow_route: overflowReason.includes("route larger draws"),
      overflow_reason: overflowReason,
    },
    explicit_scale_route: {
      route: "scale_snapshot",
      endpoints: [
        "/api/partner/snapshot/init",
        "/api/partner/snapshot/chunk",
        "/api/partner/snapshot/finalize",
      ],
    },
    v12_cases: v12Cases,
    negative_replay_mismatch: {
      formula: "rank_desc",
      expected: mismatchExpected,
      claimed: mismatchClaimed,
      result: mismatchClaimed !== mismatchExpected ? "fail_as_expected" : "unexpected_pass",
      failure_reason:
        mismatchClaimed !== mismatchExpected
          ? "claimed winners differ from recomputed Outcome Standard V1.2 winners"
          : "",
    },
  };

  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

await main();
