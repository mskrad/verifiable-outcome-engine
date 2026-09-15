# VRE Protocol Specification

Machine-readable copy of https://verifiableoutcome.online/spec for agents and tools. Same sections, same anchors, same facts.

- Product: Verifiable Outcome Engine (VRE). On-chain proof of who won.
- Cluster: Solana devnet. Mainnet is planned for this year.
- Canonical program: `6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B`
- Last program deploy: slot 497829503, 2026-09-13
- SDK: `verifiable-outcome-sdk` 0.8.2 (npm)
- Base URL: `https://verifiableoutcome.online`
- Conventions: all integers little-endian; hashes are SHA-256; `‖` is byte concatenation.

<a id="overview"></a>
## 01 · Overview

VRE commits the rules of an outcome on Solana before the result exists. Anyone can later recompute the result from the transaction signature, using only public RPC data, and compare it with what the program recorded.

### What a MATCH proves
- The rules did not change: participants, weights or scores, formula and winner count are the exact bytes stored on-chain under the committed artifact hash, bound to the runtime before resolution.
- The winners follow from the rules: replaying the committed bytes with the recorded randomness yields the same winners in the same order.
- The records agree: input, output, winner count, winner ids and effect digests match across the event, the resolution account and the replay.

### What it does not prove
- That the list was fair or complete when committed. Only that it did not change after commit.
- That the operator could not foresee the result on every path. This depends on the randomness source (§02).
- That a prize was paid. Attestation paths prove winners; payout is the integrator's step.

<a id="resolution-model"></a>
## 02 · Resolution Model

Every path: commit the rules, bind a runtime, resolve, replay.

1. Commit: `submit_compiled_artifact`, `init_compiled_artifact_chunk`, `write_compiled_artifact_chunk`, `finalize_compiled_artifact` store artifact bytes in chunk accounts keyed by SHA-256. `review_compiled_artifact` (ProgramConfig admin) approves the artifact for binding.
2. Bind: `initialize_outcome_config` creates a runtime (`runtime_id`) bound to one artifact hash.
3. Resolve: a path from §06 writes an `OutcomeResolution` account and emits a resolution event.
4. Replay: a verifier rebuilds the artifact from chunks, recomputes randomness and winners, compares with the records (§04).

### Randomness sources

| Source | Entropy | Operator can / cannot | Status |
|---|---|---|---|
| `rng_v1` | `master_seed` set by the operator at runtime creation | Cannot change rules or recorded result. Can compute the result before sending. | Legacy. No public endpoint uses it; not planned for mainnet. |
| `rng_v2` single phase (v1.2) | Hashes of three future slots fixed at prepare | Cannot predict. Can decline to settle; the unsettled draw stays on-chain and expires. | Canonical. Default. |
| `rng_v2` two phase (v1.3.2) | Same slot hashes; anyone may seal | Cannot predict and cannot abort; skipping attest forfeits the stake. | Canonical. Opt-in per draw. |
| Unicorn-G (B8) | VDF output verified with Groth16 | Designed to remove residual validator influence. | Implemented; not deployed to the canonical program. |

```text
# rng_v1
randomness   = SHA256(master_seed ‖ runtime_id ‖ resolve_id_u64le ‖ actor)

# rng_v2
# offsets by path: draws {8, 16, 24} · sortition {75, 90, 105} · slot spins {3, 4, 5}
target_slots = prepare_slot + offsets
# each target resolves to itself, or to the next produced slot after the previous resolved one
seed         = SHA256("VRE_RNG_V2" ‖ runtime_id ‖ resolve_id_u64le ‖ compiled_artifact_hash
                      ‖ snapshot_hash ‖ (slot_u64le ‖ slot_hash) × 3 [‖ operator_commit_hash])
randomness   = SHA256(seed ‖ runtime_id ‖ resolve_id_u64le ‖ actor)
expiry_slot  = target_slots[2] + 480
# snapshot_hash is 32 zero bytes for compact artifacts
```

Resolved slots and slot hashes are stored in the resolution account and the event; replay never needs historical SlotHashes.

### Which path the public endpoints use today

| Endpoint | Resolution path |
|---|---|
| `POST /api/examples/draw`, `POST /api/partner/draw`, `POST /api/live-raffle` | rng_v2 single phase in one request: commit, `prepare_rng_v2`, wait for target slots, `settle_rng_v2`, replay. |
| `POST /api/partner/snapshot/finalize` | rng_v2 single phase on a format 7 snapshot artifact, in the background: publish the snapshot, commit, `prepare_rng_v2`, wait, `settle_rng_v2` with the claimed winners, replay. |
| `POST /api/partner/sortition/seal`, `POST /api/examples/sortition/seal` | Sortition seal on future slot hashes. |
| `POST /api/partner/conditions/resolve` | `resolve_conditions`: deterministic scoring against revealed facts. No randomness. |

<a id="formats"></a>
## 03 · Artifact Formats

Magic `"W3O1"`, then `u16` format version. Max artifact size 8,192 bytes. Participant ids: printable ASCII, zero-padded to 64 bytes, strictly ascending by bytes.

