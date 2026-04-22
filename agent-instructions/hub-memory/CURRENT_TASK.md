# CURRENT TASK

- Timestamp: 2026-04-22 13:27:02 +0300
- Active Task ID: HACKATHON-LICENSE-DOCS-001
- Parent Sprint: HACKATHON-SPRINT-3 (Apr 19–25)
- Current Stage: READY FOR TESTER
- Hub Decision: `HACKATHON-LICENSE-DOCS-001` updated public docs and licensing copy to match the accepted protocol-fee / partner-instance business model.
- Next Owner: Tester
- Next Action: Verify licensing/docs copy, grep for removed self-deploy/open-source claims, and run documentation verification commands.
- Task Memory File: `agent-instructions/hub-memory/tasks/HACKATHON-LICENSE-DOCS-001.md`
- Sprint Plan: `agent-instructions/hub-memory/HACKATHON_ROADMAP.md`
- Previous Task Memory: `agent-instructions/hub-memory/tasks/HACKATHON-CONFIG-ENGINE-001.md`
- Previous Task Memory: `agent-instructions/hub-memory/tasks/HACKATHON-RAFFLE-FIX-001.md`

## Development Flow

- `HACKATHON-SPRINT-3` is the active sprint-level coordination frame.
- `HACKATHON-LICENSE-DOCS-001` is READY FOR TESTER after license/docs copy was updated for SDK MIT integration use, canonical program protocol fee, and partner instances.
- `HACKATHON-DESIGN-ADAPT-001` is ACCEPTED on `design/claude-design-v1`; merge to `main` is pending.
- `HACKATHON-PHANTOM-001` is READY FOR ARCHITECT and is the next active Sprint 3 task.
- Completed Sprint 3 doc/task details remain in each task memory file; this current-task file should not imply an active handoff for already accepted work.
- `HACKATHON-DEVPAGE-001` is accepted and committed as `db12eeb`.
- `HACKATHON-DEPLOY-001` is accepted after public HTTPS deploy verification.
- `HACKATHON-TIMELINE-001` is closed and accepted after Tester re-verified the mobile overflow fix.
- `HACKATHON-CONFIG-ENGINE-001` is accepted and provides config/SDK support used by the current reviewer flow.
- `HACKATHON-RUST-SOURCE-001` is closed and remains limited to the minimal canonical `outcome` Rust source disclosure.
- `HACKATHON-CONTRACT-CHECK-001` is closed and remains limited to review/test of `programs/outcome/` plus devnet program/config state.
- `HACKATHON-RAFFLE-FIX-001` remains limited to the operator raffle artifact ordering fix plus parser regression coverage.

## Context

- Project name (hackathon-facing): Verifiable Outcome Engine
- Short name: VRE
- Target GitHub repository: `https://github.com/mskrad/verifiable-outcome-engine`
- Canonical program ID: `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq` (devnet)
- Current repo surface: this repository root
- Reviewer/runtime entrypoints: `README.md`, `RUNBOOK.md`, `DEMO_RUNBOOK.md`, `scripts/`, `web/`, `artifacts/`, `programs/outcome/`
- Demo frontend: `web/`
- Ecosystem repo: separate from this hackathon repo

## Latest Evidence

- HACKATHON-LICENSE-DOCS-001 document update:
  - `LICENSE` now separates SDK MIT integration/verification use from proprietary Solana program source.
  - `README.md` now has `## Licensing` after Quick Verify.
  - `INTEGRATION.md` now describes the canonical program as VRE-operated and partner instances as commercial-agreement deployments.
  - `web/public/index.html` says `Open verification SDK` instead of `MIT-licensed SDK`.
  - `web/public/build.html` includes a Partner CTA with `mailto:hello@verifiableoutcome.online`.
  - `git diff --check`: passed.
  - `node --check web/server.mjs`: passed.
  - Forbidden public-doc grep returned no matches for open-source/self-deploy/Anchor deploy/MIT homepage copy.
