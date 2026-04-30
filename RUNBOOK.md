# Runbook (Bounded Public Reviewer Flow)

## 1) Install + launch

```bash
cd verifiable-outcome-engine
yarn install
yarn web
```

Optional: copy `.env.example` to `.env` to override defaults. Not required — server starts without it.

## 2) Open pages

- Reviewer flow: `http://127.0.0.1:8787/play.html`
- Verify: `http://127.0.0.1:8787/verify.html`
- Widget: `http://127.0.0.1:8787/widget.html`
- Spec / Evidence: `http://127.0.0.1:8787/spec.html`

## 3) Web reviewer flow

1. Open `play.html`.
2. Choose one active blessed signature.
3. Open `verify.html` from the provided link.
4. Run replay.
5. Expect:
   - `verification_result : MATCH`
   - `verification_reason : OK`

## 4) CLI equivalent

```bash
cd verifiable-outcome-engine
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
yarn -s replay \
  --sig 3iC7i15CakPWD47DZ72WgYYuKQdPW8qwu2Usy77rm8RjKkvocvELHqN1yMqM4MiXLcpiAb52u6z2btMKCAZsmDW1 \
  --url https://api.devnet.solana.com \
  --program-id 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq
```

## 5) Embedded widget equivalent

For a known transaction signature:

```html
<script src="https://verifiableoutcome.online/widget.js"></script>
<vre-verify
  sig="YOUR_TX_SIGNATURE"
  rpc="https://api.devnet.solana.com"
  program-id="YOUR_PROGRAM_ID">
</vre-verify>
```

For a paste-your-own-signature form:

```html
<script src="https://verifiableoutcome.online/widget.js"></script>
<vre-verify-form></vre-verify-form>
```

## 6) Acceptance boundary

This runbook is packaging-only and reviewer-oriented.

It does not require:

- `examples/*`
- `core/contracts/*`
- localnet historical sample signatures
- adapters code

## 7) Program upgrade authority

The canonical devnet program upgrade authority is held by a Squads multisig:

- Program: `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
- Squads multisig: `7jtA1fkZNrg7ZntGQtpXtAi9JxZEzgRjGRuGvdScZQqQ`
- Threshold: `1-of-1` for the hackathon devnet demo
- Member: `ESjxDsMvG2SkPpK1FdcD6Lce4RUfMM8Bvg6sfFBUsXkT`

Verify the current authority:

```bash
solana program show 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq \
  --url https://api.devnet.solana.com
```

Expected authority:

```text
Authority: 7jtA1fkZNrg7ZntGQtpXtAi9JxZEzgRjGRuGvdScZQqQ
```

Future upgrades should be proposed and approved through Squads governance, then executed after the multisig threshold is met. ProgramConfig admin is intentionally separate from upgrade authority and is controlled by the configured operator path.

### How to upgrade the program via Squads

**Step 1 — Build new program binary**
```bash
anchor build
# output: target/deploy/outcome.so
```

**Step 2 — Write the buffer**

Upload the new binary to a buffer account (does not affect the live program yet):
```bash
solana program write-buffer target/deploy/outcome.so \
  --keypair ~/.config/solana/esjx.json \
  --url https://api.devnet.solana.com
# outputs: Buffer: <BUFFER_ADDRESS>
```

**Step 3 — Set buffer authority to the Squads multisig**

The buffer must be owned by the Squads PDA before it can be used in a proposal:
```bash
solana program set-buffer-authority <BUFFER_ADDRESS> \
  --new-buffer-authority 7jtA1fkZNrg7ZntGQtpXtAi9JxZEzgRjGRuGvdScZQqQ \
  --keypair ~/.config/solana/esjx.json \
  --url https://api.devnet.solana.com
```

**Step 4 — Create upgrade proposal via Squads CLI**
```bash
squads-multisig-cli program-upgrade \
  --multisig 7jtA1fkZNrg7ZntGQtpXtAi9JxZEzgRjGRuGvdScZQqQ \
  --program-id 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq \
  --buffer <BUFFER_ADDRESS> \
  --spill-address ESjxDsMvG2SkPpK1FdcD6Lce4RUfMM8Bvg6sfFBUsXkT \
  --keypair ~/.config/solana/esjx.json \
  --url https://api.devnet.solana.com
