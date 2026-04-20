# TASK MEMORY: OUTCOME-CLEANUP-001

## Task Card Snapshot

- Problem: Phase 3 `slot-v2` base is stable, but the current outcome-runtime line still leaks slot semantics into artifacts, events, UI, and replay.
- Scope: Freeze the architecture for a new outcome-only contract line and isolate `core/contracts/slot` as frozen legacy.
- Acceptance: Architect can continue with ADR/design work without reopening scope discovery.

## 0. Memory Anchors

- Shared memory root: `agent-instructions/hub-memory/`
- Current state file: `agent-instructions/hub-memory/CURRENT_TASK.md`
- Task memory timeline file: `agent-instructions/hub-memory/tasks/OUTCOME-CLEANUP-001.md`

## 1. Meta

- Task ID: `OUTCOME-CLEANUP-001`
- Title: Outcome-Only Core Architecture Freeze
- Priority: P0
- Owner (Hub): Main coordinator
- Date: 2026-03-15
- Branch: `deterministic-outcome-usecases`

## 2. Problem

- Current behavior: Phase 3 `custom slots v2` is complete and stable. Outcome-runtime docs, tooling, replay, and examples already exist, but `raffle` and `loot` are still thin adapters over the legacy slot core, and slot semantics leak into artifacts, events, replay, and UI.
- Expected behavior: `core/contracts/slot` stays as frozen legacy reference. New work moves to `core/contracts/outcome` as a clean core with a new program id, outcome-only compiled format, outcome-only events, and outcome-only replay model.
- Business impact: This split is required to keep the infra narrative clean, reduce future audit surface, and prevent legacy slot semantics from contaminating the new public reference line.

## 3. Scope

- In scope:
  - Freeze the target structure for `core/contracts/outcome`.
  - Freeze the legacy boundary for `core/contracts/slot`.
  - Define the mandatory imports from legacy:
    - deterministic RNG contract,
    - approved artifact registry discipline,
    - chunked blob storage,
    - finalize hash validation,
    - replay trust model,
    - reason-code verification discipline.
  - Define the explicit non-imports from legacy:
    - reels,
    - paylines,
    - spin naming,
    - slot event fields,
    - paytable semantics,
    - symbol layout.
  - Define the outcome-only contracts for:
    - PDA scheme v1,
    - instruction set v1,
    - event schema v1,
    - replay model v1,
    - compiled artifact model v1.
  - Define the first bounded work package for Architect / Engineer / Tester / Documenter.
- Out of scope:
  - Any on-chain implementation.
  - Compatibility shims inside the new outcome core.
  - Migration of `raffle`/`loot` adapters.
  - UI changes beyond architecture and naming boundaries.
  - Public repo extraction, funding docs, governance flow, and product features.

## 4. Constraints

- Technical constraints:
  - Keep Phase 3 `slot-v2` buildable and frozen.
  - The new core must be outcome-only; slot/reel/spin/paytable semantics cannot appear in its compiled artifacts, events, or replay contracts.
  - A new program id is mandatory.
  - No DSL, VM, conditional runtime logic, or product-layer scope expansion.
- Environment constraints:
  - Repository: `/Users/timurkurmangaliev/web3-slot-marketplace`
  - Branch: `deterministic-outcome-usecases`
  - Shared memory artifacts remain versioned in git.
- Timeline constraints:
  - Phase 1 is architecture freeze only.
  - No implementation or release-readiness claims in this phase.

## 5. Acceptance Criteria

1. Legacy/frozen boundary and new outcome-core boundary are explicit and non-overlapping.
2. Outcome-only compiled format, event schema, replay source of truth, and new program id requirement are fixed at the architecture level.
3. Imported invariants from legacy and explicit non-goals are listed separately with no ambiguity.
4. The task card is sufficient for Architect to produce ADR/design artifacts without extra scope discovery.
5. The first work package for Architect / Engineer / Tester / Documenter is defined and scope-bounded.

## 6. Impacted Areas

- API: Future on-chain instruction surface, CLI/replay interfaces, and adapter wrapper contracts.
- DB: None.
- Process orchestration: Shared memory, handoffs, release gate, and task sequencing.
- External integrations: Solana program id separation and RPC-only replay model.
- Monitoring/logging: Replay reason codes and event schema verification expectations.

## 7. Risks and Assumptions

- Risks:
  - Partial reuse of slot naming in the new core.
  - Duplicated registry/chunk logic without a clear port strategy.
  - Backward-compat pressure forcing mixed architecture.
  - Drift between ADR, specs, and task card.
  - Scope creep into adapters, UI, or public packaging.
