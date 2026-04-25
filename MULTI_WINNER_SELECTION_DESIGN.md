# Multi-Winner Selection Design Note

- Task ID: `HACKATHON-MULTI-WINNER-001`
- Status: Architect review complete; blocked for Hub decision
- Date: 2026-04-25

## 1. Context

Goal: allow an operator to set `winners_count: N` in artifact config and let VRE deterministically derive N distinct winners from the same resolve transaction randomness.

Constraint from task: no Rust/Anchor changes; SDK and artifact format only.

## 2. Facts

- `programs/outcome/src/math/compiled_outcome_v1.rs` selects exactly one outcome using `randomness[..8]`.
- On-chain `OutcomeResolution` and `OutcomeResolved` evidence store exactly one `outcome_id`, one `effects_digest`, and one `total_output_lamports`.
- Current compiled artifact v1 header has 8 reserved bytes, but Rust parser requires them to be zero.
- Rust parser rejects unknown trailing bytes.
- Therefore `winners_count` cannot be added to the committed compiled artifact bytes without changing Rust/Anchor parser semantics.
- `sdk/verify.ts` currently recomputes one selected outcome and checks it against the on-chain event/account.
- `artifacts/outcome_devnet_blessed_signatures.json` can store demo metadata, but it is not part of the on-chain artifact hash.

## 3. Assumptions

- Existing single-winner replay must remain byte-for-byte compatible.
- The public replay claim must not imply that N winners were all recorded on-chain when only the first selected outcome is recorded on-chain.
- A sidecar demo artifact is acceptable only if the UI/docs label it as SDK-derived from the committed randomness, not as N on-chain recorded winners.

## 4. Unknowns

- Whether Hub accepts a downgraded claim: first winner is on-chain checked; additional winners are deterministic SDK-derived from the same committed randomness.
- Whether Hub instead wants full on-chain commitment of `winners_count` and all selected winners; that requires Rust/Anchor changes and is out of current scope.

## 5. Options

### Option A: Hash-derived repeated weighted selection without replacement

Use current `chooseWeightedIndex` repeatedly over a shrinking candidate list.

Algorithm:

```ts
function deriveRoll(randomness: Buffer, round: number): bigint {
  if (round === 0) return randomness.readBigUInt64LE(0);
  return sha256(Buffer.concat([
    Buffer.from("VRE_MULTI_WINNER_V1", "ascii"),
    randomness,
    u32le(round),
  ])).readBigUInt64LE(0);
}

function selectDistinctOutcomes(parsed, randomness, winnersCount) {
  const remaining = parsed.outcomes.map((outcome, originalIndex) => ({
    outcome,
    originalIndex,
  }));
  const selected = [];

  for (let round = 0; round < winnersCount; round += 1) {
    const pickedIndex = chooseWeightedIndex(
      remaining.map((entry) => entry.outcome.weight),
      deriveRoll(randomness, round)
    );
    selected.push(remaining[pickedIndex]);
    remaining.splice(pickedIndex, 1);
  }

  return selected;
}
```

Properties:
- Round 0 exactly preserves current on-chain winner.
- Rounds 1..N are deterministic from the same resolve randomness.
- No duplicate winner because each selected entry is removed.
- Keeps current weighted selection semantics.
- Does not expand the pool by weight.

Trade-off:
- Without Rust changes, only round 0 is checked against on-chain `outcome_id`; rounds 1..N are replay-derived SDK evidence.

### Option B: Raw seed increment with current `chooseWeightedIndex`

Algorithm:

```ts
rolled_i = randomness.readBigUInt64LE(0) + BigInt(i)
```

Trade-off:
- Simpler than hashing, but adjacent rolls are correlated and produce visibly fragile behavior when totals are small.
- Not recommended.

### Option C: Fisher-Yates over expanded weighted pool

Algorithm:
- Expand each outcome into `weight` slots.
- Shuffle deterministically.
- Take unique IDs from the shuffled pool.

Trade-off:
- Not safe for current weight bounds because `weight` is `u32`.
- Can create large memory use.
- Deduping expanded entries changes effective probabilities in non-obvious ways.
- Not compatible with current compact `chooseWeightedIndex`.
- Not recommended.

## 6. Recommendation

Recommended algorithm if Hub accepts SDK-derived multi-winner semantics: Option A, hash-derived repeated weighted selection without replacement.

Architect verdict for current task constraints: NO-GO for Engineer until Hub accepts one of these decisions:

1. Accept narrowed MVP: `winners_count` is sidecar/config metadata; first winner is on-chain verified, additional winners are deterministic SDK-derived from the same committed randomness.
2. Allow Rust/Anchor changes in a follow-up task to commit `winners_count` and all selected winners in the artifact/event/account.

## 7. Artifact Config Format

Backwards-compatible JSON config extension:

```json
{
  "type": "raffle",
  "input_lamports": 10,
  "payout_lamports": 3,
  "winners_count": 3,
  "participants": [
    { "address": "5RbvSHbSuo9CBjZLtw9RoP775KeqaJyMXkXNsb99AeR4", "weight": 1000 },
    { "address": "Aip3wC6UCgE5628ukFW6z3rDGDVTAXKDG4V3j15tPvEU", "weight": 1000 },
    { "address": "3nafSu5GVq9bDLAxCg2gPucT4Jzhi2Ybyy2QbhzTMFR9", "weight": 1000 }
  ]
}
```

Validation:
- `winners_count` is optional.
- Default is `1`.
- Must be a safe integer.
- Must be `>= 1`.
- Must be `<= outcomes.length` after config normalization.
- For first MVP, allow on `raffle` and `airdrop`; reject on `loot` unless Hub explicitly wants multi-loot.

Compatibility limitation:
- Under current no-Rust scope, `winners_count` cannot be serialized into compiled artifact v1 bytes.
- If Engineer implements narrowed MVP, `winners_count` must be carried by sidecar/demo metadata or an explicit SDK option. It is not independently recoverable from an arbitrary transaction signature.

## 8. Verify Response Shape

Keep existing shape for `winners_count === 1`:

```json
{
  "verification_result": "MATCH",
  "verification_reason": "OK",
  "outcome_id": "alice",
  "outcomes": [{ "id": "alice", "weight": 1000 }]
}
```

For `winners_count > 1`, add fields without removing `outcome_id`:

```json
{
  "verification_result": "MATCH",
  "verification_reason": "OK",
  "outcome_id": "alice",
  "outcome_ids": ["alice", "bob", "carol"],
  "winners_count": 3,
  "multi_winner_semantics": "first_onchain_rest_sdk_derived",
  "outcomes": [{ "id": "alice", "weight": 1000 }]
}
```

Rules:
- `outcome_id` remains the first selected winner and must match chain.
- `outcome_ids[0] === outcome_id`.
- `outcome_ids` appears only when `winners_count > 1`.
- `outcomes` keeps its current meaning: full candidate list, not winners list.

## 9. Scope of Code Changes

If Hub accepts narrowed SDK-derived MVP:

- `sdk/types.ts`
  - Add `winners_count?: number` to `RaffleConfig` and `AirdropConfig`.
  - Add `outcome_ids?: string[]`, `winners_count?: number`, and `multi_winner_semantics?: string` to `VerifyResult`.
- `sdk/artifact.ts`
  - Add `validateWinnersCount(value, outcomeCount, label)`.
  - Parse and validate `winners_count` in `buildRaffleConfig` and `buildAirdropConfig`.
  - Do not serialize `winners_count` into W3O1 v1 bytes under no-Rust scope.
  - If needed, expose a helper that returns normalized config metadata separately from the artifact blob.
- `sdk/verify.ts`
  - Keep `chooseWeightedIndex` unchanged.
  - Add `deriveMultiWinnerRoll`.
  - Add `selectOutcomesWithoutReplacement`.
  - Keep `selectOutcome` behavior unchanged for on-chain comparison.
  - Add optional winners-count input only through a controlled SDK/script path, not from chain.
- `scripts/build_artifact.ts`
  - Optionally print `winners_count` sidecar metadata.
- `scripts/replay_verify.ts`
  - Only if Hub accepts narrowed scope: accept `--winners-count <N>` and emit `outcome_ids`.

Do not modify:
- `programs/outcome/`
- `web/server.mjs` logic
- existing blessed signature entries

## 10. New Blessed Signature Requirements

If narrowed MVP is accepted:

- Add a new config, for example `examples/multi_winner_raffle.config.json`, with `winners_count: 3`.
- Produce a fresh devnet resolve transaction.
- Append a new blessed entry, e.g. `outcome_core_devnet_sig_10`; do not edit existing active signatures.
- Evidence must include:
  - `winners_count: 3`
  - `outcome_id`: first winner, matching chain
  - `outcome_ids`: 3 distinct winners
  - `outcome_ids[0] === outcome_id`
  - `verification_result: MATCH`
  - `verification_reason: OK`
  - artifact hash and runtime/resolve IDs
  - explicit note: additional winners are SDK-derived from committed randomness and sidecar `winners_count`

## 11. Scope Guard

Confirmed guardrails:
- No changes to `programs/outcome/`.
- No changes to `web/server.mjs` logic.
- No mutation of existing blessed signature entries.
- No claim that all N winners are recorded on-chain unless Rust/Anchor scope changes.

## 12. Go / No-Go

NO-GO for Engineer under the original claim that `winners_count` is artifact-committed and recoverable from any transaction signature without Rust changes.

Conditional GO only if Hub accepts the narrowed SDK-derived MVP:
- `winners_count` is external sidecar/config metadata.
- First winner is chain-verified.
- Additional winners are deterministic SDK-derived from the same committed randomness.
- Public copy must disclose this limitation.

Confidence: high for the limitation; medium for the narrowed MVP value.
