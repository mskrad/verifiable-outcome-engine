# TASK MEMORY: OUTCOME-CLEANUP-002

## Task Card Snapshot

- Problem: Bounded package 1 for `core/contracts/outcome` is buildable and unit-tested, but the new core still lacks replay-by-signature tooling and a minimal localnet proof for `deploy -> setup -> resolve -> replay`.
- Scope: Add a bounded replay CLI/verifier, localnet smoke path, and targeted negative/integration coverage for the new outcome-only core.
- Acceptance: Engineer can execute package 2 without reopening architecture or legacy slot narrative.

## 0. Memory Anchors

- Shared memory root: `agent-instructions/hub-memory/`
- Current state file: `agent-instructions/hub-memory/CURRENT_TASK.md`
- Task memory timeline file: `agent-instructions/hub-memory/tasks/OUTCOME-CLEANUP-002.md`

## 1. Meta

- Task ID: `OUTCOME-CLEANUP-002`
- Title: Outcome Replay CLI And Localnet Smoke
- Priority: P0
- Owner (Hub): Main coordinator
- Date: 2026-03-17
- Branch: `deterministic-outcome-usecases`

## 2. Problem

- Current behavior: `core/contracts/outcome` has an accepted bounded package 1 with on-chain surface, unit tests, and docs, but there is still no replay CLI/verifier for the new program line and no minimal localnet integration proof for `initialize -> resolve -> replay`.
- Expected behavior: The repo has a bounded package 2 that can deploy the outcome program to localnet, execute a minimal happy-path flow, and replay the resulting `resolve_outcome` transaction by signature under the new program id with stable `MATCH`/`MISMATCH` output.
- Business impact: Without this package, the new outcome-first line cannot yet serve as a deterministic infra reference or be demonstrated as replay-by-signature capable.

## 3. Scope

- In scope:
  - Implement replay CLI/verifier for `core/contracts/outcome` using the accepted outcome replay contract.
  - Support replay by transaction signature for the new program id:
    - `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
  - Add a minimal localnet smoke path for:
    - validator/RPC readiness,
    - deploy of `core/contracts/outcome`,
    - minimal program config + artifact lifecycle needed for a valid resolve,
    - `initialize_outcome_config`,
    - `resolve_outcome`,
    - replay verifier `MATCH` on the produced signature.
  - Add targeted negative/integration coverage for currently known non-blocking gaps:
    - runtime admin rejection path,
    - finalize hash mismatch or damaged/missing chunk path,
    - paused runtime rejection,
    - input range rejection,
    - key artifact-hash binding rejection where feasible inside the bounded scope.
  - Add minimal documentation/test-report delta for package 2 evidence only.
- Out of scope:
  - Adapters, UI, and public packaging.
  - Any legacy slot replay refactor beyond read-only reference reuse.
  - Devnet/mainnet rollout or public demo polish.
  - New runtime features, new effect types, DSL/VM scope, or adapter migration.
  - Broader release-readiness claims beyond bounded localnet + replay evidence.

## 4. Constraints

- Technical constraints:
  - Use the frozen outcome-only replay/event/artifact contracts as source of truth.
  - Do not weaken artifact-hash, event, or resolution bindings.
  - Do not introduce legacy slot/reel/spin/paytable naming into new replay/smoke surfaces.
  - Replay result model stays `MATCH` / `MISMATCH` with stable reason-code discipline.
  - Source of truth for verifier stays RPC + local recomputation.
- Environment constraints:
  - Repository: `/Users/timurkurmangaliev/web3-slot-marketplace`
  - Branch: `deterministic-outcome-usecases`
  - Local RPC target: `http://127.0.0.1:8899`
  - Shared memory artifacts remain versioned in git.
- Timeline constraints:
  - Package 2 stays bounded and reviewable.
  - Do not block package 2 on full release completeness, adapters, or public repo extraction.

## 5. Acceptance Criteria

1. A replay CLI/verifier exists for `core/contracts/outcome` and can replay a valid localnet `resolve_outcome` transaction by signature under the new program id.
2. A minimal localnet smoke path proves `deploy -> setup -> resolve -> replay MATCH` for the new core.
3. Negative/integration coverage exists for runtime admin rejection, chunk/finalize integrity failure, paused/input-range rejection, and key artifact binding failures within the bounded scope.
4. Documentation/test-report delta explicitly describes package 2 as bounded replay/smoke coverage, not as full release completeness.
5. No legacy slot narrative leaks into the new replay/verifier/smoke surfaces.

## 6. Impacted Areas