| fmt | Name | Winners selected by | Randomness | Shape |
|---|---|---|---|---|
| 1 | W3O1 v1 | Program, on-chain table | rng_v1, rng_v2 | Weighted single winner, per-outcome SOL effects |
| 2 | W3O1 v2 | Program | rng_v1, rng_v2 | Weighted multi-winner, without replacement |
| 3 | W3O1 v3 | Program | rng_v1, rng_v2 | Native formulas, signed scores, stable order |
| 4 | Snapshot v4 | Caller claim, snapshot replay | rng_v1 | Legacy snapshot line |
| 5 | Outcome Standard V1.1 compact | Program | rng_v1, rng_v2 | Named entries, one payout per winner, up to 103 entries |
| 6 | Outcome Standard V1.2 scale | Caller claim, snapshot replay | rng_v1 | Snapshot hash and URI on-chain |
| 7 | Outcome Standard V1.2.1 scale | Caller claim bound by `winner_claim_hash`, snapshot + Merkle replay | rng_v1, rng_v2 | Large lists off-chain, optional Merkle root |
| 8 | composite_rank_desc | Program | rng_v1, rng_v2 (accepted, not yet in e2e suite) | Multi-field weighted score, descending |
| 9 | Conditions fc7 | Program scores slips against facts | none | `resolve_conditions` only |
| 10 | Slot SF1 | Program replays reels | future slot hashes | `prepare_slot_spin`, `settle_slot_spin` |

Artifacts resolved through rng_v2 must be payout-free: header payout and every effect amount are zero.

### Selection rules
- `weighted_random`: round `r` takes a u64 from the first 8 bytes of the randomness when `r = 0`, else from SHA-256 of a domain tag, the randomness and `r`; selects the entry whose cumulative weight covers `u64 mod total_weight` among entries not yet chosen.
- `rank_desc`: score descending, ties by `order` ascending.
- `rank_asc`: score ascending, ties by `order` ascending.
- `first_n`: `order` ascending.
- `closest_to`: `|score − target|` ascending (128-bit), ties by `order` ascending.
- Compact rng_v2 winner digest: `winner_claim_hash = SHA256("VRE_RNG_V2_WINNERS" ‖ count_u16le ‖ Σ(len_u8 ‖ id_bytes))`.

### W3O1 v1–v3 layout (fmt 1, 2, 3)

| Header field | Type | Notes |
|---|---|---|
| magic | bytes[4] | `"W3O1"` |
| format_version | u16 | 1, 2 or 3 |
| min_input_lamports, max_input_lamports | u64, u64 | Must equal runtime bounds |
| outcome_count, total_effect_count | u16, u16 | |
| v1: reserved | bytes[8] | Zero; one winner, weighted_random |
| v2: winners_count, reserved | u16, bytes[6] | weighted_random |
| v3: winners_count, formula_code, reserved, target_score | u16, u8, bytes[5], i64 | 1 weighted_random, 2 rank_desc, 3 rank_asc, 4 first_n, 5 closest_to |

| Outcome record | Type | Notes |
|---|---|---|
| outcome_id_len, outcome_id | u8, bytes[64] | Printable ASCII, zero-padded |
| weight | u32 | > 0 |
| v3 only: score, order | i64, u16 | `order` unique |
| first_effect_index, effect_count | u16, u16 | Slice of effect table |
| effect | u8, bytes[7], u64 | Type 1 = transfer SOL, reserved zero, amount |

### Compact V1.1 layout (fmt 5)

| Field | Type | Notes |
|---|---|---|
| magic, format_version | bytes[4], u16 | fmt 5 |
| min_input_lamports, max_input_lamports | u64, u64 | |
| winners_count, formula_code, reserved, target_score | u16, u8, bytes[5], i64 | 48-byte header total |
| entry_count, payout_lamports | u16, u64 | One payout per winner |
| entry | u8, bytes[64], u32, i64, u16 | id_len, id, weight, score, order; 79 bytes |

### Scale layout (fmt 6, 7)

| Field | Type | Notes |
|---|---|---|
| magic, format_version | bytes[4], u16 | fmt 6 or 7 |
| min_input_lamports, max_input_lamports | u64, u64 | |
| winners_count, formula_code, flags, reserved | u16, u8, u8, bytes[4] | Flag bit 0: Merkle root present |
| target_score, snapshot_count, payout_lamports | i64, u32, u64 | |
| snapshot_hash | bytes[32] | SHA-256 of canonical snapshot |
| merkle_root | bytes[32] | Only if flag bit 0 |
| snapshot_uri_len, snapshot_uri | u16, bytes | 1–512 bytes, no control characters |

Composite, conditions and slot layouts: see SDK modules (§08).

<a id="verification"></a>
## 04 · Verification

Input: transaction signature and program ID.

