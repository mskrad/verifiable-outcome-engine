# Integration Guide — verifiable-outcome-sdk

## Roles

There are four distinct roles. Each requires a different level of access:

| Role | What they do | Wallet needed? | Repo clone? |
|------|-------------|----------------|-------------|
| **Verifier** | Verify any resolved outcome on-chain | No | No |
| **Builder** | Compile a config into a binary artifact locally | No | No |
| **Operator** | Resolve outcomes against an existing deployed program | Yes (program admin) | No |
| **Program Owner** | Deploy their own instance of the Solana program | Yes (funded) | Yes |

> The npm package (`verifiable-outcome-sdk`) covers Verifier, Builder, and Operator roles.  
> The Solana program itself is open-source and lives in `programs/outcome/` — Program Owners must clone the repo and deploy it themselves.
>
> The SDK does **not** deploy a new Solana program instance. It builds artifacts,
> resolves against an already deployed program, and verifies resolved outcomes.
> To operate your own program ID, clone this repo, deploy `programs/outcome`
> with Anchor, then use the SDK/CLI with `--program-id`.

---

## Part 1 — Verifier

Anyone can verify any resolved outcome. No wallet, no setup beyond Node.js.

### Install

```bash
npm install -g verifiable-outcome-sdk
```

### Verify a transaction

```bash
vre verify \
  --sig mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh \
  --rpc https://api.devnet.solana.com
```

Or run without a global install:

```bash
npx -p verifiable-outcome-sdk vre verify \
  --sig mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh \
  --rpc https://api.devnet.solana.com
```

Expected output:

```
verification_result : MATCH
verification_reason : OK
program_id          : 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq
runtime_id          : 06695059d916d903a26087c0770533c5
compiled_artifact_hash : 4a3304a5...
outcome_id          : 3nafSu5G...
```

`MATCH` means the on-chain result matches an independent local replay. No trust required.

### Verify programmatically

```js
import { verifyOutcome } from "verifiable-outcome-sdk";

const result = await verifyOutcome({
  signature: "mUXwae...",
  rpcUrl: "https://api.devnet.solana.com",
});
console.log(result.status); // "MATCH"
```

---

## Part 2 — Builder

Build a binary artifact from a config file, without deploying anything on-chain.

### Create a config

```json
{
  "type": "raffle",
  "input_lamports": 10,
  "payout_lamports": 3,
  "participants": [
    { "address": "5RbvSHbSuo9CBjZLtw9RoP775KeqaJyMXkXNsb99AeR4", "weight": 1000 },
    { "address": "Aip3wC6UCgE5628ukFW6z3rDGDVTAXKDG4V3j15tPvEU", "weight": 1000 },
    { "address": "3nafSu5GVq9bDLAxCg2gPucT4Jzhi2Ybyy2QbhzTMFR9", "weight": 1000 }
  ]
}
```

**Fields:**
- `type` — `"raffle"` selects one winner by weighted random
- `input_lamports` — entry cost per participant (1 SOL = 1,000,000,000 lamports)
- `payout_lamports` — prize payout to the winner
- `participants` — Solana wallet addresses with weights (equal weight = equal chance)

### Build

```js
import { buildArtifact } from "verifiable-outcome-sdk";

const artifact = buildArtifact({
  type: "raffle",
  input_lamports: 10,
  payout_lamports: 3,
  participants: [
    { address: "5RbvSHbSuo9CBjZLtw9RoP775KeqaJyMXkXNsb99AeR4", weight: 1000 },
    { address: "Aip3wC6UCgE5628ukFW6z3rDGDVTAXKDG4V3j15tPvEU", weight: 1000 },
  ],
});
console.log(artifact.toString("hex"));
```

---

## Part 3 — Operator

Resolve outcomes on-chain against an **existing deployed program**. Requires the wallet that initialized that program (the program admin).

> The canonical devnet program (`3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`) is operated by the VRE team. To become your own operator, see **Part 4 — Program Owner**.
>
> `vre resolve` does not deploy a program. It commits an artifact and resolves
> against the program ID you provide.

### Prerequisites

**Install Solana CLI:**

```bash
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
solana --version
```

**Create or use your admin wallet:**