- API: Outcome replay CLI surface, localnet smoke entrypoint, test helpers, and minimal docs/test-report surfaces.
- DB: None.
- Process orchestration: Localnet workflow, verification evidence capture, and Hub handoffs.
- External integrations: Solana local RPC, transaction signature lookup, and the fixed outcome program id.
- Monitoring/logging: Replay reason codes, smoke logs, and transaction signature evidence.

## 7. Risks and Assumptions

- Risks:
  - Replay logic may accidentally reuse legacy slot parsing or naming.
  - Localnet smoke may grow into demo/product scope if not kept narrow.
  - Validator/deploy scripting may become flaky and hide deterministic failures.
  - Negative coverage may miss one of the replay-critical binding failures.
- Assumptions:
  - The accepted freeze package is sufficient; no new ADR is needed unless implementation hits a direct contradiction.
  - Local wallet and Solana/Anchor tooling remain usable on the workstation.
  - Package 1 accepted surfaces remain stable; package 2 adds tooling/tests around them rather than redesigning them.

## 8. Required Artifacts

- [ ] Implementation plan for bounded package 2.
- [ ] Code diff for replay CLI/verifier + localnet smoke/integration harness.
- [ ] Test Plan + Test Report for replay/localnet/negative coverage.
- [ ] Documentation delta for package 2 evidence.
- [ ] Final handoff to Hub with exact commands and artifacts.
- [x] Shared memory initialized (`CURRENT_TASK` + task timeline).

## 9. Verification Requirements

- Commands:
  - `cargo test --manifest-path core/contracts/outcome/Cargo.toml -p outcome`
  - `anchor build` in `core/contracts/outcome`
  - localnet up command against `127.0.0.1:8899`
  - deploy command for `core/contracts/outcome`
  - smoke command that emits a `resolve_outcome` signature
  - replay CLI command against that signature
  - naming leakage grep on new replay/smoke surfaces
- Data checks:
  - Replay returns `MATCH` on the valid smoke signature.
  - Replay rejects wrong program id / wrong binding / wrong or missing artifact state with stable reason codes.
  - Task memory and docs reference `OUTCOME-CLEANUP-002`.
- Logs/metrics checks:
  - Capture the localnet resolve signature and replay result in task memory or report artifacts.
  - Capture negative-path evidence for the bounded failure cases covered by the package.

## Deliverables

1. Updated `agent-instructions/hub-memory/CURRENT_TASK.md`.
2. Task Card + timeline in `agent-instructions/hub-memory/tasks/OUTCOME-CLEANUP-002.md`.
3. Implementation plan in `docs/plans/2026-03-17-outcome-replay-smoke-package-2.md`.
4. Bounded handoff package for Engineer / Tester / Documenter.

## First Work Package

### Engineer

- Implement only the bounded replay CLI/verifier and localnet smoke/integration harness for `core/contracts/outcome`.
- Reuse the frozen replay/event/artifact contracts and package 1 surfaces as-is.
- Do not widen product/demo scope and do not touch adapters/UI.

### Tester

- Prepare a bounded verification matrix for:
  - happy-path replay `MATCH`,
  - runtime admin negative path,
  - chunk/finalize integrity failure,
  - paused/input-range rejection,
  - binding mismatch rejection.
- Capture exact commands, signatures, and expected verifier outputs.

### Documenter

- Prepare package 2 report/update surfaces only after implementation/test evidence exists.
- Keep package 2 phrasing bounded:
  - replay/smoke capable,
  - not full release-complete,
  - not full public-package complete.

### Architect

- No proactive redesign in this package.
- Engage only if implementation hits a direct contradiction between code reality and frozen replay/event/artifact contracts.

## Timeline

### 2026-03-17 21:44:01 MSK - Hub initialized bounded package 2

- Decision: Spin out replay-by-signature and localnet smoke into a separate bounded package, instead of widening `OUTCOME-CLEANUP-001`.
- Status: Active
- Notes:
  - Package 1 remains accepted and unchanged.
  - Package 2 is the first package intended to prove the new outcome line on localnet end-to-end.
  - Scope stays bounded to replay CLI/verifier, smoke coverage, and targeted negative/integration tests.

## Open Items

- Exact file location for the new replay CLI entrypoint inside `core/contracts/outcome`.
- Whether the bounded smoke path should be a shell entrypoint, Anchor/TS integration script, or both.
- Minimal output contract for the replay CLI:
  - human-readable text only,
  - JSON only,
  - or both within bounded scope.

## Timeline Append

### 2026-03-17 22:07:52 MSK - Architect froze bounded package 2 handoff shape

