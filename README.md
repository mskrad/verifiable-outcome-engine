# Verifiable Outcome Engine

On-chain proof of who won.

A raffle, an airdrop or a competition on Solana announces winners. VRE commits the
rules on-chain before the draw, takes the randomness from Solana slots that did not
exist yet when the rules were committed, and lets anyone replay the result from the
transaction signature and public RPC data.

Status: devnet. Mainnet is planned for this year.

- Spec: [verifiableoutcome.online/spec](https://verifiableoutcome.online/spec) · Markdown for agents: [spec.md](https://verifiableoutcome.online/spec.md), [llms.txt](https://verifiableoutcome.online/llms.txt)
- Integration guide: [INTEGRATION.md](./INTEGRATION.md)
- Feedback and API keys: Telegram [t.me/maskradiation](https://t.me/maskradiation)

## Verify a result

In the browser:

```text
https://verifiableoutcome.online/verify?sig=MVE6v5ZGeBYYSKqDbp9kpVY85VKgSGXbFgUkh3eh2E1Xh7z2TPW3NZHfx2WSi2ERvVjuZB4LCP3nh1MN1YFAy5H
```

From a terminal (Node 18+):

```bash
npx -p verifiable-outcome-sdk vre verify --sig MVE6v5ZGeBYYSKqDbp9kpVY85VKgSGXbFgUkh3eh2E1Xh7z2TPW3NZHfx2WSi2ERvVjuZB4LCP3nh1MN1YFAy5H
# verification_result : MATCH
# verification_reason : OK
```

`vre verify` exits with 0 on `MATCH` and 1 otherwise; add `--json` for the full result.
Reason codes: [VERIFICATION_ERRORS.md](./VERIFICATION_ERRORS.md).

In code:

```js
import { verifyOutcome } from "verifiable-outcome-sdk";

const result = await verifyOutcome({
  signature: "<transaction signature>",
  rpcUrl: "https://api.devnet.solana.com",
  programId: "6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B",
});
// result.status === "MATCH", result.reason === "OK"
```

Over HTTP: `POST https://verifiableoutcome.online/api/replay` with `{"signature": "<sig>"}`.

## Run a draw

Draws on the canonical program are executed by the VRE operator: the program only binds
rules approved by its admin key. You send participants and a formula over HTTP; the
response carries the signature that anyone can replay.

A draw takes 12–45 seconds in one request: commit the rules, `prepare_rng_v2` fixes three
future slots (+8, +16, +24), wait for them, `settle_rng_v2` picks the winners, replay.

Without a key (demo, one draw per 15 s per IP):

```bash
curl -s -X POST https://verifiableoutcome.online/api/examples/draw \
  -H "content-type: application/json" \
  -d '{"formula":"weighted_random","winners_count":1,"participants":[{"id":"alice"},{"id":"bob"},{"id":"carol"}]}'
```

With a partner key (ask in [Telegram](https://t.me/maskradiation); one draw per 10 s per key):

```bash
curl -s -X POST https://verifiableoutcome.online/api/partner/draw \
  -H "content-type: application/json" -H "x-api-key: vresk_YOUR_KEY" \
  -d '{"formula":"rank_desc","winners_count":2,"participants":[{"id":"alice","score":10},{"id":"bob","score":30},{"id":"carol","score":20}]}'
```

```json
{
  "ok": true,
  "signature": "…",
  "outcome_id": "bob",
  "outcome_ids": ["bob", "carol"],
  "replay_url": "https://verifiableoutcome.online/verify?sig=…",
  "artifact_slot": 497810330,
  "resolution_slot": 498394097,
  "rng_version": 2,
  "entropy_source": "slot_hash",
  "prepare_signature": "…",
  "target_slots": ["…", "…", "…"],
  "resolved_slots": ["…", "…", "…"],
  "winner_claim_hash": "…"
}
```

Formulas: `weighted_random` (optional `weight`), `rank_desc`, `rank_asc`, `first_n`,
`closest_to` (needs `target`). Up to ~100 participants per draw, ids up to 64 printable
ASCII bytes, `winners_count` 1–10. Full request and response reference:
[spec · API](https://verifiableoutcome.online/spec#api).

The same key also opens sortition and conditions endpoints — see [INTEGRATION.md](./INTEGRATION.md).

## Resolution paths

| Path | Version | Status on devnet |
|---|---|---|
| Single-phase future slot hashes: `prepare_rng_v2` → `settle_rng_v2` | v1.2 | standard; used by all draw endpoints |
| Two-phase: `seal_randomness` → `attest_winners` | v1.3.2 | optional, per draw |
| Sortition-by-Claim: commit a ticket, claim against a threshold | v1.4.0 | live |
| Sortition economics: entry fee and close skim | v1.4.1 | live, optional |
| Conditions: prediction slips scored against revealed match facts (used by OddSol) | fc7 | live |
| Operator seed resolve | rng_v1 | legacy |
| Unicorn-G entropy (VDF output checked on-chain via Groth16) | B8 | implemented, not deployed |

What each path proves and what it does not: [spec · Resolution model](https://verifiableoutcome.online/spec#resolution-model).
Sortition outcomes are enforced by the claim instruction on-chain; `vre verify` does not replay
sortition transactions yet.

## Program and package

- Canonical devnet program: `6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B`
- `ProgramConfig` admin (draw operator): `CJN7pVC8LCsia4QPy1yWiTX3iQMtVbnwjoUmyNK4ce2Y`; it cannot upgrade the program.
- Protocol fee on devnet: 0.
- npm: [`verifiable-outcome-sdk`](https://www.npmjs.com/package/verifiable-outcome-sdk) (MIT) — verifier, artifact builders, sortition client, the `vre` CLI and the program IDL.

## Showcase draws

Four draws on the canonical program, each replays to `MATCH` (rng_v2):

| Draw | Formula | Signature |
|---|---|---|
| Raffle | `weighted_random`, 1 winner | `MVE6v5ZGeBYYSKqDbp9kpVY85VKgSGXbFgUkh3eh2E1Xh7z2TPW3NZHfx2WSi2ERvVjuZB4LCP3nh1MN1YFAy5H` |
| Rewards selection | `weighted_random`, 3 winners | `KQdZCBaDAt7VekWAAyvZDcfiwmQ9BXbyyw1z5oMjMzEnGvRJhQHV1WijQGvkwSiQcaLWTXQUrUBriuGGqD56Qfk` |
| Trading competition | `rank_desc`, 2 winners | `3GEUW1ZTGSAjkVExXupEwojqL7Wx6srSU48FeqtKAJGvWEGHcnWaMqEAeKnptrwkDeNuiWpU2MVQWYW6o1dkYAD8` |
| Prediction market | `closest_to`, 2 winners | `4XywhAqU84x3me5vGpGsoE85VsE1YPDqzyzfEM1jVYdXXRYsq8MWjREjZEgFA6Z8hp57yGsZDfKDNFTCZzpxXmqz` |

The list with runtime ids and artifact hashes: [`artifacts/outcome_devnet_blessed_signatures.json`](./artifacts/outcome_devnet_blessed_signatures.json).
Live pages: [/play](https://verifiableoutcome.online/play), [/examples](https://verifiableoutcome.online/examples).

## Embed the verifier

```html
<script src="https://verifiableoutcome.online/widget.js"></script>
<vre-verify sig="YOUR_TX_SIGNATURE"></vre-verify>
<!-- or let visitors paste a signature -->
<vre-verify-form></vre-verify-form>
```

The widget calls the public replay endpoint on devnet; the public host does not accept a custom RPC.

## Run locally

```bash
yarn install
yarn web          # http://127.0.0.1:8787 — /play, /examples, /verify, /spec
yarn -s replay --sig <signature> --url https://api.devnet.solana.com
```

`.env.example` lists optional settings. Draw endpoints need the operator key and a partner
config; without them the local server still serves verification and the pages.

## Limits

- One compact draw holds about 100 participants (8 KB artifact).
- Randomness comes from Solana slot hashes: a validator that produces a target slot has limited
  influence over that hash. The spec lists what this means in numbers.
- Draw endpoints wait for future slots, so a request takes 12–45 seconds.

## More

- [CHANGELOG.md](./CHANGELOG.md) — what changed and when
- [SECURITY.md](./SECURITY.md) — scope and reporting
- [LICENSE](./LICENSE)
