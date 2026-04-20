# TASK MEMORY TEMPLATE: OUTCOME-DEVNET-004

## Task Card Snapshot

- Problem:
  - После freeze baseline нужно отдельно доказать devnet replay contract для нового outcome-core на реальных blessed сигнатурах, не смешивая этот gate с adapters, public packaging или broader coverage.
- Scope:
  - bounded devnet replay gate для outcome-core
  - минимум `2` active blessed devnet signatures
  - replay каждой blessed signature через existing `replay:outcome`
  - outcome-core specific blessed-signatures source-of-truth, runbook delta, bounded report
- Acceptance:
  - архитектурный handoff зафиксирован в:
    - `docs/plans/2026-03-30-outcome-devnet-replay-gate.md`
  - minimum `2` active blessed outcome-core devnet signatures
  - каждая blessed signature -> `MATCH` / `OK`
  - blessed-signatures file, tester evidence, and final report are consistent
  - no scope expansion into adapters/UI/public packaging/broader coverage

## Timeline

### 2026-03-30 21:18:03 MSK - Hub created task memory and accepted architect handoff

- Decision:
  - Accepted for Engineer handoff.
- Status:
  - Engineer handoff ready
- Notes:
  - canonical architect artifact:
    - `docs/plans/2026-03-30-outcome-devnet-replay-gate.md`
  - canonical fixed outcome program id for this task:
    - `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
  - required source-of-truth outputs after implementation:
    - `docs/outcome_runtime/outcome_devnet_blessed_signatures.json`
    - `docs/outcome_runtime/outcome_devnet_gate_report.md`
    - `docs/outcome_runtime/DEVNET_RUNBOOK.md`
    - `docs/outcome_runtime/status.md`

## Open Items

- Engineer must identify or produce at least `2` candidate devnet signatures and convert them into accepted blessed signatures under the outcome-core replay contract.

## Handoff Pointers

- Frozen execution baseline:
  - `docs/outcome_runtime/v0_1_0_execution_contract.md`
- Architect handoff:
  - `docs/plans/2026-03-30-outcome-devnet-replay-gate.md`
- Current track status:
  - `docs/outcome_runtime/status.md`
- Replay contract:
  - `docs/specs/outcome_replay_contract_v1.md`

### 2026-03-30 21:26:03 MSK - Engineer executed bounded devnet replay gate

- Status:
  - Engineer package ready for Tester
- Preflight fact:
  - canonical outcome program id was not yet present on devnet at task start
  - `solana account 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq --url https://api.devnet.solana.com`
    - `AccountNotFound`
- Execution:
  - canonical deploy succeeded with funded local wallet via:
    - `anchor deploy --provider.cluster devnet --provider.wallet /Users/timurkurmangaliev/.config/solana/esjx.json`
  - deploy signature:
    - `Mksm5NG4FmuVbZhNBLay7aJWnqSCw4XmtMXDXXy1Wi2KLzQfWQvhJEXp6bopVdZnvVaZcN59U1FxRbgcBttrHPD`
- Produced outcome-core devnet signatures via existing helper:
  - `3iC7i15CakPWD47DZ72WgYYuKQdPW8qwu2Usy77rm8RjKkvocvELHqN1yMqM4MiXLcpiAb52u6z2btMKCAZsmDW1`
    - `runtime_id`: `d5a06b25163399079d071f1efddb6772`
    - `resolve_id`: `0`
    - `compiled_artifact_hash`: `f6150d16407e764efd55bdb3482aa82fc32726eb53c1e7da02994da20b55ace2`
  - `KMsg6dqUWWNoYfNs6FZhVFWyC76MJN5U8vN61FeeVjTHAZrS9vyAJYDykxUQftvVyrJhV2phSCMXZV41LDbnE8q`
    - `runtime_id`: `0adfed6e7b0a3a2343fdda14ae6222e2`
    - `resolve_id`: `0`
    - `compiled_artifact_hash`: `598c5fd6d661520a368c24dc8cd2aab6059a5959c322049d666cd4ac729d6b82`
- Canonical replay verification:
  - both signatures replay with:
    - `verification_result = MATCH`
    - `verification_reason = OK`
- Source-of-truth/files created or updated:
  - `docs/outcome_runtime/outcome_devnet_blessed_signatures.json`
  - `docs/outcome_runtime/outcome_devnet_gate_report.md`
  - `docs/outcome_runtime/DEVNET_RUNBOOK.md`
  - `docs/outcome_runtime/status.md`

### 2026-03-30 21:29:50 MSK - Hub accepted engineer devnet gate package for Tester

- Decision:
  - Accepted for Tester handoff.
- Status:
  - Tester handoff ready