- Status: In progress
- Artifact created:
  - `docs/outcome_runtime/outcome_bounded_package_2_architecture_note.md`
- Resolved for implementation handoff:
  - replay verifier location: `core/contracts/outcome/scripts/replay_outcome_v1.ts`
  - public smoke entrypoint: `core/contracts/outcome/scripts/outcome_localnet_smoke.sh`
  - internal smoke helper: `core/contracts/outcome/scripts/outcome_smoke_setup_and_resolve.ts`
  - CLI output contract: dual output, human-readable by default with `--json`
  - replay result contract: strict `MATCH` / `MISMATCH`
- Notes:
  - No blocking contradiction found between frozen package 2 docs and accepted package 1 implementation references.
  - Remaining work is bounded implementation/test execution, not runtime redesign.

### 2026-03-17 22:20:00 MSK - Hub review of architect package 2 handoff

- Decision: Not yet accepted for Engineer handoff.
- Status: Blocked on Architect clarification
- Blocking gap:
  - `docs/outcome_runtime/outcome_bounded_package_2_architecture_note.md` defines strict replay checks that must cover randomness/input/output/outcome-id verification, but the explicit event-read contract does not list the full consensus-critical `OutcomeResolvedV1` field set needed to do that unambiguously.
  - Missing from the explicit authoritative read/compare path:
    - `actor`
    - `input_lamports`
    - `total_output_lamports`
    - `master_seed`
    - `outcome_id_len`
- Why this blocks:
  - `randomness` recomputation depends on `master_seed` and `actor_pubkey`
  - `ERR_INPUT_MISMATCH` / `ERR_OUTPUT_MISMATCH` require exact event/account/recomputed comparisons
  - canonical outcome-id verification requires `outcome_id_len`, not only padded `outcome_id`
- Required correction:
  - Architect must update the package 2 handoff artifact so the authoritative event field set and exact comparison contract are explicit before Engineer starts.

### 2026-03-17 22:20:36 MSK - Architect tightened replay event-read contract

- Status: In progress
- Updated artifact:
  - `docs/outcome_runtime/outcome_bounded_package_2_architecture_note.md`
- Clarified explicitly:
  - full authoritative `OutcomeResolvedV1` field set for package 2 replay
  - randomness recomputation uses `master_seed`, `runtime_id`, `resolve_id`, `actor`
  - `ERR_INPUT_MISMATCH` compares event input vs resolution input vs replay input
  - `ERR_OUTPUT_MISMATCH` compares event output vs resolution output vs recomputed output
  - canonical outcome-id verification uses `outcome_id_len` and zero-padding rule outside canonical slice
- Scope:
  - no new surfaces
  - no replay-model redesign
  - `CURRENT_TASK.md` unchanged

### 2026-03-17 22:24:30 MSK - Hub acceptance of architect package 2 handoff

- Decision: Accepted for Engineer handoff.
- Status: Ready for Engineer
- Notes:
  - Re-verified that `docs/outcome_runtime/outcome_bounded_package_2_architecture_note.md` now makes the replay verifier contract explicit enough for implementation.
  - The authoritative `OutcomeResolvedV1` read/compare path now includes the fields previously missing from the blocking review:
    - `actor`
    - `input_lamports`
    - `total_output_lamports`
  - `master_seed`
  - `outcome_id_len`
  - Randomness, input/output, and canonical outcome-id verification are no longer ambiguous for package 2.
  - No new blocking architecture contradictions found in the updated handoff artifact.

### 2026-03-17 22:31:30 MSK - Hub review of engineer package 2 blocker

- Decision: Blocker confirmed. Engineer stop is correct.
- Status: Blocked on Hub decision
- Verified evidence:
  - accepted fixed program id in code/docs:
    - `AoLyzeQdKkokoJHXKWXPGamGdhtVJ8TgnVKBLAw6YGND`
  - current local deploy keypair resolves to:
    - `CoawJyknoYHoNPA6Ei6WfR6iapzPSQ4zXXKCTd67zj5m`
  - `anchor build` passes, but `anchor deploy` fails with `DeclaredProgramIdMismatch`
- Why this blocks package 2:
  - localnet smoke cannot complete honest `deploy -> setup -> resolve -> replay MATCH`
  - replay verifier package can be unit-tested, but package 2 acceptance requires actual deploy/smoke evidence
- Guardrail:
  - do not silently change `declare_id!`
  - do not silently rewrite `Anchor.toml` program id
  - do not generate a replacement fixed id without an explicit Hub decision
- Required decision:
  - provide canonical keypair for the accepted fixed program id, or
  - approve a new fixed program id as a separate architectural scope decision

