/**
 * Vanish private payout — routes SOL from operator treasury to winner
 * via Vanish Core API, breaking the on-chain link.
 *
 * Usage:
 *   ts-node scripts/vanish_payout.ts \
 *     --winner <address> \
 *     --amount <lamports> \
 *     --sig <vre_resolve_sig> \
 *     --api-key <key>
 *
 * Mock mode (no API key required):
 *   VANISH_MOCK=true ts-node scripts/vanish_payout.ts \
 *     --winner <address> \
 *     --amount <lamports> \
 *     --sig <vre_resolve_sig>
 */

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { vanishPayoutRoute } from "../sdk/vanish.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const DEFAULT_RPC = "https://api.devnet.solana.com";
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOLANA_SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/;

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = "true";
      }
    }
  }
  return args;
}

function requireArg(args: Record<string, string>, key: string): string {
  const v = args[key];
  if (!v) throw new Error(`Missing required argument: --${key}`);
  return v;
}

function loadKeypair(walletPath: string): Keypair {
  const expanded = walletPath.startsWith("~")
    ? path.join(os.homedir(), walletPath.slice(1))
    : walletPath;
  const raw = JSON.parse(fs.readFileSync(expanded, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function mockTxSig(): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let s = "";
  for (let i = 0; i < 88; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function getVreWinner(
  connection: Connection,
  sig: string
): Promise<string | undefined> {
  const tx = await connection.getTransaction(sig, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  if (!tx) return undefined;
  // VRE emits OutcomeResolved event in logs: "Program log: OutcomeResolved ... outcome_id: <addr>"
  const logs = tx.meta?.logMessages ?? [];
  for (const log of logs) {
    const m = log.match(/outcome_id[:=]\s*([1-9A-HJ-NP-Za-km-z]{32,44})/);
    if (m) return m[1];
  }
  return undefined;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mockMode = process.env.VANISH_MOCK === "true" || args["mock"] === "true";

  const winner = requireArg(args, "winner");
  const amountStr = requireArg(args, "amount");
  const vreSig = requireArg(args, "sig");

  if (!SOLANA_ADDRESS_RE.test(winner)) {
    throw new Error(`Invalid winner address: ${winner}`);
  }
  if (!SOLANA_SIGNATURE_RE.test(vreSig)) {
    throw new Error(`Invalid VRE signature: ${vreSig}`);
  }
  const amountLamports = BigInt(amountStr);
  if (amountLamports <= 0n) throw new Error("Amount must be > 0");

  const rpcUrl =
    args["rpc"] ||
    process.env.ANCHOR_PROVIDER_URL ||
    process.env.LIVE_RAFFLE_RPC_URL ||
    DEFAULT_RPC;
  const programId =
    args["program-id"] ||
    process.env.LIVE_RAFFLE_PROGRAM_ID ||
    process.env.PROGRAM_ID ||
    "9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F";

  const connection = new Connection(rpcUrl, "confirmed");

  // Verify VRE resolve sig and check winner matches outcome
  console.log(`Fetching VRE resolve tx: ${vreSig}`);
  const resolvedWinner = await getVreWinner(connection, vreSig);
  if (resolvedWinner) {
    if (resolvedWinner !== winner) {
      throw new Error(
        `Winner mismatch: on-chain outcome_id is ${resolvedWinner}, but --winner is ${winner}`
      );
    }
    console.log(`VRE outcome confirmed: ${resolvedWinner}`);
  } else {
    console.warn(
      "Warning: could not extract outcome_id from VRE tx logs — proceeding without on-chain winner check"
    );
  }

  let depositTx: string;
  let withdrawTx: string;
  let isMock = false;

  if (mockMode) {
    console.log("VANISH_MOCK=true — writing mock evidence (no real API call)");
    depositTx = mockTxSig();
    withdrawTx = mockTxSig();
    isMock = true;
  } else {
    const apiKey = args["api-key"] || process.env.VANISH_API_KEY || "";
    if (!apiKey) {
      throw new Error(
        "Vanish API key required. Pass --api-key <key> or set VANISH_API_KEY env var. " +
        "For testing without a key, set VANISH_MOCK=true."
      );
    }

    const walletPath =
      args["wallet"] ||
      process.env.LIVE_RAFFLE_WALLET ||
      process.env.ANCHOR_WALLET ||
      "~/.config/solana/id.json";

    // Validate winner is a real PublicKey before spending SOL
    new PublicKey(winner);

    console.log(`Routing ${amountLamports} lamports → ${winner} via Vanish`);
    const operatorKeypair = loadKeypair(walletPath);
    const result = await vanishPayoutRoute({
      apiKey,
      amountLamports,
      winnerAddress: winner,
      operatorKeypair,
      rpcUrl,
      baseUrl: args["base-url"] || process.env.VANISH_BASE_URL,
    });
    depositTx = result.depositTx;
    withdrawTx = result.withdrawTx;
  }

  const evidence = {
    vre_resolve_sig: vreSig,
    winner_address: winner,
    amount_lamports: amountLamports.toString(),
    vanish_deposit_tx: depositTx,
    vanish_withdraw_tx: withdrawTx,
    program_id: programId,
    rpc_url: rpcUrl,
    network: rpcUrl.includes("devnet") ? "devnet" : "mainnet",
    mock: isMock || undefined,
    timestamp: new Date().toISOString(),
  };

  const outPath = path.join(REPO_ROOT, "artifacts", "vanish_integration_evidence.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2));

  console.log("\nVanish payout complete.");
  if (isMock) console.log("  (mock mode — no real funds moved)");
  console.log(`  deposit_tx  : ${depositTx}`);
  console.log(`  withdraw_tx : ${withdrawTx}`);
  console.log(`  evidence    : ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
