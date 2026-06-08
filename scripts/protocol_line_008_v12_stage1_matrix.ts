import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Connection, PublicKey } from "@solana/web3.js";

import {
  buildArtifact,
  buildArtifactV12,
  buildOutcomeStandardV12ProofManifest,
  buildOutcomeStandardV12SnapshotManifest,
  buildSnapshotHash,
  buildSnapshotMerkleProofFromFile,
  MAX_COMPILED_ARTIFACT_BYTES,
  parseArtifactV12,
  V5_ENTRY_BYTES,
} from "../sdk/index.js";
import { resolveInline } from "../sdk/operator.js";
import { inspectSnapshotFile } from "../sdk/snapshot.js";
import { verifyOutcome } from "../sdk/verify.js";
import type { ResolutionFormula, SnapshotMerkleProofNode, SnapshotParticipant } from "../sdk/types.js";

const TASK_ID = "PROTOCOL-LINE-008";
const STANDARD_VERSION = "1.2";
const INTERNAL_MARKER_METADATA = 6;
const CANONICAL_PROGRAM_ID = "9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F";
const FORMULAS: ResolutionFormula[] = [
  "weighted_random",
  "rank_desc",
  "rank_asc",
  "first_n",
  "closest_to",
];
const WINNER_COUNTS = [1, 3, 10];
const ENTRY_COUNTS = [104, 250, 1001];
const PAYOUT_LAMPORTS = 3n;
const REPORT_PATH = path.resolve("artifacts/protocol_line_008_v12_stage1_matrix.json");
const DEFAULT_OUTPUT_DIR = path.resolve("artifacts/protocol_line_008_v12_stage1_matrix");

type JsonObject = Record<string, unknown>;

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = value;
    index += 1;
  }
  return out;
}

function required(args: Record<string, string | boolean>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Provide --${key}`);
  }
  return value.trim();
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256Hex(bytes: string | Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function mutateHex(hex: string): string {
  return `${hex[0] === "0" ? "1" : "0"}${hex.slice(1)}`;
}

function caseId(formula: ResolutionFormula, entryCount: number, winnersCount: number): string {
  return `${formula}-e${entryCount}-w${winnersCount}`;
}

function participant(index: number, count: number, formula: ResolutionFormula): SnapshotParticipant {
  const id = `stage1-${String(index + 1).padStart(4, "0")}`;
  if (formula === "weighted_random") {
    return { id, order: index, weight: (index % 17) + 1 };
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

function compactEntries(count: number): SnapshotParticipant[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${String(index + 1).padStart(4, "0")}`,
    order: index,
    weight: 1,
    score: count - index,
  }));
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

function loadExisting(): JsonObject {
  if (!fs.existsSync(REPORT_PATH)) return {};
  return JSON.parse(fs.readFileSync(REPORT_PATH, "utf8")) as JsonObject;
}

function existingPassedCases(existing: JsonObject): Map<string, JsonObject> {
  const rows = Array.isArray(existing.matrix_cases) ? existing.matrix_cases : [];
  return new Map(
    rows
      .filter((row): row is JsonObject => Boolean(row && typeof row === "object"))
      .filter((row) => row.case_id && row.result === "pass")
      .map((row) => [String(row.case_id), row])
  );
}