## Handoff Pointers

- Mandatory frozen docs:
  - `docs/specs/outcome_replay_contract_v1.md`
  - `docs/specs/outcome_event_schema_v1.md`
  - `docs/specs/outcome_compiled_artifact_contract_v1.md`
  - `docs/specs/outcome_instruction_set_v1.md`

### 2026-03-17 22:47:00 MSK - Engineer blocked on localnet deploy key mismatch

- Status: Blocked, escalated to Hub
- Direct contradiction found between accepted package 2 handoff assumptions and current deploy reality:
  - frozen/accepted package originally fixed outcome program id to `AoLyzeQdKkokoJHXKWXPGamGdhtVJ8TgnVKBLAw6YGND`
  - current deploy keypair at `core/contracts/outcome/target/deploy/outcome-keypair.json` resolves to `CoawJyknoYHoNPA6Ei6WfR6iapzPSQ4zXXKCTd67zj5m`
  - `anchor deploy` therefore fails before smoke setup with `DeclaredProgramIdMismatch`
- Evidence:
  - `anchor deploy` during `yarn -s smoke:outcome:localnet` failed with:
    - `AnchorError occurred. Error Code: DeclaredProgramIdMismatch`
  - `solana address -k core/contracts/outcome/target/deploy/outcome-keypair.json`
    - `CoawJyknoYHoNPA6Ei6WfR6iapzPSQ4zXXKCTd67zj5m`
  - fixed id still present in:
    - `core/contracts/outcome/programs/outcome/src/lib.rs`
    - `core/contracts/outcome/Anchor.toml`
- Action taken:
  - implementation stopped without redesigning program-id policy
  - awaiting Hub decision on canonical deploy keypair source for fixed program id

### 2026-03-17 22:40:00 MSK - Hub re-decided fixed outcome program id after keypair search

