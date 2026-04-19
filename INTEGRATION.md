# Integration Guide — verifiable-outcome-sdk

This guide walks you through the full operator flow from zero:
create a wallet, fund it on devnet, deploy an outcome on-chain, and verify the result — using only the npm package.

**No repo clone required.**

---

## Requirements

- Node.js v18+
- npm v9+

---

## Step 1 — Install Solana CLI

```bash
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
```

Verify:

```bash
solana --version
```

---

## Step 2 — Create a wallet

```bash
solana-keygen new --outfile ~/.config/solana/id.json
```

You will be asked for an optional passphrase — press Enter to skip.

Check your public key:

```bash
solana-keygen pubkey ~/.config/solana/id.json
```

---

## Step 3 — Switch to devnet and get free SOL

```bash
solana config set --url devnet
solana airdrop 2
solana balance
```

You need at least **1 SOL** to deploy an outcome on-chain.  
If `airdrop 2` fails (rate limit), wait 30 seconds and try again, or run `solana airdrop 1` twice.

---

## Step 4 — Install the SDK

```bash
npm install -g verifiable-outcome-sdk
```

Verify the CLI is available:

```bash
vre --help
```

---

## Step 5 — Quick verify (no wallet needed)

Test that the package works by verifying a known devnet transaction:

```bash
vre verify \
  --sig mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh \
  --rpc https://api.devnet.solana.com
```

Expected output:

```
verification_result : MATCH
verification_reason : OK
program_id          : 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq
runtime_id          : 06695059d916d903a26087c0770533c5
...
```

---

## Step 6 — Create a raffle config

Create a new directory and a config file:

```bash
mkdir my-raffle && cd my-raffle
```

Create `raffle.config.json`:

```json
{
  "type": "raffle",
  "input_lamports": 10,
  "payout_lamports": 3,
  "participants": [
    { "address": "5RbvSHbSuo9CBjZLtw9RoP775KeqaJyMXkXNsb99AeR4", "weight": 1000 },
    { "address": "Aip3wC6UCgE5628ukFW6z3rDGDVTAXKDG4V3j15tPvEU", "weight": 1000 },
    { "address": "3nafSu5GVq9bDLAxCg2gPucT4Jzhi2Ybyy2QbhzTMFR9", "weight": 1000 },
    { "address": "ABKKERBB9i7MvSbB5s9h6EphiCvXa4FvNDmxWFSdHZqY", "weight": 1000 },
    { "address": "5a38vhRuQhKPQwRQFcgDAw3SYNQcGo7XKuWyvFDK5xjP", "weight": 1000 },
    { "address": "9KpwjbCV3kF8x3puk4fUKa5UTToGSg6giaLQkYFP1J8r", "weight": 1000 },
    { "address": "BKo2rXwCgPTtwkNcFV5E7G9SxYW6wByDzSbswhR6oNa4", "weight": 1000 }
  ]
}
```

**Fields:**
- `type` — outcome type, `"raffle"` selects one winner by weighted random
- `input_lamports` — entry cost per participant (in lamports, 1 SOL = 1,000,000,000 lamports)
- `payout_lamports` — prize payout to the winner
- `participants` — list of Solana wallet addresses with weights (equal weight = equal chance)

---

## Step 7 — Deploy and resolve on-chain

```bash
vre resolve \
  --config raffle.config.json \
  --wallet ~/.config/solana/id.json \
  --rpc https://api.devnet.solana.com \
  --json
```

This command:
1. Compiles your config into a binary artifact
2. Deploys the artifact on-chain (pre-commits the rules)
3. Submits the resolution transaction
4. Returns the transaction signature

Expected output:

```json
{ "signature": "5Kj3..." }
```

Copy the signature — you will use it in the next step.

---

## Step 8 — Verify your own transaction

```bash
vre verify \
  --sig <PASTE_SIGNATURE_HERE> \
  --rpc https://api.devnet.solana.com
```

Expected output:

```
verification_result : MATCH
verification_reason : OK
```

`MATCH` means: the on-chain result matches an independent local replay of your config. The outcome is provably fair.

---

## Using the SDK programmatically

```bash
npm install verifiable-outcome-sdk
```

```js
import { verifyOutcome, buildArtifact, resolveOperator } from "verifiable-outcome-sdk";

// Verify a known transaction
const result = await verifyOutcome({
  signature: "5Kj3...",
  rpcUrl: "https://api.devnet.solana.com",
});
console.log(result.status); // "MATCH"

// Build artifact from config (without deploying)
const artifact = await buildArtifact({
  configPath: "./raffle.config.json",
});

// Full operator flow: deploy + resolve
const { signature } = await resolveOperator({
  configPath: "./raffle.config.json",
  walletPath: "~/.config/solana/id.json",
  rpcUrl: "https://api.devnet.solana.com",
});
console.log("TX:", signature);
```

---

## CLI reference

```
vre verify
  --sig <TX_SIG>         Transaction signature to verify
  --rpc <URL>            RPC endpoint (default: https://api.devnet.solana.com)
  --program-id <PUBKEY>  Program ID (default: 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq)
  --json                 Output as JSON

vre resolve
  --config <PATH>        Path to raffle.config.json
  --wallet <PATH>        Path to Solana keypair JSON file
  --rpc <URL>            RPC endpoint (default: https://api.devnet.solana.com)
  --program-id <PUBKEY>  Program ID (default: 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq)
  --out-dir <DIR>        Directory to write result artifacts (default: ./tmp)
  --json                 Output as JSON
```

---

## Troubleshooting

**`airdrop` fails**  
Devnet faucet has rate limits. Wait 30 seconds and retry, or use [faucet.solana.com](https://faucet.solana.com).

**`insufficient funds`**  
Run `solana balance`. If below 0.5 SOL, airdrop more: `solana airdrop 2`.

**`verification_result: MISMATCH`**  
The on-chain data does not match local replay. This should not happen with a freshly resolved outcome — check that you are using the correct `--sig` and `--rpc`.

**`could not determine executable to run`** (with `npx verifiable-outcome-sdk`)  
The package binary is named `vre`, not `verifiable-outcome-sdk`. Use `vre` directly after `npm install -g verifiable-outcome-sdk`, or use `npx -p verifiable-outcome-sdk vre`.