- HACKATHON-DESIGN-ADAPT-001 tester result:
  - verdict: PASS; Hub accepted the task for Sprint 3.
  - branch: `design/claude-design-v1`.
  - merge status: pending merge to `main`.
  - HTML asset paths now use absolute `/assets/`, `/css/`, and `/js/` paths.
  - Correction note: the earlier keeper video plan was superseded; `index.html` now uses the static `/assets/keeper.webp` illustration.
  - New assets added under `web/public/assets/`: `keeper.webp`, `airdrop.webp`, `loot.webp`, `prediction.webp`, `raffle.webp`, `logo.webp`, `logo.svg`, `favicon.svg`, and `mascot.svg`.
  - MIME fix in `web/server.mjs`: `svg` serves as `image/svg+xml`; `webp` serves as `image/webp`; existing static support includes png, jpeg, ico, json, and woff2.
  - `play.js` fetches `/api/health` and `/api/blessed-signatures`, filters active entries, renders use-case badges, and calls `/api/timeline` per card.
  - Browser check for `/play.html`: 5 cards, use-case badges `Loot`, `Loot`, `Raffle`, `Airdrop`, `Prediction`, and 5 timeline rows.
  - `verify.js` uses `POST /api/replay` and `POST /api/timeline`; local `weightedPick` replay and direct RPC scraping are removed from frontend verify flow.
  - Browser check for `/verify.html?sig=mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh`: visible `MATCH / OK`, Committed Rules, Pre-commitment Timeline, and Raw output.
  - Browser check for `/widget.html`: live widget and form flow both rendered `MATCH / OK` and `Raffle · slot 455693113`.
  - `css/style.css` includes `.error-table`, use-case badge colors, widget page styles, keeper media styles, and mobile overflow guards.
  - `node --check web/public/js/play.js`: passed.
  - `node --check web/public/js/verify.js`: passed.
  - `node --check web/server.mjs`: passed.
  - `npx tsc --noEmit`: passed.
  - `git diff --check`: passed.
  - Local HTTP smoke: `/`, `/play.html`, `/verify.html`, `/build.html`, `/widget.html`, `/spec.html` returned HTTP `200`.
  - Local API smoke: `/api/health` returned `ok:true` and `blessed_signatures_count=5`; `/api/blessed-signatures` returned 5 entries.
  - Network evidence included `/api/health`, `/api/blessed-signatures`, `/api/replay`, and `/api/timeline`.
  - Brave headless 375px sweep: all 6 pages had `clientWidth=375`, `scrollWidth=375`, `overflow=false`.
  - Scope guard: no diff in `web/server.mjs`, SDK, Rust/Anchor code, artifacts, or `scripts/resolve_operator.ts`.
- HACKATHON-ERROR-SURFACE-001 tester result:
  - verdict: PASS, ready for Hub acceptance.
  - `spec.html` includes `<h3 id="error-codes">Verification Reason Codes</h3>`.
  - `spec.html` includes `.error-table` with 20 reason codes from `VERIFICATION_ERRORS.md`.
  - `spec.html` links to `https://github.com/mskrad/verifiable-outcome-engine/blob/main/VERIFICATION_ERRORS.md`.
  - `build.html` `.example-links` includes `Error Code Reference`.
  - `verify.html` MISMATCH result-sub includes `See error codes →` linking to `/spec.html#error-codes`.
  - mocked MISMATCH browser check rendered `MISMATCH / ERR_OUTPUT_MISMATCH` and the expected `/spec.html#error-codes` link.
  - `app.css` includes `.error-table` styles and mobile wrapping guard.
  - `node --check web/server.mjs`: passed.
  - `npx tsc --noEmit`: passed.
  - `git diff --check`: passed.
  - Local `/spec.html`, `/build.html`, `/verify.html`: HTTP `200`.
  - Brave headless `/spec.html#error-codes` at 375px: `clientWidth=375`, `scrollWidth=375`, `overflow=false`, `rows=20`, `offenders=[]`.
  - Scope guard: no replay semantics, SDK, Rust, or `web/server.mjs` logic changes.