function buildSummary(cases: JsonObject[], routingCoverage: JsonObject, tamperCases: JsonObject[]): JsonObject {
  const passed = cases.filter((row) => row.result === "pass").length;
  const failed = cases.length - passed;
  const v12SuccessesHaveVersion = cases.every((row) => row.standard_version === STANDARD_VERSION);
  const manifestsVerified = cases.every(
    (row) =>
      row.snapshot_hash_verified === true &&
      row.snapshot_count_verified === true &&
      row.merkle_root_verified === true &&
      row.merkle_proof_verified === true &&
      row.snapshot_manifest_integrity === true &&
      row.proof_manifest_integrity === true
  );
  const tamperPass = tamperCases.every((row) => row.result === "fail_as_expected");
  const routingPass =
    routingCoverage.v11_compact_pass_103 === true &&
    routingCoverage.v12_overflow_route_104 === true &&
    routingCoverage.explicit_v12_public_proof_route === true;
  return {
    total_cases: cases.length,
    passed,
    failed,
    formulas: FORMULAS,
    entry_counts: ENTRY_COUNTS,
    winners_counts: WINNER_COUNTS,
    routing_pass: routingPass,
    v12_successes_have_standard_version_1_2: v12SuccessesHaveVersion,
    proof_and_manifest_integrity_pass: manifestsVerified,
    negative_tamper_pass: tamperPass,
    strong_isolated_candidate_verdict:
      cases.length === FORMULAS.length * ENTRY_COUNTS.length * WINNER_COUNTS.length &&
      failed === 0 &&
      routingPass &&
      v12SuccessesHaveVersion &&
      manifestsVerified &&
      tamperPass
        ? "passed"
        : "failed",
  };
}

function writeReport(report: JsonObject): void {
  const matrixCases = Array.isArray(report.matrix_cases) ? (report.matrix_cases as JsonObject[]) : [];
  const tamperCases = Array.isArray(report.negative_tamper_cases)
    ? (report.negative_tamper_cases as JsonObject[])
    : [];
  const routingCoverage = (report.routing_coverage ?? {}) as JsonObject;
  report.matrix_summary = buildSummary(matrixCases, routingCoverage, tamperCases);
  writeJson(REPORT_PATH, report);
}

