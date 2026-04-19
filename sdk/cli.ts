#!/usr/bin/env node

import { resolveOperator } from "./operator.js";
import { verifyOutcome } from "./verify.js";
import { DEFAULT_PROGRAM_ID, DEFAULT_RPC_URL } from "./internals.js";

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
  console.log(`Usage:
  vre verify --sig <TX_SIG> [--rpc <RPC_URL>] [--program-id <PUBKEY>] [--json]
  vre resolve --config <PATH> --wallet <PATH> [--rpc <RPC_URL>] [--program-id <PUBKEY>] [--out-dir <DIR>] [--json]
`);
}

function printVerifyResult(result: Awaited<ReturnType<typeof verifyOutcome>>, asJson: boolean): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  console.log("verification_result :", result.status);
  console.log("verification_reason :", result.reason);
  console.log("program_id          :", result.program_id);
  console.log("runtime_id          :", result.runtime_id);
  console.log("resolve_id          :", result.resolve_id);
  console.log("compiled_artifact_hash :", result.compiled_artifact_hash);
  console.log("outcome_id          :", result.outcome_id);
}

function printResolveResult(result: Awaited<ReturnType<typeof resolveOperator>>, asJson: boolean): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  console.log("signature :", result.signature);
}

async function runVerify(args: CliArgs): Promise<void> {
  const signature = args.sig as string | undefined;
  if (!signature) {
    throw new Error("Provide --sig <TX_SIG>");
  }
  const result = await verifyOutcome({
    signature,
    rpcUrl:
      (args.rpc as string | undefined) ??
      (args.url as string | undefined) ??
      process.env.ANCHOR_PROVIDER_URL ??
      DEFAULT_RPC_URL,
    programId: (args["program-id"] as string | undefined) ?? DEFAULT_PROGRAM_ID,
  });
  printVerifyResult(result, Boolean(args.json));
  if (result.status !== "MATCH") {
    process.exitCode = 1;
  }
}

async function runResolve(args: CliArgs): Promise<void> {
  const configPath = args.config as string | undefined;
  if (!configPath) {
    throw new Error("Provide --config <PATH>");
  }
  const result = await resolveOperator({
    configPath,
    walletPath: args.wallet as string | undefined,
    rpcUrl:
      (args.rpc as string | undefined) ??
      (args.url as string | undefined) ??
      process.env.ANCHOR_PROVIDER_URL,
    programId: (args["program-id"] as string | undefined) ?? DEFAULT_PROGRAM_ID,
    outputDir: args["out-dir"] as string | undefined,
  });
  printResolveResult(result, Boolean(args.json));
}

async function main(): Promise<void> {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (!command || args.help || args.h) {
    printHelp();
    return;
  }
  if (command === "verify") {
    await runVerify(args);
    return;
  }
  if (command === "resolve") {
    await runResolve(args);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