- HACKATHON-WIDGET-001 implementation:
  - `web/public/widget.js` defines `<vre-verify>` as zero-dependency plain JS Shadow DOM component.
  - `web/public/widget.js` also defines `<vre-verify-form>` as a separate paste-your-own-signature form.
  - `widget.js` hardcodes `https://verifiableoutcome.online` as API origin.
  - `widget.js` keeps a localhost-only fallback to `location.origin` for local demo verification after a public-origin fetch failure.
  - `widget.js` posts `signature`, `rpc`, and `programId`; it does not use `url` or `program_id`.
  - `widget.js` auto-verifies on load and includes loading, match, mismatch, and error states.
  - Blessed raffle rendering contract: `✅ MATCH / OK` plus `Raffle · slot 455693113`.
  - `web/public/widget.html` shows a live demo, embed code for custom transactions with `sig`, `rpc`, and `program-id`, and an interactive `<vre-verify-form>`.
  - `README.md`, `DEMO_RUNBOOK.md`, and `RUNBOOK.md` document both embed modes: fixed-signature `<vre-verify>` and paste-your-own-signature `<vre-verify-form>`.
  - `web/server.mjs` scoped CORS only to `/api/replay` and `/api/health`.
  - `OPTIONS /api/replay` returns HTTP `204` with CORS headers.
  - `GET /api/health` returns HTTP `200` with CORS headers.
  - `widget.js` size: `4065` bytes.
  - `node --check web/server.mjs`: passed.
  - `node --check web/public/widget.js`: passed.
  - `npx tsc --noEmit`: passed.
  - `git diff --check`: passed.
  - `test "$(wc -c < web/public/widget.js)" -lt 5120`: passed.
  - `yarn web`: started successfully on `http://127.0.0.1:8787`.
  - `curl -fsS http://127.0.0.1:8787/widget.html >/tmp/widget.html`: passed.
  - `curl -fsS http://127.0.0.1:8787/widget.js >/tmp/widget.js`: passed; served size `4065` bytes.
  - Brave headless `/widget.html` at 375px: `clientWidth=375`, `scrollWidth=375`.
  - Brave headless live demo rendered `✅ MATCH / OK` and `Raffle · slot 455693113`.
  - Brave headless `<vre-verify-form>` check: 3 inputs; form submission with blessed raffle signature rendered `✅ MATCH / OK` and `Raffle · slot 455693113`.
  - Caveat: external embeds require public deployment of the new `widget.js` and scoped CORS headers; local browser verification uses localhost fallback if the public origin does not yet expose CORS.
- HACKATHON-WIDGET-001 architect design result:
  - verdict: ready for Engineer.
  - `web/server.mjs` checked: `/api/replay`, `/api/health`, and `/api/timeline` exist; CORS is missing.
  - `POST /api/replay` accepts `signature`, `rpc`, and `programId`; task sketch keys `url` and `program_id` should not be used by the widget implementation.
  - `/api/replay` does not return slot or blessed-signature label.
  - Design keeps CORS scoped to `/api/replay` and `/api/health`.
  - Design uses a tiny `KNOWN_SIGNATURES` display map in `widget.js` only for blessed raffle signature to render `Raffle · slot 455693113` without changing replay API semantics.
  - Design requires nav grid updates for 5 links and mobile overflow verification at 375px.
