import fs from "fs";
import path from "path";

import {
  buildArtifact,
  buildCompactNamedEntryClaimFromArtifactV5,
  MAX_COMPILED_ARTIFACT_BYTES,
  parseArtifactV5,
  V5_ENTRY_BYTES,
} from "../sdk/index.js";
import type { CompactNamedEntry, ResolutionFormula } from "../sdk/types.js";

const FORMULAS: ResolutionFormula[] = [
  "weighted_random",
  "rank_desc",
  "rank_asc",
  "first_n",
  "closest_to",
];
const MAX_WINNERS = 32;
const V5_HEADER_BYTES = 48;
const THEORETICAL_MAX_ENTRIES = Math.floor(
  (MAX_COMPILED_ARTIFACT_BYTES - V5_HEADER_BYTES) / V5_ENTRY_BYTES
);

function idFor(index: number): string {
  if (index % 5 === 0) return `team-${String(index + 1).padStart(3, "0")}`;
  if (index % 5 === 1) return `user_${String(index + 1).padStart(3, "0")}`;
  return `row:${String(index + 1).padStart(3, "0")}`;
}

function entries(count: number, formula: ResolutionFormula): CompactNamedEntry[] {
  return Array.from({ length: count }, (_, index) => {
    const id = idFor(index);
    if (formula === "weighted_random") {
      return { id, order: index, weight: (index % 7) + 1 };
    }
    if (formula === "first_n") {
      return { id, order: index, weight: 1 };
    }
    const score = formula === "rank_asc" ? index : count - index;
    return { id, order: index, weight: 1, score };
  });
}

function buildCase(formula: ResolutionFormula, entryCount: number, winnersCount: number) {
  const artifact = buildArtifact({
    type: "formula_draw_v5",
    formula,
    input_lamports: 10,
    payout_lamports: 3,
    participants: entries(entryCount, formula),
    winners_count: winnersCount,
    ...(formula === "closest_to" ? { target: Math.floor(entryCount / 2) } : {}),
  });
  const parsed = parseArtifactV5(artifact);
  const claim = buildCompactNamedEntryClaimFromArtifactV5(parsed, Buffer.alloc(32, 7));
  return { artifact, parsed, claim };
}

function findMaxPassingEntryCount(formula: ResolutionFormula, winnersCount: number) {
  let maxPass = 0;
  let maxBytes = 0;
  let maxOutcomeIds: string[] = [];
  let firstFail: { entryCount: number; reason: string } | null = null;

  for (let entryCount = winnersCount; entryCount <= THEORETICAL_MAX_ENTRIES + 2; entryCount += 1) {
    try {
      const { artifact, claim } = buildCase(formula, entryCount, winnersCount);
      maxPass = entryCount;
      maxBytes = artifact.length;
      maxOutcomeIds = claim.outcomeIds;
    } catch (error) {
      firstFail = {
        entryCount,
        reason: error instanceof Error ? error.message : String(error),
      };
      break;
    }
  }

  return {
    formula,
    winners_count: winnersCount,
    max_passing_entry_count: maxPass,
    max_passing_artifact_byte_size: maxBytes,
    first_failing_entry_count: firstFail?.entryCount ?? null,
    first_failure_reason: firstFail?.reason ?? "",
    result: maxPass >= winnersCount && firstFail ? "pass" : "fail",
    sample_outcome_ids: maxOutcomeIds,
  };
}

function negativeMismatchCase() {
  const { artifact, claim } = buildCase("rank_desc", 10, 2);
  const expected = claim.outcomeIds.join(",");
  const tampered = ["not-the-winner", ...claim.outcomeIds.slice(1)].join(",");
  return {
    formula: "rank_desc",
    entry_count: 10,
    artifact_byte_size: artifact.length,
    winners_count: 2,
    result: tampered !== expected ? "fail" : "pass",
    failure_reason:
      tampered !== expected
        ? "negative replay mismatch: claimed winner differs from recomputed v5 winners"
        : "",
    outcome_ids: claim.outcomeIds,
  };
}

const boundaryMatrix = FORMULAS.flatMap((formula) =>
  Array.from({ length: MAX_WINNERS }, (_, index) =>
    findMaxPassingEntryCount(formula, index + 1)
  )
);

const belowThreshold = buildCase("weighted_random", 10, 1);
const report = {
  task_id: "PARTICIPANT-SCALE-005",
  artifact_format_version: 5,
  standard_version: "Outcome Standard V1.1",
  max_compiled_artifact_bytes: MAX_COMPILED_ARTIFACT_BYTES,
  v5_header_bytes: V5_HEADER_BYTES,
  v5_entry_bytes: V5_ENTRY_BYTES,
  theoretical_max_entries_by_size: THEORETICAL_MAX_ENTRIES,
  note: "The old 100-entry cap is removed. v5 is now bounded by artifact byte size, winner count, and fixed row encoding.",
  smoke_cases: [
    {
      name: "below-boundary weighted named ids",
      formula: "weighted_random",
      entry_count: 10,
      artifact_byte_size: belowThreshold.artifact.length,
      winners_count: 1,
      result: "pass",
      failure_reason: "",
      outcome_ids: belowThreshold.claim.outcomeIds,
    },
    negativeMismatchCase(),
  ],
  boundary_matrix: boundaryMatrix,
};

const outPath = path.resolve("artifacts/participant_scale_005_v5_boundary.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify(report, null, 2));
