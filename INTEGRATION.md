# Integration Guide — verifiable-outcome-sdk

## Roles

There are four distinct roles. Each requires a different level of access:

| Role | What they do | Wallet needed? | Repo clone? |
|------|-------------|----------------|-------------|
| **Verifier** | Verify any resolved outcome on-chain | No | No |
| **Builder** | Compile a config into a binary artifact locally | No | No |
| **Operator** | Resolve outcomes against an existing deployed program | Yes (program admin) | No |
| **Partner** | Own instance via partnership | Contact VRE team | Partner agreement |

> The npm package (`verifiable-outcome-sdk`) covers Verifier, Builder, and Operator roles.  
> The canonical Solana program (`3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`) is operated by the VRE team.
>
> The SDK does **not** deploy a new Solana program instance. It builds artifacts,
> resolves against an already deployed program, and verifies resolved outcomes.
> To deploy your own instance under a partner agreement, contact the VRE team.
>
> Verification is always free. The canonical program uses a protocol fee per
> `resolveOutcome`; partner instances can run with `fee_lamports = 0` under a
> commercial agreement.

### Protocol Fee

Each `resolveOutcome` call on the canonical program may collect a small protocol
fee from the operator wallet to the VRE treasury. The fee is configured in
`ProgramConfig.fee_lamports`.

**Current fee: 0 lamports** on devnet.

The fee can be updated by the VRE admin without a program upgrade. Verification
(`/api/replay`, SDK verify, and `verify.html`) is always free. Dedicated partner
instances can run with `fee_lamports = 0`; see [Part 4 — Partner Program](#part-4--partner-program).

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

> The canonical devnet program (`3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`) is operated by the VRE team and is subject to the protocol fee model. For a dedicated instance, see **Part 4 — Partner Program**.
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

## Part 4 — Partner Program

Large platforms, GameFi projects, and NFT marketplaces can run a dedicated VRE
program instance under a partner agreement.

### What a partner instance gives you

- Full control over your program ID and admin wallet.
- `fee_lamports = 0` for your dedicated deployment.
- A commercial agreement that covers program source access, deployment support,
  and operational terms.
- The same public verification flow: anyone can still run `vre verify` against
  your program ID.

### How to get one

Contact the VRE team at [hello@verifiableoutcome.online](mailto:hello@verifiableoutcome.online).
The team will coordinate source access, deployment, fee configuration, and the
program ID you should pass to the SDK/CLI.

### Use your partner program

After your partner instance is deployed and initialized, resolve against the
program ID provided by the VRE team:

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
You are calling `resolve` against a program that was initialized by a different wallet. Use the correct admin wallet for that program, or contact the VRE team for a partner instance and pass the provided `--program-id` (Part 4).

**`airdrop` fails / rate limit**  
Wait 30 seconds and retry, or use [faucet.solana.com](https://faucet.solana.com).

**`insufficient funds`**  
Run `solana balance`. If below 0.5 SOL, airdrop more: `solana airdrop 2`.

**`verification_result: MISMATCH`**  
On-chain data does not match local replay. Check that `--sig`, `--rpc`, and `--program-id` all match the transaction you are verifying.

**`could not determine executable to run`** (when using `npx verifiable-outcome-sdk`)  
The package binary is named `vre`. Use `vre` directly after `npm install -g verifiable-outcome-sdk`, or prefix with `npx -p verifiable-outcome-sdk vre`.
