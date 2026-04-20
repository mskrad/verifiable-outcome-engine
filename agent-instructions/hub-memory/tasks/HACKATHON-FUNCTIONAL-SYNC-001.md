# TASK MEMORY: HACKATHON-FUNCTIONAL-SYNC-001

## Task Card Snapshot

- Problem:
  - The standalone hackathon repo lagged behind the accepted public functional surface: operator resolve was missing, SDK helpers were incomplete, and the active runtime surface still depended on legacy compiled-spec and metrics artifact files.
- Parent sprint / coordination frame:
  - `HACKATHON-SPRINT-1`
- Scope:
  - Sync only the standalone repo runtime/functionality layer with the accepted public operator surface.
  - Keep hackathon docs polish out of scope for this task.
  - Remove active runtime dependency on legacy compiled-spec and metrics artifact files.
- Out of scope:
  - replay semantics changes
  - runtime redesign
  - hackathon copywriting / docs polish
  - submission portal operations
- Acceptance:
  - `yarn -s replay --help` still works from repo root.
  - `yarn -s resolve:operator --help` exists and works from repo root.
  - The active web/runtime surface no longer requires `artifacts/compiled_spec_v2.*` or `artifacts/metrics.json`.
- Facts:
  - The standalone repo already contained `scripts/replay_verify.ts`, `web/`, and blessed evidence artifacts.
  - It did not yet contain `scripts/resolve_reference_operator.ts`.
  - `package.json` did not yet expose `resolve:operator`.
  - `web/server.mjs` and `web/public/spec.html` still surfaced legacy compiled-spec and metrics operator data.
- Assumptions:
  - The standalone repo should carry the operator resolve helper as operator/reference functionality.
  - Reviewer-facing docs can be polished later in a separate bounded task.
- Unknowns:
  - None material for this sync.
- Confidence:
  - high

## Timeline

### 2026-04-09 17:27:43 +04 - Hub opened bounded functional sync task

- Decision:
  - Opened `HACKATHON-FUNCTIONAL-SYNC-001` to align the standalone repo with the current operator-enabled public functional surface.
- Status:
  - In progress.
- Notes:
  - Scope was kept strictly to runtime/functionality and internal task-state synchronization.
- Facts:
  - The standalone repo had no active bounded task at open.
- Assumptions:
  - Existing reviewer docs would be handled separately.
- Unknowns:
  - None material.
- Confidence:
  - high

### 2026-04-09 17:27:43 +04 - Hub accepted and closed functional sync task

- Decision:
  - Accepted and closed `HACKATHON-FUNCTIONAL-SYNC-001`.
- Status:
  - Closed.
- Notes:
  - Added `scripts/resolve_reference_operator.ts` and the root-level `resolve:operator` command.
  - Extended `scripts/outcome_public_sdk.ts` with operator helpers required by the resolve command.
  - Removed active runtime dependence on legacy compiled-spec and metrics operator files from `web/server.mjs`, `web/public/spec.html`, and the exported evidence summary.
- Facts:
  - Legacy files `artifacts/compiled_spec_v2.json`, `artifacts/compiled_spec_v2.bin`, and `artifacts/metrics.json` were removed from the standalone repo runtime surface.
  - `tmp/` is now ignored locally for operator output.
- Assumptions:
  - Follow-up docs polish, if needed, should be opened as a separate bounded task.
- Unknowns:
  - None material after local command validation.
- Confidence:
  - high

## Open Items

- Open a separate bounded docs task if repo-facing copy needs cleanup after the functional sync.

## Handoff Pointers

- Repo status:
  - `STATUS.md`
- Shared memory:
  - `agent-instructions/hub-memory/CURRENT_TASK.md`
- Functional entrypoints:
  - `package.json`
  - `scripts/replay_verify.ts`
  - `scripts/resolve_reference_operator.ts`

## Default Verdict Format

1. Brief conclusion
2. Main decision / result
3. Alternatives
4. Risks / limitations
5. Confidence level

## Final Status

- Accepted and closed.