# outputs: Transaction index: <INDEX>
```

**Step 5 — Approve the proposal**
```bash
squads-multisig-cli transaction approve \
  --multisig 7jtA1fkZNrg7ZntGQtpXtAi9JxZEzgRjGRuGvdScZQqQ \
  --transaction-index <INDEX> \
  --keypair ~/.config/solana/esjx.json \
  --url https://api.devnet.solana.com
```

**Step 6 — Execute**
```bash
squads-multisig-cli transaction execute \
  --multisig 7jtA1fkZNrg7ZntGQtpXtAi9JxZEzgRjGRuGvdScZQqQ \
  --transaction-index <INDEX> \
  --keypair ~/.config/solana/esjx.json \
  --url https://api.devnet.solana.com
```

**Step 7 — Verify**
```bash
solana program show 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq \
  --url https://api.devnet.solana.com
# Authority should still be 7jtA1fkZNrg7ZntGQtpXtAi9JxZEzgRjGRuGvdScZQqQ
# Last Deployed In Slot should be updated
```

### Alternatively — Squads web UI

Open https://squads.so/multisig and connect `esjx.json` wallet (devnet). The multisig `7jtA1fkZNrg7ZntGQtpXtAi9JxZEzgRjGRuGvdScZQqQ` will appear in your dashboard. Create → Program Upgrade proposal, paste buffer address, approve, execute.

### Key addresses

| Name | Address |
|---|---|
| Program | `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq` |
| Squads multisig PDA | `7jtA1fkZNrg7ZntGQtpXtAi9JxZEzgRjGRuGvdScZQqQ` |
| Member / operator key | `ESjxDsMvG2SkPpK1FdcD6Lce4RUfMM8Bvg6sfFBUsXkT` |
| ProgramConfig admin | `E8wB17KxBi89Noz74eypjbcrAJXhmPeA7e7oYHZSbjzf` (Swig actor wallet, separate from upgrade authority) |
| Evidence | `artifacts/squads_multisig_evidence.json` |

## 8) Swig operator setup

Honest claim: VPS server key is Swig-delegated, scoped to VRE program with daily SOL spending limit. Admin keypair (esjx.json) kept offline.

Create a delegate keypair for the VPS:

```bash
solana-keygen new \
  --no-bip39-passphrase \
  --outfile ~/.config/solana/vre-swig-delegate.json
```

Create the Swig wallet and delegate role on devnet:

```bash
cd verifiable-outcome-engine
ROOT_KEYPAIR=~/.config/solana/esjx.json \
SWIG_DELEGATE_KEYPAIR=~/.config/solana/vre-swig-delegate.json \
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
VRE_PROGRAM_ID=3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq \
yarn -s swig:operator:create
```

For production cutover of the live raffle operator, also move ProgramConfig admin to the Swig wallet during setup:

```bash
cd verifiable-outcome-engine
ROOT_KEYPAIR=~/.config/solana/esjx.json \
SWIG_DELEGATE_KEYPAIR=~/.config/solana/vre-swig-delegate.json \
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
VRE_PROGRAM_ID=3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq \
SWIG_TRANSFER_PROGRAM_CONFIG_ADMIN=1 \
yarn -s swig:operator:create
```

If the Swig account already exists and you only need to add a corrected delegate policy, pass `EXISTING_SWIG_ADDRESS=<SWIG_ACCOUNT_ADDRESS>`.

The script prints:

```text
SWIG_WALLET_ADDRESS=<SWIG_ACCOUNT_ADDRESS>
SWIG_ROLE_ID=<DELEGATE_ROLE_ID>
```

Set these on the VPS:

```bash
SWIG_WALLET_ADDRESS=<SWIG_ACCOUNT_ADDRESS>
SWIG_DELEGATE_KEYPAIR=/path/to/vre-swig-delegate.json
SWIG_ROLE_ID=<DELEGATE_ROLE_ID>
```

Without `SWIG_WALLET_ADDRESS` and `SWIG_DELEGATE_KEYPAIR`, the server keeps the raw keypair fallback path:

```bash
LIVE_RAFFLE_WALLET=~/.config/solana/esjx.json
```

Evidence is written to `artifacts/swig_operator_evidence.json` after setup and updated after a successful live raffle replay.

The active policy uses `programLimit` for the VRE program and `solRecurringLimit` for the daily SOL cap. Swig `programScopeRecurringLimit` is target-account scoped in SDK `1.9.1`, so it is not used for the live raffle flow that creates and writes multiple VRE accounts.

## 9) Vanish private payout (optional)

After a VRE draw, the operator can route the winner payout through [Vanish](https://core.vanish.trade) to break the on-chain link between the operator treasury and the winner wallet. The VRE selection remains fully public and verifiable; only the payment path is private.

**Required env var:**

```bash
VANISH_API_KEY=<your-vanish-api-key>
```

Obtain your API key from the [Vanish hackathon dashboard](https://core.vanish.trade) or by emailing Vanish.

**Optional:**

```bash
VANISH_PAYOUT_LAMPORTS=100000   # lamports to route per payout; default 100000 (0.0001 SOL)
```

When `VANISH_API_KEY` is set, each successful `/api/live-raffle` response will include:

```json
{
  "vanish_deposit_tx": "<operator→Vanish pool tx>",
  "vanish_tx": "<Vanish→winner tx>"
}
```

If Vanish is unavailable or the payout fails, the raffle result is still returned — Vanish is non-fatal.

**Standalone payout script:**

```bash
# Real payout (requires VANISH_API_KEY or --api-key):
VANISH_API_KEY=<key> \
ANCHOR_WALLET=~/.config/solana/esjx.json \
ts-node scripts/vanish_payout.ts \
  --winner <winner_address> \
  --amount 100000 \
  --sig <vre_resolve_sig>

