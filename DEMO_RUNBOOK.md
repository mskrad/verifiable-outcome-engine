# Demo Runbook

Show a VRE result end to end on the canonical devnet program `6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B`:
pick a showcase draw, replay it, then run a fresh draw and replay that one.

Version history: [CHANGELOG.md](CHANGELOG.md). API details: [INTEGRATION.md](INTEGRATION.md).

## 1) Replay a showcase draw

Showcase signatures (all rng_v2, all `MATCH`), also in `artifacts/outcome_devnet_blessed_signatures.json`:

| Draw | Signature |
|---|---|
| Raffle — `weighted_random`, 1 winner | `MVE6v5ZGeBYYSKqDbp9kpVY85VKgSGXbFgUkh3eh2E1Xh7z2TPW3NZHfx2WSi2ERvVjuZB4LCP3nh1MN1YFAy5H` |
| Rewards selection — `weighted_random`, 3 winners | `KQdZCBaDAt7VekWAAyvZDcfiwmQ9BXbyyw1z5oMjMzEnGvRJhQHV1WijQGvkwSiQcaLWTXQUrUBriuGGqD56Qfk` |
| Trading competition — `rank_desc`, 2 winners | `3GEUW1ZTGSAjkVExXupEwojqL7Wx6srSU48FeqtKAJGvWEGHcnWaMqEAeKnptrwkDeNuiWpU2MVQWYW6o1dkYAD8` |
| Prediction market — `closest_to`, target 22450 | `4XywhAqU84x3me5vGpGsoE85VsE1YPDqzyzfEM1jVYdXXRYsq8MWjREjZEgFA6Z8hp57yGsZDfKDNFTCZzpxXmqz` |

Browser: `https://verifiableoutcome.online/verify?sig=<SIGNATURE>`

Terminal:

```bash
npx -p verifiable-outcome-sdk vre verify --sig MVE6v5ZGeBYYSKqDbp9kpVY85VKgSGXbFgUkh3eh2E1Xh7z2TPW3NZHfx2WSi2ERvVjuZB4LCP3nh1MN1YFAy5H
```

Expected:

```text
verification_result : MATCH
verification_reason : OK
rng_version         : 2
entropy_source      : slot_hash
```

If public devnet RPC is busy (`ERR_TX_NOT_FOUND_OR_NO_LOGS`, `ERR_REPLAY_UNHANDLED`), retry after a few seconds.

## 2) Run a fresh draw and replay it

No key needed — the demo endpoint allows one draw per 15 s per IP:

```bash
curl -s -X POST https://verifiableoutcome.online/api/examples/draw \
  -H "content-type: application/json" \
  -d '{"formula":"weighted_random","winners_count":1,"participants":[{"id":"alice"},{"id":"bob"},{"id":"carol"}]}'
```

The request takes 12–45 s: the rules are committed, three future slots are fixed, and the winners
come from their hashes. Copy `signature` from the response and replay it as in step 1.
`target_slots` and `resolved_slots` in the response show which slots were used.

The same flow with buttons: [/examples](https://verifiableoutcome.online/examples).

## 3) Embed the verifier

```html
<script src="https://verifiableoutcome.online/widget.js"></script>
<vre-verify sig="YOUR_TX_SIGNATURE"></vre-verify>
<vre-verify-form></vre-verify-form>
```

Local demo page: `http://127.0.0.1:8787/widget` after `yarn web`.

## Resolution paths

Draws use single-phase rng_v2 (v1.2). The same program also runs two-phase rng_v2 (v1.3.2),
Sortition-by-Claim (v1.4.0) with optional economics (v1.4.1) and Conditions (fc7). Unicorn-G (B8) is
implemented but not deployed. Details: [/protocol-paths](https://verifiableoutcome.online/protocol-paths).