1. Fetch transaction logs; find the resolution event emitted by that program. Conditions and slot events use dedicated replays.
2. Load `OutcomeConfig`, `OutcomeResolution`, `ApprovedOutcomeArtifact` header and, for rng_v2, `RngV2State`.
3. Check the artifact hash is equal in event, config, resolution and header; artifact finalized; status allows binding.
4. Rebuild the artifact from chunk accounts; re-hash.
5. Recompute randomness: `master_seed` (rng_v1) or recorded slots and slot hashes (rng_v2); check operator reveal against commitment.
6. Replay winner selection: compact from the on-chain table; scale by fetching the snapshot (committed URI or a hash-addressed mirror, see Snapshot sources in §08) and checking hash, count and Merkle root.
7. Compare input, output, winner count, winner ids and padding, winner digest, effect digest. All equal: `MATCH / OK`. Otherwise the first failing check's code.

### HTTP response

`POST /api/replay` with `{"signature": "<sig>", "programId": "<optional>"}` (`sig` also accepted). RPC and local-artifact overrides are disabled on the public host.

```json
{
  "ok": true,
  "replay": {
    "verification_result": "MATCH",
    "verification_reason": "OK",
    "outcome_id": "entry_02",
    "outcome_ids": ["entry_02", "entry_03", "entry_04"],
    "winners_count": 3,
    "artifact_format_version": 5,
    "resolution_formula": "weighted_random",
    "runtime_id": "64bfee3c3b1bd09d6a6160bd46ed7b82",
    "resolve_id": "0",
    "compiled_artifact_hash": "bbd8ea03e8a3dfc00f8e921b88a50941a9d17ead5ddf4f228d8f77cedf3fc0c9",
    "program_id": "6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B",
    "outcomes": []
  },
  "stdout": "…",
  "stderr": "…"
}
```

Example from devnet signature `237xT8M5YE9drfMTdJKRCrgbWU6b1pZAB7YPHZkgy8A3pqi8Jtf3TrAVCBaLa6GfXDS5MaMNAEsSkjRyf5aCYEgw` (2026-09-13); `outcomes` abbreviated.

### SDK result

`verifyOutcome` returns the same data with `status` / `reason` instead of `verification_result` / `verification_reason`. Fields appear only when applicable.

| Group | Fields |
|---|---|
| Always | status, reason, outcome_id, resolve_id, compiled_artifact_hash, runtime_id, program_id |
| Winners and rules | outcome_ids, winners_count, artifact_format_version, resolution_formula, target, standard_version, entry_count, outcomes[] |
| rng_v2 | rng_version, target_slots, resolved_slots, slot_hashes, operator_commit_hash, winner_claim_hash, entropy_source, protocol_revision |
| Scale snapshot | snapshot_hash, snapshot_count, snapshot_uri, merkle_root |
| Conditions | entrant_count, winning_score_sum, winners_digest, facts_ref_root |
| Slot spin | actor, input_lamports, payout_lamports, raw_win_lamports, reel_stops, randomness, settled_at_slot |

### Reason codes

`MATCH` always carries `OK`. `MISMATCH` carries one of:

| Code | Meaning |
|---|---|
| `OK` | All checks passed |
| `ERR_TX_NOT_FOUND_OR_NO_LOGS` | RPC could not return the transaction or its logs |
| `ERR_PROGRAM_ID_MISMATCH` | Requested program not invoked, or event from another program |
| `ERR_EVENT_DISCRIMINATOR_MISMATCH` | Program data is not a supported resolution event |
| `ERR_EVENT_NOT_FOUND_FOR_PROGRAM` | No resolution event from the requested program |
| `ERR_OUTCOME_CONFIG_NOT_FOUND` | `OutcomeConfig` missing or undecodable |
| `ERR_RESOLUTION_ACCOUNT_NOT_FOUND` | `OutcomeResolution` missing or undecodable |
| `ERR_ARTIFACT_HEADER_NOT_FOUND` | `ApprovedOutcomeArtifact` header missing or undecodable |
| `ERR_ARTIFACT_CHUNK_MISSING` | Artifact chunk missing, unreadable, misplaced or incomplete |
| `ERR_CONFIG_HASH_MISMATCH` | Config artifact hash differs from event |
| `ERR_RESOLUTION_HASH_MISMATCH` | Resolution hash, runtime or resolve id differs from event |
| `ERR_ARTIFACT_HASH_MISMATCH` | Header, rebuilt bytes or supplied file do not hash to the event hash |
| `ERR_ARTIFACT_NOT_FINALIZED` | Artifact never finalized |
| `ERR_ARTIFACT_STATUS_INVALID` | Artifact status does not allow binding |
| `ERR_ARTIFACT_FORMAT_VERSION_MISMATCH` | Format version differs between event, account and artifact |
| `ERR_RANDOMNESS_MISMATCH` | Recomputed randomness differs from event or account |
| `ERR_RNG_V2_EVIDENCE_MISSING` | Resolved slots, slot hashes or commit evidence missing |
| `ERR_RNG_V2_SNAPSHOT_HASH_MISMATCH` | Event snapshot hash differs from artifact, or non-zero for a compact artifact |
| `ERR_SNAPSHOT_UNAVAILABLE` | No source (committed URI, hash-addressed mirror, local copy) served the snapshot with the committed hash; unverifiable, not disproven |
| `ERR_RNG_V2_STATE_MISMATCH` | Event differs from prepared `RngV2State` |
| `ERR_RNG_V2_RESOLUTION_MISMATCH` | rng_v2 evidence differs between event and resolution account |
| `ERR_RNG_V2_OPERATOR_REVEAL_MISMATCH` | Operator reveal missing or does not hash to its commitment |
| `ERR_INPUT_MISMATCH` | Input lamports differ between event, account and replay |
| `ERR_OUTPUT_MISMATCH` | Output lamports differ between event, account and replay |
| `ERR_WINNER_COUNT_MISMATCH` | Winner count differs between event, account, artifact and replay |
| `ERR_OUTCOME_ID_MISMATCH` | A winner id, length or zero padding differs from replay |
| `ERR_WINNER_CLAIM_HASH_MISMATCH` | Recorded winner digest differs from digest of replayed list |
| `ERR_EFFECTS_DIGEST_MISMATCH` | Effect count or digest differs from replay |
| `ERR_CONDITIONS_ENTRANT_COUNT_MISMATCH` | Conditions: entrant count differs from committed artifact |
| `ERR_CONDITIONS_FACTS_ROOT_MISMATCH` | Conditions: facts root differs from event |
| `ERR_CONDITIONS_SCORE_SUM_MISMATCH` | Conditions: winning score sum differs from event |
| `ERR_CONDITIONS_WINNERS_DIGEST_MISMATCH` | Conditions: ranking digest differs from event |
| `ERR_SLOT_RANDOMNESS_MISMATCH` | Slot: randomness from frozen slot evidence differs from event |
| `ERR_SLOT_REEL_STOPS_MISMATCH` | Slot: replayed reel stops differ from event |
| `ERR_SLOT_WIN_MISMATCH` | Slot: replayed raw win differs from event |
| `ERR_SLOT_PAYOUT_MISMATCH` | Slot: `min(raw win, max-win cap)` differs from payout |
| `ERR_REPLAY_UNHANDLED` | Internal error or unsupported shape; on public devnet RPC also a temporary rate limit, retry after 20–30 s |

