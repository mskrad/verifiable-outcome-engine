# Runbook (Public Reviewer Flow)

> Protocol version history and per-path mechanics (v1.3.2 → v1.4.0 → v1.4.1 → Unicorn-G,
> canonical-promotion 2026-06-25) are in [`CHANGELOG.md`](CHANGELOG.md) and `README.md`
> "Protocol Versions & Changelog".

## 1) Install + launch

```bash
cd verifiable-outcome-engine
yarn install
yarn web
```

Optional: copy `.env.example` to `.env` to override defaults. Not required — server starts without it.

## 2) Open pages

- Reviewer flow: `http://127.0.0.1:8787/play`
- Verify: `http://127.0.0.1:8787/verify`
- Widget: `http://127.0.0.1:8787/widget`
- Spec / Evidence: `http://127.0.0.1:8787/spec`

## 3) Web reviewer flow

1. Open `play.html`.
2. Choose one active blessed signature.
3. Open `verify.html` from the provided link.
4. Run replay.
5. Expect:
   - `verification_result : MATCH`
   - `verification_reason : OK`

## 4) CLI equivalent

```bash
cd verifiable-outcome-engine
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
yarn -s replay \
  --sig 47S5Q3xXY1f5i5DWrppGqgNYb29uTCaeJceMcwCAdCBasgPrqe6mosyLvFSfch3EXZm3CWAiRhyEEx8XGx8FHdcF \
  --url https://api.devnet.solana.com \
  --program-id 6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B
```

## 5) Embedded widget equivalent

For a known transaction signature:

```html
<script src="https://verifiableoutcome.online/widget.js"></script>
<vre-verify
  sig="YOUR_TX_SIGNATURE"
  rpc="https://api.devnet.solana.com"
  program-id="YOUR_PROGRAM_ID">
</vre-verify>
```

For a paste-your-own-signature form:

```html
<script src="https://verifiableoutcome.online/widget.js"></script>
<vre-verify-form></vre-verify-form>
```

## 6) Acceptance boundary

This runbook is packaging-only and reviewer-oriented.

It does not require:

- `examples/*`
- `core/contracts/*`
- localnet historical sample signatures
- adapters code

## 6b) Unicorn-G entropy source — canonical, opt-in

Status: canonical opt-in entropy path (`PROTOCOL-INFRA-014-B8-UNICORN-G-CLOSURE`).

What this is: an alternative on-chain entropy source for `outcome` draws. With `entropy_source = UNICORN_G`, the program derives the RNG v2 input `u` on-chain from frozen `RngV2State` + `SlotHashes`, verifies a VDF output `y` through an embedded Groth16 proof, and seals randomness from `y`. The `SLOT_HASH` path remains the **default**; Unicorn-G is selected explicitly per draw.

Maturity notes:

- **Opt-in, not default** — the default entropy source stays SlotHashes.
- Relies on a Groth16 **trusted setup** (devnet RSA modulus). A multi-party ceremony is the path to a stronger setup before any mainnet use.
- Mainnet is a separate, later effort; this describes the canonical **devnet** protocol.

Validation program (devnet): `6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B` — the same code now carried by the canonical program `6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B`.

End-to-end devnet cycle completed: `prepare -> SlotHashes-derived u replay -> proof -> seal -> attest`.

Evidence:

- Seal: `4aKtC13JeN73bg9j2kycqSwAhocPipdhWgDYdYQvgygheAS1qvmK5uvsBAGEsxvUdRWuyJTh6fo7spFTDYbDSGQC` — CU `247476` — randomness `939e8494fb7696f6a18bcab57a8e87e2c7935e91987e60ea209a60f8555a73c9`
- Attest: `45RCc4Xd9Sdyr3q1VmurJ2D2QvTUcj8zR63u42iPyw8mBqXnv4umKXqNJ2fRz2NNYfd3cu8o2wBUhyZETqHUNaeD` — CU `61466` — outcome resolution `4eg6mKzS2LSLDsDUZnwPu35nE7dmUrCYzqqNuUkrrzyr` — winner `p_0`
- Wrong-proof rejection: `InvalidUnicornGProof (6035)` — simulation CU `143069`
- Reinforcing negatives: replay of a valid proof against an already-SEALED state → `InvalidRngV2Status (6022)`; independent fresh-draw tampered-`y` on a real proof → `InvalidUnicornGProof (6035)` (pairing check)
- Localnet full E2E (incl. tampered-`y` rejection): seal CU `209226`, prover `37.4s` / `4.3 GB` peak RSS

