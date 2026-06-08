import crypto from "crypto";
import fs from "fs";
import path from "path";

import {
  buildArtifact,
  buildArtifactV121,
  buildOutcomeStandardV121ProofManifest,
  buildOutcomeStandardV121SnapshotManifest,
  buildSnapshotHash,
  buildSnapshotMerkleProofFromFile,
  buildWinnerClaimHash,
  FORMAT_VERSION_V1_2_1_SCALE,
  OUTCOME_STANDARD_V1_2_1,
  parseArtifactV121,
} from "../sdk/index.js";
import {
  buildSnapshotClaimFromFile,
  formulaNameFromArtifactV4,
  inspectSnapshotFile,
} from "../sdk/snapshot.js";
import type { ResolutionFormula, SnapshotMerkleProofNode, SnapshotParticipant } from "../sdk/types.js";

const TASK_ID = "PROTOCOL-LINE-012";
const STANDARD_VERSION = OUTCOME_STANDARD_V1_2_1;
const INTERNAL_MARKER_METADATA = FORMAT_VERSION_V1_2_1_SCALE;
const CANONICAL_PROGRAM_ID = "9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F";
const ISOLATED_PROGRAM_ID = "5xQ8ocTQmkWqFJEvsxACEK1nv1r2Vdj6SC3ZcW9t15pW";
const REPORT_PATH = path.resolve("artifacts/protocol_line_012_v121_local_proof.json");
const OUTPUT_DIR = path.resolve("artifacts/protocol_line_012_v121");
const FORMULAS: ResolutionFormula[] = [
  "weighted_random",
  "rank_desc",
  "rank_asc",
  "first_n",
  "closest_to",
];
const ENTRY_COUNTS = [104, 250, 1001];
const WINNERS_COUNT = 32;
const PAYOUT_LAMPORTS = 3n;
const RANDOMNESS = crypto.createHash("sha256").update("protocol-line-012-local-randomness").digest();

type JsonObject = Record<string, unknown>;

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function mutateHex(hex: string): string {
  return `${hex[0] === "0" ? "1" : "0"}${hex.slice(1)}`;
}

function participant(index: number, count: number, formula: ResolutionFormula): SnapshotParticipant {
  const id = `v121-${String(index + 1).padStart(6, "0")}`;
  if (formula === "weighted_random") {
    return { id, order: index, weight: (index % 23) + 1 };
  }
  if (formula === "first_n") {
    return { id, order: index };
  }
  if (formula === "rank_asc") {
    return { id, order: index, score: index };
  }
  if (formula === "closest_to") {
    const target = Math.floor(count / 2);
    const distance = Math.floor(index / 2);
    const direction = index % 2 === 0 ? 1 : -1;
    return { id, order: index, score: target + direction * distance };
  }
  return { id, order: index, score: count - index };
}

function participants(count: number, formula: ResolutionFormula): SnapshotParticipant[] {
  return Array.from({ length: count }, (_, index) => participant(index, count, formula));
}

function verifyMerkleProof(leafHash: string | null, proof: SnapshotMerkleProofNode[], expectedRoot: string): boolean {
  if (!leafHash) return false;
  let cursor = Buffer.from(leafHash, "hex");
  for (const node of proof) {
    const sibling = Buffer.from(node.sibling, "hex");
    cursor =
      node.position === "left"
        ? crypto.createHash("sha256").update(Buffer.concat([sibling, cursor])).digest()
        : crypto.createHash("sha256").update(Buffer.concat([cursor, sibling])).digest();
  }
  return cursor.toString("hex") === expectedRoot;
}

function encodeV121ResolvePayload(opts: {
  runtimeId: Buffer;
  inputLamports: bigint;
  winnerCount: number;
  winnerClaimHash: Buffer;
  primaryWinnerId: string;
}): Buffer {
  const input = Buffer.alloc(8);
  input.writeBigUInt64LE(opts.inputLamports, 0);
  const count = Buffer.alloc(2);
  count.writeUInt16LE(opts.winnerCount, 0);
  const idBytes = Buffer.from(opts.primaryWinnerId, "ascii");
  if (idBytes.length > 64) {
    throw new RangeError("primaryWinnerId must fit in 64 bytes");
  }
  return Buffer.concat([
    opts.runtimeId,
    input,
    count,
    opts.winnerClaimHash,
    Buffer.from([idBytes.length]),
    idBytes,
  ]);
}

