# Expected Transaction Examples (Outcome Public Reference)

## Public acceptance surface

- Canonical program id:
  - `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
- Canonical RPC:
  - `https://api.devnet.solana.com`
- Authoritative signatures source in this package:
  - `artifacts/outcome_devnet_blessed_signatures.json`

Historical localnet signatures are intentionally excluded from this public evidence file.

## Expected replay fields

- `verification_result : MATCH`
- `verification_reason : OK`

## Blessed Signature 1

- `signature`: `3iC7i15CakPWD47DZ72WgYYuKQdPW8qwu2Usy77rm8RjKkvocvELHqN1yMqM4MiXLcpiAb52u6z2btMKCAZsmDW1`
- `runtime_id`: `d5a06b25163399079d071f1efddb6772`
- `resolve_id`: `0`
- `compiled_artifact_hash`: `f6150d16407e764efd55bdb3482aa82fc32726eb53c1e7da02994da20b55ace2`

Replay command:

```bash
cd verifiable-outcome-engine
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
yarn -s replay \
  --sig 3iC7i15CakPWD47DZ72WgYYuKQdPW8qwu2Usy77rm8RjKkvocvELHqN1yMqM4MiXLcpiAb52u6z2btMKCAZsmDW1 \
  --url https://api.devnet.solana.com \
  --program-id 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq
```

## Blessed Signature 2

- `signature`: `KMsg6dqUWWNoYfNs6FZhVFWyC76MJN5U8vN61FeeVjTHAZrS9vyAJYDykxUQftvVyrJhV2phSCMXZV41LDbnE8q`
- `runtime_id`: `0adfed6e7b0a3a2343fdda14ae6222e2`
- `resolve_id`: `0`
- `compiled_artifact_hash`: `598c5fd6d661520a368c24dc8cd2aab6059a5959c322049d666cd4ac729d6b82`

Replay command:

```bash
cd verifiable-outcome-engine
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
yarn -s replay \
  --sig KMsg6dqUWWNoYfNs6FZhVFWyC76MJN5U8vN61FeeVjTHAZrS9vyAJYDykxUQftvVyrJhV2phSCMXZV41LDbnE8q \
  --url https://api.devnet.solana.com \
  --program-id 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq
```

Both commands are expected to print:

- `verification_result : MATCH`
- `verification_reason : OK`
