# TASK MEMORY TEMPLATE: OUTCOME-ADAPTERS-006

## Task Card Snapshot

- Problem:
  - После accepted packages 1/2, accepted devnet gate и accepted broader localnet coverage нужно отдельно определить bounded adapters package. Нельзя смешивать это с public packaging или с дальнейшим core redesign.
- Scope:
  - bounded adapters track only
  - определить, какие adapter surfaces могут считаться next accepted package поверх frozen outcome-core baseline
  - без public packaging
  - без UI/product expansion
  - без runtime redesign
- Acceptance:
  - Architect handoff должен определить:
    - bounded adapters goal
    - exact adapter scenario set
    - acceptance contract
    - file impact
    - role handoff for Engineer / Tester / Documenter

## Timeline

### 2026-03-30 23:48:14 MSK - Hub opened next bounded task after accepted broader coverage

- Decision:
  - Opened for Architect handoff.
- Status:
  - Architect handoff requested
- Notes:
  - this task follows the frozen ordering after:
    - accepted devnet gate
    - accepted broader localnet integration coverage
  - public packaging remains out of scope for this task

## Open Items

- Architect must define the bounded adapters package without expanding into public packaging or release-complete claims.

## Handoff Pointers

- Frozen execution baseline:
  - `docs/outcome_runtime/v0_1_0_execution_contract.md`
- Accepted previous tasks:
  - `agent-instructions/hub-memory/tasks/OUTCOME-DEVNET-004.md`
  - `agent-instructions/hub-memory/tasks/OUTCOME-COVERAGE-005.md`
- Current track status:
  - `docs/outcome_runtime/status.md`

## Architect Append

### 2026-03-30 23:54:28 MSK - Bounded adapters handoff frozen

- Decision:
  - Created bounded architect handoff:
    - `docs/plans/2026-03-30-outcome-adapters-package.md`
- Status:
  - Architect handoff ready for Engineer
- Notes:
  - accepted adapters package is limited to:
    - `examples/raffle`
    - `examples/loot`
    - shared adapter docs
  - accepted adapter execution surface is limited to adapter-owned:
    - `yarn -s demo`
    - `yarn -s replay --sig <TX_SIG>`
  - `examples/web` and public packaging remain explicitly out of scope
  - frozen outcome-core baseline and canonical fixed program id remain unchanged

## Engineer Append

### 2026-03-31 00:12:00 MSK - Adapter-owned demo/replay package implemented

- Decision:
  - kept scope bounded to `examples/raffle` and `examples/loot` only
  - did not redesign the shared bridge in `core/contracts/slot`
- Implementation:
  - updated adapter-owned binding/logging in:
    - `examples/raffle/scripts/demo.sh`
    - `examples/loot/scripts/demo.sh`
  - updated shared adapter docs:
    - `examples/common/ENV.md`
    - `examples/common/VERIFY.md`
  - refreshed adapter evidence docs:
    - `examples/raffle/artifacts/EXPECTED_TX_EXAMPLES.md`
    - `examples/loot/artifacts/EXPECTED_TX_EXAMPLES.md`
  - created bounded report:
    - `docs/outcome_runtime/outcome_adapters_package_report.md`
  - updated:
    - `docs/outcome_runtime/status.md`
- Fresh localnet evidence:
  - raffle demo:
    - `signature: 1H2nXuV8WMZaVgTbD5NU3dGLsRL5ZqzQyvWoUMrT3bS7hsEqPY62xUsY8RufLyDWALKPz6rcSGwC9Sjdxwzd2Ae`
  - loot demo:
    - `signature: 5zi1bgdoCfoVQZtphiJkQutRVGeUGD5E1Xh3khidwvAdFmhp6quMjVZuokZt52J8fgQkofZkode6uY3pVzHtb4Sr`
  - raffle replay:
    - `verification_result : MATCH`
    - `verification_reason : OK`
  - loot replay:
    - `verification_result : MATCH`
    - `verification_reason : OK`
- Status:
  - Engineer package ready for Tester

### 2026-03-31 00:14:43 MSK - Hub accepted engineer adapters package for Tester

- Decision:
  - Accepted for Tester handoff.
- Status:
  - Tester handoff ready
- Notes:
  - Hub review sees the package staying within the bounded adapter-owned surface only:
    - `examples/raffle`
    - `examples/loot`
    - `examples/common`
  - no immediate scope-expansion blocker detected into:
    - `examples/web`
    - public packaging
    - runtime redesign
  - fresh evidence reported by Engineer is sufficient for independent Tester validation:
    - one fresh raffle signature
    - one fresh loot signature
    - both replays currently reported as `MATCH / OK`
  - `docs/outcome_runtime/outcome_adapters_package_report.md` is present and suitable as the bounded report surface for the next stage

