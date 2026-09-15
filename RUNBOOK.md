# Runbook — run and check VRE locally

For integrating against the public API read [INTEGRATION.md](INTEGRATION.md); the full reference is
[/spec](https://verifiableoutcome.online/spec). Version history is in [CHANGELOG.md](CHANGELOG.md).

## 1) Install and launch

```bash
cd verifiable-outcome-engine
yarn install
yarn web          # http://127.0.0.1:8787
```

`.env.example` lists optional settings. Without a `.env` the server starts and serves verification
and the pages; draw endpoints additionally need the operator key and a partner config (§5).

## 2) Pages

- `/play` — showcase draws and a live raffle
- `/examples` — keyless demo draws, sortition console, conditions scorer
- `/verify` — replay any signature
- `/build` — partner API in short
- `/widget` — embeddable verifier
- `/protocol-paths` — resolution paths
- `/spec`, `/spec.md`, `/llms.txt` — reference

## 3) Verify a result

Browser: open `/verify?sig=<SIGNATURE>` and run the replay; expect `MATCH` / `OK`.

Terminal, from a clone:

```bash
yarn -s replay \
  --sig MVE6v5ZGeBYYSKqDbp9kpVY85VKgSGXbFgUkh3eh2E1Xh7z2TPW3NZHfx2WSi2ERvVjuZB4LCP3nh1MN1YFAy5H \
  --url https://api.devnet.solana.com \
  --program-id 6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B
```

Terminal, from npm: `npx -p verifiable-outcome-sdk vre verify --sig <SIGNATURE>`.

The four showcase signatures (all rng_v2) are in `artifacts/outcome_devnet_blessed_signatures.json`.

## 4) Embedded widget

```html
<script src="https://verifiableoutcome.online/widget.js"></script>
<vre-verify sig="YOUR_TX_SIGNATURE"></vre-verify>
<vre-verify-form></vre-verify-form>
```

`rpc` and `program-id` attributes default to public devnet and the canonical program. The public
host replays through its own devnet RPC and rejects other `rpc` values.

## 5) Run draws locally

Draws on the canonical program bind only artifacts approved by the `ProgramConfig` admin, so the
local server needs that key to run them.

`.env`:

```bash
LIVE_RAFFLE_WALLET=/path/to/program-config-admin.json   # signs draws
CONDITIONS_OPERATOR_WALLET=/path/to/program-config-admin.json   # signs conditions; must be the same admin
EXAMPLES_DEMO_API_KEY=vresk_...                          # a key from config/partners.json, used by /api/examples/draw
```

Partner keys:

```bash
mkdir -p config
cp config/partners.json.example config/partners.json
# edit: one entry per key — { "key": "vresk_...", "name": "...", "tier": 1, "created": "YYYY-MM-DD", "draw_enabled": true }
```

The file is read once at start; restart the server after editing it.

Check the setup:

```bash
curl -s http://127.0.0.1:8787/api/health
curl -s -X POST http://127.0.0.1:8787/api/partner/draw \
  -H "content-type: application/json" -H "x-api-key: vresk_YOUR_KEY" \
  -d '{"formula":"rank_asc","winners_count":1,"participants":[{"id":"a","score":3},{"id":"b","score":1}]}'
```

A draw returns in 12–45 s with `signature`, `outcome_ids`, `artifact_slot`, `resolution_slot`,
`rng_version: 2`, `target_slots`, `resolved_slots`. Replay the signature as in §3.

Expected failures: `401` missing or unknown key, `403` key without `draw_enabled`,
`503` missing `config/partners.json`, `500` with `error_code: "UnauthorizedAdmin"` when the signing
key is not the program admin.

## 6) Resolution paths on devnet

All run on `6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B`:

| Path | Version | Status |
|---|---|---|
| Single phase `prepare_rng_v2` → `settle_rng_v2` | v1.2 | default for all draw endpoints |
| Two phase `seal_randomness` → `attest_winners` | v1.3.2 | optional |
| Sortition-by-Claim | v1.4.0 | live |
| Sortition economics | v1.4.1 | live, optional |
| Conditions | fc7 | live |
| Operator seed resolve | rng_v1 | legacy |
| Unicorn-G entropy | B8 | implemented, not deployed |

### Sortition-by-Claim and economics

Entrants register `commitment = sha256(secret ‖ ticket_id ‖ draw_id)` before a deadline; the draw
seals `omega` from three slot hashes 75, 90 and 105 slots after creation; each entrant claims by
revealing `secret` and wins iff `sha256(secret ‖ omega) < threshold`. `v1.4.1` adds an optional fee
layer (`entry_fee_lamports` at register, `close_skim_bps` on close) that is byte-compatible with
`v1.4.0` draws.

Measured: lifecycle create → register → seal → claim passes; 5/5 negative cases rejected; claim
below 10k CU; 200 draws × 100 tickets, expected 10 winners → mean 9.7, variance 8.76. Economics:
9/9 negative cases; `register_paid` 18,096 CU, `init_economics` 5,234 CU, `close` 9,643 CU,
`sweep(2)` 18,459 CU.

Evidence: `artifacts/protocol_infra_011_sortition_devnet.json`, `artifacts/protocol_infra_013_economics_devnet.json`
and the localnet files next to them. Builders and the inline client live in `sdk/sortition.ts`; the API
exposes `/api/partner/sortition/*` and the keyless `/api/examples/sortition/*`.

### Unicorn-G entropy — implemented, not deployed

An alternative entropy source: the program derives the input from frozen `RngV2State` and
`SlotHashes`, verifies a VDF output through an embedded Groth16 proof and seals randomness from it.
The instructions sit behind a build feature; the canonical program is not built with it. Before
mainnet it needs the circuit soundness fix and a multi-party trusted-setup ceremony.

Measured on devnet in June 2026: seal with verification 247,476 CU, attest 61,466 CU, wrong proof
rejected as `InvalidUnicornGProof`. Evidence: `artifacts/protocol_infra_014_b8_devnet_evidence_summary.json`.

## 7) Program upgrade authority

On devnet the upgrade authority is a single key, separate from the `ProgramConfig` admin that signs
operator transactions. Mainnet governance (multisig, timelock or immutable) is decided separately.

```bash
solana program show 6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B --url https://api.devnet.solana.com
```

Upgrade in place:

```bash
anchor build                                    # -> target/deploy/outcome.so
solana program deploy target/deploy/outcome.so \
  --program-id 6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B \
  --upgrade-authority /path/to/upgrade-authority.json \
  --url https://api.devnet.solana.com
```

| Name | Address |
|---|---|
| Program | `6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B` |
| ProgramConfig admin | `CJN7pVC8LCsia4QPy1yWiTX3iQMtVbnwjoUmyNK4ce2Y` |

## 8) Artifact standards

- `Outcome Standard V1.1` — compact named-entry artifact (`artifact_format_version=5`); holds 103
  entries / 8,185 bytes, overflows at 104 entries / 8,264 bytes.
- `Outcome Standard V1.2` — scale extension with a snapshot and Merkle root.

## 9) Large snapshot flow (local-only)

Small lists stay on `POST /api/partner/draw`. The snapshot flow commits a large participant set as a
hash and keeps the on-chain payload compact.

It is local-only by default: set `PARTNER_SNAPSHOT_RPC_URL` to a local validator such as
`http://127.0.0.1:8899`. A non-local RPC also needs `PARTNER_SNAPSHOT_ALLOW_NONLOCAL=1` and
`PARTNER_SNAPSHOT_PROGRAM_ID` pointing at a separate program; the canonical program is refused
for this path.

```bash
curl -s -X POST http://127.0.0.1:8787/api/partner/snapshot/init \
  -H "content-type: application/json" -H "x-api-key: vresk_YOUR_KEY" \
  -d '{"label":"large snapshot"}'

curl -s -X POST http://127.0.0.1:8787/api/partner/snapshot/chunk \
  -H "content-type: application/json" -H "x-api-key: vresk_YOUR_KEY" \
  -d '{"session_id":"<SESSION_ID>","chunk_index":0,"participants":[{"id":"trader-alice","score":1200},{"id":"trader-bob","score":900}]}'

curl -s -X POST http://127.0.0.1:8787/api/partner/snapshot/finalize \
  -H "content-type: application/json" -H "x-api-key: vresk_YOUR_KEY" \
  -d '{"session_id":"<SESSION_ID>","formula":"rank_desc","winners_count":2}'
```

Finalize writes `tmp/partner-snapshot/<SESSION_ID>/canonical_snapshot.jsonl` and `manifest.json`.

Test cases against a local validator:

```bash
PARTNER_API_KEY=vresk_YOUR_KEY node scripts/partner_snapshot_large_case.mjs \
  --base-url http://127.0.0.1:8787 --count 1001 --chunk-size 500 --formula rank_desc --winners-count 2

PARTNER_API_KEY=vresk_YOUR_KEY node scripts/partner_snapshot_formula_matrix.mjs \
  --base-url http://127.0.0.1:8787 --rpc-url http://127.0.0.1:8899 \
  --count 1001 --chunk-size 500 --winners 1,2,3,5
```

The first uploads 1,001 participants in three chunks and expects winners `trader-0001,trader-0002`;
the second runs all five formulas for several winner counts and replays every signature.