<a id="program"></a>
## 05 · Canonical Program

| Item | Value |
|---|---|
| Program ID | `6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B` |
| Upgrade authority | `9Ei6bPifoK3UKkAPn5eMTHboFjCe6wF2jSRcrGBtqe4b` |
| ProgramConfig admin | `CJN7pVC8LCsia4QPy1yWiTX3iQMtVbnwjoUmyNK4ce2Y` |
| Treasury | `GQcdfnLVQn8Jur7SAyokBGL9uspveS2GbUo7r95kgLQm` |

Key separation: the upgrade authority can only replace code. The admin signs operational calls including `review_compiled_artifact` and cannot upgrade. Both single keys on devnet; mainnet governance decided separately.

### ProgramConfig

| Field | Type | Devnet value |
|---|---|---|
| admin | Pubkey | `CJN7pVC8LCsia4QPy1yWiTX3iQMtVbnwjoUmyNK4ce2Y` |
| allow_unreviewed_binding | bool | false |
| fee_lamports | u64 | 0 |
| treasury | Pubkey | `GQcdfnLVQn8Jur7SAyokBGL9uspveS2GbUo7r95kgLQm` |

### Account addresses (PDA seeds)

| Account | Seeds |
|---|---|
| ProgramConfig | `["outcome_program_config"]` |
| ApprovedOutcomeArtifact | `["approved_outcome_artifact", artifact_hash]` |
| artifact chunk | `["approved_outcome_artifact_chunk", artifact_hash, index_u32le]` |
| OutcomeConfig | `["outcome_config", runtime_id]` |
| vault | `["outcome_vault", runtime_id]` |
| OutcomeResolution | `["outcome_resolution", runtime_id, resolve_id_u64le]` |
| RngV2State | `["rng_v2_state", runtime_id, resolve_id_u64le]` |

### Protocol fee

`fee_lamports` = 0 on devnet, changeable by the admin without upgrade. When set: charged by `resolve_outcome*` and `settle_rng_v2` from the operator; snapshotted at `prepare_rng_v2` and taken from the stake at `attest_winners`; charged on paid sortition registration. Verification is free.

### Instructions

| Group | Instructions |
|---|---|
| Config and admin | initialize_program_config, set_program_config, recover_program_config_admin, admin_pause, admin_withdraw |
| Artifact commit | submit_compiled_artifact, init_compiled_artifact_chunk, write_compiled_artifact_chunk, finalize_compiled_artifact, review_compiled_artifact, initialize_outcome_config |
| rng_v1 resolve | resolve_outcome, resolve_outcome_v4, resolve_outcome_v121, refresh_master_seed |
| rng_v2 | prepare_rng_v2, settle_rng_v2, seal_randomness, attest_winners, expire_rng_v2, expire_sealed_rng_v2 |
| Sortition | create_sortition_draw, register_sortition_ticket, register_sortition_ticket_paid, seal_sortition_draw, claim_sortition_ticket, init_sortition_economics, close_sortition_ticket, sweep_sortition_tickets |
| Conditions | resolve_conditions |
| Slot | prepare_slot_spin, settle_slot_spin |
| Unicorn-G (source only, not in current build) | initialize_unicorn_g_config, set_unicorn_g_config, prepare_rng_v2_unicorn, seal_randomness_unicorn |