- Assumptions:
  - Legacy slot remains supported only as a frozen reference line.
  - Adapter migration happens after the outcome-core freeze.
  - Deterministic/replay invariants from legacy are worth porting intact.

## 8. Required Artifacts

- [ ] ADR: `slot` frozen legacy, `outcome` new core.
- [ ] Design Note: `core/contracts/outcome` architecture freeze.
- [ ] Draft specs:
  - PDA scheme,
  - instruction set,
  - event schema,
  - replay contract,
  - compiled artifact contract.
- [ ] Implementation roadmap:
  - Phase 1 Architecture freeze,
  - Phase 2 On-chain MVP,
  - Phase 3 Replay + examples,
  - Phase 4 Public packaging.
- [ ] Test Plan for architecture conformance / contract verification.
- [ ] Documentation delta list for the outcome-only narrative.
- [x] Shared memory initialized (`CURRENT_TASK` + task timeline).

## 9. Verification Requirements

- Commands:
  - `git -C /Users/timurkurmangaliev/web3-slot-marketplace branch --show-current`
  - `git -C /Users/timurkurmangaliev/web3-slot-marketplace status --short -- agent-instructions/hub-memory`
- Data checks:
  - `CURRENT_TASK.md` and task timeline use the same task id.
  - Scope excludes implementation and adapter migration.
  - The new outcome core requires a separate program id.
- Logs/metrics checks:
  - Not applicable in the freeze phase.

## Deliverables

1. Updated `agent-instructions/hub-memory/CURRENT_TASK.md`.
2. Task Card + task timeline initialized in `agent-instructions/hub-memory/tasks/OUTCOME-CLEANUP-001.md`.
3. Architecture freeze package requested from Architect.
4. First bounded work packets defined for Engineer / Tester / Documenter.

## First Work Package

### Architect

- Produce the architecture freeze package covering:
  - legacy/frozen boundary,
  - new `core/contracts/outcome` module boundary,
  - new program id rationale,
  - PDA/instruction/event/replay/compiled contracts,
  - port-vs-rewrite decision for registry/chunk/finalize logic.
- Stay above implementation level; no code changes.

### Engineer

- Do not start code before architecture approval.
- Prepare only a file impact map for the approved freeze:
  - future touch points in `core/contracts/slot`,
  - future touch points in `core/contracts/outcome`,
  - docs/examples/replay surfaces affected by the split.
- No code diff in this phase.

### Tester

- Prepare an architecture-conformance checklist:
  - no slot semantics in new artifacts/events/replay,
  - legacy reference stays isolated,
  - reason-code and replay trust model are preserved.
- Define future evidence requirements for Phase 2+.

### Documenter

- Prepare a documentation migration map:
  - what remains under legacy slot docs,
  - what must move or be recreated under the outcome-only hub,
  - naming glossary and non-goal section.
- No public packaging edits in this phase.

## Timeline

### 2026-03-15 21:04:48 MSK - Hub scope freeze initialized

- Decision: Stop extending the new outcome line on top of the legacy slot narrative. Freeze `core/contracts/slot` as legacy and open architecture freeze for `core/contracts/outcome`.
- Status: Active
- Notes: Phase 3 base is treated as stable. This task is architecture-only and blocks new implementation in the outcome line until ADR/spec freeze is approved.

## Open Items

- Exact file locations for the new ADR/design note/spec drafts.
- Port-as-is vs rewrite strategy for registry/chunk/finalize logic.
- Exact naming of the outcome resolve instruction family.

## Handoff Pointers

- Mandatory context:
  - `docs/outcome_runtime/README.md`
  - `docs/outcome_runtime/status.md`
  - `docs/outcome_runtime/project_full_documentation.md`
  - `docs/adr/0004-outcome-first-runtime.md`
  - `docs/outcome_runtime/v0_1_0_execution_contract.md`
- Guardrails:
  - No scope expansion.
  - No mixed legacy/outcome narrative.
  - No done-claims without artifacts and verification.

### 2026-03-15 21:25:48 MSK - Architect freeze package prepared

- Recommended architecture: separate clean `core/contracts/outcome` program with mandatory new program id; `core/contracts/slot` remains frozen legacy.
- Boundary freeze: no new outcome semantics in legacy slot program, events, replay, artifacts, or UI-facing naming; no reuse of legacy slot program id or slot PDA namespace.
- Port policy:
  - registry header/finalize logic: port with cleanup,
  - chunk storage/write discipline: port as-is,
  - slot-specific parser/paytable/reel state: do not port.
