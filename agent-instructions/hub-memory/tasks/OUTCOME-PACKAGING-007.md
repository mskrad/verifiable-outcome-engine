# TASK MEMORY TEMPLATE: OUTCOME-PACKAGING-007

## Task Card Snapshot

- Problem:
  - После accepted outcome-core bounded packages, accepted devnet gate, accepted broader coverage и bounded adapters docs package нужно отдельно собрать один bounded public reference package без утечки monorepo-only assumptions.
- Scope:
  - bounded public packaging only
  - один public reference package under `reference-slot/`
  - standalone replay/web reviewer surface
  - accepted docs/evidence curation only
  - без runtime redesign
  - без reopen accepted tasks
  - без adapters code export
  - без UI/product rollout
- Acceptance:
  - public code export stays on `reference-slot/`
  - exported package does not depend on monorepo-only paths/commands
  - public docs/evidence are derived only from accepted source-of-truth
  - exact exported file list and bounded packaging report are present
  - `examples/*`, `core/contracts/*`, `agent-instructions/*` are not exported as public code surface

## Timeline

### 2026-03-31 00:30:00 MSK - Engineer started bounded public packaging package

- Decision:
  - Took the task directly on Engineer scope from the bounded packaging plan.
- Status:
  - Engineer implementation in progress
- Notes:
  - safest default is to keep a single public package line under `reference-slot/`
  - accepted adapters remain docs-only evidence, not exported code

## Open Items

- Tester should validate the final exported file set, standalone package assumptions, and reviewer docs consistency.

## Handoff Pointers

- Plan:
  - `docs/plans/2026-03-31-outcome-public-packaging.md`
- Frozen baseline:
  - `docs/outcome_runtime/v0_1_0_execution_contract.md`
- Accepted upstream evidence:
  - `docs/outcome_runtime/outcome_bounded_package_1_report.md`
  - `docs/outcome_runtime/outcome_bounded_package_2_report.md`
  - `docs/outcome_runtime/outcome_devnet_gate_report.md`
  - `docs/outcome_runtime/outcome_broader_coverage_report.md`
  - `docs/outcome_runtime/outcome_adapters_package_report.md`
- Authoritative public replay source:
  - `docs/outcome_runtime/outcome_devnet_blessed_signatures.json`

## Engineer Append

### 2026-03-31 01:00:50 MSK - Standalone public reference package prepared

- Decision:
  - kept public code export strictly on `reference-slot/`
  - did not export `examples/*`, `core/contracts/*`, or `agent-instructions/*`
  - did not reopen accepted runtime/devnet/coverage/adapters tasks
- Implementation:
  - rewired `reference-slot/package.json` to local standalone scripts only
  - replaced legacy monorepo-dependent replay wiring with:
    - `reference-slot/scripts/replay_verify.ts`
    - `reference-slot/scripts/outcome_public_sdk.ts`
  - copied public runtime assets into package:
    - `reference-slot/artifacts/outcome_idl.json`
    - `reference-slot/artifacts/outcome_devnet_blessed_signatures.json`
    - `reference-slot/artifacts/public_evidence_summary.json`
  - rewrote reviewer docs/web surface:
    - `reference-slot/README.md`
    - `reference-slot/RUNBOOK.md`
    - `reference-slot/REVIEWER_RUNBOOK.md`
    - `reference-slot/OPEN_REPO_MIGRATION.md`
    - `reference-slot/web/*`
  - created bounded report:
    - `docs/outcome_runtime/outcome_public_packaging_report.md`
  - updated status:
    - `docs/outcome_runtime/status.md`
- Exact export contract:
  - frozen in:
    - `reference-slot/OPEN_REPO_MIGRATION.md`
  - includes `reference-slot/yarn.lock`
  - excludes install artifacts:
    - `reference-slot/node_modules/**`
    - `reference-slot/.DS_Store`
- Verification:
  - `cd reference-slot && yarn install` -> PASS
  - `cd reference-slot && yarn -s replay --help` -> PASS
  - standalone replay on blessed signature:
    - `3iC7i15CakPWD47DZ72WgYYuKQdPW8qwu2Usy77rm8RjKkvocvELHqN1yMqM4MiXLcpiAb52u6z2btMKCAZsmDW1`
    - `verification_result: MATCH`
    - `verification_reason: OK`
  - standalone replay on second blessed signature:
    - `KMsg6dqUWWNoYfNs6FZhVFWyC76MJN5U8vN61FeeVjTHAZrS9vyAJYDykxUQftvVyrJhV2phSCMXZV41LDbnE8q`
    - `verification_result: MATCH`
    - `verification_reason: OK`
  - standalone web health:
    - `yarn web` -> listener on `127.0.0.1:8787`
    - `/api/health` -> `ok: true`
    - `/api/blessed-signatures` -> both active blessed signatures served
- Status:
  - Engineer package ready for Tester

### 2026-04-03 16:18:24 +04 - Documenter completed bounded public packaging pass

- Decision:
  - no blocker doc issue found in the bounded public packaging narrative
- Updated docs/evidence:
  - `docs/outcome_runtime/outcome_public_packaging_report.md`
  - `reference-slot/README.md`
  - `reference-slot/artifacts/public_evidence_summary.json`
- Alignment applied:
  - report status aligned to tester-accepted state
  - accepted packaging evidence narrowed to commit `4a297ca` plus:
    - `cd reference-slot && yarn install`
    - `cd reference-slot && yarn -s replay --help`
  - public package source-of-truth mapping made explicit
  - `reference-slot/` remains the only public export seed
  - no adapters code export and no reopen of accepted runtime/devnet/coverage/adapters tasks
- Status for Hub:
  - `Documenter ready / Hub release-gate decision`

### 2026-04-03 17:02:00 +04 - Hub accepted bounded public packaging release-gate

- Decision:
  - Accepted and closed in bounded scope.
- Release-gate confirmation:
  - `reference-slot/` remains the single public export seed
  - packaging narrative stays strictly bounded:
    - no runtime redesign
    - no reopen of accepted package 1 / package 2 / devnet / coverage / adapters tasks
    - no adapters code export
    - no product or release-complete claim
  - public docs/evidence stay tied only to accepted source-of-truth:
    - `docs/outcome_runtime/outcome_devnet_blessed_signatures.json`
    - `docs/specs/outcome_replay_contract_v1.md`
    - accepted outcome reports under `docs/outcome_runtime/`
  - `examples/*`, `core/contracts/*`, and `agent-instructions/*` are not presented as public code surface
  - accepted packaging evidence remains intentionally narrow:
    - commit `4a297ca`
    - `cd reference-slot && yarn install`
    - `cd reference-slot && yarn -s replay --help`
- Status:
  - Hub closed / no next bounded task opened yet
