# TASK MEMORY: HACKATHON-DOCS-001

## Task Card Snapshot

- Problem:
  - `reference-slot/README.md` is still reviewer/package-facing and opens with internal packaging context instead of a judge-facing product narrative.
  - A short pitch/demo runbook for the hackathon-facing flow does not exist yet under `reference-slot/`.
- Parent sprint / coordination frame:
  - `HACKATHON-SPRINT-1`
- Scope:
  - Documentation-only.
  - Rewrite `reference-slot/README.md` around `Verifiable Outcome Engine`.
  - Create `reference-slot/DEMO_RUNBOOK.md` with a short reproducible demo path.
  - Keep `reference-slot/` as the only public package surface.
  - Keep replay claims tied to transaction signature plus public RPC data.
- Out of scope:
  - on-chain core changes
  - RNG contract changes
  - replay semantic changes
  - artifact binding changes
  - `reference-slot/web/` title/UI changes
  - live browser resolve
  - new use-cases beyond raffle/winner-selection narrative
  - broad SDK or package publishing
- Acceptance:
  - `reference-slot/README.md` opens with problem -> solution -> verify flow, not packaging internals.
  - README uses `Verifiable Outcome Engine` as the primary project name.
  - README presents raffle/winner selection as the first proof scenario, not as the whole product.
  - README does not claim "just a transaction signature", "forever", "signed event", implemented protocol fees, or release-complete/product rollout.
  - `reference-slot/DEMO_RUNBOOK.md` exists and gives a 3-5 step demo flow with expected `MATCH / OK` result.
  - Demo runbook includes fallback to accepted blessed devnet signatures if live resolve is unavailable.
  - No core/runtime/replay/web implementation files are changed.
