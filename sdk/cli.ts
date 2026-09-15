#!/usr/bin/env node

import { verifyOutcome } from "./verify.js";
import { DEFAULT_PROGRAM_ID, DEFAULT_RPC_URL } from "./internals.js";

const PUBLIC_DEVNET_RPC = "https://api.devnet.solana.com";

type CliArgs = Record<string, string | boolean>;

function parseArgs(argv: string[]): { command?: string; args: CliArgs } {
  const [command, ...rest] = argv;
  const args: CliArgs = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--json" || arg === "--help" || arg === "-h") {
      args[arg.replace(/^-+/, "")] = true;
      continue;
    }
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = rest[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    args[key] = value;
    i += 1;
  }
  return { command, args };
}

function printHelp(): void {
  process.stdout.write(`vre — replay a VRE outcome from public Solana data

Usage:
  vre verify --sig <TX_SIGNATURE> [--rpc <URL>] [--program-id <ID>] [--snapshot-file <PATH>] [--snapshot-mirror <URL,...>] [--json]

Options:
  --sig         transaction signature of the resolution
  --rpc         Solana RPC URL (default: ANCHOR_PROVIDER_URL, SOLANA_RPC_URL or ${PUBLIC_DEVNET_RPC})
  --program-id  VRE program id (default: ${DEFAULT_PROGRAM_ID})
  --snapshot-file    local copy of a snapshot draw's participant list, used if its hash matches
  --snapshot-mirror  comma-separated hash-addressed mirrors (<url>/sha256/<hash>.jsonl)
  --json        print the full result as JSON

Exit code is 0 on MATCH and 1 otherwise.
`);
}

function printVerifyResult(result: Awaited<ReturnType<typeof verifyOutcome>>, asJson: boolean): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const lines: Array<[string, unknown]> = [
    ["verification_result", result.status],
    ["verification_reason", result.reason],
    ["outcome_id", result.outcome_id],
    ["outcome_ids", result.outcome_ids?.join(",")],
    ["winners_count", result.winners_count],
    ["resolution_formula", result.resolution_formula],
    ["rng_version", result.rng_version],
    ["entropy_source", result.entropy_source],
    ["target_slots", result.target_slots?.join(",")],
    ["resolved_slots", result.resolved_slots?.join(",")],
  ];
  for (const [label, value] of lines) {
    if (value === undefined || value === null || value === "") continue;
    process.stdout.write(`${label.padEnd(20)}: ${value}\n`);
  }
}

async function runVerify(args: CliArgs): Promise<void> {
  const signature = args.sig as string | undefined;
  if (!signature) {
    throw new Error("Provide --sig <TX_SIGNATURE>");
  }
  const result = await verifyOutcome({
    signature,
    rpcUrl:
      (args.rpc as string | undefined) ??
      (args.url as string | undefined) ??
      process.env.ANCHOR_PROVIDER_URL ??
      (DEFAULT_RPC_URL || PUBLIC_DEVNET_RPC),
    programId: (args["program-id"] as string | undefined) ?? DEFAULT_PROGRAM_ID,
    ...(args["snapshot-file"] ? { snapshotFile: args["snapshot-file"] as string } : {}),
    ...(args["snapshot-mirror"]
      ? { snapshotMirrors: String(args["snapshot-mirror"]).split(",").map((v) => v.trim()).filter(Boolean) }
      : {}),
  });
  printVerifyResult(result, Boolean(args.json));
  if (result.status !== "MATCH") {
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (!command || command === "--help" || command === "-h" || command === "help" || args.help || args.h) {
    printHelp();
    return;
  }
  if (command === "verify") {
    await runVerify(args);
    return;
  }
  throw new Error(`Unknown command: ${command}. Run "vre --help".`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