# Mock mode (no API key, no funds moved — writes evidence with "mock": true):
VANISH_MOCK=true \
ts-node scripts/vanish_payout.ts \
  --winner <winner_address> \
  --amount 100000 \
  --sig <vre_resolve_sig>
```

Evidence is written to `artifacts/vanish_integration_evidence.json` with:
- `vre_resolve_sig` — VRE resolve transaction (public, verifiable)
- `vanish_deposit_tx` — operator → Vanish pool transfer
- `vanish_withdraw_tx` — Vanish → winner transfer
- `mock: true` if run in mock mode

## 11) Partner Draw API

`POST /api/partner/draw` lets B2B partners submit a participant list and receive a verifiable on-chain transaction signature. The draw runs against the canonical devnet program using the operator wallet (same as `/api/live-raffle`).

**Requirements:**

- Header: `x-api-key: vresk_...` (existing partner key)
- `"draw_enabled": true` in the partner's entry in `config/partners.json`

To enable draws for a partner, edit `config/partners.json`:

```json
{
  "key": "vresk_...",
  "name": "Partner Name",
  "tier": 1,
  "created": "2026-04-28",
  "draw_enabled": true
}
```

**Example request:**

```bash
curl -s -X POST https://verifiableoutcome.online/api/partner/draw \
  -H "Content-Type: application/json" \
  -H "x-api-key: vresk_YOUR_KEY" \
  -d '{"participants":["<addr1>","<addr2>","<addr3>"],"winners_count":1,"label":"Campaign #1"}'
```

**Response codes:**

| Code | Meaning |
|------|---------|
| `200` | Draw completed; `signature`, `outcome_id`, `outcome_ids`, `replay_url`, `artifact_slot`, `resolution_slot` returned |
| `400` | Validation error (bad participants, duplicate addresses, invalid `winners_count`, bad `use_case`) |
| `401` | Missing or unknown API key |
| `403` | Partner key valid but `draw_enabled` is not `true` |
| `429` | Rate limit exceeded; one draw per partner key per 60 s |
| `504` | Devnet timeout; retry |

## 10) Partner API keys for `/api/resolutions` and `/api/participant`

These two endpoints are partner-only and require:

- header: `x-api-key: vresk_...`
- local file: `config/partners.json`

Bootstrap the config:

```bash
cd /Users/timurkurmangaliev/verifiable-outcome-engine
mkdir -p config
cp config/partners.json.example config/partners.json
```

Then edit `config/partners.json` and restart the server.

Example request:

```bash
curl -s http://127.0.0.1:8787/api/resolutions?limit=3 \
  -H 'x-api-key: vresk_4a3304a5cb2804331078c6e09b687fdb'
```

Expected behavior:

- missing key → HTTP `401`
- unknown key → HTTP `401`
- missing `config/partners.json` → HTTP `503`
- valid key from `config/partners.json` → HTTP `200`
