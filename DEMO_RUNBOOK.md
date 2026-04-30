# Demo Runbook

Purpose: show Verifiable Outcome Engine against the current canonical devnet program, active blessed signatures, and native W3O1 v3 formulas.

## 1) Install

```bash
cd verifiable-outcome-engine
yarn install
```

## 2) Pick an included devnet signature

Use one active signature from:

- `artifacts/outcome_devnet_blessed_signatures.json`
- `artifacts/EXPECTED_TX_EXAMPLES.md`

Default demo signature:

```text
5wZUU5YQ8Nu5RddNeEEigYUEM5Q45C2SJmwLgdLhQcLQi4S3vYhAUvLc6YchYnxqU5b1pvEsBSD1USZPPDEaRVd2
```

Other active examples:

- `3F5UeDYgfsg4NhsucruqUbCTSd8YJjDjnGZuDMVunbVL9yAVDmf39Ace8gUMmoginoJ6fFiczNhDUZnYvQDhBFnN` — `Rewards Selection`
- `4Ge4ggoRaT5nCQbdZXr51AU3sPPfuPeJgExLziy2HNtQ85AEhMMxDaazUs4ZCnPEckcHP8UuJ8vnTaBCaqJizT8o` — `Trading Competition` (`rank_desc`)
- `3XxRQhYvzakKdX7uwi4wN5YKGu5Mdm8oGwSoLr8GiAFDWYcEEyxPAVkTNJZe1AV9gbsFpbWFauHWQakYR2SFEw8G` — `Prediction Market` (`closest_to`, target `22450`)

## 3) Replay from public RPC data

```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
yarn -s replay \
  --sig 5wZUU5YQ8Nu5RddNeEEigYUEM5Q45C2SJmwLgdLhQcLQi4S3vYhAUvLc6YchYnxqU5b1pvEsBSD1USZPPDEaRVd2 \
  --url https://api.devnet.solana.com \
  --program-id 9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F
```

## 4) Expected result

Expected terminal lines:

- `verification_result : MATCH`
- `verification_reason : OK`

If devnet RPC is unavailable, retry later or use another active signature from `artifacts/outcome_devnet_blessed_signatures.json`.

---

## Optional: Live Resolve Path

To generate a fresh on-chain outcome and verify it in one flow (requires funded devnet wallet):

```bash
# Step 1 — resolve a new outcome on-chain, capture signature
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
yarn -s resolve:operator \
  --url https://api.devnet.solana.com \
  --program-id 9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F \
  --json

# Step 2 — replay the returned signature
yarn -s replay \
  --sig <signature> \
  --url https://api.devnet.solana.com \
  --program-id 9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F
```

Expected: `verification_result : MATCH` / `verification_reason : OK`

This path demonstrates the operator cycle against an existing deployed program: commit rules on-chain → resolve → independently verify.

---

## Optional: Metaplex Agent Registry Evidence

VRE verifier is registered on Solana devnet as a Metaplex Agent Identity.

```text
Agent asset: C3qM2VVxR5dyjzqEvv9qHaaUDfTDneEaJCMTKV9bxQLX
Mint tx: 429YX7c7p7RhZM3vrypCDXXBvPBsoPfXHyiLDLmjNVWXKHX8VeboDiecmu48vRkX9cGSiVQZUnnV9Rjk1PxUowjj
Evidence: artifacts/metaplex_agent_registry_evidence.json
```

To re-check the registry evidence:

```bash
METAPLEX_AGENT_RPC_URL=https://api.devnet.solana.com \
METAPLEX_AGENT_NETWORK=solana-devnet \
METAPLEX_AGENT_URI=https://verifiableoutcome.online/agents/vre-outcome-verification-agent.json \
yarn -s metaplex:agent:verify \
  --asset C3qM2VVxR5dyjzqEvv9qHaaUDfTDneEaJCMTKV9bxQLX
```

Expected: AgentIdentity plugin present, lifecycle checks truthy, registration URI valid JSON, and VRE replay `MATCH / OK`.

---

## Optional: Embedded Widget Path

To show verification directly inside another page, use the public widget script.

For a fixed transaction signature:

```html
<script src="https://verifiableoutcome.online/widget.js"></script>
<vre-verify
  sig="YOUR_TX_SIGNATURE"
  rpc="https://api.devnet.solana.com"
  program-id="YOUR_PROGRAM_ID">
</vre-verify>
```

For a paste-your-own-signature flow:

```html
<script src="https://verifiableoutcome.online/widget.js"></script>
<vre-verify-form></vre-verify-form>
```

The local demo page is available at:

```text
http://127.0.0.1:8787/widget.html
```
