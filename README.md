# Verifiable Outcome Engine


## Problem

On-chain apps often ask users to trust that an outcome was computed correctly:

- a raffle picks a winner,
- a reviewer wants to verify the selected winner.

The usual review path is weak: users see a transaction or UI result, but not an easy way to independently check how that outcome was derived.

## Solution

Verifiable Outcome Engine replays a Solana outcome from a transaction signature plus public RPC data.

This package demonstrates the verification path:

- use a transaction signature,
- fetch public on-chain logs/accounts through RPC,
- recompute the outcome locally,
- compare the replayed result with the recorded outcome,
- expect `MATCH / OK` for the included devnet examples.

Canonical devnet program id:

- `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`

## First Proof Scenario

The first proof scenario is raffle / winner selection.

That scenario is a concrete demo target. The verifier is the reusable part: resolve on-chain, replay independently, compare the result.

## Verify Flow

1. Install the standalone verifier package.
2. Pick an included devnet signature from `artifacts/outcome_devnet_blessed_signatures.json`.
3. Replay it through the local verifier.
4. Check for:
   - `verification_result : MATCH`
   - `verification_reason : OK`

CLI example:

```bash
cd verifiable-outcome-engine
yarn install

ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
yarn -s replay \
  --sig 3iC7i15CakPWD47DZ72WgYYuKQdPW8qwu2Usy77rm8RjKkvocvELHqN1yMqM4MiXLcpiAb52u6z2btMKCAZsmDW1 \
  --url https://api.devnet.solana.com \
  --program-id 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq
```

More included signatures:

- `artifacts/EXPECTED_TX_EXAMPLES.md`
- `artifacts/outcome_devnet_blessed_signatures.json`

Short demo runbook:

- `DEMO_RUNBOOK.md`

## Web Reviewer Flow

The package also includes a small reviewer-facing web surface:

```bash
cd verifiable-outcome-engine
yarn install
yarn web
```

Optional: copy `.env.example` to `.env` to override defaults (port, RPC URL, program ID). Not required — the server starts with built-in defaults.

Open:

- `http://127.0.0.1:8787/play.html`
- `http://127.0.0.1:8787/verify.html`
- `http://127.0.0.1:8787/spec.html`

The web surface is a reviewer flow. Live browser resolve is not part of this demo path.

## Included Evidence

Packaged evidence:

- included devnet signatures:
  - `artifacts/outcome_devnet_blessed_signatures.json`
- reviewer commands:
  - `artifacts/EXPECTED_TX_EXAMPLES.md`
- evidence summary:
  - `artifacts/public_evidence_summary.json`

For this standalone hackathon repo, the reviewer-facing source of truth is the bundled evidence set in this repository:

- `artifacts/outcome_devnet_blessed_signatures.json`
- `artifacts/EXPECTED_TX_EXAMPLES.md`
- `artifacts/public_evidence_summary.json`
- `artifacts/outcome_idl.json`

## Operator Reference: Live Resolve

For operators or reviewers who want to generate a fresh on-chain outcome and then replay it, the package includes a operator resolve script.

This path is optional. The default reviewer flow uses included devnet signatures.

### What it does

`resolve:operator` runs a full operator cycle on-chain:

1. Submits a compiled artifact (outcome rules) to the program.
2. Initializes an outcome runtime.
3. Resolves the outcome — the program selects a result using on-chain randomness.
4. Returns the transaction signature.

The returned signature can be passed directly to `yarn replay` to verify the result.

### Requirements

- Solana wallet keypair (`~/.config/solana/id.json` or `--wallet <PATH>`)
- Funded account on the target cluster
- RPC access to devnet or a local validator

### Run

```bash
# Against devnet (requires funded wallet)
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
yarn -s resolve:operator \
  --url https://api.devnet.solana.com \
  --program-id 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq \
  --json
```

Output includes `signature`. Pass it to the verifier:

```bash
yarn -s replay \
  --sig <signature from above> \
  --url https://api.devnet.solana.com \
  --program-id 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq
```

Expected: `verification_result : MATCH` / `verification_reason : OK`

Result files are written to `tmp/resolve-operator/` by default. Use `--out-dir <DIR>` to override.

## Boundaries

This package is:

- a hackathon-facing verifier reference,
- a standalone replay-by-signature surface,
- a reviewer path for included devnet evidence,
- the standalone hackathon repo for Verifiable Outcome Engine.

This package is not:

- a runtime redesign,
- a new RNG or replay semantics change,
- an artifact binding change,
- an adapters export,
- SDK/package publishing,
- a fee implementation claim,
- a product rollout claim.

The ecosystem monorepo continues separately and is not required to run this repository. Historical localnet signatures are excluded from public verification examples. Verification claims here are limited to transaction signature plus public RPC data for the included devnet evidence.