- HACKATHON-USECASES-UI-001 tester result:
  - verdict: PASS, ready for Hub acceptance.
  - `play.html` renders labels/descriptions and colored badges for all active signature cards.
  - Badge classes render for Loot, Raffle, Airdrop, and Prediction.
  - Badge colors matched expected values: raffle `#14f195`, airdrop `#6366f1`, prediction `#f59e0b`, loot `#a855f7`.
  - `build.html` renders 4 use case cards including `Prediction Market`.
  - `build.html` includes required Prediction Market copy.
  - `index.html` Drop-in feature card mentions `prediction market`.
  - `npx tsc --noEmit`: passed.
  - `node --check web/server.mjs`: passed.
  - `git diff --check`: passed.
  - `yarn web`: started successfully on `http://127.0.0.1:8787`.
  - Local `GET /`, `/play.html`, `/build.html`: HTTP `200`.
  - Brave headless `/play.html` at 375px: `clientWidth=375`, `scrollWidth=375`, `overflow=false`, `offenders=[]`, labels `Loot`, `Loot`, `Raffle`, `Airdrop`, `Prediction`.
  - Brave headless `/build.html`: use case cards `Raffle`, `Loot`, `Airdrop`, `Prediction Market`.
  - Scope guard: no diff in `web/server.mjs`, SDK, Rust/Anchor code, or `scripts/resolve_operator.ts`.
- Active blessed signatures count: `5`
- Airdrop signature: `24rAiXuQehJE6ruAH4wunGJw6yirbcjDAhjam7kTKWk7z88k1HJGcq2MHfhNTDADYBkC9NBX4jaNm51qhKBf8b9t`
- Airdrop runtime ID: `2af0d5d0696d6cb4308a13c4667b8528`
- Airdrop compiled artifact hash: `dc5e40691ec9b536ac35e6e47a24d657a7c31a2788535d6371a8d858c55f0b73`
- Airdrop replay result: `MATCH / OK`
- Airdrop replay outcome: `CktRuQ2mQFucF77t4vZ4QGWJv2a9oW1P1bL6n6LJ9m5H`
- Prediction signature: `4qXC2BkboXan2KsDXhW8g9XLD8Zm8yQPQXHsZH7x3fp7AiaPZeUKrjWELPfeBnVd5zwFx2YCZd1DVs1mymAKZh3y`
- Prediction runtime ID: `2f9f0156ed3235f126509bfc88e356ad`
- Prediction compiled artifact hash: `08052c81661aa2ec630cb205224bb551e2ccc8b1ccd229bd6e954875d4816b14`
- Prediction replay result: `MATCH / OK`
- Prediction replay outcome: `Solana ecosystem wins`
- Tester result for HACKATHON-AIRDROP-DEMO-001: PASS, ready for Hub acceptance.
- `npx tsc --noEmit`: passed.
- `node --check web/server.mjs`: passed.
- Local `GET /api/health`: returned `blessed_signatures_count:5`.
- Local `GET /api/blessed-signatures`: returned both new active entries with `label` and `description`.
- Local `/play.html`: HTTP `200`.
- Headless Brave `/verify.html?sig=<AIRDROP_SIG>` and `/verify.html?sig=<PREDICTION_SIG>`: visible `MATCH / OK`.
- Source-of-truth check: `web/server.mjs` reads `artifacts/outcome_devnet_blessed_signatures.json`; no hardcoded new signatures or `BLESSED_SIGNATURES` array found.
- Devnet raffle signature: `mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh`
- Runtime ID: `06695059d916d903a26087c0770533c5`
- Compiled artifact hash: `4a3304a5cb2804331078c6e09b687fdbce1545e2cda5d77ef0c1eb3ab7688ed7`
- Replay result: `MATCH / OK`
- Decoded raffle outcomes: `7`
- Raffle winner: `3nafSu5GVq9bDLAxCg2gPucT4Jzhi2Ybyy2QbhzTMFR9`

## Artifact Decode Evidence