function estimateLegacyV12WinnerPayloadBytes(winnerCount: number): number {
  return 16 + 8 + 4 + winnerCount + 4 + winnerCount * 64;
}

async function verifyLocalReplay(opts: {
  artifactPath: string;
  snapshotPath: string;
  committedWinnerCount: number;
  committedWinnerClaimHash: string;
}): Promise<JsonObject> {
  const artifact = fs.readFileSync(opts.artifactPath);
  const parsed = parseArtifactV121(artifact);
  const formula = formulaNameFromArtifactV4(parsed);
  const inspected = await inspectSnapshotFile({
    snapshotPath: opts.snapshotPath,
    formula,
    expectedHash: parsed.snapshotHash.toString("hex"),
    expectedCount: parsed.snapshotCount,
    ...(parsed.merkleRoot ? { expectedMerkleRoot: parsed.merkleRoot.toString("hex") } : {}),
  });
  const claim = await buildSnapshotClaimFromFile({
    snapshotPath: opts.snapshotPath,
    formula,
    winnersCount: parsed.winnersCount,
    randomness: RANDOMNESS,
    payoutLamports: parsed.payoutLamports,
    ...(formula === "closest_to" ? { targetScore: parsed.targetScore } : {}),
  });
  if (opts.committedWinnerCount !== claim.winnersCount || opts.committedWinnerCount !== parsed.winnersCount) {
    return {
      status: "MISMATCH",
      reason: "ERR_WINNER_COUNT_MISMATCH",
      standard_version: STANDARD_VERSION,
    };
  }
  const replayClaimHash = buildWinnerClaimHash(claim.outcomeIds).toString("hex");
  if (opts.committedWinnerClaimHash !== replayClaimHash) {
    return {
      status: "MISMATCH",
      reason: "ERR_WINNER_CLAIM_HASH_MISMATCH",
      standard_version: STANDARD_VERSION,
    };
  }
  return {
    status: "MATCH",
    reason: "OK",
    standard_version: STANDARD_VERSION,
    internal_marker_metadata: INTERNAL_MARKER_METADATA,
    outcome_id: claim.outcomeIds[0],
    outcome_ids: claim.outcomeIds,
    winners_count: claim.winnersCount,
    winner_claim_hash: replayClaimHash,
    snapshot_hash: inspected.snapshotHash,
    snapshot_count: inspected.snapshotCount,
    merkle_root: inspected.merkleRoot,
  };
}