- Decision: Canonical keypair for the old fixed outcome id was not found in the repository, `~/.config/solana`, or `~/.anchor`.
- User decision: Generate a new canonical local deploy keypair and re-bind the fixed outcome program id to it.
- New fixed outcome program id:
  - `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
- Applied surfaces:
  - `core/contracts/outcome/Anchor.toml`
  - `core/contracts/outcome/programs/outcome/src/lib.rs`
  - package 2 smoke scripts
  - current outcome runtime docs/status reports
  - active Hub shared memory
- Remaining verification:
  - re-run deploy/smoke to confirm the original `DeclaredProgramIdMismatch` blocker is gone under the new fixed id

### 2026-03-17 22:57:30 MSK - Hub verified deploy consistency under the new fixed id

- Decision: The original `DeclaredProgramIdMismatch` blocker is resolved.
- Status: Engineer can resume package 2 verification
- Verified evidence:
  - generated deploy keypair resolves to:
    - `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
  - `cargo test --manifest-path core/contracts/outcome/Cargo.toml -p outcome` -> PASS (`8 passed`)
  - `anchor build` in `core/contracts/outcome` -> PASS
  - localnet deploy command now succeeds under the re-decided fixed id:
    - program id:
      - `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
    - deploy signature:
      - `NHDed2ZvZF3aBPiQPmodaHqAQHpfbt67oCFQq8AgN7c8zbtbfq21gmSiRVA7k7q8ssD6Q7bhkqKKETpxgMzDc9a`
    - result:
      - `Deploy success`
- Remaining work:
  - run full package 2 smoke and replay verification against the new fixed id
  - capture negative/integration evidence for final package 2 review
  - `docs/outcome_runtime/outcome_core_architecture_freeze.md`
- Current accepted package 1 evidence:
  - `docs/outcome_runtime/outcome_bounded_package_1_report.md`
  - `docs/plans/2026-03-15-outcome-bounded-implementation-package-1.md`
- Guardrails:
  - No scope expansion.
  - No mixed legacy/outcome narrative.
  - No done-claims without localnet + replay evidence.

### 2026-03-18 00:06:12 MSK - Architect added bounded process recovery contract

- Status: In progress
- Updated artifact:
  - `docs/outcome_runtime/outcome_bounded_package_2_architecture_note.md`
- Recovery decisions fixed:
  - Hub-side edits in executable package 2 files are not `Hub-only accepted`
  - executable/config/test surfaces touched during deviation are `provisional` until Engineer re-ownership
  - prior Hub-run smoke/replay outputs are informational only and must be re-confirmed by Tester
  - close gate requires Engineer re-ownership + Tester evidence + Documenter bounded delta
- Scope:
  - no runtime redesign
  - no adapter/UI/public packaging expansion
  - `CURRENT_TASK.md` unchanged

### 2026-03-18 00:18:40 MSK - Engineer re-owned package 2 and closed functional acceptance

- Status: Package 2 implementation ready for Tester
- Engineer-owned bounded fix:
  - `core/contracts/outcome/scripts/replay_outcome_v1.ts`
    - narrowed replay binding logic so wrong `--program-id` returns `ERR_PROGRAM_ID_MISMATCH` when `OutcomeResolvedV1` is emitted by another program in the same tx
- Verified commands and evidence:
  - `cargo test --manifest-path /Users/timurkurmangaliev/web3-slot-marketplace/core/contracts/outcome/Cargo.toml -p outcome`
    - PASS (`8 passed`)
  - `cd /Users/timurkurmangaliev/web3-slot-marketplace/core/contracts/outcome && anchor build`
    - PASS
  - `yarn -s smoke:outcome:localnet`
    - PASS
    - `verification_result`: `MATCH`
    - `verification_reason`: `OK`
    - `signature`: `LLHd3K9aM7ijoUktc911bNCKoxv7DT83ma5995RbfV4SZsjHFuRM7qbKpe9MukP5JXodG3UWEgA1ANaWEGTsiWY`
    - `program_id`: `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
    - `runtime_id`: `fd311446e558092bb123f200be13a518`
    - `resolve_id`: `0`
    - `compiled_artifact_hash`: `94243db41d3c90d5ae5c6ef2cf0dc3aec6ad10750ee59457489262d2c3bf564a`
  - `yarn -s replay:outcome --sig LLHd3K9aM7ijoUktc911bNCKoxv7DT83ma5995RbfV4SZsjHFuRM7qbKpe9MukP5JXodG3UWEgA1ANaWEGTsiWY --url http://127.0.0.1:8899 --program-id 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq --artifact /Users/timurkurmangaliev/web3-slot-marketplace/core/contracts/outcome/target/package2/smoke-94243db41d3c90d5.bin --json`
    - PASS
    - `{"verification_result":"MATCH","verification_reason":"OK",...}`
  - `yarn -s test:integration:outcome`
    - PASS
    - `PASS unauthorized_runtime_admin_reject`
    - `PASS finalize_chunk_integrity_reject`
    - `PASS paused_runtime_reject`
    - `PASS input_out_of_range_reject`
  - replay negatives confirmed:
    - wrong `--program-id` -> `{"verification_result":"MISMATCH","verification_reason":"ERR_PROGRAM_ID_MISMATCH",...}`
    - wrong `--artifact` -> `{"verification_result":"MISMATCH","verification_reason":"ERR_ARTIFACT_HASH_MISMATCH",...}`
  - forbidden naming leakage grep over `core/contracts/outcome/scripts` and `core/contracts/outcome/tests`
    - no matches

### 2026-03-18 10:16:40 MSK - Engineer fixed warm-validator smoke rerun collision

- Status: Corrected, ready for Tester re-validation
- Bounded defect:
  - public smoke rerun on an already-running local validator collided on deterministic smoke artifact hash/PDA
  - failure reproduced on second consecutive `yarn -s smoke:outcome:localnet`
    - `Instruction: SubmitCompiledArtifact`
    - `Allocate: account ... already in use`
- Bounded fix:
  - `core/contracts/outcome/scripts/outcome_smoke_setup_and_resolve.ts`
    - public smoke helper now generates a unique valid smoke artifact variant per run
    - safe default kept narrow:
      - unique artifact weights per run
      - payouts remain fixed at the original bounded happy-path values `3/7`
    - no validator-reset redesign
    - no replay-model changes