- Frozen contracts requested for implementation phase:
  - outcome-only PDA scheme v1,
  - instruction set v1,
  - event schema v1,
  - replay contract v1,
  - compiled artifact contract v1.
- Handoff scope:
  - Engineer: implement only `core/contracts/outcome` against the freeze package,
  - Tester: prepare conformance and negative replay matrix for outcome-only contracts,
  - Documenter: create ADR/design/spec drafts and mark legacy/outcome docs split explicitly.

### 2026-03-15 21:32:00 MSK - Hub review of architect package

- Decision: Direction accepted. Variant C is approved as the architecture baseline for the new outcome-only core.
- Status: In progress
- Notes:
  - Verified legacy-slot leakage in current code surfaces:
    - `core/contracts/slot/programs/slot/src/events.rs`
    - `core/contracts/slot/programs/slot/src/state/approved_compiled_spec.rs`
    - `core/contracts/slot/scripts/replay_v2.ts`
  - Architect output is sufficient to freeze direction, boundaries, and imported invariants.
  - Engineer implementation remains blocked until the required freeze artifacts exist as files:
    - ADR for `slot` legacy / `outcome` new core,
    - design note for `core/contracts/outcome`,
    - draft specs for PDA / instructions / events / replay / compiled artifact.
  - Safest defaults accepted unless ADR overrides them:
    - `effects_digest` is consensus-critical; detailed effect payload stays optional/non-consensus,
    - `allow_unreviewed_binding` may exist only as a dev-only config flag with default `false`.

### 2026-03-15 21:50:09 MSK - Architect freeze artifacts written

- Created freeze package files:
  - `docs/adr/0005-outcome-core-split.md`
  - `docs/outcome_runtime/outcome_core_architecture_freeze.md`
  - `docs/specs/outcome_program_pda_v1.md`
  - `docs/specs/outcome_instruction_set_v1.md`
  - `docs/specs/outcome_event_schema_v1.md`
  - `docs/specs/outcome_replay_contract_v1.md`
  - `docs/specs/outcome_compiled_artifact_contract_v1.md`
- Updated minimal hub docs:
  - `docs/outcome_runtime/README.md`
  - `docs/outcome_runtime/status.md`
  - `docs/outcome_runtime/project_full_documentation.md`
  - `docs/adr/0004-outcome-first-runtime.md`
- Freeze package now exists as concrete files; Engineer unblock condition on architecture artifacts is satisfied.

### 2026-03-15 22:03:00 MSK - Hub review of freeze artifacts

- Decision: Freeze package is not yet accepted for Engineer handoff; two blocking doc inconsistencies must be fixed first.
- Status: Blocked on Architect follow-up
- Notes:
  - Blocking issue 1:
    - `docs/outcome_runtime/outcome_core_architecture_freeze.md` defines `OutcomeResolution` without `compiled_artifact_hash`,
    - `docs/specs/outcome_replay_contract_v1.md` requires exact artifact-hash binding across event, config, registry, and resolution account and lists `ERR_RESOLUTION_HASH_MISMATCH`,
    - as written, Engineer cannot implement both contracts consistently.
  - Blocking issue 2:
    - `docs/outcome_runtime/project_full_documentation.md` still presents the legacy RNG preimage (`game_id`, `player_pubkey`) and legacy anchor name (`compiled_spec_hash`) as the consolidated project contract,
    - this conflicts with the accepted new-core terminology (`runtime_id`, `compiled_artifact_hash`) and risks narrative drift during implementation/test handoff.
  - Result:
    - Architect must patch the freeze docs first,
    - Engineer remains blocked,
    - Tester/Documenter can continue only after the corrected freeze package is accepted by Hub.

### 2026-03-15 22:29:48 MSK - Architect blocking doc fixes applied

- `OutcomeResolution` state model synced with replay contract:
  - `compiled_artifact_hash` added to required fields in `docs/outcome_runtime/outcome_core_architecture_freeze.md`
  - strict replay binding now explicitly includes resolution account hash equality in `docs/specs/outcome_replay_contract_v1.md`
- Consolidated new-core narrative synced in `docs/outcome_runtime/project_full_documentation.md`:
  - RNG contract now uses `runtime_id` / `actor_pubkey`
  - consensus anchor now uses `compiled_artifact_hash`
  - legacy terms remain only as legacy reference note

### 2026-03-15 22:36:00 MSK - Hub acceptance of corrected freeze package

