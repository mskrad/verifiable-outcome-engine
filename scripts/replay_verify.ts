import {
  DEFAULT_PROGRAM_ID,
  DEFAULT_RPC_URL,
} from "./outcome_public_sdk.ts";
import { verifyOutcome } from "../sdk/verify.ts";
import type { VerifyResult } from "../sdk/types.ts";

type CliArgs = Record<string, string | boolean>;

type ReplayOutput = {
  verification_result: "MATCH" | "MISMATCH";
  verification_reason: string;
  signature: string;
  program_id: string;
  runtime_id: string;
  resolve_id: string;
  compiled_artifact_hash: string;
  outcome_id: string;
  outcome_ids?: string[];
  winners_count?: number;
  artifact_format_version?: number;
  standard_version?: string;
  resolution_formula?: VerifyResult["resolution_formula"];
  target?: VerifyResult["target"];
  snapshot_hash?: string;
  snapshot_count?: number;
  snapshot_uri?: string;
  merkle_root?: string;
  irys_url?: string;
  proof_manifest_url?: string;
  publication_status?: VerifyResult["publication_status"];
  outcomes: Array<{ id: string; weight: number; score?: number; order?: number }>;
};

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json" || arg === "--help" || arg === "-h") {
      out[arg.replace(/^-+/, "")] = true;
      continue;
    }
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    out[key] = value;
    i += 1;
  }
  return out;
}

function buildReplayOutput(
  result: VerifyResult,
  signature: string,
  fallbackProgramId: string
): ReplayOutput {
  return {
    verification_result: result.status,
    verification_reason: result.reason,
    signature,
    program_id: result.program_id || fallbackProgramId,
    runtime_id: result.runtime_id,
    resolve_id: result.resolve_id,
    compiled_artifact_hash: result.compiled_artifact_hash,
    outcome_id: result.outcome_id,
    ...(result.outcome_ids
      ? {
          outcome_ids: result.outcome_ids,
          winners_count: result.winners_count,
          artifact_format_version: result.artifact_format_version,
        }
      : {}),
    ...(result.standard_version
      ? {
          standard_version: result.standard_version,
        }
      : {}),
    ...(result.resolution_formula
      ? {
          resolution_formula: result.resolution_formula,
          target: result.target,
        }
      : {}),
    ...(result.snapshot_hash
      ? {
          snapshot_hash: result.snapshot_hash,
          snapshot_count: result.snapshot_count,
          snapshot_uri: result.snapshot_uri,
          merkle_root: result.merkle_root,
          irys_url: result.irys_url,
          proof_manifest_url: result.proof_manifest_url,
          publication_status: result.publication_status,
        }
      : {}),
    outcomes: result.outcomes ?? [],
  };
}

function printOutput(output: ReplayOutput, asJson: boolean): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
    return;
  }
  console.log("verification_result :", output.verification_result);
  console.log("verification_reason :", output.verification_reason);
  console.log("outcome_id          :", output.outcome_id);
  if (output.outcome_ids) {
    console.log("outcome_ids         :", output.outcome_ids.join(","));
    console.log("winners_count       :", output.winners_count);
    if (output.standard_version) {
      console.log("standard_version    :", output.standard_version);
    } else {
      console.log("artifact_format_version :", output.artifact_format_version);
    }
  }
  if (output.resolution_formula) {
    console.log("resolution_formula  :", output.resolution_formula);
    console.log("target              :", output.target);
  }
  if (output.snapshot_hash) {
    console.log("snapshot_hash       :", output.snapshot_hash);
    console.log("snapshot_count      :", output.snapshot_count);
    console.log("snapshot_uri        :", output.snapshot_uri);
    console.log("merkle_root         :", output.merkle_root);
    console.log("irys_url            :", output.irys_url);
    console.log("proof_manifest_url  :", output.proof_manifest_url);
    console.log("publication_status  :", output.publication_status);
  }
  console.log("signature           :", output.signature);
  console.log("program_id          :", output.program_id);
  console.log("runtime_id          :", output.runtime_id);
  console.log("resolve_id          :", output.resolve_id);
  console.log("compiled_artifact_hash :", output.compiled_artifact_hash);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(`Usage:
  yarn -s replay --sig <TX_SIG> [--url <RPC_URL>] [--program-id <PUBKEY>] [--artifact <PATH>] [--json]
`);
    return;
  }

  const asJson = Boolean(args.json);
  const signature = (args.sig as string | undefined) ?? "";
  const programId =
    (args["program-id"] as string | undefined) ?? DEFAULT_PROGRAM_ID;
  const rpcUrl =
    (args.url as string | undefined) ??
    process.env.ANCHOR_PROVIDER_URL ??
    DEFAULT_RPC_URL;

  try {
    const result = await verifyOutcome({
      signature,
      rpcUrl,
      programId,
      artifactPath: args.artifact as string | undefined,
    });
    printOutput(buildReplayOutput(result, signature, programId), asJson);
    if (result.status === "MISMATCH") {
      process.exit(1);
    }
  } catch (_) {
    printOutput(
      {
        verification_result: "MISMATCH",
        verification_reason: "ERR_REPLAY_UNHANDLED",
        signature,
        program_id: programId,
        runtime_id: "",
        resolve_id: "",
        compiled_artifact_hash: "",
        outcome_id: "",
        outcomes: [],
      },
      asJson
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
