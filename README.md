# Verifiable Outcome Engine

On-chain proof of who won.

Every competition, raffle, or airdrop on Solana announces a winner. VRE commits
the rules on-chain before the draw — anyone can take the transaction signature and
verify the result themselves. No backend trust required.

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

The **Solana program** (`6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B`) runs
on a protocol fee model: each `resolveOutcome` call pays a small fee to the
VRE treasury.

**Program source:** The full Anchor program source is not yet publicly released.
The repository includes selected files (`submit_compiled_artifact`, `math/`, IDL)
sufficient for integration and verification. The core resolution logic is planned
for open-source release post-launch. The deployed program is verifiable via the
IDL and on-chain replay without access to the source.

**Partners** (large platforms, GameFi, NFT marketplaces) can deploy their own
instance under a commercial agreement — no per-tx fee.
[Contact us →](mailto:hello@verifiableoutcome.online)

## Why this exists

Every Solana app that picks a winner — competition, raffle, airdrop, loot drop — asks
users to trust the backend. The more money follows, the bigger the trust gap.

VRE closes it. Rules are committed on-chain before resolution. Anyone can take the
transaction signature and replay the outcome from public RPC data.

| Without VRE | With VRE |
|---|---|
| Operator picks winner, posts TX | Rules committed on-chain before draw |
| Users trust the result | Anyone replays from public RPC data |
| No way to verify | `vre verify --sig <TX>` → `MATCH / OK` |

## How it works

VRE replays a Solana outcome from a transaction signature plus public RPC data:

- fetch the on-chain artifact via the signature,
- recompute the outcome locally using the committed rules,
- compare replayed result with the recorded outcome,
- expect `MATCH / OK`.

Canonical devnet program id:

- `6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B`
- Upgrade authority (devnet): a single operator key. Multisig governance is not
  used on devnet — it added ceremony without protecting real value while the
  protocol is still iterating.
- Live operator: Swig actor wallet `E8wB17KxBi89Noz74eypjbcrAJXhmPeA7e7oYHZSbjzf`; VPS delegate is scoped to the VRE program with a daily SOL spending limit.
- Mainnet governance is decided separately at mainnet time (multisig / immutable /
  timelock) — the devnet single-key simplification is **not** carried to mainnet.

## Resolution Paths

The protocol carries several resolution paths, all canonical on the devnet program
`6QtLot…`. Replay-by-signature stays the **default** path; the others are canonical
alternatives selected per draw.

| Path | Version | Status | What it is |
|------|---------|--------|------------|
| Replay-by-signature + global-Ω resolve | v1.3.2 | **canonical (default)** | Recompute an outcome locally from a tx signature; the default reviewer entry. |
| Sortition-by-Claim | v1.4.0 | **canonical** | Commit-reveal ticket draw; winners self-claim against an on-chain threshold. |
| Sortition economics | v1.4.1 | **canonical** | Optional entry fee / close-skim fee layer on a sortition draw. |
| Conditions (OddSol) | fc7/fv9 | **canonical · attestation-only** | Score committed prediction slips (odds × proven facts) → ranking; `resolve_conditions` proves S + winners, no fund custody. |
| Unicorn-G entropy source | B8 | **opt-in · research (setup pending)** | Alternative global-Ω entropy: VDF output verified on-chain via embedded Groth16. |

Notes:

- All paths run on the one canonical program `6QtLot…`; there is no separate isolated program.
- The default entropy source is SlotHashes. **Unicorn-G is opt-in** (selected explicitly
  per draw) and relies on a Groth16 trusted setup (devnet RSA modulus). A known soundness
  caveat remains (a composite `l` passes the in-circuit primality check) — Unicorn-G is
  research/opt-in only and **not** for mainnet until a multi-party ceremony and the sound
  circuit land.
- **Conditions** (fc7/fv9): live on `6QtLot` since **2026-07-03**; the off-chain scorer
  (`/api/conditions/score`) is byte-identical to on-chain `resolve_conditions`, and a live
  attestation replays to MATCH. VRE proves the winner ranking only; payout is pro-rata over
  winners and executed by the partner (no fund custody).
