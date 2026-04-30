# Expected Transaction Examples (Canonical Public Reference)

## Public acceptance surface

- Canonical program id:
  - `9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F`
- Canonical RPC:
  - `https://api.devnet.solana.com`
- Authoritative signatures source in this package:
  - `artifacts/outcome_devnet_blessed_signatures.json`

Historical localnet signatures are intentionally excluded from this public evidence file.

## Expected replay fields

- `verification_result : MATCH`
- `verification_reason : OK`

## Blessed Signature 1 — Raffle

- `signature`: `5wZUU5YQ8Nu5RddNeEEigYUEM5Q45C2SJmwLgdLhQcLQi4S3vYhAUvLc6YchYnxqU5b1pvEsBSD1USZPPDEaRVd2`
- `runtime_id`: `dabf24dc2a1e8ee7c4ab54e76089c038`
- `resolve_id`: `0`
- `compiled_artifact_hash`: `4a5c908d2e6a1be0a6197119ebe2e691421e67cc92d88e6c78588ba8d222363c`
- `artifact_format_version`: `1`
- `label`: `Raffle`

Replay command:

```bash
cd verifiable-outcome-engine
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
yarn -s replay \
  --sig 5wZUU5YQ8Nu5RddNeEEigYUEM5Q45C2SJmwLgdLhQcLQi4S3vYhAUvLc6YchYnxqU5b1pvEsBSD1USZPPDEaRVd2 \
  --url https://api.devnet.solana.com \
  --program-id 9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F
```

## Blessed Signature 2 — Rewards Selection

- `signature`: `3F5UeDYgfsg4NhsucruqUbCTSd8YJjDjnGZuDMVunbVL9yAVDmf39Ace8gUMmoginoJ6fFiczNhDUZnYvQDhBFnN`
- `runtime_id`: `2d7a38eb054fdf2402e1bd4e7d33d8af`
- `resolve_id`: `0`
- `compiled_artifact_hash`: `6c56b8ed6f96d60070ce15d4598a5f2dc2a37bce841369afcf6f0616c5f3ab9e`
- `artifact_format_version`: `2`
- `winners_count`: `3`
- `label`: `Rewards Selection`

Replay command:

```bash
cd verifiable-outcome-engine
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
yarn -s replay \
  --sig 3F5UeDYgfsg4NhsucruqUbCTSd8YJjDjnGZuDMVunbVL9yAVDmf39Ace8gUMmoginoJ6fFiczNhDUZnYvQDhBFnN \
  --url https://api.devnet.solana.com \
  --program-id 9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F
```

Both commands are expected to print:

- `verification_result : MATCH`
- `verification_reason : OK`

## Blessed Signature 3 — Trading Competition

- `signature`: `4Ge4ggoRaT5nCQbdZXr51AU3sPPfuPeJgExLziy2HNtQ85AEhMMxDaazUs4ZCnPEckcHP8UuJ8vnTaBCaqJizT8o`
- `program_id`: `9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F`
- `runtime_id`: `f29cada12aee0382307a0e081e189506`
- `resolve_id`: `0`
- `compiled_artifact_hash`: `8c10a9df3c52aa4d5bd9df7c41dcbabad09d2e637635ebf15cf7a85050532dab`
- expected `resolution_formula`: `rank_desc`
- expected `winners_count`: `2`

Replay command:

```bash
cd verifiable-outcome-engine
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
yarn -s replay \
  --sig 4Ge4ggoRaT5nCQbdZXr51AU3sPPfuPeJgExLziy2HNtQ85AEhMMxDaazUs4ZCnPEckcHP8UuJ8vnTaBCaqJizT8o \
  --url https://api.devnet.solana.com \
  --program-id 9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F
```

Expected replay fields:

- `verification_result : MATCH`
- `verification_reason : OK`
- `artifact_format_version : 3`
- `resolution_formula : rank_desc`

## Blessed Signature 4 — Prediction Market

- `signature`: `3XxRQhYvzakKdX7uwi4wN5YKGu5Mdm8oGwSoLr8GiAFDWYcEEyxPAVkTNJZe1AV9gbsFpbWFauHWQakYR2SFEw8G`
- `program_id`: `9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F`
- `runtime_id`: `474c35b27f31574733653cf8a07a4712`
- `resolve_id`: `0`
- `compiled_artifact_hash`: `51829b82c6bb71bed91b9ad93b7d28f8dcef65c979290e395a2c05642ebddabd`
- expected `resolution_formula`: `closest_to`
- expected `target`: `22450`
- expected `winners_count`: `2`

Replay command:

```bash
cd verifiable-outcome-engine
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
yarn -s replay \
  --sig 3XxRQhYvzakKdX7uwi4wN5YKGu5Mdm8oGwSoLr8GiAFDWYcEEyxPAVkTNJZe1AV9gbsFpbWFauHWQakYR2SFEw8G \
  --url https://api.devnet.solana.com \
  --program-id 9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F
```

Expected replay fields:

- `verification_result : MATCH`
- `verification_reason : OK`
- `artifact_format_version : 3`
- `resolution_formula : closest_to`
- `target : 22450`
