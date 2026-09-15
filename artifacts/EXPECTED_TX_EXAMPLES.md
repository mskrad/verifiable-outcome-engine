# Expected Replay Examples (canonical devnet)

Canonical program: `6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B`

The four showcase draws below run on single-phase rng_v2 and replay to
`verification_result : MATCH` / `verification_reason : OK`. Source of truth:
`artifacts/outcome_devnet_blessed_signatures.json`.

## Showcase 1 — Raffle

- `signature`: `MVE6v5ZGeBYYSKqDbp9kpVY85VKgSGXbFgUkh3eh2E1Xh7z2TPW3NZHfx2WSi2ERvVjuZB4LCP3nh1MN1YFAy5H`
- `runtime_id`: `164bb2e4e025d7266ec9549b063f914d`
- `resolve_id`: `0`
- `compiled_artifact_hash`: `11d30b3b6e75ce4a289303e34a89c4069e26d7405d8b70176d8780a66bb5b032`
- `artifact_format_version`: `1`
- `resolution_formula`: `weighted_random`
- `rng_version`: `2`
- `target_slots`: `498395156, 498395164, 498395172`
- `resolved_slots`: `498395156, 498395172, 498395173`

```bash
npx -p verifiable-outcome-sdk vre verify --sig MVE6v5ZGeBYYSKqDbp9kpVY85VKgSGXbFgUkh3eh2E1Xh7z2TPW3NZHfx2WSi2ERvVjuZB4LCP3nh1MN1YFAy5H
# or, from a clone
yarn -s replay --sig MVE6v5ZGeBYYSKqDbp9kpVY85VKgSGXbFgUkh3eh2E1Xh7z2TPW3NZHfx2WSi2ERvVjuZB4LCP3nh1MN1YFAy5H --url https://api.devnet.solana.com --program-id 6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B
```

## Showcase 2 — Rewards Selection

- `signature`: `KQdZCBaDAt7VekWAAyvZDcfiwmQ9BXbyyw1z5oMjMzEnGvRJhQHV1WijQGvkwSiQcaLWTXQUrUBriuGGqD56Qfk`
- `runtime_id`: `7bfa87440da3e7cbf1312b2bc8446f6e`
- `resolve_id`: `0`
- `compiled_artifact_hash`: `d04d30f389e5c4e79da880878f67fd06de536f05317b27ae0e5ffea973245f38`
- `artifact_format_version`: `2`
- `resolution_formula`: `weighted_random`
- `winners_count`: `3`
- `rng_version`: `2`
- `target_slots`: `498395252, 498395260, 498395268`
- `resolved_slots`: `498395252, 498395260, 498395268`

```bash
npx -p verifiable-outcome-sdk vre verify --sig KQdZCBaDAt7VekWAAyvZDcfiwmQ9BXbyyw1z5oMjMzEnGvRJhQHV1WijQGvkwSiQcaLWTXQUrUBriuGGqD56Qfk
# or, from a clone
yarn -s replay --sig KQdZCBaDAt7VekWAAyvZDcfiwmQ9BXbyyw1z5oMjMzEnGvRJhQHV1WijQGvkwSiQcaLWTXQUrUBriuGGqD56Qfk --url https://api.devnet.solana.com --program-id 6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B
```

## Showcase 3 — Trading Competition

- `signature`: `3GEUW1ZTGSAjkVExXupEwojqL7Wx6srSU48FeqtKAJGvWEGHcnWaMqEAeKnptrwkDeNuiWpU2MVQWYW6o1dkYAD8`
- `runtime_id`: `7216809fce1c51cb34e790f25419bf0c`
- `resolve_id`: `0`
- `compiled_artifact_hash`: `46b7395c1480892fb8d0d06cc021d00508cf0c64e492e1f8311f709acd39ff0f`
- `artifact_format_version`: `3`
- `resolution_formula`: `rank_desc`
- `winners_count`: `2`
- `rng_version`: `2`
- `target_slots`: `498395368, 498395376, 498395384`
- `resolved_slots`: `498395368, 498395376, 498395384`

```bash
npx -p verifiable-outcome-sdk vre verify --sig 3GEUW1ZTGSAjkVExXupEwojqL7Wx6srSU48FeqtKAJGvWEGHcnWaMqEAeKnptrwkDeNuiWpU2MVQWYW6o1dkYAD8
# or, from a clone
yarn -s replay --sig 3GEUW1ZTGSAjkVExXupEwojqL7Wx6srSU48FeqtKAJGvWEGHcnWaMqEAeKnptrwkDeNuiWpU2MVQWYW6o1dkYAD8 --url https://api.devnet.solana.com --program-id 6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B
```

## Showcase 4 — Prediction Market

- `signature`: `4XywhAqU84x3me5vGpGsoE85VsE1YPDqzyzfEM1jVYdXXRYsq8MWjREjZEgFA6Z8hp57yGsZDfKDNFTCZzpxXmqz`
- `runtime_id`: `d30650cc6b9cf0377a4b7bc84bf3cda3`
- `resolve_id`: `0`
- `compiled_artifact_hash`: `43e0c9d3958c63b4b55c6578bd1e6272320d483ce005b06b1155e1fc78cf13c4`
- `artifact_format_version`: `3`
- `resolution_formula`: `closest_to`
- `target`: `22450`
- `winners_count`: `2`
- `rng_version`: `2`
- `target_slots`: `498395528, 498395536, 498395544`
- `resolved_slots`: `498395532, 498395536, 498395548`

```bash
npx -p verifiable-outcome-sdk vre verify --sig 4XywhAqU84x3me5vGpGsoE85VsE1YPDqzyzfEM1jVYdXXRYsq8MWjREjZEgFA6Z8hp57yGsZDfKDNFTCZzpxXmqz
# or, from a clone
yarn -s replay --sig 4XywhAqU84x3me5vGpGsoE85VsE1YPDqzyzfEM1jVYdXXRYsq8MWjREjZEgFA6Z8hp57yGsZDfKDNFTCZzpxXmqz --url https://api.devnet.solana.com --program-id 6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B
```

All four print:

- `verification_result : MATCH`
- `verification_reason : OK`