### Compute and heap

Compact artifacts on rng_v2 (`prepare_rng_v2`, `settle_rng_v2`, `attest_winners`) parse the full outcome table on-chain: add `ComputeBudgetProgram.requestHeapFrame` (up to 256 KiB) and a ~1.4M CU limit. Measured at 103 entries: settle 174k–266k CU, attest 142k–231k CU. Other instructions keep the default 32 KiB heap.

<a id="paths"></a>
## 06 · Resolution Paths

| Version | Path | Status on canonical program |
|---|---|---|
| rng_v1 | Operator-seed resolve | Legacy, retained |
| v1.2 | Single-phase settle | Canonical, default |
| v1.3.2 | Two-phase seal and attest | Canonical, opt-in |
| 2026-09-09 | Compact artifacts on rng_v2 | Canonical |
| v1.4.0 | Sortition-by-Claim | Canonical |
| v1.4.1 | Sortition economics | Canonical |
| fc7 | Conditions | Canonical, attestation only |
| SF1 | Slot spins | Instructions on canonical program; demo game on its own program |
| B8 | Unicorn-G entropy | Research, not in current build |

### Single-phase settle (v1.2), default
`prepare_rng_v2` fixes rules, stake and three future target slots, 8, 16 and 24 slots ahead. A Solana leader produces 4 slots in a row, so the first target is always ≥ 2 leader groups after the slot that included prepare, and the three targets fall in three different leader groups. Groups are not validators: one validator can lead several groups, and a skipped target moves to the next produced slot after the previous resolved one. Devnet 2026-09-13: 8 slots skipped, targets …680/…688/…696 resolved to …688/…689/…696, and one validator produced all three. Measured over 5,000 slots on 2026-09-13: mainnet — one validator on 2 of 3 hashes in 3.1% of draws (2.3% with 75/90/105), never 3 of 3; devnet (12 leaders, 22.5% skips) — 2+ of 3 in ~73%, 3 of 3 in ~10%, regardless of offsets. After the last target slot and before expiry, the same operator calls `settle_rng_v2`: reads SlotHashes, derives randomness, resolves, writes the resolution. The operator cannot predict the result but can choose not to settle; the prepared draw stays visible and expires via `expire_rng_v2` (stake refunded). The public draw endpoints run this path in one request.

### Two-phase seal and attest (v1.3.2)
1. prepare: operator opens the draw with a stake and a bounty.
2. seal: `seal_randomness` is permissionless; after the target slots anyone seals, fixing the outcome and earning the bounty.
3. attest: `attest_winners` (operator or configured attester) records the resolution, takes the fee, refunds the rest of the stake.
4. expire: a never-sealed draw expires and its bounty goes to the treasury; a sealed draw not attested by the deadline (480 slots after expiry) can be closed by anyone with `expire_sealed_rng_v2`.

Use when the operator has an interest in the result and must not be able to back out.

### Compact artifacts on rng_v2
Since 2026-09-09 both rng_v2 lifecycles accept compact formats 1, 2, 3, 5 and 8, not only scale format 7. For compact artifacts the program selects winners; callers pass empty winner arguments (non-empty fails with `RngV2CompactArgsMustBeEmpty`). The resolution stores `winner_claim_hash` as the digest of the winner list; the list is emitted in `OutcomeResolvedV5`. Scale artifacts keep caller-claimed winners proved by snapshot replay and emit `OutcomeResolvedV4`. Both payout-free. SDK 0.8.1 verifies these draws, and the public draw endpoints resolve through this path.

### Sortition-by-Claim (v1.4.0)
Entrants register `sha256(secret ‖ ticket_id ‖ draw_id)` before a deadline. `seal_sortition_draw` fixes `omega` from three future slot hashes, 75, 90 and 105 slots after draw creation; registration must close before the first. Each entrant claims by revealing `secret`; wins iff `sha256(secret ‖ omega) < threshold`.
- Claim ~8,200 CU (budget 10k).
- 5/5 negative cases rejected.
- 200 draws × 100 tickets, 10 expected winners: mean 9.7, variance 8.76 (binomial 10 / 9).

### Sortition economics (v1.4.1)
Optional fee layer, byte-compatible with 1.4.0. `fee_mode` selects `entry_fee_lamports` at registration and `close_skim_bps` at close. `close_split(rent, skim_bps)` guarantees `refund + skim == rent`. Measured: paid register 18,096 CU, init economics 5,234 CU, close 9,643 CU, sweep(2) 18,459 CU; 9/9 negative cases rejected.

### Conditions (fc7)
Scores committed prediction slips (legs with odds) against revealed match facts and ranks entrants. Off-chain `POST /api/conditions/score` is byte-identical to on-chain `resolve_conditions` (~15,700 CU). Event `ConditionsResolvedV1` carries `winners_digest`, `facts_ref_root`, `winning_score_sum`. VRE proves the ranking; payout stays with the partner.

### Slot spins (SF1)
`prepare_slot_spin` binds player, bet and committed game before entropy exists. `settle_slot_spin` derives randomness from future slot hashes, replays reels, applies the max-win cap, pays the bound player from the vault. Public demo game program: `6R5n5uPTj1bg4xz6P3xCmVkyorTySbLQQZuENe8SSaKK`; verify its spins with the SDK and that program ID.