- Decision: Freeze package accepted for Engineer handoff.
- Status: Ready for Engineer
- Notes:
  - Verified that `OutcomeResolution` now contains `compiled_artifact_hash` and replay binding explicitly checks it.
  - Verified that consolidated project docs now present the new-core contract with `runtime_id`, `actor_pubkey`, and `compiled_artifact_hash`.
  - No new blocking inconsistencies found in the corrected scope.
  - Remaining open item is non-blocking for this phase:
    - actual assignment of the new program id value before the first implementation PR.

### 2026-03-16 10:08:00 MSK - Hub review of Engineer package 1

- Decision: Not accepted yet; two blocking findings must be fixed by Engineer.
- Status: Blocked on Engineer follow-up
- Notes:
  - Blocking issue 1:
    - frozen instruction contract requires `authority or authorized admin` for `refresh_master_seed` and `admin_pause`,
    - implementation currently enforces only `OutcomeConfig.authority`,
    - this narrows the accepted admin surface and diverges from the freeze package.
  - Blocking issue 2:
    - compiled artifact contract requires that a non-empty effect table is allowed only if effect entries are referenced by outcomes,
    - parser currently bounds-checks slices but does not reject orphaned effect entries,
    - accepted runtime/spec behavior is therefore weaker than the frozen artifact contract.
  - Verified positives:
    - `cargo test -p outcome` passed locally (`7 passed`),
    - `anchor build` completed,
    - naming leakage grep only matched Solana `slot` sysvar field names, not legacy slot-game narrative.

### 2026-03-16 10:14:00 MSK - Hub acceptance of Engineer corrective patch

- Decision: Engineer bounded package 1 is accepted for Tester handoff.
- Status: Ready for Tester
- Notes:
  - Verified that `refresh_master_seed` and `admin_pause` now accept either `OutcomeConfig.authority` or `ProgramConfig.admin`.
  - Verified that `admin_withdraw` authorization surface was not expanded.
  - Verified that compiled artifact parsing now rejects orphan effect entries and includes a dedicated unit test.
  - Verification evidence:
    - `cargo test --manifest-path core/contracts/outcome/Cargo.toml -p outcome` -> PASS (`8 passed`)
    - `anchor build` in `core/contracts/outcome` -> PASS
  - Remaining non-blocking item:
    - replay CLI/verifier is still outside this bounded package and should be handled in a later package.

### 2026-03-16 12:18:00 MSK - Hub acceptance of Tester handoff

- Decision: Tester handoff accepted; bounded package 1 is valid for its current scope.
- Status: Ready for Documenter
- Notes:
  - Re-verified `cargo test -p outcome` locally -> PASS (`8 passed`).
  - Re-verified `anchor build` locally -> PASS.
  - Forbidden naming grep returned no legacy slot-game narrative hits in `core/contracts/outcome/programs/outcome/src`.
  - Residual gaps remain non-blocking and should be documented, not fixed in this package:
    - no dedicated negative tests yet for runtime admin auth,
    - no explicit finalize hash mismatch test,
    - no full resolve-path integration test with on-chain accounts,
    - replay CLI/verifier still out of scope.

### 2026-03-16 10:10:00 MSK - Engineer corrective patch for Hub blocking review

- Fixed runtime admin authorization without redesign:
  - `refresh_master_seed` and `admin_pause` now accept either `OutcomeConfig.authority` or `ProgramConfig.admin`
  - `admin_withdraw` authorization surface was not expanded
- Fixed compiled artifact validation:
  - parser now rejects orphan effect entries when `effect_table` contains entries not referenced by any outcome slice
  - added minimal unit test for orphan effect rejection
- Verification:
  - `cargo test --manifest-path core/contracts/outcome/Cargo.toml -p outcome` -> PASS (`8 passed`)
  - `anchor build` in `core/contracts/outcome` -> PASS
- Note:
  - admin override path for `refresh_master_seed` / `admin_pause` now depends on explicit `program_config` account wiring at call sites

### 2026-03-16 09:57:28 MSK - Engineer bounded implementation package 1