- Notes:
  - Hub review found the required bounded outputs present:
    - `docs/outcome_runtime/outcome_devnet_blessed_signatures.json`
    - `docs/outcome_runtime/outcome_devnet_gate_report.md`
    - `docs/outcome_runtime/DEVNET_RUNBOOK.md`
    - `docs/outcome_runtime/status.md`
  - current engineer package satisfies the minimum shape for independent Tester validation:
    - `2` active blessed outcome-core devnet signatures
    - both currently recorded as `MATCH / OK`
    - canonical fixed program id preserved as `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
  - no immediate scope-expansion blocker was identified at Hub review

### 2026-03-30 21:45:58 MSK - Tester bounded devnet replay gate validation

- Decision:
  - Accepted
- Blocking findings:
  - none
- Blessed-signatures source-of-truth check:
  - `docs/outcome_runtime/outcome_devnet_blessed_signatures.json`
    - coherent schema root
    - `2` active entries
    - both active entries contain non-empty:
      - `signature`
      - `runtime_id`
      - `resolve_id`
      - `compiled_artifact_hash`
    - both active entries bind to canonical program id:
      - `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
    - both active entries record:
      - `verification_result = MATCH`
      - `verification_reason = OK`
- Independent devnet replay verification:
  - signature `3iC7i15CakPWD47DZ72WgYYuKQdPW8qwu2Usy77rm8RjKkvocvELHqN1yMqM4MiXLcpiAb52u6z2btMKCAZsmDW1`
    - `{"verification_result":"MATCH","verification_reason":"OK","signature":"3iC7i15CakPWD47DZ72WgYYuKQdPW8qwu2Usy77rm8RjKkvocvELHqN1yMqM4MiXLcpiAb52u6z2btMKCAZsmDW1","program_id":"3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq","runtime_id":"d5a06b25163399079d071f1efddb6772","resolve_id":"0","compiled_artifact_hash":"f6150d16407e764efd55bdb3482aa82fc32726eb53c1e7da02994da20b55ace2"}`
  - signature `KMsg6dqUWWNoYfNs6FZhVFWyC76MJN5U8vN61FeeVjTHAZrS9vyAJYDykxUQftvVyrJhV2phSCMXZV41LDbnE8q`
    - `{"verification_result":"MATCH","verification_reason":"OK","signature":"KMsg6dqUWWNoYfNs6FZhVFWyC76MJN5U8vN61FeeVjTHAZrS9vyAJYDykxUQftvVyrJhV2phSCMXZV41LDbnE8q","program_id":"3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq","runtime_id":"0adfed6e7b0a3a2343fdda14ae6222e2","resolve_id":"0","compiled_artifact_hash":"598c5fd6d661520a368c24dc8cd2aab6059a5959c322049d666cd4ac729d6b82"}`
- Additional bounded evidence:
  - current canonical program account exists on devnet under:
    - `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
  - recorded deploy signature confirms canonical deploy success:
    - `Mksm5NG4FmuVbZhNBLay7aJWnqSCw4XmtMXDXXy1Wi2KLzQfWQvhJEXp6bopVdZnvVaZcN59U1FxRbgcBttrHPD`
- Cross-file consistency:
  - canonical program id consistent across:
    - `docs/outcome_runtime/outcome_devnet_blessed_signatures.json`
    - `docs/outcome_runtime/outcome_devnet_gate_report.md`
    - `docs/outcome_runtime/DEVNET_RUNBOOK.md`
    - `docs/outcome_runtime/status.md`
    - `docs/plans/2026-03-30-outcome-devnet-replay-gate.md`
    - `core/contracts/outcome/programs/outcome/src/lib.rs`
  - new source-of-truth file consistently treated as:
    - `docs/outcome_runtime/outcome_devnet_blessed_signatures.json`
  - legacy file is mentioned only as non-authoritative historical context, not as outcome-core gate authority
- Scope check:
  - no blocker evidence of scope expansion into:
    - adapters acceptance
    - public packaging
    - broader release-complete claims
    - reopening accepted package 1/2
- Status for Hub:
  - `Tester accepted / ready for Documenter`

### 2026-03-30 22:41:18 MSK - Documenter bounded devnet gate consistency pass

- Decision:
  - No blocker doc issue found after bounded consistency review.
- Narrow doc updates applied:
  - `docs/outcome_runtime/outcome_devnet_gate_report.md`
  - `docs/outcome_runtime/status.md`
- Verified after review:
  - `docs/outcome_runtime/outcome_devnet_blessed_signatures.json` is the authoritative source-of-truth for the outcome-core devnet gate,
  - legacy `docs/outcome_runtime/devnet_blessed_signatures.json` is not presented as authoritative for the outcome-core gate,
  - canonical fixed program id remains `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`,
  - bounded docs do not make broader release-complete claims,
  - docs package is consistent enough for Hub release-gate use.
- Status for Hub:
  - `Documenter ready / Hub release-gate decision`

### 2026-03-30 22:43:04 MSK - Hub final release-gate decision

- Decision:
  - Closed for bounded scope.
- Status:
  - Accepted
- Final close basis:
  - `docs/outcome_runtime/outcome_devnet_blessed_signatures.json` is the authoritative source-of-truth for the outcome-core devnet gate
  - it contains `2` active blessed signatures, both recorded and tester-validated as `MATCH / OK`
  - canonical fixed program id is consistent as:
    - `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
  - legacy `docs/outcome_runtime/devnet_blessed_signatures.json` is not used as authority for the outcome-core gate
  - gate docs and shared memory do not introduce scope expansion or broader release-complete claims
- Closure note:
  - the next bounded task in the frozen ordering is broader integration coverage
