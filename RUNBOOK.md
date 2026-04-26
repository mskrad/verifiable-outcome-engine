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