- Implemented new isolated workspace `core/contracts/outcome` with fixed new program id:
  - `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
- Added bounded outcome-only program surface:
  - state: `ProgramConfig`, `ApprovedOutcomeArtifact`, `ApprovedOutcomeArtifactChunk`, `OutcomeConfig`, `OutcomeResolution`
  - instructions: `initialize_program_config`, `set_program_config`, `submit_compiled_artifact`, `init_compiled_artifact_chunk`, `write_compiled_artifact_chunk`, `finalize_compiled_artifact`, `review_compiled_artifact`, `initialize_outcome_config`, `refresh_master_seed`, `resolve_outcome`, `admin_pause`, `admin_withdraw`
  - math/events: deterministic RNG v1, compiled artifact parser/selector v1, outcome events v1
- Ported accepted invariants only:
  - deterministic RNG contract with `runtime_id || resolve_id || actor_pubkey`
  - integer-only weighted selection
  - approved artifact registry lifecycle
  - chunked blob storage discipline
  - finalize hash validation
  - replay-critical artifact hash binding in config/resolution/event path
  - fail-fast error surface in new core
- Verification evidence:
  - `cargo test --manifest-path core/contracts/outcome/Cargo.toml -p outcome` -> PASS (`7 passed`)
  - `anchor build` in `core/contracts/outcome` -> PASS
- Notes:
  - replay CLI/verifier is not implemented in this package yet; only on-chain surface + pure math/tests were added
  - forbidden legacy naming grep on new core had no slot-game narrative hits; only Solana ledger field usage `.slot` / `last_seed_slot` remains per frozen docs

### 2026-03-16 12:10:34 MSK - Tester review for accepted bounded package 1

- Decision: No blocking findings in `core/contracts/outcome`; package is acceptable for bounded Tester handoff.
- Scope verified:
  - frozen-doc conformance for outcome-only naming, fixed new program id, new PDA namespace, and state/instruction/event surfaces,
  - runtime admin auth for `refresh_master_seed` / `admin_pause`,
  - unchanged bounded auth surface for `admin_withdraw`,
  - artifact registry/chunk/finalize discipline and exact artifact-hash binding in init/resolve/resolution/event path,
  - parser/math invariants for integer-only weighted selection, orphan effect rejection, unsorted/trailing malformed artifact rejection, and consensus-critical `effects_digest`.
- Verification evidence:
  - `cargo test -p outcome` in `core/contracts/outcome` -> PASS (`8 passed`)
  - `anchor build` in `core/contracts/outcome` -> PASS
  - forbidden naming grep in `core/contracts/outcome/programs/outcome/src` -> no legacy slot-game hits; only Solana slot sysvar/property usage remains (`Clock::get()?.slot`, `last_seed_slot`, `source_slot`) per frozen docs
- Residual non-blocking gaps:
  - no dedicated tests yet for runtime admin negative paths, finalize hash mismatch path, or full resolve-path integration over on-chain accounts;
  - replay CLI/verifier remains explicitly out of scope for this bounded package and does not block acceptance.

### 2026-03-16 12:26:56 MSK - Documenter documentation delta for accepted bounded package 1

- Created:
  - `docs/outcome_runtime/outcome_bounded_package_1_report.md`
- Updated minimally:
  - `docs/outcome_runtime/README.md`
  - `docs/outcome_runtime/status.md`
  - `docs/outcome_runtime/project_full_documentation.md`
- Documentation now states explicitly:
  - bounded package 1 in `core/contracts/outcome` is accepted for its current scope,
  - fixed new program id is `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`,
  - verification evidence is limited to `cargo test -p outcome` PASS (`8 passed`) and `anchor build` PASS,
  - replay CLI/verifier, adapters/UI/public packaging, and broader integration coverage remain out of scope or pending,
  - residual gaps are documented as non-blocking and the new core is not presented as release-complete or full replay-complete.

### 2026-03-16 12:34:00 MSK - Hub acceptance of Documenter handoff

- Decision: Bounded package 1 cycle is complete and accepted for its bounded scope.
- Status: Package 1 closed / Hub planning next package
- Notes:
  - Verified that the new report exists:
    - `docs/outcome_runtime/outcome_bounded_package_1_report.md`
  - Verified that `README.md`, `status.md`, and `project_full_documentation.md` now describe package 1 as accepted bounded scope, not full core completion.
  - No additional blocking documentation issues found in the current delta.
  - Task remains open for the next bounded package:
    - replay CLI/verifier for `core/contracts/outcome`,
    - broader integration and negative-path coverage.

### 2026-03-17 21:44:01 MSK - Hub extracted package 2 follow-up

- Decision: Replay-by-signature, localnet smoke, and targeted negative/integration coverage are split into a new task:
  - `OUTCOME-CLEANUP-002`
- Status: Follow-up extracted
- Notes:
  - `OUTCOME-CLEANUP-001` remains accepted and closed for bounded package 1 history.
  - New active task moved to:
    - `agent-instructions/hub-memory/tasks/OUTCOME-CLEANUP-002.md`
  - `CURRENT_TASK.md` now points to package 2 as the active scope.
