# Verifiable Outcome Engine

We help Solana apps replace backend-trust reward logic with replay-verifiable on-chain outcomes.

## Quick Verify

```bash
npm install -g verifiable-outcome-sdk
vre verify --sig 5wZUU5YQ8Nu5RddNeEEigYUEM5Q45C2SJmwLgdLhQcLQi4S3vYhAUvLc6YchYnxqU5b1pvEsBSD1USZPPDEaRVd2

# -> MATCH / OK
```

Live verifier:

```text
https://verifiableoutcome.online/verify?sig=5wZUU5YQ8Nu5RddNeEEigYUEM5Q45C2SJmwLgdLhQcLQi4S3vYhAUvLc6YchYnxqU5b1pvEsBSD1USZPPDEaRVd2
```

Full error code reference: [VERIFICATION_ERRORS.md](./VERIFICATION_ERRORS.md)

## Licensing

The **verification SDK** is open for integration — use it to build artifacts,
verify outcomes, and replay results from chain data.

The **Solana program** (`9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F`) runs
on a protocol fee model: each `resolveOutcome` call pays a small fee to the
VRE treasury.

**Partners** (large platforms, GameFi, NFT marketplaces) can deploy their own
instance under a commercial agreement — no per-tx fee.
[Contact us →](mailto:hello@verifiableoutcome.online)

## Problem

On-chain apps often ask users to trust that an outcome was computed correctly:

- a raffle picks a winner,
- a reviewer wants to verify the selected winner.

The usual review path is weak: users see a transaction or UI result, but not an easy way to independently check how that outcome was derived.

| Without VRE | With VRE |
|---|---|
| Operator picks winner, posts TX | Rules committed on-chain before draw |
| Users trust the result | Anyone replays from public RPC data |
| No way to verify selection logic | `vre verify --sig <TX>` -> `MATCH / OK` |

## Solution

Verifiable Outcome Engine replays a Solana outcome from a transaction signature plus public RPC data.

This package demonstrates the verification path and the current W3O1 surface:

- use a transaction signature,
- fetch public on-chain logs/accounts through RPC,
- recompute the outcome locally,
- compare the replayed result with the recorded outcome,
- expect `MATCH / OK` for the included devnet examples,
- inspect `artifact_format_version`, `resolution_formula`, `winners_count`, and `target` for W3O1 v3 artifacts.

Canonical devnet program id:

- `9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F`
- Upgrade authority: Squads vault PDA `8o5a6hj22sEsmpsYTN8aM4GUwKGkR1YXKsgYQdiVkbgA` under multisig `7jtA1fkZNrg7ZntGQtpXtAi9JxZEzgRjGRuGvdScZQqQ` ([Squads](https://squads.xyz/multisig)).
- Live operator: Swig actor wallet `E8wB17KxBi89Noz74eypjbcrAJXhmPeA7e7oYHZSbjzf`; VPS delegate is scoped to the VRE program with a daily SOL spending limit.

## Evidence Set

The public devnet bundle currently exposes four active blessed signatures on the canonical program:

- `Raffle` — W3O1 v1 weighted random
- `Rewards Selection` — W3O1 v2 multi-winner weighted random
- `Trading Competition` — W3O1 v3 `rank_desc`
- `Prediction Market` — W3O1 v3 `closest_to`

The verifier is the reusable part: resolve on-chain, replay independently, compare the result, and expose the same evidence set in CLI, web, and widget surfaces.

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
  --sig 5wZUU5YQ8Nu5RddNeEEigYUEM5Q45C2SJmwLgdLhQcLQi4S3vYhAUvLc6YchYnxqU5b1pvEsBSD1USZPPDEaRVd2 \
  --url https://api.devnet.solana.com \
  --program-id 9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F
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

- `http://127.0.0.1:8787/play`
- `http://127.0.0.1:8787/verify`
- `http://127.0.0.1:8787/widget`
- `http://127.0.0.1:8787/spec`

The web surface is a reviewer flow. Live browser resolve is not part of this demo path.

## Embeddable Widget

The reviewer flow can also be embedded on another page with the standalone widget script.

Use `<vre-verify>` when the page already knows the transaction signature:

```html
<script src="https://verifiableoutcome.online/widget.js"></script>
<vre-verify
  sig="YOUR_TX_SIGNATURE"
  rpc="https://api.devnet.solana.com"
  program-id="YOUR_PROGRAM_ID">
</vre-verify>
```

Use `<vre-verify-form>` when users should paste their own transaction signature in-page:

```html
<script src="https://verifiableoutcome.online/widget.js"></script>
<vre-verify-form></vre-verify-form>
```

Both widgets call the public replay endpoint with `signature`, `rpc`, and `programId` and show `MATCH / OK` when replay matches the on-chain outcome.

## Included Evidence

Packaged evidence:

- included devnet signatures:
  - `artifacts/outcome_devnet_blessed_signatures.json`
- reviewer commands:
  - `artifacts/EXPECTED_TX_EXAMPLES.md`
- evidence summary:
  - `artifacts/public_evidence_summary.json`
- Metaplex Agent Registry evidence:
  - `artifacts/metaplex_agent_registry_evidence.json`

For this standalone hackathon repo, the reviewer-facing source of truth is the bundled evidence set in this repository:

- `artifacts/outcome_devnet_blessed_signatures.json`
- `artifacts/EXPECTED_TX_EXAMPLES.md`
- `artifacts/public_evidence_summary.json`
- `artifacts/metaplex_agent_registry_evidence.json`
- `artifacts/outcome_idl.json`

Metaplex Agent Registry registration:

- agent asset:
  - `C3qM2VVxR5dyjzqEvv9qHaaUDfTDneEaJCMTKV9bxQLX`
- mint transaction:
  - `429YX7c7p7RhZM3vrypCDXXBvPBsoPfXHyiLDLmjNVWXKHX8VeboDiecmu48vRkX9cGSiVQZUnnV9Rjk1PxUowjj`
- registration evidence:
  - `artifacts/metaplex_agent_registry_evidence.json`

## Operator Reference: Live Resolve

For operators or reviewers who want to generate a fresh on-chain outcome and then replay it, the package includes a operator resolve script.

This path is optional. The default reviewer flow uses included devnet signatures.

### What it does

`resolve:operator` runs a full operator cycle on-chain:

1. Submits a compiled artifact (outcome rules) to the program.
2. Initializes an outcome runtime.
3. Resolves the outcome — the program selects a result using deterministic RNG v1.
4. Returns the transaction signature.

The returned signature can be passed directly to `yarn replay` to verify the result.
For economic adversarial use, read `SECURITY.md`; RNG v1 is replay-friendly but
predictable from public state.

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
  --program-id 9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F \
  --json
```

Output includes `signature`. Pass it to the verifier:

```bash
yarn -s replay \
  --sig <signature from above> \
  --url https://api.devnet.solana.com \
  --program-id 9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F
```

Expected: `verification_result : MATCH` / `verification_reason : OK`

Result files are written to `tmp/resolve-operator/` by default. Use `--out-dir <DIR>` to override.

## Current Limitations

### Participant list size

The Partner Draw API commits participants directly in one Solana transaction.
Because Solana transactions have a strict size limit, large lists or long participant IDs can fail with:

```
Transaction too large
```

For now, use short participant IDs (e.g. `"A1"`) and keep lists small (2–10 entries for readable IDs, up to ~20 with short IDs).
For larger leaderboards, the upcoming chunked snapshot commit flow will remove this limit — see [INTEGRATION.md](./INTEGRATION.md#current-limitations) for details.

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
- a claim that the npm SDK deploys the Solana program,
- a fee implementation claim,
- a product rollout claim.

The ecosystem monorepo continues separately and is not required to run this repository. Historical localnet signatures are excluded from public verification examples. Verification claims here are limited to transaction signature plus public RPC data for the included devnet evidence.