- Re-verified commands and evidence:
  - `cargo test --manifest-path /Users/timurkurmangaliev/web3-slot-marketplace/core/contracts/outcome/Cargo.toml -p outcome`
    - PASS (`8 passed`)
  - `cd /Users/timurkurmangaliev/web3-slot-marketplace/core/contracts/outcome && anchor build`
    - PASS
  - first rerun-safe smoke:
    - `cd /Users/timurkurmangaliev/web3-slot-marketplace/core/contracts/outcome && yarn -s smoke:outcome:localnet`
    - PASS
    - `signature`: `5dnfQKW7ifMBtuFeAKcHwq8NegvWAojJKQ3n9Eqrog4gvRqCsbCypsts8dUgzT5RhRnE9wnij3WfWHC9Xw4Y65iJ`
    - `runtime_id`: `85d2d61c178e8512041c4b932a65aab5`
    - `compiled_artifact_hash`: `81ff818d878d5cf6ec7021419dd8c8eec45c9903ab26c7df32d9d73293b14141`
    - result: `MATCH`
  - second consecutive smoke on the same warm validator:
    - `cd /Users/timurkurmangaliev/web3-slot-marketplace/core/contracts/outcome && yarn -s smoke:outcome:localnet`
    - PASS
    - `signature`: `5P6RRaZPVrShQjJkHD7L5HcACASoVdG31kK7SRsVHEdYwKMTNLwz57LmkKiKTjiQ21eTKrbMPiadj8v95icyr28C`
    - `runtime_id`: `4b4f4311a477ea7ab0de21b90ac8b5e5`
    - `compiled_artifact_hash`: `7f48559df759d97441b8ddeda2696da9bbf16e1e132b435bf8fc5b58b208ce62`
    - result: `MATCH`
  - standalone replay against the valid second-run signature:
    - `{"verification_result":"MATCH","verification_reason":"OK","signature":"5P6RRaZPVrShQjJkHD7L5HcACASoVdG31kK7SRsVHEdYwKMTNLwz57LmkKiKTjiQ21eTKrbMPiadj8v95icyr28C","program_id":"3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq","runtime_id":"4b4f4311a477ea7ab0de21b90ac8b5e5","resolve_id":"0","compiled_artifact_hash":"7f48559df759d97441b8ddeda2696da9bbf16e1e132b435bf8fc5b58b208ce62"}`
  - integration negatives:
    - `PASS unauthorized_runtime_admin_reject`
    - `PASS finalize_chunk_integrity_reject`
    - `PASS paused_runtime_reject`
    - `PASS input_out_of_range_reject`
  - replay negatives:
    - wrong `--program-id` -> `{"verification_result":"MISMATCH","verification_reason":"ERR_PROGRAM_ID_MISMATCH",...}`
    - wrong `--artifact` -> `{"verification_result":"MISMATCH","verification_reason":"ERR_ARTIFACT_HASH_MISMATCH",...}`
  - forbidden naming leakage grep over `core/contracts/outcome/scripts` and `core/contracts/outcome/tests`
    - no matches

### 2026-03-18 00:24:30 MSK - Hub acceptance of engineer functional package 2 handoff

- Decision: Accepted for Tester handoff.
- Status: Ready for Tester
- Notes:
  - The previous deploy-mismatch blocker is no longer active under the new fixed outcome program id:
    - `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
  - Engineer provided bounded functional evidence for all current package 2 acceptance surfaces:
    - smoke happy path -> `MATCH`
    - standalone replay -> `MATCH`
    - four on-chain reject cases
    - two replay `MISMATCH` cases
  - The replay verifier patch in `core/contracts/outcome/scripts/replay_outcome_v1.ts` is narrow and aligned with the accepted reason-code contract.
  - No new scope expansion detected in the reported package 2 delta.

### 2026-03-18 01:32:43 MSK - Tester bounded validation result

- Decision: Not accepted yet; one behavioural blocker found in the public smoke entrypoint.
- Blocking finding:
  - `yarn -s smoke:outcome:localnet` is not rerunnable against an already-running local validator with pre-existing package 2 state.
  - Reproduced failure on a live validator before fresh reset:
    - `SubmitCompiledArtifact`
    - `Allocate: account ... already in use`
  - Relevant implementation surface:
    - `core/contracts/outcome/scripts/outcome_localnet_smoke.sh` reuses any ready validator as-is via `localnet_up.sh` and does not force a fresh ledger before setup.
    - `core/contracts/outcome/scripts/outcome_smoke_setup_and_resolve.ts` always submits the same deterministic compiled artifact hash/PDA for the smoke artifact, so warm-validator state collides immediately.
- Bounded verification that still passed on a fresh validator / live RPC:
  - `cargo test --manifest-path /Users/timurkurmangaliev/web3-slot-marketplace/core/contracts/outcome/Cargo.toml -p outcome` -> PASS (`8 passed`)
  - `cd /Users/timurkurmangaliev/web3-slot-marketplace/core/contracts/outcome && anchor build` -> PASS
  - fresh-validator smoke -> PASS
    - `verification_result`: `MATCH`
    - `verification_reason`: `OK`
    - `signature`: `5yk1fejFNqwfGgCjp9oEk6Xf7TZ3nsuSHSkLzTFJ6RKtLo8hiG7TKGAhocUVzAcb6TL252NDC1uFCupA7UZBSmW5`
    - `program_id`: `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
    - `runtime_id`: `ce6c49e62f9256bb891f31fb1c72280f`
    - `resolve_id`: `0`
    - `compiled_artifact_hash`: `94243db41d3c90d5ae5c6ef2cf0dc3aec6ad10750ee59457489262d2c3bf564a`
  - standalone replay on a live validator after manual deploy/setup -> PASS
    - `verification_result`: `MATCH`
    - `verification_reason`: `OK`
    - `signature`: `2wLKoQbT7XEvQy5ktjfU7URWo9pq459gae7bkiuTV6jENmjrHQTWGNUWYQKZkQGLsfpx4XoasKNNLhezfSVxrNAq`
    - `runtime_id`: `5b66becaece04666b6da5957dba26ae6`
    - `resolve_id`: `0`
    - `compiled_artifact_hash`: `94243db41d3c90d5ae5c6ef2cf0dc3aec6ad10750ee59457489262d2c3bf564a`
  - `yarn -s test:integration:outcome` -> PASS
    - `PASS unauthorized_runtime_admin_reject`
    - `PASS finalize_chunk_integrity_reject`
    - `PASS paused_runtime_reject`
    - `PASS input_out_of_range_reject`
  - replay negatives on live validator -> PASS
    - wrong `--program-id` -> `ERR_PROGRAM_ID_MISMATCH`
    - wrong `--artifact` -> `ERR_ARTIFACT_HASH_MISMATCH`
  - naming leakage grep over `core/contracts/outcome/scripts` and `core/contracts/outcome/tests` -> no matches
