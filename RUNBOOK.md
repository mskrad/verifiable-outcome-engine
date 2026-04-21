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