```bash
solana-keygen new --outfile ~/.config/solana/id.json
solana-keygen pubkey ~/.config/solana/id.json
```

**Fund the wallet (devnet):**

```bash
solana config set --url devnet
solana airdrop 2
solana balance
```

You need at least **1 SOL** to cover transaction fees and artifact storage.  
If `airdrop 2` is rate-limited, wait 30 seconds and retry, or use [faucet.solana.com](https://faucet.solana.com).

### Resolve via CLI

```bash
vre resolve \
  --config raffle.config.json \
  --wallet ~/.config/solana/id.json \
  --rpc https://api.devnet.solana.com \
  --program-id <YOUR_PROGRAM_ID> \
  --json
```

This command:
1. Compiles the config into a binary artifact
2. Uploads the artifact on-chain (pre-commits the rules)
3. Submits the resolution transaction
4. Returns the transaction signature

Expected output:

```json
{ "signature": "5Kj3..." }
```

### Verify the result

```bash
vre verify \
  --sig <SIGNATURE_FROM_ABOVE> \
  --rpc https://api.devnet.solana.com \
  --program-id <YOUR_PROGRAM_ID>
```

### Resolve programmatically

```js
import { resolveOperator } from "verifiable-outcome-sdk";

const { signature } = await resolveOperator({
  configPath: "./raffle.config.json",
  walletPath: "~/.config/solana/id.json",
  rpcUrl: "https://api.devnet.solana.com",
  programId: "<YOUR_PROGRAM_ID>",
});
console.log("TX:", signature);
```

---

## Part 4 — Program Owner

Deploy your own instance of the Solana program so you control the admin wallet.

### Prerequisites

- [Rust](https://rustup.rs)
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) v0.32+
- Solana CLI + funded devnet wallet (see Part 3 prerequisites)

### Clone the repo

```bash
git clone https://github.com/mskrad/verifiable-outcome-engine
cd verifiable-outcome-engine
yarn install
```

### Generate a new program keypair

```bash
solana-keygen new --outfile target/deploy/outcome-keypair.json
solana address -k target/deploy/outcome-keypair.json
```

Copy the printed address — this will be your program ID.

### Update the program ID in two places

**`Anchor.toml`** — replace both `localnet` and `devnet` entries:

```toml
[programs.localnet]
outcome = "<YOUR_PROGRAM_ID>"

[programs.devnet]
outcome = "<YOUR_PROGRAM_ID>"
```

**`programs/outcome/src/lib.rs`** — update the `declare_id!` macro:

```rust
declare_id!("<YOUR_PROGRAM_ID>");
```

### Build and deploy

```bash
anchor build
anchor deploy --provider.cluster devnet
```

Anchor will use `target/deploy/outcome-keypair.json` as the program authority.

### Use your program

The first `vre resolve` against a fresh program ID will automatically call `initializeProgramConfig` and set your wallet as the admin.

```bash
vre resolve \
  --config raffle.config.json \
  --wallet ~/.config/solana/id.json \
  --rpc https://api.devnet.solana.com \
  --program-id <YOUR_PROGRAM_ID> \
  --json
```

```bash
vre verify \
  --sig <SIGNATURE> \
  --rpc https://api.devnet.solana.com \
  --program-id <YOUR_PROGRAM_ID>
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

**`ProgramConfig admin mismatch`**  
You are calling `resolve` against a program that was initialized by a different wallet. Use the correct admin wallet for that program, or operate your own program instance by cloning this repo, deploying `programs/outcome` with Anchor, then passing `--program-id` (Part 4).

**`airdrop` fails / rate limit**  
Wait 30 seconds and retry, or use [faucet.solana.com](https://faucet.solana.com).

**`insufficient funds`**  
Run `solana balance`. If below 0.5 SOL, airdrop more: `solana airdrop 2`.

**`verification_result: MISMATCH`**  
On-chain data does not match local replay. Check that `--sig`, `--rpc`, and `--program-id` all match the transaction you are verifying.

**`could not determine executable to run`** (when using `npx verifiable-outcome-sdk`)  
The package binary is named `vre`. Use `vre` directly after `npm install -g verifiable-outcome-sdk`, or prefix with `npx -p verifiable-outcome-sdk vre`.
