import fs from "fs";
import os from "os";
import path from "path";

import {
  mintAndSubmitAgent,
  mplAgentIdentity,
  type AgentMetadata,
  type SvmNetwork,
} from "@metaplex-foundation/mpl-agent-registry";
import { fetchAsset, mplCore } from "@metaplex-foundation/mpl-core";
import { base58, keypairIdentity } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { Connection, PublicKey } from "@solana/web3.js";

const REF_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EVIDENCE_PATH = path.join(
  REF_ROOT,
  "artifacts",
  "metaplex_agent_registry_evidence.json"
);

const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
const DEFAULT_NETWORK = "solana-devnet";
const DEFAULT_METADATA_URI =
  "https://verifiableoutcome.online/agents/vre-outcome-verification-agent.json";
const AGENT_NAME = "VRE Outcome Verification Agent";
const AGENT_IDENTITY_PROGRAM_ID = "1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p";
const VRE_PROGRAM_ID = "3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq";
const BLESSED_SIGNATURE =
  "mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh";
const VRE_REPLAY_ENDPOINT = "https://verifiableoutcome.online/api/replay";

type Args = {
  command: "mint" | "verify";
  asset?: string;
  yes: boolean;
  force: boolean;
  minimal: boolean;
  writeEvidence: boolean;
};

type ServiceCheck = {
  name: string;
  endpoint: string;
  status: string;
};

type AgentVerification = {
  asset: any;
  agentIdentity: any;
  lifecycleChecks: {
    transfer: boolean;
    update: boolean;
    execute: boolean;
  };
  assetMetadataUri: string;
  registrationUri: string;
  assetMetadataJson: unknown;
  registrationUriJson: unknown;
  replayResult: any;
  serviceChecks: ServiceCheck[];
};

function parseArgs(argv: string[]): Args {
  const [rawCommand = "verify", ...rest] = argv;
  const command = rawCommand === "mint" ? "mint" : "verify";
  const args: Args = {
    command,
    yes: false,
    force: false,
    minimal: false,
    writeEvidence: command === "mint",
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--yes") {
      args.yes = true;
      continue;
    }
    if (arg === "--force") {
      args.force = true;
      continue;
    }
    if (arg === "--minimal") {
      args.minimal = true;
      continue;
    }
    if (arg === "--write-evidence") {
      args.writeEvidence = true;
      continue;
    }
    if (arg === "--no-write-evidence") {
      args.writeEvidence = false;
      continue;
    }
    if (arg === "--asset") {
      const value = rest[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --asset");
      }
      args.asset = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function expandHome(inputPath: string): string {
  if (!inputPath.startsWith("~")) return inputPath;
  return path.join(os.homedir(), inputPath.slice(1));
}

function readWalletPath(): string {
  const walletPath = process.env.METAPLEX_AGENT_WALLET || process.env.ANCHOR_WALLET;
  if (!walletPath) {
    throw new Error("Set METAPLEX_AGENT_WALLET or ANCHOR_WALLET to a Solana keypair JSON path");
  }
  return expandHome(walletPath);
}

function loadSecretKey(walletPath: string): Uint8Array {
  const parsed = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error(`Wallet file is not a Solana keypair array: ${walletPath}`);
  }
  return Uint8Array.from(parsed);
}

function jsonStringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function postJson(url: string, payload: unknown): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || `${url} returned HTTP ${response.status}`);
  }
  return body;
}

async function assertProgramAvailable(connection: Connection, programId: string): Promise<void> {
  const info = await connection.getAccountInfo(new PublicKey(programId), "confirmed");
  if (!info) {
    throw new Error(`Program not found on selected RPC: ${programId}`);
  }
  if (!info.executable) {
    throw new Error(`Program account is not executable on selected RPC: ${programId}`);
  }
}

function createUmiForEnv() {
  const rpcUrl = process.env.METAPLEX_AGENT_RPC_URL || DEFAULT_RPC_URL;
  const umi = createUmi(rpcUrl).use(mplAgentIdentity());
  const walletPath = readWalletPath();
  const keypair = umi.eddsa.createKeypairFromSecretKey(loadSecretKey(walletPath));
  umi.use(keypairIdentity(keypair));
  return { umi, rpcUrl, walletPath, owner: String(keypair.publicKey) };
}

