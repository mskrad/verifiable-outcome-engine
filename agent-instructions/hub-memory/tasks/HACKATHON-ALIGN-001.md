# TASK MEMORY: HACKATHON-ALIGN-001

## Task Card Snapshot

- Problem:
  - This repository is already the standalone hackathon repo, but several docs and instructions still reference the former extracted package shape (`reference-slot/`), monorepo-only paths, and missing internal docs.
- Parent sprint / coordination frame:
  - `HACKATHON-SPRINT-1`
- Scope:
  - Align repo-facing docs, internal instructions, and shared memory to the current standalone hackathon repo shape.
  - Preserve the boundary that the ecosystem monorepo continues separately.
  - Keep runtime behavior unchanged.
- Out of scope:
  - replay semantics changes
  - runtime redesign
  - new public features
  - submission portal operations
- Acceptance:
  - Active docs and instructions point to this repository root.
  - Source-of-truth references are local and present in this repo.
  - Shared memory reflects that this repo is the hackathon repo and the monorepo is separate.
- Facts:
  - The repo root is `/Users/timurkurmangaliev/verifiable-outcome-engine`.
  - `README.md`, `RUNBOOK.md`, `DEMO_RUNBOOK.md`, `OPEN_REPO_MIGRATION.md`, `web/`, `scripts/`, and `artifacts/` exist in this repo.
  - Prior instructions still referenced `reference-slot/`, `/Users/timurkurmangaliev/web3-slot-marketplace`, and `docs/outcome_runtime/*`.
- Assumptions:
  - The repo itself should now be the canonical hackathon-facing surface.
  - Internal coordination files remain versioned, but reviewer-facing docs should not depend on them.
- Unknowns:
  - None material for this alignment patch.
- Confidence:
  - high

## Timeline

### 2026-04-09 14:42:48 +04 - Hub opened bounded alignment task

- Decision:
  - Opened `HACKATHON-ALIGN-001` to remove repo-shape discrepancies after extraction into the standalone hackathon repo.
- Status:
  - In progress.
- Notes:
  - This task is documentation/instructions alignment only.
- Facts:
  - The current repo contents already match a standalone public package layout.
- Assumptions:
  - Runtime behavior should remain unchanged.
- Unknowns:
  - None material.
- Confidence:
  - high

### 2026-04-09 14:42:48 +04 - Hub accepted and closed alignment task

- Decision:
  - Accepted and closed `HACKATHON-ALIGN-001`.
- Status:
  - Closed.
- Notes:
  - Root docs now use repository-root commands.
  - Internal instructions now treat this repo as the hackathon repo and the monorepo as a separate ecosystem line.
  - `STATUS.md` was added as the local project-visible status file.
- Facts:
  - `README.md`, `RUNBOOK.md`, `DEMO_RUNBOOK.md`, `OPEN_REPO_MIGRATION.md`, `artifacts/public_evidence_summary.json`, `artifacts/EXPECTED_TX_EXAMPLES.md`, and `web/server.mjs` were aligned.
  - `AGENTS.md`, `agent-instructions/AGENTS.md`, and `agent-instructions/hub-memory/CURRENT_TASK.md` now reference repo-local truth sources.
- Assumptions:
  - Future hackathon-surface work should start from this aligned baseline.
- Unknowns:
  - None material after the patch.
- Confidence:
  - high

## Open Items

- Run verification commands if a bounded follow-up task is opened for runtime proof.

## Handoff Pointers

- Repo status:
  - `STATUS.md`
- Shared memory:
  - `agent-instructions/hub-memory/CURRENT_TASK.md`
- Repo boundary:
  - `OPEN_REPO_MIGRATION.md`

## Default Verdict Format

1. Brief conclusion
2. Main decision / result
3. Alternatives
4. Risks / limitations
5. Confidence level

## Final Status

- Accepted and closed.