- Status for Hub:
  - keep with Engineer until smoke rerun behaviour on warm validator is resolved or the bounded acceptance contract is narrowed explicitly.

### 2026-03-18 10:06:13 MSK - Hub accepted tester blocker and returned task to Engineer

- Decision: Rejected for now; keep scope bounded and fix the warm-validator smoke rerun defect in implementation.
- Current blocker accepted by Hub:
  - `yarn -s smoke:outcome:localnet` must be safe for a normal rerun against an already-running local validator, or the public smoke contract remains misleading for package 2 acceptance.
  - The reproducer and evidence recorded by Tester are sufficient; no additional architectural redesign is requested.
- Next required Engineer outcome:
  - make the public smoke entrypoint rerunnable without deterministic artifact-state collision on a warm validator
  - re-run:
    - smoke `MATCH`
    - standalone replay `MATCH`
    - four on-chain reject cases
    - two replay `MISMATCH` cases
  - return with bounded evidence for another Tester pass
- Guardrails:
  - no scope expansion
  - no replay-model redesign
  - no adapter/UI/public packaging work

### 2026-03-30 20:33:56 MSK - Hub accepted engineer corrective handoff for tester re-validation

- Decision: Accepted for Tester re-validation, not yet final package acceptance.
- Hub review:
  - the reported fix is still bounded to the original blocker surface in `core/contracts/outcome/scripts/outcome_smoke_setup_and_resolve.ts`
  - the chosen approach stays narrow:
    - no validator-reset redesign
    - no replay-model changes
    - no scope expansion beyond warm-validator smoke rerun safety
  - the corrective evidence is directionally sufficient for another Tester pass:
    - two consecutive `yarn -s smoke:outcome:localnet` runs reported as `MATCH`
    - standalone replay still reported as `MATCH`
    - replay negatives still reported as `ERR_PROGRAM_ID_MISMATCH` and `ERR_ARTIFACT_HASH_MISMATCH`
    - integration negatives still reported as passing
- Next required step:
  - Tester must independently re-validate the corrected smoke rerun behaviour and the bounded package 2 acceptance set before any move to Documenter

### 2026-03-30 20:52:54 MSK - Tester re-validation after corrective fix

- Decision: Accepted.
- Blocking findings:
  - none