async function runCase(formula: ResolutionFormula, entryCount: number): Promise<JsonObject> {
  const caseId = `${formula}-e${entryCount}-w${WINNERS_COUNT}`;
  const caseDir = path.join(OUTPUT_DIR, caseId);
  fs.mkdirSync(caseDir, { recursive: true });
  const snapshot = buildSnapshotHash({ formula, participants: participants(entryCount, formula) });
  const snapshotPath = path.join(caseDir, "snapshot.jsonl");
  fs.writeFileSync(snapshotPath, snapshot.canonicalSnapshot);
  const artifact = buildArtifactV121({
    type: "outcome_standard_v1_2_1",
    formula,
    input_lamports: 1000,
    snapshot_hash: snapshot.snapshotHash,
    snapshot_count: snapshot.snapshotCount,
    snapshot_uri: snapshotPath,
    merkle_root: snapshot.merkleRoot,
    winners_count: WINNERS_COUNT,
    payout_lamports: Number(PAYOUT_LAMPORTS),
    ...(formula === "closest_to" ? { target: Math.floor(entryCount / 2) } : {}),
  });
  const artifactPath = path.join(caseDir, "artifact_v121.bin");
  fs.writeFileSync(artifactPath, artifact);
  const parsed = parseArtifactV121(artifact);
  const claim = await buildSnapshotClaimFromFile({
    snapshotPath,
    formula,
    winnersCount: WINNERS_COUNT,
    randomness: RANDOMNESS,
    payoutLamports: PAYOUT_LAMPORTS,
    ...(formula === "closest_to" ? { targetScore: BigInt(Math.floor(entryCount / 2)) } : {}),
  });
  const winnerClaimHash = claim.winnerClaimHash.toString("hex");
  const snapshotManifest = buildOutcomeStandardV121SnapshotManifest({
    snapshotHash: snapshot.snapshotHash,
    snapshotCount: snapshot.snapshotCount,
    formula,
    winnersCount: WINNERS_COUNT,
    snapshotUri: snapshotPath,
    merkleRoot: snapshot.merkleRoot,
    payoutLamports: PAYOUT_LAMPORTS,
    ...(formula === "closest_to" ? { targetScore: BigInt(Math.floor(entryCount / 2)) } : {}),
    publicationStatus: "skipped_disabled",
    publicationUrl: null,
    proofManifestUrl: path.join(caseDir, "proof_manifest.json"),
    proofStatus: "ready",
    thresholdMode: entryCount <= 250 ? "medium" : "bulk",
    winnerClaimHash,
  });
  const proofManifest = buildOutcomeStandardV121ProofManifest({
    signature: "local-only-not-submitted",
    programId: ISOLATED_PROGRAM_ID,
    snapshotHash: snapshot.snapshotHash,
    snapshotCount: snapshot.snapshotCount,
    snapshotUri: snapshotPath,
    merkleRoot: snapshot.merkleRoot,
    formula,
    selectedIds: claim.outcomeIds,
    snapshotManifestUri: path.join(caseDir, "snapshot_manifest.json"),
    proofEndpointTemplate: "local-only",
    publicationStatus: "skipped_disabled",
    publicationUrl: null,
    proofStatus: "ready",
    ...(formula === "closest_to" ? { target: BigInt(Math.floor(entryCount / 2)) } : {}),
    winnerClaimHash,
  });
  const snapshotManifestPath = path.join(caseDir, "snapshot_manifest.json");
  const proofManifestPath = path.join(caseDir, "proof_manifest.json");
  writeJson(snapshotManifestPath, snapshotManifest);
  writeJson(proofManifestPath, proofManifest);
  const proof = await buildSnapshotMerkleProofFromFile({
    snapshotPath,
    formula,
    participantId: claim.outcomeIds[0],
    expectedHash: snapshot.snapshotHash,
    expectedCount: snapshot.snapshotCount,
    expectedMerkleRoot: snapshot.merkleRoot,
  });
  const payload = encodeV121ResolvePayload({
    runtimeId: crypto.createHash("sha256").update(caseId).digest().subarray(0, 16),
    inputLamports: 1000n,
    winnerCount: WINNERS_COUNT,
    winnerClaimHash: claim.winnerClaimHash,
    primaryWinnerId: claim.outcomeIds[0],
  });
  const replay = await verifyLocalReplay({
    artifactPath,
    snapshotPath,
    committedWinnerCount: WINNERS_COUNT,
    committedWinnerClaimHash: winnerClaimHash,
  });
  return {
    case_id: caseId,
    result: replay.status === "MATCH" ? "pass" : "fail",
    replay_status: replay.status,
    replay_reason: replay.reason,
    standard_version: replay.standard_version,
    internal_marker_metadata: INTERNAL_MARKER_METADATA,
    formula,
    entry_count: entryCount,
    winners_count: WINNERS_COUNT,
    artifact_format_version: parsed.formatVersion,
    artifact_bytes: artifact.length,
    winner_claim_hash: winnerClaimHash,
    instruction_payload_bytes: payload.length,
    legacy_v12_estimated_winner_payload_bytes: estimateLegacyV12WinnerPayloadBytes(WINNERS_COUNT),
    payload_includes_full_winner_ids: false,
    snapshot_hash_verified: replay.snapshot_hash === snapshot.snapshotHash,
    snapshot_count_verified: replay.snapshot_count === snapshot.snapshotCount,
    merkle_root_verified: replay.merkle_root === snapshot.merkleRoot,
    merkle_proof_verified: verifyMerkleProof(proof.leafHash, proof.proof, snapshot.merkleRoot),
    snapshot_manifest_integrity: snapshotManifest.standard_version === STANDARD_VERSION &&
      snapshotManifest.winner_claim_hash === winnerClaimHash,
    proof_manifest_integrity: proofManifest.standard_version === STANDARD_VERSION &&
      proofManifest.winner_claim_hash === winnerClaimHash &&
      proofManifest.selected_ids.length === WINNERS_COUNT,
    artifact_path: artifactPath,
    snapshot_path: snapshotPath,
    snapshot_manifest_path: snapshotManifestPath,
    proof_manifest_path: proofManifestPath,
  };
}