Evidence artifacts:

- `artifacts/protocol_infra_014_b8_devnet_evidence_summary.json` (index)
- `artifacts/protocol_infra_014_b8_unicorn_g_replay.json`
- `artifacts/protocol_infra_014_b8_attest_devnet.json`
- `artifacts/protocol_infra_014_b8_wrong_proof_replay.json`
- `artifacts/protocol_infra_014_b8_wrong_proof_rejection.json`
- `artifacts/protocol_infra_014_b8_localnet_e2e.json`

Read-only verification (no mutation):

```bash
solana program show 6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B --url https://api.devnet.solana.com
```

Local gates recorded with this evidence: `cargo test -p outcome` (`31/31`), `anchor build`, `npx tsc --noEmit`, `git diff --check`.

## 6c) Sortition-by-Claim + economics — canonical

Status: canonical — Sortition-by-Claim `v1.4.0` (`PROTOCOL-INFRA-011`) and the sortition economics fee layer `v1.4.1` (`PROTOCOL-INFRA-013`).

What this is: a commit-reveal ticket draw. Entrants register a `commitment = sha256(secret || ticket_id || draw_id)` before a deadline; the draw seals against three future `SlotHashes`-derived slots to fix `omega`; each entrant self-claims by revealing `secret`, and wins iff `sha256(secret || omega) < threshold`. `v1.4.1` adds an optional fee layer (`fee_mode` bitflags: flat `entry_fee_lamports` at register, `close_skim_bps` skim on close) carved from reserved bytes — byte-compatible with `1.4.0` draws (fee fields `0` = disabled).

Notes:

- Replay-by-signature stays the **default** resolution path; sortition is a canonical alternative.
- Mainnet is a separate, later effort; this describes the canonical **devnet** protocol.

Validation program (devnet): `6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B` — the same code now carried by the canonical program `6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B`.

Evidence (sortition `v1.4.0`, `PROTOCOL-INFRA-011`):

- Lifecycle passed (create → register → seal → claim); `5/5` negative cases passed; claim CU below `10k`.
- Statistical distribution over `200` draws / `100` tickets / threshold `0x1999…`: observed mean `9.7` winners vs binomial mean `10` (variance `8.76` vs `9.0`).
- Self-bias / grinding probe recorded under `self_bias` (grind gain tracks the order-statistic heuristic, no anomalous advantage at `grind_k=0`).

Evidence (economics `v1.4.1`, `PROTOCOL-INFRA-013`):

- Positive path passed; `9/9` negative cases passed; dedicated treasury.
- CU: `register_paid 18096`, `init_economics 5234`, `close 9643`, `sweep_2 18459`.

Evidence artifacts:

- `artifacts/protocol_infra_011_sortition_localnet.json`
- `artifacts/protocol_infra_011_sortition_devnet.json`
- `artifacts/protocol_infra_011_deep_tests.json`
- `artifacts/protocol_infra_011_residual_tests.json`
- `artifacts/protocol_infra_011_completion_tests.json`
- `artifacts/protocol_infra_013_economics_localnet.json`
- `artifacts/protocol_infra_013_economics_devnet.json`

SDK / API exposure: sortition builders live in `sdk/sortition.ts` (re-exported from the package), and the partner API exposes `/api/partner/sortition/*` routes. Both default to the canonical program id and tag every response `maturity: "canonical-devnet"`. Replay-by-signature remains the default resolution path.

## 7) Program upgrade authority

On devnet the program upgrade authority is a single operator key. Multisig governance
is not used on devnet — it added ceremony without protecting real value while the protocol
iterates. ProgramConfig admin is intentionally separate from upgrade authority and is
controlled by the configured operator path.

> **Mainnet governance is decided separately** (multisig / immutable / timelock). The devnet
> single-key simplification is **not** carried to mainnet — there, who can upgrade the program
> is part of the trust story and must be hardened before launch.

Verify the current authority:

```bash
solana program show 6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B \
  --url https://api.devnet.solana.com
```

### How to upgrade the program (devnet, single key)

```bash
# 1) Build
anchor build                                    # -> target/deploy/outcome.so

# 2) Upgrade in place (authority = operator key)
solana program deploy target/deploy/outcome.so \
  --program-id 6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B \
  --upgrade-authority ~/.config/solana/id.json \
  --url https://api.devnet.solana.com

# 3) Verify (Last Deployed In Slot should advance)
solana program show 6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B \
  --url https://api.devnet.solana.com
```

### Key addresses

| Name | Address |
|---|---|
| Program | `6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B` |
| ProgramConfig admin | `CJN7pVC8LCsia4QPy1yWiTX3iQMtVbnwjoUmyNK4ce2Y` (operator key, separate from the upgrade authority) |

## 9) Vanish private payout (optional)

After a VRE draw, the operator can route the winner payout through [Vanish](https://core.vanish.trade) to break the on-chain link between the operator treasury and the winner wallet. The VRE selection remains fully public and verifiable; only the payment path is private.

**Required env var:**

```bash
VANISH_API_KEY=<your-vanish-api-key>
```

Obtain your API key from the [Vanish dashboard](https://core.vanish.trade) or by emailing Vanish.

**Optional:**

```bash
VANISH_PAYOUT_LAMPORTS=100000   # lamports to route per payout; default 100000 (0.0001 SOL)
```

When `VANISH_API_KEY` is set, each successful `/api/live-raffle` response will include:

```json
{
  "vanish_deposit_tx": "<operator→Vanish pool tx>",
  "vanish_tx": "<Vanish→winner tx>"
}
```

If Vanish is unavailable or the payout fails, the raffle result is still returned — Vanish is non-fatal.

**Standalone payout script:**

```bash
# Real payout (requires VANISH_API_KEY or --api-key):
VANISH_API_KEY=<key> \
ANCHOR_WALLET=~/.config/solana/esjx.json \
ts-node scripts/vanish_payout.ts \
  --winner <winner_address> \
  --amount 100000 \
  --sig <vre_resolve_sig>

# Mock mode (no API key, no funds moved — writes evidence with "mock": true):
VANISH_MOCK=true \
ts-node scripts/vanish_payout.ts \
  --winner <winner_address> \
  --amount 100000 \
  --sig <vre_resolve_sig>
```

Evidence is written to `artifacts/vanish_integration_evidence.json` with:
- `vre_resolve_sig` — VRE resolve transaction (public, verifiable)
- `vanish_deposit_tx` — operator → Vanish pool transfer
- `vanish_withdraw_tx` — Vanish → winner transfer
- `mock: true` if run in mock mode

## 9b) Outcome Standards status

Both artifact standards are canonical on `6QtLot…`:

- `Outcome Standard V1.1`
  - compact named-entry base
  - internal `artifact_format_version=5` is metadata only
  - boundary: pass at `103` entries / `8185` bytes; first overflow at `104` entries / `8264` bytes
- `Outcome Standard V1.2`
  - large/public scale extension (Merkle snapshot)
  - product-facing replay uses `standard_version:"1.2"`
  - internal scale marker `6` is metadata only
  - Stage 1 expanded matrix passed `45/45`

Mainnet is a separate, later effort; the above describes the canonical devnet protocol.

## 10) Partner Draw API

`POST /api/partner/draw` lets B2B partners submit a formula-driven participant list and receive a verifiable on-chain transaction signature. The draw runs against the canonical devnet program using the operator wallet (same as `/api/live-raffle`).

Boundary note:

- this section describes the current reviewer-facing canonical partner path
- it is not the same thing as the `Outcome Standard V1.1 / V1.2` artifact standards
- clean-line canonical promotion is not yet accepted

**Requirements:**

- Header: `x-api-key: vresk_...` (existing partner key)
- `"draw_enabled": true` in the partner's entry in `config/partners.json`

To enable draws for a partner, edit `config/partners.json`:

```json
{
  "key": "vresk_...",
  "name": "Partner Name",
  "tier": 1,
  "created": "2026-04-28",
  "draw_enabled": true
}
```

**Example request:**

```bash
curl -s -X POST https://verifiableoutcome.online/api/partner/draw \
  -H "Content-Type: application/json" \
  -H "x-api-key: vresk_YOUR_KEY" \
  -d '{
    "formula":"rank_desc",
    "participants":[
      {"id":"trader-alice","score":1200},
      {"id":"trader-bob","score":900},
      {"id":"trader-carol","score":1500}
    ],
    "winners_count":2,
    "label":"AlphaDex Top 2"
  }'
```

**Formula examples:**

```json
{
  "formula": "weighted_random",
  "participants": [
    { "id": "user-001", "weight": 5 },
    { "id": "user-002", "weight": 1 }
  ]
}
```

```json
{
  "formula": "closest_to",
  "target": 22450,
  "participants": [
    { "id": "alice", "score": 22449 },
    { "id": "bob", "score": 22460 },
    { "id": "carol", "score": 22451 }
  ]
}
```

**Response codes:**

| Code | Meaning |
|------|---------|
| `200` | Draw completed; `signature`, `outcome_id`, `outcome_ids`, `replay_url`, `artifact_slot`, `resolution_slot` returned |
| `400` | Validation error (bad formula, bad participant ids, duplicates, invalid `score` / `weight` / `target`, bad `winners_count`, bad `use_case`) |
| `401` | Missing or unknown API key |
| `403` | Partner key valid but `draw_enabled` is not `true` |
| `429` | Rate limit exceeded; one draw per partner key per 10 s |
| `504` | Devnet timeout; retry |

`participants` are generic participant ids, not necessarily Solana addresses. Current artifact format still requires printable ASCII ids up to 64 bytes.

Formula contract:
- `weighted_random`: `participants[].id`, optional `participants[].weight` (default `1`)
- `rank_desc`: `participants[].id`, required `participants[].score`
- `rank_asc`: `participants[].id`, required `participants[].score`
- `first_n`: `participants[].id`
- `closest_to`: `participants[].id`, required `participants[].score`, required top-level `target`

Native W3O1 v3 layout:
- header: `magic`, `format_version=3`, `min_input_lamports`, `max_input_lamports`, `outcome_count`, `effect_count`, `winners_count`, `formula_code`, `reserved[5]`, `target_score`
- outcome: `outcome_id_len`, `outcome_id[64]`, `weight`, `score`, `order`, `first_effect_index`, `effect_count`

## 11) Large Snapshot Partner Flow (local-only first pass)

Small lists stay on `POST /api/partner/draw`. The additive snapshot flow is for very large participant sets and keeps the committed on-chain payload compact (`W3O1 v4`).

Boundary note:

- this section documents the accepted snapshot/publication evidence track used in the current repo
- the large/public scale standard is `Outcome Standard V1.2`
- `V1.2` reuses the scale/public evidence model conceptually, but is not yet the public canonical reviewer flow

Threshold model:

- `<= 1,000` — simple
- `1,001–10,000` — medium
- `10,000+` — bulk
- `100,000+` — streaming-oriented bulk

Safety guardrail:

- first pass is local-only by default
- set `PARTNER_SNAPSHOT_RPC_URL` to a local validator such as `http://127.0.0.1:8899`
- if you intentionally use a non-local RPC, you must also set `PARTNER_SNAPSHOT_ALLOW_NONLOCAL=1` and point `PARTNER_SNAPSHOT_PROGRAM_ID` at a brand new isolated program id
- the canonical program must not be used for this path

Session flow:

```bash
curl -s -X POST http://127.0.0.1:8787/api/partner/snapshot/init \
  -H "Content-Type: application/json" \
  -H "x-api-key: vresk_YOUR_KEY" \
  -d '{"label":"AlphaDex large snapshot"}'
```

```bash
curl -s -X POST http://127.0.0.1:8787/api/partner/snapshot/chunk \
  -H "Content-Type: application/json" \
  -H "x-api-key: vresk_YOUR_KEY" \
  -d '{
    "session_id":"<SESSION_ID>",
    "chunk_index":0,
    "participants":[
      {"id":"trader-alice","score":1200},
      {"id":"trader-bob","score":900}
    ]
  }'
```

```bash
curl -s -X POST http://127.0.0.1:8787/api/partner/snapshot/finalize \
  -H "Content-Type: application/json" \
  -H "x-api-key: vresk_YOUR_KEY" \
  -d '{
    "session_id":"<SESSION_ID>",
    "formula":"rank_desc",
    "winners_count":2,
    "label":"AlphaDex large snapshot"
  }'
```

What finalize writes locally:

- `tmp/partner-snapshot/<SESSION_ID>/canonical_snapshot.jsonl`
- `tmp/partner-snapshot/<SESSION_ID>/manifest.json`
- operator artifact/result files for the local resolve run

Verifier contract for `W3O1 v4`:

- on-chain artifact binds `snapshot_hash`, `snapshot_count`, `formula_code`, `target_score` when needed, `payout_lamports`, and `snapshot_uri`
- replay recomputes the winner-set from tx randomness plus the published canonical snapshot
- v1/v2/v3 replay behavior remains unchanged

Reproducible `1000+` testcase:

```bash
cd verifiable-outcome-engine
PARTNER_API_KEY=vresk_4a3304a5cb2804331078c6e09b687fdb \
node scripts/partner_snapshot_large_case.mjs \
  --base-url http://127.0.0.1:8787 \
  --count 1001 \
  --chunk-size 500 \
  --formula rank_desc \
  --winners-count 2 \
  --label "1001+ snapshot testcase"
```

What this testcase does:

- generates `1001` participants locally
- uploads them as three chunks: `500 + 500 + 1`
- expects threshold mode `medium`
- uses deterministic descending scores, so expected winners are `trader-0001,trader-0002`
- prints the produced local signature plus a ready replay command

Reproducible `100k+` testcase:

```bash
cd verifiable-outcome-engine
PARTNER_API_KEY=vresk_4a3304a5cb2804331078c6e09b687fdb \
node scripts/partner_snapshot_large_case.mjs \
  --base-url http://127.0.0.1:8787 \
  --count 100001 \
  --chunk-size 5000 \
  --formula rank_desc \
  --winners-count 2 \
  --label "100k+ snapshot testcase"
```

What this testcase does:

- generates participants per chunk instead of keeping all `100001` entries in memory
- uploads `20` full chunks of `5000` plus one tail chunk of `1`
- crosses into the `bulk` range immediately after `10000`
- still uses deterministic descending scores, so expected winners are `trader-000001,trader-000002`
- prints the produced local signature plus a ready replay command

Formula + multi-winner local matrix:

```bash
cd verifiable-outcome-engine
PARTNER_API_KEY=vresk_4a3304a5cb2804331078c6e09b687fdb \
node scripts/partner_snapshot_formula_matrix.mjs \
  --base-url http://127.0.0.1:8787 \
  --rpc-url http://127.0.0.1:8899 \
  --count 1001 \
  --chunk-size 500 \
  --winners 1,2,3,5 \
  --label-prefix "formula matrix"
```

What this matrix does:

- runs all five formulas:
  - `weighted_random`
  - `rank_desc`
  - `rank_asc`
  - `first_n`
  - `closest_to`
- repeats each formula for several `winners_count`
- executes `init/chunk/finalize` for every case
- immediately runs local replay for every produced signature
- asserts `MATCH / OK`, `artifact_format_version=4`, committed `snapshot_hash`, committed `snapshot_count`, and winner-set length
- for deterministic formulas (`rank_desc`, `rank_asc`, `first_n`, `closest_to`) also asserts the exact expected winner ids

## 12) Partner API keys for `/api/resolutions` and `/api/participant`

These two endpoints are partner-only and require:

- header: `x-api-key: vresk_...`
- local file: `config/partners.json`

Bootstrap the config:

```bash
cd verifiable-outcome-engine
mkdir -p config
cp config/partners.json.example config/partners.json
```

Then edit `config/partners.json` and restart the server.

Example request:

```bash
curl -s http://127.0.0.1:8787/api/resolutions?limit=3 \
  -H 'x-api-key: vresk_4a3304a5cb2804331078c6e09b687fdb'
```

Expected behavior:

- missing key → HTTP `401`
- unknown key → HTTP `401`
- missing `config/partners.json` → HTTP `503`
- valid key from `config/partners.json` → HTTP `200`
