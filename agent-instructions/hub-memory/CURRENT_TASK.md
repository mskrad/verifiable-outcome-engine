# CURRENT TASK

- Timestamp: 2026-04-20 23:00:00 +0300
- Active Task ID: HACKATHON-USECASES-UI-001
- Parent Sprint: HACKATHON-SPRINT-3 (Apr 19–25)
- Current Stage: READY FOR ARCHITECT
- Hub Decision: HACKATHON-AIRDROP-DEMO-001 accepted. Blessed signatures count now 5 (airdrop + prediction added). Next: visual use-case separation in play.html and build.html.
- Next Owner: Architect
- Next Action: Design UI changes for use-case badges and grouping in play.html and build.html.
- Task Memory File: `agent-instructions/hub-memory/tasks/HACKATHON-USECASES-UI-001.md`
- Sprint Plan: `agent-instructions/hub-memory/HACKATHON_ROADMAP.md`
- Previous Task Memory: `agent-instructions/hub-memory/tasks/HACKATHON-CONFIG-ENGINE-001.md`
- Previous Task Memory: `agent-instructions/hub-memory/tasks/HACKATHON-RAFFLE-FIX-001.md`

## Development Flow

- `HACKATHON-SPRINT-3` is the active sprint-level coordination frame.
- `HACKATHON-AIRDROP-DEMO-001` is ready for Hub acceptance after Tester verified both new devnet signatures, JSON source-of-truth behavior, local API responses, and verify UI replay.
- `HACKATHON-COPY-BOUNDARY-001` is ready for Tester after site/docs wording cleanup around npm SDK, CLI commands, and own-program deployment boundaries. npm package `verifiable-outcome-sdk@0.1.1` is published; use `vre` as the executable name.
- `HACKATHON-SDK-CLI-001` is ready for Hub acceptance after Tester verified SDK CLI package surface and devnet verify flow.
- `HACKATHON-NPM-PUBLISH-001` is ready for Hub acceptance after Tester verified SDK build output, importability, embedded IDL, script import removal, and npm dry-run packaging.
- `HACKATHON-ARTIFACT-DECODE-001` is ready for Tester after decoded artifact outcomes were added to replay JSON and verify.html renders the Committed Rules card after MATCH.
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