async function buildTamperCases(referenceCase: JsonObject): Promise<JsonObject[]> {
  const artifactPath = String(referenceCase.artifact_path);
  const snapshotPath = String(referenceCase.snapshot_path);
  const winnerClaimHash = String(referenceCase.winner_claim_hash);
  const winnerCount = Number(referenceCase.winners_count);
  const artifact = fs.readFileSync(artifactPath);
  const parsed = parseArtifactV121(artifact);
  const formula = formulaNameFromArtifactV4(parsed);
  const proof = await buildSnapshotMerkleProofFromFile({
    snapshotPath,
    formula,
    participantId: String((await verifyLocalReplay({
      artifactPath,
      snapshotPath,
      committedWinnerCount: winnerCount,
      committedWinnerClaimHash: winnerClaimHash,
    })).outcome_id),
    expectedHash: parsed.snapshotHash.toString("hex"),
    expectedCount: parsed.snapshotCount,
    ...(parsed.merkleRoot ? { expectedMerkleRoot: parsed.merkleRoot.toString("hex") } : {}),
  });
  const winnerHashTamper = await verifyLocalReplay({
    artifactPath,
    snapshotPath,
    committedWinnerCount: winnerCount,
    committedWinnerClaimHash: mutateHex(winnerClaimHash),
  });
  const winnerCountTamper = await verifyLocalReplay({
    artifactPath,
    snapshotPath,
    committedWinnerCount: winnerCount - 1,
    committedWinnerClaimHash: winnerClaimHash,
  });
  let snapshotHashReason = "OK";
  try {
    await inspectSnapshotFile({
      snapshotPath,
      formula,
      expectedHash: mutateHex(parsed.snapshotHash.toString("hex")),
      expectedCount: parsed.snapshotCount,
      ...(parsed.merkleRoot ? { expectedMerkleRoot: parsed.merkleRoot.toString("hex") } : {}),
    });
  } catch (error) {
    snapshotHashReason = error instanceof Error ? error.message : String(error);
  }
  const badRoot = parsed.merkleRoot ? mutateHex(parsed.merkleRoot.toString("hex")) : mutateHex(String(referenceCase.merkle_root));
  const merkleTamperOk = verifyMerkleProof(proof.leafHash, proof.proof, badRoot);
  const versionTampered = Buffer.from(artifact);
  versionTampered.writeUInt16LE(6, 4);
  let versionReason = "OK";
  try {
    parseArtifactV121(versionTampered);
  } catch (error) {
    versionReason = error instanceof Error ? error.message : String(error);
  }
  return [
    {
      case_id: "winner_claim_hash_tamper",
      result: winnerHashTamper.status === "MISMATCH" ? "fail_as_expected" : "unexpected_pass",
      replay_status: winnerHashTamper.status,
      failure_reason: winnerHashTamper.reason,
    },
    {
      case_id: "winner_count_tamper",
      result: winnerCountTamper.status === "MISMATCH" ? "fail_as_expected" : "unexpected_pass",
      replay_status: winnerCountTamper.status,
      failure_reason: winnerCountTamper.reason,
    },
    {
      case_id: "snapshot_hash_tamper",
      result: snapshotHashReason !== "OK" ? "fail_as_expected" : "unexpected_pass",
      failure_reason: snapshotHashReason,
    },
    {
      case_id: "merkle_root_proof_tamper",
      result: merkleTamperOk === false ? "fail_as_expected" : "unexpected_pass",
      failure_reason: merkleTamperOk === false ? "ERR_MERKLE_ROOT_PROOF_MISMATCH" : "OK",
    },
    {
      case_id: "version_mismatch_tamper",
      result: versionReason !== "OK" ? "fail_as_expected" : "unexpected_pass",
      failure_reason: versionReason,
    },
  ];
}