- Mainnet is a separate, later effort; these statuses describe the canonical **devnet** protocol.

Evidence for each path lives under `artifacts/public_evidence_summary.json` and is
summarized in `RUNBOOK.md` §6b–§6c.

### Resolution formats

global-Ω resolve / replay supports the following committed formats:

- `weighted_random` — weighted single- or multi-winner random selection
- `rank_desc` / `rank_asc` — top (or bottom) by score
- `closest_to` — nearest to a committed target value
- `composite_rank_desc` — multi-field weighted composite score, ranked descending
- `first_n` — first N entrants by registration order

Engine × use-case × monetization mapping is documented in
`agent-instructions/hub-memory/PRODUCT_MATRIX.md` (product SSOT).

## Protocol Versions & Changelog

**What changed after the hackathon.** The hackathon baseline was `rng_v1`/`rng_v2` resolve with
replay-by-signature over a set of blessed devnet signatures. Since then the protocol added
three canonical paths — Sortition-by-Claim (`v1.4.0`), an optional sortition economics fee
layer (`v1.4.1`), and the opt-in Unicorn-G entropy source (`B8`) — and on **2026-06-25** the
whole protocol was **promoted to the single canonical devnet program** `6QtLot…` (no separate
isolated program). Replay-by-signature stays the default; default entropy stays SlotHashes.

Versions live on **two axes**: the **randomness** (`rng_version`: v1 legacy → v2 current) and
the **artifact format / size tier** (compact for small–medium, Merkle *scale* for large). They
are independent — see [`CHANGELOG.md`](CHANGELOG.md) "Version model".

| Version | Path | rng | Status |
|---------|------|-----|--------|
| rng_v1 | operator-seed resolve (compact small/medium) | v1 | legacy · retained |
| **v1.2** | `settle_rng_v2` — single-phase future-slot-hash (simple random / casino) | v2 | **canonical** |
| v1.3.2 | global-Ω two-phase `seal → attest` / replay-by-signature | v2 | **canonical · default** |
| v1.4.0 | Sortition-by-Claim | v2 | **canonical** |
| v1.4.1 | Sortition economics (fee layer) | — | **canonical** |
| fc7/fv9 | Conditions (OddSol) — score committed slips → ranking (attestation-only) | — | **canonical** |
| B8 | Unicorn-G entropy source | v2 | **opt-in · research (setup pending)** |

Full history, per-path mechanics, and measured numbers (CU, negatives, distribution) live in
[`CHANGELOG.md`](CHANGELOG.md). Numbers are sourced from `artifacts/public_evidence_summary.json`.
Mainnet is a separate, later effort; these statuses describe the canonical **devnet** protocol.

## Outcome Standards

Two artifact standards are canonical:

- `Outcome Standard V1.1` — compact named-entry base. Internal
  `artifact_format_version=5` is audit/debug metadata. Measured compact boundary:
  pass at `103` entries / `8185` bytes; first overflow at `104` entries / `8264` bytes.
- `Outcome Standard V1.2` — large/public scale extension (Merkle snapshot). Product-facing
  replay uses `standard_version:"1.2"`; internal scale marker `6` is metadata only.

Reviewer-facing evidence bundle:

- `artifacts/public_evidence_summary.json`
- `artifacts/outcome_devnet_blessed_signatures.json`
- `artifacts/EXPECTED_TX_EXAMPLES.md`

## Live Examples

Four active signatures on the canonical devnet program — click any to verify:

- `Raffle` — weighted random, single winner
- `Rewards Selection` — multi-winner weighted random
- `Trading Competition` — `rank_desc`, top by score
- `Prediction Market` — `closest_to`, nearest prediction wins

All examples live at [verifiableoutcome.online/play](https://verifiableoutcome.online/play)

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
  --program-id 6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B
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
  --program-id 6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B \
  --json
```

Output includes `signature`. Pass it to the verifier:

```bash
yarn -s replay \
  --sig <signature from above> \
  --url https://api.devnet.solana.com \
  --program-id 6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B
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
For larger leaderboards, a chunked snapshot commit flow is available as a local-only first pass — see [INTEGRATION.md](./INTEGRATION.md#current-limitations) for details.

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