- Facts:
  - `OUTCOME-PACKAGING-007` is accepted and closed.
  - `reference-slot/` is the only public export seed.
  - Canonical devnet program id:
    - `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
  - Accepted blessed signatures source-of-truth:
    - `docs/outcome_runtime/outcome_devnet_blessed_signatures.json`
  - Current README is still titled `Outcome Public Reference Package`.
- Assumptions:
  - The judge-facing narrative should be `Verifiable Outcome Engine for Solana`.
  - Raffle/winner selection is the safest first proof scenario for Sprint 1.
  - Live resolve may be useful later but is not required for this doc task.
- Unknowns:
  - Whether the final public repository name will remain `outcome-runtime-reference`.
  - Whether Colosseum Frontier requires a formal weekly update artifact.
- Confidence:
  - high

## Timeline

### 2026-04-07 00:00:00 +04 - Hub opened bounded docs task

- Decision:
  - Opened `HACKATHON-DOCS-001` as a documentation-only task under `HACKATHON-SPRINT-1`.
- Status:
  - Ready for Documenter.
- Notes:
  - Do not change `core/contracts/*`, replay logic, artifact authority, or `reference-slot/web/*` in this task.
  - UI/title work belongs to `HACKATHON-UI-001`.
  - Blessed signature verification belongs to `HACKATHON-VERIFY-001`.
- Facts:
  - `reference-slot/README.md` still has package/reviewer framing.
  - `reference-slot/DEMO_RUNBOOK.md` does not exist yet.
- Assumptions:
  - README and runbook can be updated without changing runtime behavior.
- Unknowns:
  - None blocking this task.
- Confidence:
  - high

### 2026-04-07 01:24:13 +04 - Documenter completed hackathon-facing docs pass

- Decision:
  - Completed documentation-only pass within bounded scope.
- Files updated:
  - `reference-slot/README.md`
  - `reference-slot/DEMO_RUNBOOK.md`
- Result:
  - README now opens with problem -> solution -> verify flow.
  - Primary name is `Verifiable Outcome Engine`.
  - Raffle / winner selection is presented as the first proof scenario, not the whole product.
  - Verification claims are bounded to transaction signature plus public RPC data for accepted blessed devnet evidence.
  - DEMO_RUNBOOK gives a 4-step flow with expected `MATCH / OK`.
  - Fallback via accepted blessed devnet signatures is documented.
- Scope guardrails:
  - no core runtime changes
  - no RNG/replay semantics changes
  - no artifact binding changes
  - no web UI/title changes
  - no live browser resolve
  - no new use-cases
  - no SDK/package publishing
- Facts:
  - Branch checked as `main`.
  - `reference-slot/DEMO_RUNBOOK.md` did not exist before this pass.
- Assumptions:
  - `outcome-runtime-reference` remains acceptable in copy/paste commands because final public repository name is still unknown.
- Unknowns:
  - Final public repository name remains unknown.
- Confidence:
  - high

### 2026-04-07 01:40:00 +04 - Hub reviewed docs pass and applied narrative cleanup

- Decision:
  - Did not close the task yet; moved to Tester validation.
- Status:
  - Ready for Tester.
- Notes:
  - Hub found public-facing README leakage of internal terms including `bounded`, `docs task`, `reference package`, and repeated `accepted/acceptance` framing.
  - Applied a small docs-only cleanup to keep the public surface judge-facing.
  - Kept all changes inside `reference-slot/README.md` and `reference-slot/DEMO_RUNBOOK.md`.
- Facts:
  - No core runtime, replay semantics, artifact binding, web UI code, live browser resolve, SDK, or new use-case changes were made.
  - Public docs now avoid the searched internal/legacy terms:
    - `slot`
    - `spin`
    - `reel`
    - `payline`
    - `paytable`
    - `casino`
    - `game engine`
    - `bounded`
    - `docs task`
    - `reference package`
    - `accepted`
    - `acceptance`
    - `execution contract`
- Assumptions:
  - `outcome-runtime-reference` remains acceptable in copy/paste commands until the final public repository name is confirmed.
- Unknowns:
  - Final public repository name remains unknown.
- Confidence:
  - high

### 2026-04-08 00:00:00 +04 - Tester-lite accepted narrative and blocked close on replay command failure

- Decision:
  - Do not close `HACKATHON-DOCS-001` yet.
  - Narrative quality passed, but command-surface validation found a real blocker outside docs text quality.
- Status:
  - Blocked by `HACKATHON-VERIFY-001`.
- Findings:
  - README narrative structure -> PASS
  - public-claim and legacy-term grep checks -> PASS
  - `yarn -s replay --help` -> FAIL with `ERR_UNKNOWN_FILE_EXTENSION`
  - documented replay command path could not be reproduced as written
- Notes:
  - This is not a copy issue; it is a public verification entrypoint issue.
  - The docs task becomes closable only after the public replay command path is fixed and revalidated.
- Confidence:
  - high

### 2026-04-08 00:00:00 +04 - Hub linked docs close to verify task

- Decision:
  - Opened `HACKATHON-VERIFY-001` as a separate bounded task instead of expanding docs scope.
- Status:
  - Pending close after verify acceptance.
- Notes:
  - `HACKATHON-DOCS-001` remains documentation-only.
  - No further docs edits are required unless the public replay command itself changes.
- Confidence:
  - high

### 2026-04-09 00:00:00 +04 - Hub closed bounded docs task after verify unblock

- Decision:
  - Closed `HACKATHON-DOCS-001` as accepted.
- Close basis:
  - public docs narrative and claim boundaries were already accepted
  - `HACKATHON-VERIFY-001` removed the only blocking issue in the public replay command path
  - no additional docs edits were required after the verify fix because the public command surface remained unchanged
- Final status:
  - Accepted and closed.
- Next effect on flow:
  - active bounded task can switch to `HACKATHON-UI-001`
- Confidence:
  - high

## Open Items

- None.

## Handoff Pointers

- Sprint plan:
  - `agent-instructions/hub-memory/SPRINT_1_HACKATHON.md`
- Current state:
  - `agent-instructions/hub-memory/CURRENT_TASK.md`
  - `docs/outcome_runtime/status.md`
- Accepted packaging report:
  - `docs/outcome_runtime/outcome_public_packaging_report.md`
- Execution contract:
  - `docs/outcome_runtime/v0_1_0_execution_contract.md`
- Public package docs to edit:
  - `reference-slot/README.md`
  - `reference-slot/DEMO_RUNBOOK.md`
- Evidence references:
  - `reference-slot/artifacts/outcome_devnet_blessed_signatures.json`
  - `reference-slot/artifacts/EXPECTED_TX_EXAMPLES.md`
  - `reference-slot/artifacts/public_evidence_summary.json`

## Final Status

- Accepted and closed.

## Default Verdict Format

1. Brief conclusion
2. Main decision / result
3. Alternatives
4. Risks / limitations
5. Confidence level