- `npx tsc --noEmit`: passed.
- `node --check web/server.mjs`: passed.
- `yarn -s replay --sig mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh --url https://api.devnet.solana.com --program-id 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq --json`: returned `MATCH / OK`, `outcomes.length=7`, winner `3nafSu5GVq9bDLAxCg2gPucT4Jzhi2Ybyy2QbhzTMFR9`.
- `yarn -s replay --sig 3iC7i15CakPWD47DZ72WgYYuKQdPW8qwu2Usy77rm8RjKkvocvELHqN1yMqM4MiXLcpiAb52u6z2btMKCAZsmDW1 --url https://api.devnet.solana.com --program-id 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq --json`: returned loot-style labels `common`, `rare` with weights.
- `yarn web`: started successfully on `http://127.0.0.1:8787`.
- Local `POST /api/replay` for the raffle signature returned `ok:true` and `replay.outcomes` with 7 entries.
- Brave headless 375px raffle check: `clientWidth=375`, `scrollWidth=375`, `.artifact-rules=true`, rows `7`, winner rows `1`, raw JSON contains `outcomes`.
- Brave headless 375px loot check: `clientWidth=375`, `scrollWidth=375`, rows `common`, `rare`, winner `common`.

## Config Engine Evidence

- Config devnet signature: `5pEb9MWfFoeaohctsDQ5yKS9oAKCvyY3SCNmPubGnak73hS98AkhN1kSzxru3mAhP9LuKi1iSom6YosBDFfkzwjP`
- Config runtime ID: `25f615a7b4d515d835053db9b4f637e5`
- Shorthand devnet signature: `61K8rjNeQsTC8xjxeLd22RdoJ5Nv9pQ9V4GN8t8GiRbJxF2puKmMgVfzqvV2AJ5xMEn3JCqCPe6ojr6wbWV7QMRK`
- Shorthand runtime ID: `4cb3f34519cc3450f7ca34bcf917b003`
- Default operator devnet signature: `2nGY3iRwEF8Qx9TXuPX1wuS4xuCnKqLinbPJA4pav7axySSd7YPH1kbXRiK1vLfb6e7H6PBEghYmHwMG9FcEqxGo`
- Raffle artifact hash: `4a3304a5cb2804331078c6e09b687fdbce1545e2cda5d77ef0c1eb3ab7688ed7`
- Loot artifact hash: `c7a19da303433427976b43fa87aeccdfa49f30fe307b183eecfb31d310484f94`

## Timeline Evidence

- Acceptance signature: `mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh`
- Acceptance artifact hash: `4a3304a5cb2804331078c6e09b687fdbce1545e2cda5d77ef0c1eb3ab7688ed7`
- Artifact slot: `455663125`
- Resolution slot: `455693113`
- Gap slots: `29988`

## Timeline Tester Result

- `/api/timeline` for blessed signature returned expected `ok:true`, `artifact_slot:455663125`, `resolution_slot:455693113`, `gap_slots:29988`.
- `verify.html` showed the full pre-commitment timeline after `MATCH`.
- `verify.html` hid the timeline on mocked `MISMATCH`, mocked replay `ERROR`, and mocked `/api/timeline` failure.
- `play.html` rendered signature cards before delayed timeline calls completed and then showed compact slot rows.
- `.timeline-track` wraps on mobile and stays inside `.timeline-block`.
- Mobile overflow blocker resolved after CSS-only header/nav fix: at viewport 375px, `documentElement.clientWidth=375`, `scrollWidth=375`, `NAV.nav right=359`.
- Desktop regression check at viewport 1280px passed: `documentElement.clientWidth=1280`, `scrollWidth=1280`, timeline visible.

## Public Deploy Evidence

- Public URL: `https://verifiableoutcome.online/`
- `GET /` returned HTTP `200`.
- `GET /api/health` returned `ok:true`, canonical devnet program id, and `blessed_signatures_count:3`.
- `POST /api/replay` for blessed signature returned `MATCH / OK`.
- `POST /api/timeline` for blessed signature returned `artifact_slot:455663125`, `resolution_slot:455693113`, `gap_slots:29988`.
- Certbot dry-run renewal succeeded on VPS after DNS/nginx correction.