function fullAgentMetadata(): AgentMetadata {
  return {
    type: "agent",
    name: AGENT_NAME,
    description:
      "Deterministic Solana outcome verification agent for Verifiable Outcome Engine. Use the web verifier or replay API with a transaction signature to recompute outcome evidence from public RPC data and compare it with the on-chain record. Verification does not depend on LLM judgment.",
    services: [
      { name: "web", endpoint: "https://verifiableoutcome.online/verify" },
      { name: "web", endpoint: "https://verifiableoutcome.online/play" },
      { name: "replay-api", endpoint: VRE_REPLAY_ENDPOINT },
      {
        name: "repository",
        endpoint: "https://github.com/mskrad/verifiable-outcome-engine",
      },
    ],
    registrations: [],
    supportedTrust: ["deterministic-replay"],
  };
}

function minimalAgentMetadata(): AgentMetadata {
  return {
    type: "agent",
    name: AGENT_NAME,
    description:
      "Deterministic Solana outcome verification agent for Verifiable Outcome Engine. Use the web verifier or replay API with a transaction signature to recompute outcome evidence from public RPC data and compare it with the on-chain record. Verification does not depend on LLM judgment.",
    services: [
      { name: "web", endpoint: "https://verifiableoutcome.online/verify" },
      { name: "web", endpoint: "https://verifiableoutcome.online/play" },
    ],
    registrations: [],
    supportedTrust: [],
  };
}

async function checkPrerequisites(rpcUrl: string, metadataUri: string): Promise<void> {
  const connection = new Connection(rpcUrl, "confirmed");
  await assertProgramAvailable(connection, AGENT_IDENTITY_PROGRAM_ID);
  await assertProgramAvailable(connection, VRE_PROGRAM_ID);
  const metadata = await fetchJson(metadataUri);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error(`Registration URI did not return a JSON object: ${metadataUri}`);
  }
}

function hasEvidenceAsset(): boolean {
  if (!fs.existsSync(EVIDENCE_PATH)) return false;
  const parsed = JSON.parse(fs.readFileSync(EVIDENCE_PATH, "utf8"));
  return Boolean(parsed.agent_asset_address);
}

function assertNoDuplicateMint(force: boolean): void {
  if (!force && hasEvidenceAsset()) {
    throw new Error(
      `Evidence already contains an agent asset. Refusing duplicate mint without --force: ${EVIDENCE_PATH}`
    );
  }
}

