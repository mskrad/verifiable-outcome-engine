# Integration Guide — Verifiable Outcome Engine

How to verify VRE results and how to run draws, sortition and conditions rounds on the
canonical devnet program `6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B`.

Reference with every field and error code: [verifiableoutcome.online/spec](https://verifiableoutcome.online/spec).
Questions, feedback and API keys: Telegram [t.me/maskradiator](https://t.me/maskradiator).

| You want to | You need | Part |
|---|---|---|
| Check that a result is genuine | nothing | 1 |
| Run a draw (raffle, airdrop, leaderboard) | a partner key, or the demo endpoint | 2 |
| Run a commit-and-claim ticket draw | a partner key, or your own devnet wallet | 3 |
| Score prediction slips against match facts | nothing to score; a partner key to anchor on-chain | 4 |

**Who executes what.** The program only binds rules approved by its admin key, so draws on the
canonical program are executed by the VRE operator through the API. Your own wallet cannot
resolve a draw there. Sortition needs no admin approval and can run from any funded wallet.

---

## Part 1 — Verify

Every result is a Solana transaction. Replaying it recomputes the outcome from the committed rules
and the on-chain randomness and compares it with what the program recorded.

Browser: `https://verifiableoutcome.online/verify?sig=<SIGNATURE>`

Terminal (Node 18+):

```bash
npx -p verifiable-outcome-sdk vre verify --sig <SIGNATURE>
# verification_result : MATCH
# verification_reason : OK
```

Options: `--rpc <URL>` (default `https://api.devnet.solana.com`), `--program-id <ID>`, `--json`.
Exit code 0 on `MATCH`, 1 otherwise.

Code:

```js
import { verifyOutcome } from "verifiable-outcome-sdk";

const result = await verifyOutcome({
  signature: "<SIGNATURE>",
  rpcUrl: "https://api.devnet.solana.com",
  programId: "6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B",
});
if (result.status !== "MATCH") throw new Error(result.reason);
```

HTTP: `POST https://verifiableoutcome.online/api/replay` with `{"signature": "<SIGNATURE>"}`
(12 requests per 60 s per IP).

`MISMATCH` comes with a reason code; the list is in [VERIFICATION_ERRORS.md](./VERIFICATION_ERRORS.md).
`vre verify` replays draws and conditions rounds; it does not replay sortition transactions yet
(Part 3 explains what enforces those).

---

## Part 2 — Draws

### Get a key

Ask in Telegram: [t.me/maskradiator](https://t.me/maskradiator). Send the key in the `x-api-key`
header. To try without a key, `POST /api/examples/draw` takes the same body and returns the same
response, limited to one draw per 15 s per IP.

### Request

```bash
curl -s -X POST https://verifiableoutcome.online/api/partner/draw \
  -H "content-type: application/json" -H "x-api-key: vresk_YOUR_KEY" \
  -d '{
    "formula": "weighted_random",
    "winners_count": 2,
    "participants": [
      { "id": "wallet-1", "weight": 1 },
      { "id": "wallet-2", "weight": 3 },
      { "id": "wallet-3", "weight": 2 }
    ]
  }'
```

| Field | Rules |
|---|---|
| `formula` | `weighted_random`, `rank_desc`, `rank_asc`, `first_n`, `closest_to` |
| `participants` | at least 2; unique `id`, up to 64 printable ASCII bytes |
| `weight` | `weighted_random` only, optional (default equal chance) |
| `score` | required for `rank_desc`, `rank_asc`, `closest_to`; not allowed for `weighted_random`, `first_n` |
| `winners_count` | 1–10, not more than participants |
| `target` | required for `closest_to`, a signed safe integer |
| `label`, `use_case` | optional; `use_case` is `raffle`, `airdrop` or `competition` |

`first_n` keeps the order you send. One draw holds about 100 participants (8 KB of rules).

### What happens

One request, 12–45 seconds:

1. The rules and participants are committed on-chain.
2. `prepare_rng_v2` fixes three target slots: 8, 16 and 24 slots after it lands.
3. The server waits until those slots exist.
4. `settle_rng_v2` takes their slot hashes and selects the winners on-chain.
5. The server replays the transaction and returns the result.

The winners depend on slot hashes that did not exist when the rules were committed. If a target
slot is skipped, the next produced slot is used; `resolved_slots` shows which ones.

### Response

```json
{
  "ok": true,
  "signature": "…",
  "outcome_id": "wallet-2",
  "outcome_ids": ["wallet-2", "wallet-3"],
  "replay_url": "https://verifiableoutcome.online/verify?sig=…",
  "artifact_slot": 497810330,
  "resolution_slot": 498394097,
  "rng_version": 2,
  "entropy_source": "slot_hash",
  "prepare_signature": "…",
  "target_slots": ["498394081", "498394089", "498394097"],
  "resolved_slots": ["498394081", "498394089", "498394097"],
  "winner_claim_hash": "…"
}
```

`artifact_slot` is the slot where these exact rules were first committed; identical rules reuse
the same on-chain artifact, so it can be much older than the draw.

### Errors

| HTTP | Meaning |
|---|---|
| 400 | invalid body; `error` says which field |
| 401 | missing or unknown key |
| 403 | the key has no draw permission |
| 409 | the body asks for a scale snapshot draw (`mode: "scale"` and similar), which this endpoint does not run |
| 413 | the participant table does not fit a compact artifact |
| 429 | another draw on this key started less than 10 s ago (`retry_after_ms`) |
| 504 | devnet did not finish within 55 s; retry |

### More than 100 participants

The snapshot endpoints take up to 5,000 participants per chunk and commit the whole list as a
hash and a Merkle root:

```bash
curl -s -X POST https://verifiableoutcome.online/api/partner/snapshot/init \
  -H "content-type: application/json" -H "x-api-key: vresk_YOUR_KEY" -d '{"label":"season 3"}'
# → { "session_id": "…" }

curl -s -X POST https://verifiableoutcome.online/api/partner/snapshot/chunk \
  -H "content-type: application/json" -H "x-api-key: vresk_YOUR_KEY" \
  -d '{"session_id":"…","chunk_index":0,"participants":[{"id":"wallet-1","weight":3},{"id":"wallet-2","weight":1}]}'

curl -s -X POST https://verifiableoutcome.online/api/partner/snapshot/finalize \
  -H "content-type: application/json" -H "x-api-key: vresk_YOUR_KEY" \
  -d '{"session_id":"…","formula":"weighted_random","winners_count":3}'
# → 202 { "status": "finalizing", "status_url": "/api/partner/snapshot/status?session_id=…" }
```

Poll `status_url` until `status` is `finalized` (about 25 s for 10,000 participants); `result`
holds the signature, winners, `snapshot_uri` and `merkle_root`. The list is published before the
draw is committed, so anyone can replay the signature. Each participant checks their entry with
`GET /api/partner/draw/<signature>/proof?address=<id>` and `verifySnapshotMerkleProof` against the
`merkle_root` on-chain.

On devnet the list goes to Irys devnet, which drops uploads after about 60 days; VRE keeps a copy
at `https://verifiableoutcome.online/sha256/<snapshot_hash>.jsonl`, and the verifier falls back to
it by hash.

---

## Part 3 — Sortition-by-Claim

A ticket draw where each entrant commits a secret before the draw and later proves a win.

1. **Create** a draw with a 16-byte `draw_id`, a 32-byte `threshold` and a registration window.
2. **Register** tickets: `commitment = sha256(secret ‖ ticket_id ‖ draw_id)` (32-byte secret, 16-byte ticket id).
3. **Seal**: after registration closes and 105 slots have passed since creation, the draw takes
   `omega` from three slot hashes (75, 90 and 105 slots after creation).
4. **Claim**: reveal the secret; the ticket wins when `sha256(secret ‖ omega) < threshold`
   (big-endian). The program checks this in the claim instruction — a losing claim fails with
   `SortitionPredicateNotMet`.

`threshold = 80` followed by 31 zero bytes gives each ticket a 50 % chance.
`sortitionThresholdFromProbability(numerator, denominator)` in the SDK computes other odds.

### Through the API

| Endpoint | Body | Returns |
|---|---|---|
| `POST /api/partner/sortition/draw` | `draw_id`, `threshold`, `registration_duration_slots` (default 60, must be below 75), `claim_duration_slots` (default 120), `unclaimed_rule` (0–255) | `draw_id`, `draw_pda`, `signature` |
| `POST /api/partner/sortition/register` | `draw_id`, `ticket_id`, `commitment` | `ticket_id`, `ticket_pda`, `signature` |
| `POST /api/partner/sortition/seal` | `draw_id` | `signature` |
| `POST /api/partner/sortition/claim` | `draw_id`, `ticket_id`, `secret` | `signature` |

All values are hex. The VRE operator signs these transactions; you keep the secrets.
Timing at ~400 ms per slot: registration closes ~24 s after creation with the default window, seal is
possible after ~42 s, the claim window ends `claim_duration_slots` after the last target slot.

A rejected instruction comes back with the program error name in `error_code`:

| HTTP | `error_code` | Meaning |
|---|---|---|
| 409 | `SortitionRegistrationOpen` | seal before registration closed and the committed slots exist |
| 409 | `SortitionRegistrationClosed` | register after the window |
| 409 | `SortitionClaimWindowClosed` | claim after the claim window |
| 409 | `SortitionAlreadyClaimed` | the ticket was claimed before |
| 409 | `AccountAlreadyInUse` | a draw or ticket with this id already exists |
| 422 | `SortitionPredicateNotMet` | the ticket did not win — a normal outcome, not a failed call |
| 422 | `InvalidSortitionSecret` | the secret does not match the commitment |
| 404 | `AccountNotInitialized` | the draw or ticket does not exist |

The keyless demo of this flow is at [/examples](https://verifiableoutcome.online/examples)
(`/api/examples/sortition/*`, one draw per 15 s per IP).

### From your own wallet

Sortition does not need the program admin, so a funded devnet wallet can run it with the SDK:

```js
import crypto from "node:crypto";
import {
  createSortitionClient, sortitionCommitment,
  sortitionCreateDrawInline, sortitionRegisterTicketInline,
  sortitionSealDrawInline, sortitionClaimTicketInline,
} from "verifiable-outcome-sdk";

const client = createSortitionClient({
  rpcUrl: "https://api.devnet.solana.com",
  walletPath: "~/.config/solana/id.json",
});
const drawId = crypto.randomBytes(16);
const ticketId = crypto.randomBytes(16);
const secret = crypto.randomBytes(32);

await sortitionCreateDrawInline(client, {
  drawId,
  threshold: Buffer.from("80" + "00".repeat(31), "hex"),
  registrationDurationSlots: 70,
  claimDurationSlots: 1200,
});
await sortitionRegisterTicketInline(client, {
  drawId, ticketId, commitment: sortitionCommitment(secret, ticketId, drawId),
});
await new Promise((r) => setTimeout(r, 105 * 400 + 8_000)); // wait for the committed slots
await sortitionSealDrawInline(client, { drawId });
await sortitionClaimTicketInline(client, { drawId, ticketId, secret }); // throws if the ticket did not win
```

---

## Part 4 — Conditions

Scores committed prediction slips (odds × revealed match facts) into a per-entrant score and a
ranking. The off-chain scorer and the on-chain `resolve_conditions` produce identical bytes. VRE
proves the ranking; escrow and payout stay with you.

### Score without a key

`POST /api/conditions/score`:

```json
{
  "fixtures": [
    { "fixture_id": 1, "stats": [{ "stat_key": 1, "value": 2 }, { "stat_key": 2, "value": 0 }] },
    { "fixture_id": 2, "stats": [{ "stat_key": 1, "value": 1 }, { "stat_key": 2, "value": 1 }] }
  ],
  "entrants": [
    { "wallet": "<base58 wallet>", "tier": 50, "entered_at": 100, "fixture_index": [0, 1],
      "legs": [
        { "stat_key_a": 1, "stat_key_b": 2, "op": 2, "comparison": 0, "odds_milli": 2150 },
        { "stat_key_a": 1, "stat_key_b": 2, "op": 1, "comparison": 1, "line_x2": 5, "odds_milli": 1850 }
      ] }
  ]
}
```

Returns `winners_count`, `winning_score_sum`, `ranking[{rank, wallet, all_hit, score_fixed, slip_hash}]`
and the exact artifact bytes.

Leg codes: `term_kind` 0 = single, 1 = binary · `op` 0 = none, 1 = add (totals), 2 = subtract (1X2) ·
`comparison` 0 = greater, 1 = less, 2 = equal · `odds_milli` = odds × 1000 · `line_x2` = line × 2
(totals) · `stat_key` = period × 1000 + base (base 1 = side one goals, 2 = side two goals).
Score = product of the odds of hit legs; any miss gives 0; a void leg counts as a push.

### Anchor on-chain (partner key)

1. At slate open: `POST /api/partner/conditions/commit` with `round_id`, `fixtures: [{ fixture_id, event_stat_root? }]`
   and `entrants` → `commitment_ref`, `commit_signature`, `committed_at_slot`.
2. After the matches: `POST /api/partner/conditions/resolve` with `round_id` and
   `fixtures: [{ fixture_id, event_stat_root, stats }]` → `signature`, `verify_url`, `winners`,
   `ranking`, `winning_score_sum`, `artifact`.

`event_stat_root` is a 32-byte hex reference to your facts source. VRE binds it into the resolution
but does not check the facts behind it. The resolve `signature` replays to `MATCH`.
Supported markets: 1X2, totals, both teams to score.

---

## Troubleshooting

**401 `Invalid or missing API key`** — check the `x-api-key` header; keys are issued in Telegram.

**429 on a draw** — one draw per 10 s per key (15 s per IP on the demo endpoint), counted from the
start of the previous request. Send draws one after another.

**504 `Devnet is slow right now`** — devnet did not finish in time. The draw may still complete;
retry with a new request.

**`MISMATCH` with `ERR_TX_NOT_FOUND_OR_NO_LOGS`** — a fresh transaction can take a few seconds to
appear on public RPC; retry.

**`could not determine executable to run`** — the command is `vre`: use
`npx -p verifiable-outcome-sdk vre verify …` or install the package and run `vre`.

**409 `SortitionRegistrationClosed` / `SortitionRegistrationOpen`** — the call came outside the
registration window; see the timing in Part 3.

**422 `SortitionPredicateNotMet`** — the ticket lost. Nothing to retry.
