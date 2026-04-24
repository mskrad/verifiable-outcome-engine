# Demo Runbook

Purpose: show Verifiable Outcome Engine as a raffle / winner-selection proof scenario using included devnet evidence.

## 1) Install

```bash
cd verifiable-outcome-engine
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

---

## Optional: Live Resolve Path

To generate a fresh on-chain outcome and verify it in one flow (requires funded devnet wallet):

```bash
# Step 1 — resolve a new outcome on-chain, capture signature
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
yarn -s resolve:operator \
  --url https://api.devnet.solana.com \
  --program-id 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq \
  --json

# Step 2 — replay the returned signature
yarn -s replay \
  --sig <signature> \
  --url https://api.devnet.solana.com \
  --program-id 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq
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