- Independent bounded verification on one live local validator:
  - `cargo test --manifest-path /Users/timurkurmangaliev/web3-slot-marketplace/core/contracts/outcome/Cargo.toml -p outcome`
    - PASS (`8 passed`)
  - `cd /Users/timurkurmangaliev/web3-slot-marketplace/core/contracts/outcome && anchor build`
    - PASS
  - first smoke on fresh live validator:
    - `cd /Users/timurkurmangaliev/web3-slot-marketplace/core/contracts/outcome && yarn -s smoke:outcome:localnet`
    - PASS
    - `verification_result`: `MATCH`
    - `verification_reason`: `OK`
    - `signature`: `4a19WWznWehVi3FBuqjY7Ne34S3S24Qmi1LmzKwjVWqR41YCs3pC8ZTJhw48uhCzhZKMNWFKYzrB8uHtipxN4UX4`
    - `runtime_id`: `abc3ce353b51063f539c3e7d957ffe02`
    - `resolve_id`: `0`
    - `compiled_artifact_hash`: `357ad1d68e35f75d01ddc37a0ccbbd96601a0fb2ad7cf67ad580719b53557f02`
  - second consecutive smoke on the same warm validator:
    - `cd /Users/timurkurmangaliev/web3-slot-marketplace/core/contracts/outcome && yarn -s smoke:outcome:localnet`
    - PASS
    - no `SubmitCompiledArtifact`
    - no `Allocate: account ... already in use`
    - `verification_result`: `MATCH`
    - `verification_reason`: `OK`
    - `signature`: `BLx6fQYskakg2BmP4Z4KKAGZQN8kdhASnSGDbSovKtJdmL5ZZ1xDVMj63xVzhNkPNXo2MSckxw9bUBzGWoAJXzt`
    - `program_id`: `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
    - `runtime_id`: `b7da639a96e99af831a2327a64fc60f6`
    - `resolve_id`: `0`
    - `compiled_artifact_hash`: `1fc4806f9f9f71352f99cb7a3711f68669d8c18f459e15004d941f4f8022013f`
  - standalone replay after the second smoke:
    - `{"verification_result":"MATCH","verification_reason":"OK","signature":"BLx6fQYskakg2BmP4Z4KKAGZQN8kdhASnSGDbSovKtJdmL5ZZ1xDVMj63xVzhNkPNXo2MSckxw9bUBzGWoAJXzt","program_id":"3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq","runtime_id":"b7da639a96e99af831a2327a64fc60f6","resolve_id":"0","compiled_artifact_hash":"1fc4806f9f9f71352f99cb7a3711f68669d8c18f459e15004d941f4f8022013f"}`
  - integration negatives:
    - `PASS unauthorized_runtime_admin_reject`
    - `PASS finalize_chunk_integrity_reject`
    - `PASS paused_runtime_reject`
    - `PASS input_out_of_range_reject`
  - replay negatives:
    - wrong `--program-id` -> `MISMATCH / ERR_PROGRAM_ID_MISMATCH`
    - wrong `--artifact` -> `MISMATCH / ERR_ARTIFACT_HASH_MISMATCH`
  - naming leakage grep over `core/contracts/outcome/scripts` and `core/contracts/outcome/tests`
    - no matches
- Verdict for Hub:
  - `Tester accepted / ready for Documenter`

### 2026-03-30 20:54:35 MSK - Hub accepted tester re-validation and moved task to Documenter

- Decision: Accepted for Documenter handoff.
- Hub summary:
  - the original warm-validator smoke rerun blocker is now closed
  - bounded package 2 acceptance evidence is present for:
    - two consecutive public smoke runs on one warm validator
    - standalone replay `MATCH`
    - four on-chain reject cases
    - two replay `MISMATCH` cases
    - no naming leakage in package 2 scripts/tests
  - no new scope expansion is recorded in the accepted tester result
- Next required step:
  - Documenter should publish only the bounded package 2 documentation delta and current status/evidence under the fixed program id

### 2026-03-30 20:56:58 MSK - Documenter published bounded package 2 docs delta

- Created:
  - `docs/outcome_runtime/outcome_bounded_package_2_report.md`
- Updated minimally:
  - `docs/outcome_runtime/status.md`
- Documentation now states explicitly:
  - package 2 accepted scope is limited to replay verifier by signature, localnet smoke `MATCH`, targeted negative/integration coverage, and warm-validator rerun safety,
  - current canonical fixed outcome program id is `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`,
  - old fixed id is historical only and not current canonical for package 2 docs,
  - accepted tester evidence is limited to two consecutive warm-validator smoke runs, standalone replay `MATCH`, four on-chain reject cases, two replay `MISMATCH` cases, and no naming leakage,
  - no release claims, no project-wide done claims, and no scope expansion were added.

### 2026-03-30 20:59:07 MSK - Hub final close decision

- Decision: Closed for bounded scope.
- Final close basis:
  - implementation surfaces were accepted after bounded tester re-validation,
  - warm-validator smoke rerun blocker was closed and independently confirmed,
  - documentation delta now captures:
    - package 2 accepted scope,
    - current canonical fixed outcome program id,
    - accepted tester evidence,
    - bounded warm-validator correction,
    - explicit non-goals
  - no additional scope expansion was introduced at the documentation stage
- Closure note:
  - any further work beyond this point must be opened as a new bounded task and must not be treated as part of the already accepted package 2 scope