### 2026-03-31 00:22:43 MSK - Hub decision after tester review

- Decision:
  - Accepted for Documenter handoff, with one non-blocking docs clarification required.
- Status:
  - Documenter handoff ready
- Hub interpretation of tester result:
  - the reported stale localnet signatures are not a blocker against the accepted adapters contract
  - localnet signature invalidation after validator reset is expected and already documented in the adapter evidence files
  - the actual acceptance surface remains:
    - fresh adapter-owned `yarn -s demo`
    - immediate adapter-owned `yarn -s replay --sig <TX_SIG>`
  - Tester evidence confirms that both fresh raffle and fresh loot runs still produce:
    - valid fresh signatures
    - `verification_result : MATCH`
    - `verification_reason : OK`
- Required Documenter clarification:
  - make it explicit that recorded localnet signatures in report/examples are historical samples, not evergreen acceptance fixtures across validator resets
  - keep accepted package scope bounded to adapter-owned fresh localnet demo/replay only

## Tester Append

### 2026-03-31 00:26:40 MSK - Tester bounded adapters validation found a blocker in recorded sample evidence

- Decision:
  - Not accepted yet
- Blocking finding:
  - adapter-owned fresh demo/replay flow works for both `raffle` and `loot`, but the recorded localnet sample signatures currently used as concrete expected evidence in:
    - `docs/outcome_runtime/outcome_adapters_package_report.md`
    - `examples/raffle/artifacts/EXPECTED_TX_EXAMPLES.md`
    - `examples/loot/artifacts/EXPECTED_TX_EXAMPLES.md`
    do not reproduce on a fresh validator reset and direct replay on those recorded signatures returns:
    - `verification_result : MISMATCH`
    - `verification_reason : ERR_TX_NOT_FOUND_OR_NO_LOGS`
- Fresh bounded tester evidence on a clean localnet:
  - `slot` deploy -> PASS
  - `cd examples/raffle && yarn -s demo` -> PASS
    - binding lines printed
    - fresh signature:
      - `2qKccZ5sdRWQDvdeR4gU5UhVxGyBVTvFDoEm3cQtwUzW77CCr8E5fPmUNDtCJyW7v73iHvR9tndTTDXyGQMwfcqm`
    - explicit replay on that fresh signature -> `MATCH / OK`
  - `cd examples/loot && yarn -s demo` -> PASS
    - binding lines printed
    - fresh signature:
      - `5JM1iXggwHqtmoAcT7a7YGkASUZsNG4uV3VGFf6WQ1EoxuSGV5jZrGw5KPAKdSR9jR2tiUGSzVXu2oiyFdPmamrF`
    - explicit replay on that fresh signature -> `MATCH / OK`
- Blocking mismatch against recorded samples:
  - recorded raffle sample:
    - `1H2nXuV8WMZaVgTbD5NU3dGLsRL5ZqzQyvWoUMrT3bS7hsEqPY62xUsY8RufLyDWALKPz6rcSGwC9Sjdxwzd2Ae`
    - direct replay on fresh reset validator -> `ERR_TX_NOT_FOUND_OR_NO_LOGS`
  - recorded loot sample:
    - `5zi1bgdoCfoVQZtphiJkQutRVGeUGD5E1Xh3khidwvAdFmhp6quMjVZuokZt52J8fgQkofZkode6uY3pVzHtb4Sr`
    - direct replay on fresh reset validator -> `ERR_TX_NOT_FOUND_OR_NO_LOGS`
- Scope note:
  - no blocker found around adapter-owned entrypoints themselves
  - no blocker found around `examples/web` or public packaging scope creep
  - blocker is specifically about the recorded exact localnet sample evidence currently presented for Tester recheck

### 2026-03-31 00:27:00 MSK - Documenter clarified adapter docs wording for Hub close

- Decision:
  - no blocker doc issue remains inside bounded scope
- Updated docs:
  - `docs/outcome_runtime/outcome_adapters_package_report.md`
  - `docs/outcome_runtime/status.md`
  - `examples/common/VERIFY.md`
  - `examples/raffle/artifacts/EXPECTED_TX_EXAMPLES.md`
  - `examples/loot/artifacts/EXPECTED_TX_EXAMPLES.md`
- Clarification applied:
  - accepted adapter package relies on fresh adapter-owned `demo`
  - accepted adapter package relies on immediate adapter-owned `replay --sig <TX_SIG>`
  - both steps must run on the same live local validator session
  - recorded localnet signatures are historical sample evidence only
  - recorded localnet signatures are not guaranteed after validator reset
- Scope guardrails preserved:
  - no `examples/web`
  - no public packaging
  - no runtime redesign
  - no broader release-complete claim
- Status for Hub:
  - `Documenter ready / final Hub close`
