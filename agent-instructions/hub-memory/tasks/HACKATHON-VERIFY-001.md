# TASK MEMORY: HACKATHON-VERIFY-001

## Task Card Snapshot

- Problem:
  - Tester-lite found that the public replay command from `reference-slot/DEMO_RUNBOOK.md` fails before execution with `ERR_UNKNOWN_FILE_EXTENSION` under the current ESM TypeScript setup.
  - `HACKATHON-DOCS-001` cannot be closed while the judge-facing runbook command surface is broken.
- Parent sprint / coordination frame:
  - `HACKATHON-SPRINT-1`
- Scope:
  - Fix the public replay entrypoint under `reference-slot/` so the documented command path actually runs.
  - Validate the public command surface with:
    - `cd reference-slot && yarn -s replay --help`
    - blessed devnet replay using the documented flags
  - Keep the fix minimal and public-surface-only.
- Out of scope:
  - core runtime refactor
  - replay semantic changes
  - artifact binding changes
  - web UI changes
  - README rewrite
  - new public repository work
- Acceptance:
  - `cd reference-slot && yarn -s replay --help` completes without `ts-node` / ESM crash.
  - Blessed devnet replay completes through the public command path.
  - Expected result contains:
    - `verification_result : MATCH`
    - `verification_reason : OK`
  - Fix remains minimal and does not add monorepo-only dependencies.
  - `HACKATHON-DOCS-001` becomes closable after Tester validation.
- Facts:
  - Current public package file:
    - `reference-slot/package.json`
  - Failing script before fix:
    - `TS_NODE_PROJECT=tsconfig.json ts-node --transpile-only scripts/replay_verify.ts`
  - Canonical devnet program id:
    - `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
- Assumptions:
  - The failure is an execution-path issue, not a replay logic issue.
  - The public command should stay `yarn -s replay ...` after the fix.
- Unknowns:
  - Whether Node / `ts-node` warnings should be polished away for the hackathon demo.
- Confidence:
  - high

## Timeline

### 2026-04-08 00:00:00 +04 - Hub opened bounded verify task

- Decision:
  - Opened `HACKATHON-VERIFY-001` as a narrow public replay verification task under `HACKATHON-SPRINT-1`.
- Status:
  - Ready for Engineer.
- Notes:
  - Keep the fix inside the public package surface.
  - Do not widen scope into replay semantics or runtime changes.
- Facts:
  - Tester-lite blocked `HACKATHON-DOCS-001` because `yarn -s replay` crashed before execution.
- Confidence:
  - high

### 2026-04-08 00:00:00 +04 - Engineer applied minimal replay entrypoint fix

- Decision:
  - Switched the public replay script in `reference-slot/package.json` to explicit ESM mode for `ts-node`.
- Files updated:
  - `reference-slot/package.json`
- Result:
  - Script changed from:
    - `ts-node --transpile-only scripts/replay_verify.ts`
  - To:
    - `ts-node --esm --transpile-only scripts/replay_verify.ts`
  - Public command surface remains unchanged:
    - `yarn -s replay --help`
    - `yarn -s replay --sig ... --url ... --program-id ...`
- Engineer-reported verification:
  - `yarn -s replay --help` -> PASS
  - blessed devnet replay -> `verification_result : MATCH`
  - blessed devnet replay -> `verification_reason : OK`
- Scope guardrails:
  - no replay logic changes
  - no `tsconfig.json` changes
  - no docs changes
  - no web UI changes
- Notes:
  - Node warning `DEP0180` may still appear, but it is non-blocking for acceptance.
- Status:
  - Ready for Tester.
- Confidence:
  - medium

## Open Items

- Tester should independently validate the fixed public replay command path and blessed replay result.

### 2026-04-09 00:00:00 +04 - Tester accepted bounded public replay command fix

- Decision:
  - Accepted the bounded fix for the public replay command path.
- Verification:
  - `cd reference-slot && yarn -s replay --help` -> PASS
  - no `ts-node` / ESM crash observed
  - blessed devnet replay through the public command path -> `verification_result : MATCH`
  - blessed devnet replay through the public command path -> `verification_reason : OK`
- Scope check:
  - fix remains minimal and limited to `reference-slot/package.json`
  - no monorepo-only dependency added in the verified public command path
  - no evidence of core runtime, replay semantic, artifact binding, web UI, or README scope expansion
- Result:
  - `HACKATHON-VERIFY-001` can be closed
  - blocker for `HACKATHON-DOCS-001` is removed
- Confidence:
  - high

### 2026-04-09 00:00:00 +04 - Hub closed bounded verify task

- Decision:
  - Closed `HACKATHON-VERIFY-001` as accepted.
- Close basis:
  - public replay entrypoint works through the documented command surface
  - independent Tester verdict is PASS
  - docs blocker is removed without widening scope
- Final status:
  - Accepted and closed.
- Next effect on flow:
  - `HACKATHON-DOCS-001` becomes closable
  - active bounded task switches to `HACKATHON-UI-001`
- Confidence:
  - high

## Handoff Pointers

- Current state:
  - `agent-instructions/hub-memory/CURRENT_TASK.md`
  - `docs/outcome_runtime/status.md`
- Blocked docs task:
  - `agent-instructions/hub-memory/tasks/HACKATHON-DOCS-001.md`
- Public package:
  - `reference-slot/package.json`
  - `reference-slot/scripts/replay_verify.ts`
  - `reference-slot/DEMO_RUNBOOK.md`
- Evidence references:
  - `reference-slot/artifacts/outcome_devnet_blessed_signatures.json`
  - `reference-slot/artifacts/EXPECTED_TX_EXAMPLES.md`

## Final Status

- Accepted and closed.

## Default Verdict Format

1. Brief conclusion
2. Main decision / result
3. Alternatives
4. Risks / limitations
5. Confidence level