### Unicorn-G entropy (B8), implemented, not deployed
VDF output verified on-chain with an embedded Groth16 verifier. Measured on devnet June 2026: seal with verification 247,476 CU, attest 61,466 CU, wrong proof rejected as `InvalidUnicornGProof`. The instructions sit behind a build feature that the canonical program is not built with. Before mainnet it needs the circuit soundness fix and a trusted-setup ceremony.

<a id="api"></a>
## 07 · HTTP API

Base URL `https://verifiableoutcome.online`. JSON in and out. Draw endpoints sign with the server's operator key. A draw resolves through rng_v2 inside the request: commit, wait for future target slots (~10 s), settle, replay; a draw call takes 12–45 s in total.

The canonical program binds only artifacts approved by the `ProgramConfig` admin, so a draw cannot be resolved there with your own wallet; the API runs it with the operator key. Sortition instructions need no admin and can be sent from any funded wallet (§08).

### Limits and statuses

| Limit | Default |
|---|---|
| General API, per IP | 60 requests / 60 s |
| `POST /api/replay`, per IP | 12 requests / 60 s |
| `POST /api/examples/draw`, per IP | 1 draw / 15 s |
| `POST /api/live-raffle` | 1 draw / 10 s |
| `POST /api/partner/draw`, per key | 1 draw / 10 s |
| `POST /api/examples/sortition/draw`, per IP | 1 draw / 15 s |

Statuses: 200 success; 400 validation; 401 missing or unknown key; 403 key lacks permission; 404 unknown conditions round, or an account that does not exist (`AccountNotInitialized`); 409 a scale-shaped body sent to a draw endpoint, a duplicate snapshot chunk, or a program state conflict (`SortitionRegistrationOpen`, `SortitionRegistrationClosed`, `SortitionClaimWindowClosed`, `SortitionAlreadyClaimed`, `AccountAlreadyInUse` for a reused id); 413 participant table too large for a compact artifact; 422 the program rejected the input (`SortitionPredicateNotMet` for a losing ticket, `InvalidSortitionSecret`, other `InvalidSortition*`); 429 rate limit (counted from the start of the previous draw); 500 server-side failure; 503 partner config absent; 504 devnet timeout, retry.

When the program rejects an instruction the body carries `error_code` (the program error name), `error_number` and a readable `error`: `{ "ok": false, "error": "Sortition predicate not met", "error_code": "SortitionPredicateNotMet", "error_number": 6045 }`.

### Public, no key

| Endpoint | Request | Response |
|---|---|---|
| `POST /api/replay` | signature, programId? | Verdict (§04) |
| `POST /api/timeline` | signature, compiledArtifactHash, programId? | `{ ok, artifact_slot, resolution_slot, gap_slots }` |
| `GET /api/recent-resolutions` | ?limit= | `{ ok, resolutions: [{ signature, outcome_id, outcome_ids, winners_count, artifact_format_version, resolution_formula, target, verification_result, verification_reason, runtime_id, resolve_id, compiled_artifact_hash, participants_count, commit_slot, resolve_slot, source }] }` |
| `GET /api/blessed-signatures` | | `{ ok, data }` |
| `GET /api/health` | | `{ ok, program_id, rpc, operator: { mode, program_id }, world_id: { enabled, environment, … }, blessed_signatures_count }` |
| `GET /api/spec` | | `{ ok, summary, blessed }` |
| `POST /api/conditions/score` | fixtures, entrants | Scores and ranking (below) |
| `POST /api/examples/draw` | Same body as partner draw | Same response as partner draw; runs on the server's demo key |
| `POST /api/examples/sortition/draw` | Same body as partner sortition draw | Creates a sortition draw on the demo key |
| `POST /api/examples/sortition/register` | draw_id, ticket_id, commitment | Registers a ticket commitment |
| `POST /api/examples/sortition/seal` | draw_id | Seals omega from future slot hashes |
| `POST /api/examples/sortition/claim` | draw_id, ticket_id, secret | Reveals and claims a ticket |

### Scoring conditions without a key

```bash
curl -s -X POST https://verifiableoutcome.online/api/conditions/score \
  -H "content-type: application/json" -d '{
  "fixtures": [
    { "fixture_id": 1, "stats": [{"stat_key":1,"value":2},{"stat_key":2,"value":0}] },
    { "fixture_id": 2, "stats": [{"stat_key":1,"value":1},{"stat_key":2,"value":1}] }
  ],
  "entrants": [
    { "wallet": "<wallet>", "tier": 50, "entered_at": 100, "fixture_index": [0,1],
      "legs": [
        {"stat_key_a":1,"stat_key_b":2,"op":2,"comparison":0,"odds_milli":2150},
        {"stat_key_a":1,"stat_key_b":2,"op":1,"comparison":1,"line_x2":5,"odds_milli":1850}
      ]}
  ]
}'
```

Response: `{ ok, formula: "conditions", formula_code: 7, format_version: 9, winners_count, winning_score_sum, ranking: [{ rank, wallet, all_hit, score_fixed, slip_hash }], artifact: { hash, bytes, hex } }`.

