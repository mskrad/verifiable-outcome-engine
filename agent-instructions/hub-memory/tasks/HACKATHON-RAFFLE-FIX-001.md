# HACKATHON-RAFFLE-FIX-001

- Timestamp: 2026-04-15 15:07:11 +0300
- Parent Sprint: HACKATHON-SPRINT-1
- Current Stage: Ready for Hub acceptance
- Next Owner: Hub

## Scope

Fix the operator raffle flow that failed during devnet artifact finalization with `InvalidOutcomeId`.

## Facts

- Contract parser requires strictly increasing ASCII `outcome_id` values.
- The operator `--raffle` path encoded participant wallet addresses in declaration order.
- The declaration order was not sorted, so finalization rejected the artifact at `programs/outcome/src/math/compiled_outcome_v1.rs:214`.
- Current parser source already checks that seven effect reserved bytes remain before slicing.

## Changes

- `scripts/resolve_operator.ts` now sorts raffle participant IDs before artifact encoding.
- `scripts/resolve_operator.ts` now validates participant count, ASCII IDs, max ID length, and duplicates before writing the artifact.
- `programs/outcome/src/math/compiled_outcome_v1.rs` has a regression test for truncated effect reserved bytes returning an error without panicking.
- `tsconfig.json`, `package.json`, and `scripts/types.d.ts` make the existing TypeScript no-emit gate pass without changing runtime behavior.

## Verification

- `cargo test -p outcome rejects_truncated_effect_reserved_bytes_without_panicking`: passed.
- `yarn install --frozen-lockfile`: passed.
- `cargo fmt --check`: passed.
- `cargo test -p outcome`: passed, 9 tests.
- `npx tsc --noEmit`: passed.
- `yarn -s resolve:operator --help`: passed.
- `solana cluster-version --url https://api.devnet.solana.com`: returned `4.0.0-beta.6`.
- `yarn resolve:operator --url https://api.devnet.solana.com --wallet /Users/timurkurmangaliev/.config/solana/esjx.json --raffle`: passed.
- `yarn -s replay --sig 44CGwHRDhpQMkHjVkuE5EK3CjzvPsZae2yNejH2GBXXx6MBVqTgWPuox6cFZZtmPnLaDusQ9r62dpPmy4MVv7FDH --url https://api.devnet.solana.com --program-id 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`: `MATCH / OK`.
- `yarn resolve:operator --url https://api.devnet.solana.com --wallet /Users/timurkurmangaliev/.config/solana/esjx.json --raffle`: passed on re-test.
- `yarn -s replay --sig mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh --url https://api.devnet.solana.com --program-id 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`: `MATCH / OK`.

## Evidence

- Devnet raffle signature: `mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh`
- Program ID: `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
- Runtime ID: `06695059d916d903a26087c0770533c5`
- Resolve ID: `0`
- Compiled artifact hash: `4a3304a5cb2804331078c6e09b687fdbce1545e2cda5d77ef0c1eb3ab7688ed7`
- Result manifest: `tmp/resolve-operator/raffle-1776254790053-result.json`

## Risks

- Existing invalid unfinalized artifact PDA `CVgd73xYotw41jkfNBFwksy2hdWiWg3Xjw4PECetC7pw` remains on devnet and should be ignored.
- `.gitignore` currently excludes shared status/memory docs even though repo instructions say documents are stored in git by default.

## Hub Handoff

Review and accept or reject the verified fix:

```bash
cd /Users/timurkurmangaliev/verifiable-outcome-engine
yarn -s replay \
  --sig mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh \
  --url https://api.devnet.solana.com \
  --program-id 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq
```

Expected result: `verification_result : MATCH`, `verification_reason : OK`, runtime `06695059d916d903a26087c0770533c5`, hash `4a3304a5cb2804331078c6e09b687fdbce1545e2cda5d77ef0c1eb3ab7688ed7`.
