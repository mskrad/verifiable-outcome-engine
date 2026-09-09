# Expected Replay Examples (canonical devnet)

Canonical program: `6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B`

All four blessed signatures below were produced on the canonical program and replay to
`verification_result : MATCH` / `verification_reason : OK`. Source of truth:
`artifacts/outcome_devnet_blessed_signatures.json`.

> Legacy note: an earlier blessed set lived on `9tEram…` (a 608 KB pre-Unicorn-G binary whose upgrade
> authority is a multisig vault). The protocol moved to `6QtLot…` (full feature set, team-held upgrade
> authority) and all four outcomes were re-blessed there. The old `9tEram` signatures remain
> valid on that legacy program but are no longer the canonical set.

## Blessed Signature 1 — Raffle

- `signature`: `47S5Q3xXY1f5i5DWrppGqgNYb29uTCaeJceMcwCAdCBasgPrqe6mosyLvFSfch3EXZm3CWAiRhyEEx8XGx8FHdcF`
- `runtime_id`: `515240d51974297b16db23538608e20d`
- `resolve_id`: `0`
- `compiled_artifact_hash`: `4a3304a5cb2804331078c6e09b687fdbce1545e2cda5d77ef0c1eb3ab7688ed7`
- `artifact_format_version`: `1`
- `resolution_formula`: `weighted_random`
- `label`: `Raffle`

```bash
cd verifiable-outcome-engine
yarn -s replay \
  --sig 47S5Q3xXY1f5i5DWrppGqgNYb29uTCaeJceMcwCAdCBasgPrqe6mosyLvFSfch3EXZm3CWAiRhyEEx8XGx8FHdcF \
  --url https://api.devnet.solana.com \
  --program-id 6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B
```

## Blessed Signature 2 — Rewards Selection

- `signature`: `uhCqjSdbfHW1YWwyaWjvVjL1cGpj62dShjvrS9JcAgBM8L2AiNqFtdVDQ4MajsEv6ybtvtEsNzCYjbgqCHRJoaq`
- `runtime_id`: `f114d63526a552f54d491c381f9be0a9`
- `resolve_id`: `0`
- `compiled_artifact_hash`: `c2dfa364fd9bdfccdd198398764f02aa08aa653174c285639c9a22c2861854ef`
- `artifact_format_version`: `2`
- `resolution_formula`: `weighted_random`
- `winners_count`: `3`
- `label`: `Rewards Selection`

```bash
cd verifiable-outcome-engine
yarn -s replay \
  --sig uhCqjSdbfHW1YWwyaWjvVjL1cGpj62dShjvrS9JcAgBM8L2AiNqFtdVDQ4MajsEv6ybtvtEsNzCYjbgqCHRJoaq \
  --url https://api.devnet.solana.com \
  --program-id 6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B
```

## Blessed Signature 3 — Trading Competition

- `signature`: `2Wmtwv5FHfRTDK6WJYPhV2TZm1wU5o4FNy2mUx4mgGzMUtJHyGfNvUoTtfsyCbZhUUHbgCJ5keCVC6qkZtjhfLki`
- `runtime_id`: `049d4f17c9c0225706bfbe255313ec2b`
- `resolve_id`: `0`
- `compiled_artifact_hash`: `b1901d51b8004853800a2619baa57469bea1f136317f04c4b72efff2175a75f7`
- `artifact_format_version`: `3`
- `resolution_formula`: `rank_desc`
- `winners_count`: `2`
- `label`: `Trading Competition`

```bash
cd verifiable-outcome-engine
yarn -s replay \
  --sig 2Wmtwv5FHfRTDK6WJYPhV2TZm1wU5o4FNy2mUx4mgGzMUtJHyGfNvUoTtfsyCbZhUUHbgCJ5keCVC6qkZtjhfLki \
  --url https://api.devnet.solana.com \
  --program-id 6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B
```

## Blessed Signature 4 — Prediction Market

- `signature`: `veg7dh83N6vuMF72ktVnmQwZjJNe8XmS1tJaAN8sZevJ9asGfAJnjGL8ZLatTXG3ga6yAR7EinhG16291CfwLjf`
- `runtime_id`: `5a94d581a7a2b217226909edc982b92d`
- `resolve_id`: `0`
- `compiled_artifact_hash`: `95901199dcb4d4d27168f3a980c69336624fa45189e13cd70ef1aad24c6dea13`
- `artifact_format_version`: `3`
- `resolution_formula`: `closest_to`
- `target`: `22450`
- `winners_count`: `2`
- `label`: `Prediction Market`

```bash
cd verifiable-outcome-engine
yarn -s replay \
  --sig veg7dh83N6vuMF72ktVnmQwZjJNe8XmS1tJaAN8sZevJ9asGfAJnjGL8ZLatTXG3ga6yAR7EinhG16291CfwLjf \
  --url https://api.devnet.solana.com \
  --program-id 6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B
```

All four commands print:

- `verification_result : MATCH`
- `verification_reason : OK`