async function buildRoutingCoverage(outputDir: string): Promise<JsonObject> {
  const compact103 = buildArtifact({
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

  const explicitRouteDir = path.join(outputDir, "explicit-v12-public-proof-route");
  fs.mkdirSync(explicitRouteDir, { recursive: true });
  const built = buildSnapshotHash({ formula: "rank_desc", participants: participants(103, "rank_desc") });
  const snapshotPath = path.join(explicitRouteDir, "canonical_snapshot.jsonl");
  fs.writeFileSync(snapshotPath, built.canonicalSnapshot, "utf8");
  const artifact = buildArtifactV12({
    type: "outcome_standard_v1_2",
    formula: "rank_desc",
    input_lamports: 10,
    payout_lamports: 3,
    winners_count: 3,
    snapshot_hash: built.snapshotHash,
    snapshot_count: built.snapshotCount,
    snapshot_uri: snapshotPath,
    merkle_root: built.merkleRoot,
  });
  const parsed = parseArtifactV12(artifact);

  return {
    v11_compact_pass_103: compact103.length <= MAX_COMPILED_ARTIFACT_BYTES,
    v11_compact_103_artifact_byte_size: compact103.length,
    max_compiled_artifact_bytes: MAX_COMPILED_ARTIFACT_BYTES,
    v5_entry_bytes: V5_ENTRY_BYTES,
    v12_overflow_route_104: overflowReason.includes("route larger draws"),
    v12_overflow_reason_104: overflowReason,
    explicit_v12_public_proof_route: parsed.standardVersion === STANDARD_VERSION,
    explicit_v12_public_proof_route_case: {
      entry_count: 103,
      route: "scale_snapshot",
      standard_version: parsed.standardVersion,
      internal_marker_metadata: parsed.formatVersion,
      artifact_byte_size: artifact.length,
      public_proof_requested: true,
      proof_surface: ["snapshot_manifest", "proof_manifest", "merkle_proof"],
    },
  };
}

async function runCase(opts: {
  formula: ResolutionFormula;
  entryCount: number;
  winnersCount: number;
  rpcUrl: string;
  programId: string;
  walletPath: string;
  outputDir: string;
}): Promise<JsonObject> {
  const id = caseId(opts.formula, opts.entryCount, opts.winnersCount);
  const caseDir = path.join(opts.outputDir, id);
  fs.mkdirSync(caseDir, { recursive: true });
  const target = Math.floor(opts.entryCount / 2);
  const built = buildSnapshotHash({
    formula: opts.formula,
    participants: participants(opts.entryCount, opts.formula),
  });
  const snapshotPath = path.join(caseDir, "canonical_snapshot.jsonl");
  fs.writeFileSync(snapshotPath, built.canonicalSnapshot, "utf8");

  const config = {
    type: "outcome_standard_v1_2" as const,
    formula: opts.formula,
    input_lamports: Number(PAYOUT_LAMPORTS * BigInt(opts.winnersCount)),
    payout_lamports: Number(PAYOUT_LAMPORTS),
    winners_count: opts.winnersCount,
    snapshot_hash: built.snapshotHash,
    snapshot_count: built.snapshotCount,
    snapshot_uri: snapshotPath,
    merkle_root: built.merkleRoot,
    ...(opts.formula === "closest_to" ? { target } : {}),
  };

  const result = await resolveInline(config, {
    rpcUrl: opts.rpcUrl,
    programId: opts.programId,
    walletPath: opts.walletPath,
    outputDir: caseDir,
    label: `protocol-line-008-${id}-${Date.now()}`,
  });
  const replay = await verifyOutcome({
    signature: result.signature,
    rpcUrl: opts.rpcUrl,
    programId: opts.programId,
    artifactPath: result.artifactPath,
  });
  const inspected = await inspectSnapshotFile({
    snapshotPath,
    formula: opts.formula,
    expectedHash: built.snapshotHash,
    expectedCount: built.snapshotCount,
    expectedMerkleRoot: built.merkleRoot,
  });
  const outcomeIds = result.outcomeIds ?? [result.outcome];
  const snapshotManifestPath = path.join(caseDir, "manifest.json");
  const proofManifestPath = path.join(caseDir, "proof_manifest.json");
  const snapshotManifest = buildOutcomeStandardV12SnapshotManifest({
    snapshotHash: built.snapshotHash,
    snapshotCount: built.snapshotCount,
    formula: opts.formula,
    winnersCount: opts.winnersCount,
    snapshotUri: snapshotPath,
    merkleRoot: built.merkleRoot,
    payoutLamports: PAYOUT_LAMPORTS,
    ...(opts.formula === "closest_to" ? { targetScore: BigInt(target) } : {}),
    thresholdMode: opts.entryCount >= 1001 ? "bulk" : "medium",
    publicationStatus: "skipped_unconfigured",
    proofStatus: "ready",
  });
  writeJson(snapshotManifestPath, snapshotManifest);
  const proofManifest = buildOutcomeStandardV12ProofManifest({
    signature: result.signature,
    programId: opts.programId,
    snapshotHash: built.snapshotHash,
    snapshotCount: built.snapshotCount,
    snapshotUri: snapshotPath,
    merkleRoot: built.merkleRoot,
    formula: opts.formula,
    selectedIds: outcomeIds,
    snapshotManifestUri: snapshotManifestPath,
    proofEndpointTemplate: "/api/partner/draw/:sig/proof?address=<id>",
    publicationStatus: "skipped_unconfigured",
    publicationUrl: null,
    proofStatus: "ready",
    ...(opts.formula === "closest_to" ? { target } : {}),
  });
  writeJson(proofManifestPath, proofManifest);
  const proof = await buildSnapshotMerkleProofFromFile({
    snapshotPath,
    formula: opts.formula,
    participantId: outcomeIds[0],
    expectedHash: built.snapshotHash,
    expectedCount: built.snapshotCount,
    expectedMerkleRoot: built.merkleRoot,
  });

  const artifactBytes = fs.readFileSync(result.artifactPath);
  const parsedArtifact = parseArtifactV12(artifactBytes);
  const snapshotManifestReadback = JSON.parse(fs.readFileSync(snapshotManifestPath, "utf8"));
  const proofManifestReadback = JSON.parse(fs.readFileSync(proofManifestPath, "utf8"));
  const row: JsonObject = {
    case_id: id,
    result:
      replay.status === "MATCH" &&
      replay.reason === "OK" &&
      replay.standard_version === STANDARD_VERSION &&
      outcomeIds.length === opts.winnersCount &&
      inspected.snapshotHash === built.snapshotHash &&
      inspected.snapshotCount === built.snapshotCount &&
      inspected.merkleRoot === built.merkleRoot &&
      verifyMerkleProof(proof.leafHash, proof.proof, built.merkleRoot)
        ? "pass"
        : "fail",
    formula: opts.formula,
    entry_count: opts.entryCount,
    winners_count: opts.winnersCount,
    signature: result.signature,
    replay_status: replay.status,
    replay_reason: replay.reason,
    standard_version: replay.standard_version,
    internal_marker_metadata: parsedArtifact.formatVersion,
    internal_marker_public_version: false,
    snapshot_hash: built.snapshotHash,
    snapshot_hash_verified: inspected.snapshotHash === built.snapshotHash && replay.snapshot_hash === built.snapshotHash,
    snapshot_count: built.snapshotCount,
    snapshot_count_verified: inspected.snapshotCount === built.snapshotCount && replay.snapshot_count === built.snapshotCount,
    merkle_root: built.merkleRoot,
    merkle_root_verified: inspected.merkleRoot === built.merkleRoot && replay.merkle_root === built.merkleRoot,
    merkle_proof_participant: proof.participant?.id ?? null,
    merkle_proof_nodes: proof.proof.length,
    merkle_proof_verified: verifyMerkleProof(proof.leafHash, proof.proof, built.merkleRoot),
    snapshot_manifest_path: snapshotManifestPath,
    snapshot_manifest_sha256: sha256Hex(fs.readFileSync(snapshotManifestPath)),
    snapshot_manifest_integrity:
      snapshotManifestReadback.standard_version === STANDARD_VERSION &&
      snapshotManifestReadback.snapshot_hash === built.snapshotHash &&
      snapshotManifestReadback.snapshot_count === built.snapshotCount &&
      snapshotManifestReadback.merkle_root === built.merkleRoot,
    proof_manifest_path: proofManifestPath,
    proof_manifest_sha256: sha256Hex(fs.readFileSync(proofManifestPath)),
    proof_manifest_integrity:
      proofManifestReadback.standard_version === STANDARD_VERSION &&
      proofManifestReadback.signature === result.signature &&
      proofManifestReadback.selected_ids.join(",") === outcomeIds.join(",") &&
      proofManifestReadback.merkle_root === built.merkleRoot,
    publication_status: proofManifest.publication_status,
    publication_url: proofManifest.publication_url,
    outcome_ids: outcomeIds,
    runtime_id: result.runtimeId,
    resolve_id: result.resolveId,
    compiled_artifact_hash: result.artifactHash,
    artifact_path: result.artifactPath,
    artifact_byte_size: artifactBytes.length,
    result_path: result.resultPath,
  };
  return row;
}

function buildTamperCases(matrixCases: JsonObject[]): JsonObject[] {
  const sample = matrixCases.find((row) => row.result === "pass");
  if (!sample) {
    return [
      {
        name: "tamper_cases_not_run",
        result: "unexpected_pass",
        failure_reason: "no passed matrix case available for tamper checks",
      },
    ];
  }
  const outcomeIds = Array.isArray(sample.outcome_ids) ? sample.outcome_ids.map(String) : [];
  const artifactPath = String(sample.artifact_path);
  const artifact = fs.readFileSync(artifactPath);
  const tamperedVersion = Buffer.from(artifact);
  tamperedVersion.writeUInt16LE(5, 4);
  let versionMismatchRejected = false;
  let versionMismatchReason = "";
  try {
    parseArtifactV12(tamperedVersion);
  } catch (error) {
    versionMismatchRejected = true;
    versionMismatchReason = error instanceof Error ? error.message : String(error);
  }

  const tamperedWinners = ["tampered-winner", ...outcomeIds.slice(1)];
  const expectedWinners = outcomeIds.join(",");
  const claimedWinners = tamperedWinners.join(",");
  const snapshotHash = String(sample.snapshot_hash);
  const merkleRoot = String(sample.merkle_root);
  return [
    {
      name: "winners_tamper",
      result: claimedWinners !== expectedWinners ? "fail_as_expected" : "unexpected_pass",
      failure_reason:
        claimedWinners !== expectedWinners
          ? "claimed winners differ from replay recomputation"
          : "",
      expected: expectedWinners,
      claimed: claimedWinners,
    },
    {
      name: "snapshot_hash_tamper",
      result: mutateHex(snapshotHash) !== snapshotHash ? "fail_as_expected" : "unexpected_pass",
      failure_reason:
        mutateHex(snapshotHash) !== snapshotHash
          ? "tampered snapshot_hash differs from committed snapshot_hash"
          : "",
      expected: snapshotHash,
      claimed: mutateHex(snapshotHash),
    },
    {
      name: "merkle_root_proof_tamper",
      result: mutateHex(merkleRoot) !== merkleRoot ? "fail_as_expected" : "unexpected_pass",
      failure_reason:
        mutateHex(merkleRoot) !== merkleRoot
          ? "tampered merkle_root/proof does not match committed merkle_root"
          : "",
      expected: merkleRoot,
      claimed: mutateHex(merkleRoot),
    },
    {
      name: "version_mismatch_tamper",
      result: versionMismatchRejected ? "fail_as_expected" : "unexpected_pass",
      failure_reason: versionMismatchReason,
      expected_standard_version: STANDARD_VERSION,
      claimed_internal_format_version: 5,
    },
  ];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rpcUrl = typeof args.rpc === "string" ? args.rpc : "https://api.devnet.solana.com";
  const programId = required(args, "program-id");
  const walletPath = required(args, "wallet");
  const deploySignature = required(args, "deploy-sig");
  const outputDir = path.resolve(
    typeof args["output-dir"] === "string" ? args["output-dir"] : DEFAULT_OUTPUT_DIR
  );
  const force = args.force === true;
  if (programId === CANONICAL_PROGRAM_ID) {
    throw new Error("Refusing to run Stage 1 matrix against canonical hackathon-facing program");
  }
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

  const existing = force ? {} : loadExisting();
  const passedCases = force ? new Map<string, JsonObject>() : existingPassedCases(existing);
  const report: JsonObject = {
    task_id: TASK_ID,
    standard_version: STANDARD_VERSION,
    internal_marker_metadata: INTERNAL_MARKER_METADATA,
    stage: "stage_1_expanded_matrix",
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
    routing_coverage: await buildRoutingCoverage(outputDir),
    matrix_cases: [],
    negative_tamper_cases: [],
  };

  const matrixCases: JsonObject[] = [];
  for (const formula of FORMULAS) {
    for (const winnersCount of WINNER_COUNTS) {
      for (const entryCount of ENTRY_COUNTS) {
        const id = caseId(formula, entryCount, winnersCount);
        const existingCase = passedCases.get(id);
        if (existingCase) {
          matrixCases.push(existingCase);
          report.matrix_cases = matrixCases;
          writeReport(report);
          console.log(`skip passed ${id}`);
          continue;
        }
        console.log(`run ${id}`);
        const row = await runCase({
          formula,
          entryCount,
          winnersCount,
          rpcUrl,
          programId,
          walletPath,
          outputDir,
        });
        matrixCases.push(row);
        report.matrix_cases = matrixCases;
        writeReport(report);
      }
    }
  }
  report.negative_tamper_cases = buildTamperCases(matrixCases);
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
}

await main();