Leg encoding: `op` 1 = add (totals), 2 = subtract (1x2); `comparison` 0 = greater, 1 = less, 2 = equal; `line_x2` = line × 2 (totals only). Full-match goals: `stat_key` 1 = side one, 2 = side two.

### Live raffle with a wallet

| Endpoint | Request | Response |
|---|---|---|
| `POST /api/live-raffle` | address, requireWorldId?, worldId? | `{ ok, signature, outcome, outcome_ids, runtimeId, resolveId, artifactHash, programId, participantCount, world_id?, rng_version, entropy_source, prepare_signature, target_slots, resolved_slots, winner_claim_hash }` |
| `POST /api/world-id/rp-context` | | `{ ok, enabled, …, rp_context }` |

With `requireWorldId`, the caller sends a World ID 4.0 proof; the server verifies it and reserves its nullifier (one human, one entry). The public host runs World ID in staging (simulator). Wallet pages read only the address via Wallet Standard and never request signatures.

### Partner API

Header `x-api-key: vresk_…`. Keys are issued on request (https://t.me/maskradiation) and stored server-side. Draws also require `draw_enabled` on the key.

| Endpoint | Request | Response |
|---|---|---|
| `POST /api/partner/draw` | formula, participants, winners_count?, target?, label?, use_case? | `{ ok, signature, outcome_id, outcome_ids, replay_url, artifact_slot, resolution_slot, rng_version, entropy_source, prepare_signature, target_slots, resolved_slots, winner_claim_hash }` |
| `GET /api/partner/draw/:signature/proof` | ?address= | Scale draw membership proof: included, winner, participant, merkle_root, leaf_hash, proof, snapshot_uri, publication_url |
| `POST /api/partner/snapshot/init` | label?, use_case? | Snapshot session id, valid 24 h |
| `POST /api/partner/snapshot/chunk` | session_id, chunk_index, participants | ≤ 5,000 participants per chunk, ≤ 2 MB body |
| `POST /api/partner/snapshot/finalize` | session_id, formula, winners_count, target?, wait? | 202 with `status_url`; the draw runs in the background. `wait: true` answers 200 with the result instead |
| `GET /api/partner/snapshot/status` | ?session_id= | `{ status: open \| finalizing \| finalized \| failed, stage, result?, error?, retryable? }`; `result` has the signature, winners, `snapshot_uri`, `snapshot_mirror_url`, `merkle_root` and the rng_v2 fields |
| `POST /api/partner/sortition/draw` | draw_id?, threshold, registration_duration_slots, claim_duration_slots, unclaimed_rule | Creates a sortition draw |
| `POST /api/partner/sortition/register` | draw_id, ticket_id, commitment | Registers a ticket commitment |
| `POST /api/partner/sortition/seal` | draw_id | Seals omega from future slot hashes |
| `POST /api/partner/sortition/claim` | draw_id, ticket_id, secret | Reveals and claims a ticket |
| `POST /api/partner/conditions/commit` | round_id, fixtures, entrants | `{ commitment_ref, commit_signature, committed_at_slot }` |
| `POST /api/partner/conditions/resolve` | round_id, fixtures (with stats, event_stat_root) | `{ signature, verify_url, winners, ranking, winning_score_sum, artifact }` |
| `GET /api/resolutions` | ?limit= | Recent resolutions on the canonical program |
| `GET /api/participant` | ?address= | Draws where the address participated and whether it won |

### Partner draw fields
- `formula`: `weighted_random` | `rank_desc` | `rank_asc` | `first_n` | `closest_to`.
- `participants`: ≥ 2 objects, unique `id` up to 64 printable ASCII bytes, plus `weight` or `score` as the formula needs. Compact artifact holds ~100 entries; use the snapshot flow for more.
- `winners_count`: 1–10, ≤ participants.
- `target`: required for `closest_to`; signed safe integer.
- `use_case`: `raffle` | `airdrop` | `competition`; informational.
- `mode: "scale"`, `scale: true`, `public_proof: true` or `standard_version: "1.2"` on this endpoint returns 409 with `route: "scale_snapshot"` and the snapshot endpoints.
- `artifact_slot` is the slot where these exact rules were first committed; identical rules reuse one artifact, so it can predate the draw.

```bash
curl -s -X POST https://verifiableoutcome.online/api/partner/draw \
  -H "content-type: application/json" -H "x-api-key: vresk_YOUR_KEY" \
  -d '{"formula":"rank_desc","winners_count":2,"participants":[{"id":"alice","score":10},{"id":"bob","score":30},{"id":"carol","score":20}]}'
# → { "ok": true, "signature": "…", "outcome_id": "bob", "outcome_ids": ["bob","carol"], "replay_url": "https://verifiableoutcome.online/verify?sig=…", "artifact_slot": …, "resolution_slot": …, "rng_version": 2, "entropy_source": "slot_hash", "target_slots": […], "resolved_slots": […] }
```

<a id="sdk"></a>
## 08 · SDK

`verifiable-outcome-sdk` 0.8.2: TypeScript, ES module, Node 18+.

```bash
npm install verifiable-outcome-sdk

# or verify from a terminal without installing
npx -p verifiable-outcome-sdk vre verify --sig <signature> [--rpc <url>] [--program-id <id>] [--json]
# exit code 0 on MATCH, 1 otherwise
```

```js
import { verifyOutcome, buildArtifact } from "verifiable-outcome-sdk";

const result = await verifyOutcome({
  signature: "<transaction signature>",
  rpcUrl: "https://api.devnet.solana.com",
  programId: "6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B",
});
// { status: "MATCH", reason: "OK", outcome_id, outcome_ids, … }

const bytes = buildArtifact({
  type: "formula_draw_v5",
  formula: "rank_desc",
  input_lamports: 10,
  payout_lamports: 0,
  winners_count: 2,
  participants: [{ id: "alice", score: 10 }, { id: "bob", score: 30 }],
});
// Buffer with the fmt 5 artifact; SHA-256 of it is the compiled_artifact_hash
```

| Area | Exports |
|---|---|
| Verification | verifyOutcome |
| Artifacts | buildArtifact, buildArtifactV4, buildArtifactV5, buildArtifactV12, buildArtifactV121, parseArtifactV5, parseArtifactV12, parseArtifactV121 |
| Snapshots and Merkle | buildSnapshotHash, buildSnapshotManifest, buildWinnerClaimHash, buildMerkleLevels, buildMerkleProof, buildSnapshotMerkleProofFromFile, hashSnapshotLeafLine; after 0.8.2: canonicalSnapshotLine, verifySnapshotMerkleProof, computeSnapshotMerkleRootFromProof, fetchSnapshotCommitment, fetchCommittedSnapshot, snapshotSourceCandidates, SnapshotUnavailableError |
| Composite | buildCompositeRankDescArtifact, parseCompositeRankDescArtifact, replayCompositeRankDescArtifact |
| Sortition | createSortitionClient, sortitionCreateDrawInline, sortitionRegisterTicketInline, sortitionSealDrawInline, sortitionClaimTicketInline, sortitionCommitment, sortitionWins, sortitionThresholdFromProbability, build*SortitionInstruction helpers |
| Conditions and slot | Scoring, artifact encoders and replay helpers for fc7 and SF1 |

Not in the published package: the operator resolve client and the rng_v2 prepare-and-settle client (draws run through the HTTP API). `verifyOutcome` and `vre verify` do not replay sortition transactions; the claim instruction enforces the sortition predicate on-chain.

### Snapshot sources

`snapshot_uri` is opaque to the program. It is part of the hashed artifact, so a draw commits to where the list was published, and the file itself is checked against `snapshot_hash`. The verifier tries, in order:

1. a local copy (`--snapshot-file`);
2. the committed URI: `https://` as is, `irys-devnet://<id>` through devnet.irys.xyz and gateway.irys.xyz, `irys://` through gateway.irys.xyz, `ar://` through arweave.net and turbo-gateway.com;
3. mirrors by hash, `<mirror>/sha256/<snapshot_hash>.jsonl`: https://verifiableoutcome.online by default, override with `--snapshot-mirror` or `VRE_SNAPSHOT_MIRRORS`.

A source whose bytes do not hash to `snapshot_hash` is skipped. If no source serves the file, the result is `ERR_SNAPSHOT_UNAVAILABLE`. Moving to other storage needs no program upgrade: new draws commit a different URI, and older draws keep verifying through mirrors. Irys devnet drops uploads after about 60 days; the VRE mirror keeps every snapshot it published.

File format: one JSON object per line, `{"id","order","weight"}` for `weighted_random`, `{"id","order"}` for `first_n`, `{"id","order","score"}` otherwise, each ending in a newline, sorted by id bytes. Leaf = SHA-256(SHA-256(line)); node = SHA-256(left ‖ right), the last node is duplicated on odd levels; a proof is a list of `{ position, sibling }` from the leaf upward, where `position` is the side the sibling sits on. `verifySnapshotMerkleProof` checks a line and proof against the on-chain `merkle_root`.

Measured on devnet on 2026-09-15: 10,001 participants, finalized in 23 s, replayed to MATCH from the committed URI alone. On a local validator, 100,001 participants (8 MB) took 24 s.

<a id="use-cases"></a>
## 09 · Use Cases

| Use case | Mechanism | Committed before the result |
|---|---|---|
| Raffle or NFT drop | weighted_random | Every ticket holder, weight = tickets |
| Trading competition | rank_desc | Final scores; top N follow deterministically |
| Lowest-bid contest | rank_asc | Bids; no late entries or edits |
| Guess the value | closest_to | Guesses and the target |
| First-come airdrop | first_n | Registration order |
| Pack break or loot table | weighted_random | Every slot and weight, before the stream |
| Mass airdrop or allowlist | Sortition | Ticket commitments; winners self-claim |
| Large leaderboard | Scale snapshot | Snapshot hash and Merkle root; wallets prove inclusion |
| Prediction slips | Conditions | Every slip with legs and odds; facts revealed later |
| Slot game | SF1 | Game math, before each bet's entropy exists |