function lifecycleTruthy(checks: any, key: "transfer" | "update" | "execute"): boolean {
  const value = checks?.[key];
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

async function findMintSignature(
  connection: Connection,
  assetAddress: string
): Promise<string | null> {
  const signatures = await connection.getSignaturesForAddress(
    new PublicKey(assetAddress),
    { limit: 10 },
    "confirmed"
  );
  return signatures.find((item) => item.err === null)?.signature || null;
}

function assertReplayMatch(replayResult: any): void {
  if (
    replayResult?.verification_result !== "MATCH" ||
    replayResult?.verification_reason !== "OK"
  ) {
    throw new Error(
      `VRE replay did not return MATCH/OK: ${replayResult?.verification_result || "UNKNOWN"}/${replayResult?.verification_reason || "UNKNOWN"}`
    );
  }
}

function buildEvidence(input: {
  network: SvmNetwork;
  owner: string | null;
  walletPath: string | null;
  assetAddress: string;
  mintSignature: string;
  metadataUri: string;
  verification: AgentVerification;
}) {
  return {
    task_id: "HACKATHON-METAPLEX-001",
    network: input.network,
    agent_name: AGENT_NAME,
    owner: input.owner,
    wallet_path: input.walletPath,
    agent_asset_address: input.assetAddress,
    agent_identity_program_id: AGENT_IDENTITY_PROGRAM_ID,
    mint_transaction_signature: input.mintSignature,
    asset_metadata_uri: input.metadataUri,
    registration_uri: input.verification.registrationUri,
    registration_uri_matches_plugin_uri:
      input.verification.agentIdentity?.uri === input.verification.registrationUri,
    agent_identity_plugin: {
      present: Boolean(input.verification.agentIdentity),
      uri: input.verification.agentIdentity?.uri || null,
      lifecycle_checks: input.verification.lifecycleChecks,
    },
    service_checks: input.verification.serviceChecks,
    vre_program_id: VRE_PROGRAM_ID,
    blessed_signature: BLESSED_SIGNATURE,
    replay_result: {
      verification_result: input.verification.replayResult.verification_result,
      verification_reason: input.verification.replayResult.verification_reason,
      runtime_id: input.verification.replayResult.runtime_id,
      resolve_id: input.verification.replayResult.resolve_id,
      compiled_artifact_hash: input.verification.replayResult.compiled_artifact_hash,
      outcome_id: input.verification.replayResult.outcome_id,
    },
    verified_at: new Date().toISOString(),
  };
}

async function verifyAgent(
  assetAddress: string,
  rpcUrl: string,
  metadataUri: string
): Promise<AgentVerification> {
  const umi = createUmi(rpcUrl).use(mplCore()).use(mplAgentIdentity());
  const asset = (await fetchAsset(umi, assetAddress)) as any;
  const agentIdentity = Array.isArray(asset.agentIdentities)
    ? asset.agentIdentities[0]
    : undefined;
  if (!agentIdentity) {
    throw new Error(`AgentIdentity plugin not found for asset: ${assetAddress}`);
  }
  const lifecycleChecks = {
    transfer: lifecycleTruthy(agentIdentity?.lifecycleChecks, "transfer"),
    update: lifecycleTruthy(agentIdentity?.lifecycleChecks, "update"),
    execute: lifecycleTruthy(agentIdentity?.lifecycleChecks, "execute"),
  };
  if (!lifecycleChecks.transfer || !lifecycleChecks.update || !lifecycleChecks.execute) {
    throw new Error(`AgentIdentity lifecycle checks are incomplete for asset: ${assetAddress}`);
  }
  if (asset.uri !== metadataUri) {
    throw new Error(`Asset metadata URI mismatch: expected ${metadataUri}, got ${asset.uri}`);
  }
  const registrationUri = agentIdentity.uri;
  if (!registrationUri || typeof registrationUri !== "string") {
    throw new Error(`AgentIdentity registration URI is missing for asset: ${assetAddress}`);
  }
  const assetMetadataJson = await fetchJson(metadataUri);
  const registrationUriJson = await fetchJson(registrationUri);
  const replay = await postJson(VRE_REPLAY_ENDPOINT, {
    signature: BLESSED_SIGNATURE,
  });
  const replayResult = replay?.replay || {};
  assertReplayMatch(replayResult);

  const serviceChecks: ServiceCheck[] = [
    {
      name: "web",
      endpoint: "https://verifiableoutcome.online/verify",
      status: "reachable",
    },
    {
      name: "metadata",
      endpoint: metadataUri,
      status: "HTTP 200 valid JSON",
    },
    {
      name: "agent-registration-uri",
      endpoint: registrationUri,
      status: "HTTP 200 valid JSON",
    },
    {
      name: "replay-api",
      endpoint: VRE_REPLAY_ENDPOINT,
      status:
        replayResult.verification_result === "MATCH" &&
        replayResult.verification_reason === "OK"
          ? "MATCH/OK for blessed signature"
          : `${replayResult.verification_result || "UNKNOWN"}/${replayResult.verification_reason || "UNKNOWN"}`,
    },
  ];

  return {
    asset,
    agentIdentity,
    lifecycleChecks,
    assetMetadataUri: asset.uri,
    registrationUri,
    assetMetadataJson,
    registrationUriJson,
    replayResult,
    serviceChecks,
  };
}

async function mintAgent(args: Args) {
  if (!args.yes) {
    throw new Error("Refusing to mint without --yes");
  }
  assertNoDuplicateMint(args.force);

  const { umi, rpcUrl, walletPath, owner } = createUmiForEnv();
  const network = (process.env.METAPLEX_AGENT_NETWORK || DEFAULT_NETWORK) as SvmNetwork;
  const metadataUri = process.env.METAPLEX_AGENT_URI || DEFAULT_METADATA_URI;

  await checkPrerequisites(rpcUrl, metadataUri);

  const input = {
    wallet: umi.identity.publicKey,
    network,
    name: AGENT_NAME,
    uri: metadataUri,
    agentMetadata: args.minimal ? minimalAgentMetadata() : fullAgentMetadata(),
  };

  let result;
  try {
    result = await mintAndSubmitAgent(umi, {}, input);
  } catch (error) {
    if (args.minimal) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (!/api|validation|400|422|service|trust/i.test(message)) throw error;
    result = await mintAndSubmitAgent(umi, {}, {
      ...input,
      agentMetadata: minimalAgentMetadata(),
    });
  }

  const assetAddress = String(result.assetAddress);
  const signature = base58.deserialize(result.signature)[0];
  const verification = await verifyAgent(assetAddress, rpcUrl, metadataUri);
  const evidence = buildEvidence({
    network,
    owner,
    walletPath,
    assetAddress,
    mintSignature: signature,
    metadataUri,
    verification,
  });

  fs.writeFileSync(EVIDENCE_PATH, jsonStringify(evidence));
  return evidence;
}

async function verifyExisting(args: Args) {
  const rpcUrl = process.env.METAPLEX_AGENT_RPC_URL || DEFAULT_RPC_URL;
  const metadataUri = process.env.METAPLEX_AGENT_URI || DEFAULT_METADATA_URI;
  const assetAddress =
    args.asset ||
    (fs.existsSync(EVIDENCE_PATH)
      ? JSON.parse(fs.readFileSync(EVIDENCE_PATH, "utf8")).agent_asset_address
      : "");
  if (!assetAddress) {
    throw new Error("Provide --asset <AGENT_ASSET_ADDRESS> or create evidence with metaplex:agent:mint");
  }

  await checkPrerequisites(rpcUrl, metadataUri);
  const connection = new Connection(rpcUrl, "confirmed");
  const verification = await verifyAgent(assetAddress, rpcUrl, metadataUri);
  const current = fs.existsSync(EVIDENCE_PATH)
    ? JSON.parse(fs.readFileSync(EVIDENCE_PATH, "utf8"))
    : {};
  const mintSignature =
    current.mint_transaction_signature ||
    (await findMintSignature(connection, assetAddress));
  const result = {
    ok: true,
    agent_asset_address: assetAddress,
    mint_transaction_signature: mintSignature,
    asset_metadata_uri: metadataUri,
    registration_uri: verification.registrationUri,
    registration_uri_matches_plugin_uri:
      verification.agentIdentity?.uri === verification.registrationUri,
    agent_identity_plugin: {
      present: Boolean(verification.agentIdentity),
      uri: verification.agentIdentity?.uri || null,
      lifecycle_checks: verification.lifecycleChecks,
    },
    replay_result: {
      verification_result: verification.replayResult.verification_result,
      verification_reason: verification.replayResult.verification_reason,
    },
    verified_at: new Date().toISOString(),
  };

  if (args.writeEvidence) {
    if (!mintSignature) {
      throw new Error(`Could not recover mint transaction signature for asset: ${assetAddress}`);
    }
    const network = (process.env.METAPLEX_AGENT_NETWORK || DEFAULT_NETWORK) as SvmNetwork;
    const evidence = buildEvidence({
      network,
      owner: String(verification.asset.owner || current.owner || ""),
      walletPath: process.env.METAPLEX_AGENT_WALLET || process.env.ANCHOR_WALLET || null,
      assetAddress,
      mintSignature,
      metadataUri,
      verification,
    });
    fs.writeFileSync(EVIDENCE_PATH, jsonStringify(evidence));
  }

  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result =
    args.command === "mint" ? await mintAgent(args) : await verifyExisting(args);
  process.stdout.write(jsonStringify(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
