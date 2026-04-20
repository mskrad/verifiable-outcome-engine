# TASK MEMORY: HACKATHON-DEMO-001

## Task Card Snapshot

- Problem:
  - The public docs, replay command path, and UI copy are now accepted, but the judge-facing browser flow is not yet validated as a bounded artifact.
  - The remaining risk before pitch work is whether `reference-slot/web/` actually supports the intended blessed-signature verification flow without manual reconstruction by the judge.
- Parent sprint / coordination frame:
  - `HACKATHON-SPRINT-1`
- Scope:
  - Validate the existing browser demo flow for the public `reference-slot/web/` surface.
  - Confirm that the verify page accepts and preserves blessed-signature prefill parameters:
    - `sig`
    - `rpc`
    - `programId`
  - Confirm that visible defaults remain judge-safe:
    - RPC -> `https://api.devnet.solana.com`
    - program id -> `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
  - If a blocker exists, identify the narrowest affected surface:
    - `reference-slot/web/public/play.html`
    - `reference-slot/web/public/verify.html`
    - `reference-slot/web/server.mjs`
- Out of scope:
  - core runtime changes
  - replay semantic changes
  - artifact binding changes
  - README rewrite
  - broad UI redesign
  - pitch script or social copy
- Acceptance:
  - At least one blessed-signature path from the public demo surface reaches `verify.html` with the required params present.
  - Verify page pre-fills `sig`, `rpc`, and `programId` from the blessed link or query string.
  - Visible defaults remain devnet-safe and judge-facing.
  - Tester can state whether the judge flow is:
    - PASS as-is
    - blocked, with the blocker pinned to the smallest frontend-serving surface
- Facts:
  - `HACKATHON-DOCS-001` is accepted and closed.
  - `HACKATHON-VERIFY-001` is accepted and closed.
  - `HACKATHON-UI-001` is accepted and closed.
  - Canonical devnet program id:
    - `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
- Assumptions:
  - The intended judge path is `play.html` -> blessed link -> `verify.html` -> verify action.
  - The needed data is already present in the public surface or in its query params.
- Unknowns:
  - Whether the existing browser flow already satisfies the "≤2 clicks" sprint-level acceptance.
- Confidence:
  - high

## Timeline

### 2026-04-09 00:00:00 +04 - Hub opened bounded demo verification task

- Decision:
  - Opened `HACKATHON-DEMO-001` as a narrow browser/demo-flow verification task under `HACKATHON-SPRINT-1`.
- Status:
  - Ready for Tester.
- Notes:
  - Start with verification, not implementation.
  - If a blocker is found, keep findings bounded to the smallest frontend-serving surface.
- Confidence:
  - high

## Open Items

- Tester should validate blessed prefill flow and visible devnet-safe defaults.

### 2026-04-09 00:30:00 +04 - Tester accepted bounded browser demo flow

- Decision:
  - Accepted the public browser demo flow as-is.
- Verification:
  - live local server health -> `ok: true`
  - blessed signatures API -> 2 active blessed entries
  - `play.html` builds `Open in Verify` links with:
    - `sig`
    - `rpc`
    - `programId`
  - concrete blessed link path confirmed:
    - `/verify.html?sig=...&rpc=https%3A%2F%2Fapi.devnet.solana.com&programId=3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
  - `verify.html` prefill logic confirmed for:
    - `sig`
    - `rpc`
    - `programId`
  - visible defaults remain:
    - RPC -> `https://api.devnet.solana.com`
    - program id -> `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
- Scope check:
  - no core runtime, replay semantic, artifact binding, README, or broad UI work required
  - no blocker found in:
    - `reference-slot/web/public/play.html`
    - `reference-slot/web/public/verify.html`
    - `reference-slot/web/public/spec.html`
    - `reference-slot/web/public/index.html`
    - `reference-slot/web/server.mjs`
- Notes:
  - full browser click-through automation was not available because the local Playwright browser binary is absent in this environment
  - acceptance is based on live server/API evidence plus direct HTML/JS verification
- Status:
  - Ready for Hub close
- Confidence:
  - medium

### 2026-04-09 00:45:00 +04 - Hub closed bounded demo verification task

- Decision:
  - Closed `HACKATHON-DEMO-001` as accepted.
- Close basis:
  - Tester found no blocker in the checked public demo surface
  - blessed verify links preserve `sig`, `rpc`, and `programId`
  - verify-page prefill logic and visible defaults remain devnet-safe and judge-facing
  - no broader UI/runtime scope expansion was required
- Notes:
  - Full click-through browser automation was unavailable in this environment due to missing browser binary.
  - Acceptance is still valid for this bounded task because it is grounded in live server/API evidence plus direct HTML/JS verification.
- Final status:
  - Accepted and closed.
- Next effect on flow:
  - active bounded task switches to `HACKATHON-PITCH-001`
- Confidence:
  - medium

## Handoff Pointers

- Current state:
  - `agent-instructions/hub-memory/CURRENT_TASK.md`
  - `docs/outcome_runtime/status.md`
- Browser surface:
  - `reference-slot/web/public/play.html`
  - `reference-slot/web/public/verify.html`
  - `reference-slot/web/public/spec.html`
  - `reference-slot/web/public/index.html`
  - `reference-slot/web/server.mjs`
- Evidence references:
  - `reference-slot/artifacts/outcome_devnet_blessed_signatures.json`
  - `reference-slot/DEMO_RUNBOOK.md`

## Final Status

- Accepted and closed.

## Default Verdict Format

1. Brief conclusion
2. Main decision / result
3. Alternatives
4. Risks / limitations
5. Confidence level
