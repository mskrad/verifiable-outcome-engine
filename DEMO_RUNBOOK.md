# Demo Runbook

Purpose: show Verifiable Outcome Engine as a raffle / winner-selection proof scenario using included devnet evidence.

## 1) Install

```bash
cd outcome-runtime-reference
yarn install
```

## 2) Pick an included devnet signature

Use one active signature from:

- `artifacts/outcome_devnet_blessed_signatures.json`
- `artifacts/EXPECTED_TX_EXAMPLES.md`

Fallback signature if live resolve is unavailable:

```text
3iC7i15CakPWD47DZ72WgYYuKQdPW8qwu2Usy77rm8RjKkvocvELHqN1yMqM4MiXLcpiAb52u6z2btMKCAZsmDW1
```

## 3) Replay from public RPC data

```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
yarn -s replay \
  --sig 3iC7i15CakPWD47DZ72WgYYuKQdPW8qwu2Usy77rm8RjKkvocvELHqN1yMqM4MiXLcpiAb52u6z2btMKCAZsmDW1 \
  --url https://api.devnet.solana.com \
  --program-id 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq
```

## 4) Expected result

Expected terminal lines:

- `verification_result : MATCH`
- `verification_reason : OK`

If devnet RPC is unavailable, retry later or use another active signature from `artifacts/outcome_devnet_blessed_signatures.json`.