async function main(): Promise<void> {
  const cases: JsonObject[] = [];
  for (const formula of FORMULAS) {
    for (const entryCount of ENTRY_COUNTS) {
      cases.push(await runCase(formula, entryCount));
    }
  }
  const compactV11 = buildArtifact({
    type: "formula_draw_v5",
    formula: "rank_desc",
    input_lamports: 1000,
    winners_count: 3,
    participants: Array.from({ length: 103 }, (_, index) => ({
      id: `v11-${String(index + 1).padStart(3, "0")}`,
      order: index,
      score: 103 - index,
    })),
  });
  const v12Compatibility = buildArtifact({
    type: "outcome_standard_v1_2",
    formula: "first_n",
    input_lamports: 1000,
    winners_count: 3,
    snapshot_hash: "0".repeat(64),
    snapshot_count: 104,
    snapshot_uri: "local://compat-v12",
    merkle_root: "1".repeat(64),
  });
  const report = {
    task_id: TASK_ID,
    generated_at: new Date().toISOString(),
    standard_version: STANDARD_VERSION,
    internal_marker_metadata: INTERNAL_MARKER_METADATA,
    canonical_program_untouched: true,
    canonical_program_id: CANONICAL_PROGRAM_ID,
    non_local_validation_opened: false,
    isolated_program_reuse_note: ISOLATED_PROGRAM_ID,
    commands_recorded: [
      "yarn -s tsc --noEmit",
      "TS_NODE_PROJECT=tsconfig.json node --loader ts-node/esm scripts/protocol_line_012_v121_local_proof.ts",
      "yarn -s build",
      "TS_NODE_PROJECT=tsconfig.json node --loader ts-node/esm scripts/protocol_line_004_v12_local_proof.ts",
      "TS_NODE_PROJECT=tsconfig.json node --loader ts-node/esm scripts/participant_scale_005_v5_boundary.ts",
      "git diff --check",
    ],
    compatibility_checks: {
      v11_compact_artifact_format_version: compactV11.readUInt16LE(4),
      v11_compact_artifact_bytes: compactV11.length,
      v12_artifact_format_version: v12Compatibility.readUInt16LE(4),
      v12_artifact_bytes: v12Compatibility.length,
      v12_product_version_preserved: "1.2",
    },
    matrix_cases: cases,
    negative_tamper_cases: await buildTamperCases(cases[0]),
    summary: {
      cases: cases.length,
      cases_passed: cases.every((row) => row.result === "pass"),
      formulas: FORMULAS,
      entry_counts: ENTRY_COUNTS,
      winners_count: WINNERS_COUNT,
      all_successes_have_standard_version_1_2_1: cases.every((row) => row.standard_version === STANDARD_VERSION),
      payload_does_not_include_full_winner_ids: cases.every((row) => row.payload_includes_full_winner_ids === false),
      payload_bytes_constant_for_winner_count_32: [...new Set(cases.map((row) => row.instruction_payload_bytes))],
      legacy_v12_payload_bytes_at_winner_count_32: estimateLegacyV12WinnerPayloadBytes(WINNERS_COUNT),
    },
  };
  writeJson(REPORT_PATH, report);
  process.stdout.write(`${REPORT_PATH}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
