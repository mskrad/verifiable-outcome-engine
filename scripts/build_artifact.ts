import crypto from "crypto";
import fs from "fs";
import path from "path";

import { buildArtifact } from "../sdk/artifact.ts";
import type { ArtifactConfig } from "../sdk/types.ts";

type CliArgs = Record<string, string | boolean>;

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
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

function resolvePath(raw: string): string {
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function sha256Hex(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function loadConfig(configPath: string): ArtifactConfig {
  return JSON.parse(fs.readFileSync(resolvePath(configPath), "utf8")) as ArtifactConfig;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(`Usage:
  yarn build:artifact --config <CONFIG_JSON> --out <ARTIFACT_BIN>
`);
    return;
  }

  const configPath = args.config as string | undefined;
  const outPath = args.out as string | undefined;
  if (!configPath) throw new Error("Provide --config <CONFIG_JSON>");
  if (!outPath) throw new Error("Provide --out <ARTIFACT_BIN>");

  const artifactPath = resolvePath(outPath);
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  const blob = buildArtifact(loadConfig(configPath));
  fs.writeFileSync(artifactPath, blob);

  console.log("artifact_path :", outPath);
  console.log("artifact_hash :", sha256Hex(blob));
  console.log("blob_bytes    :", blob.length);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
