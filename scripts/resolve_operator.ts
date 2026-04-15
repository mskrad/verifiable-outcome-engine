import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import {
  CHUNK_SIZE,
  DEFAULT_PROGRAM_ID,
  deriveApprovedArtifactChunkPda,
  deriveApprovedArtifactPda,
  deriveOutcomeConfigPda,
  deriveOutcomeResolutionPda,
  deriveOutcomeVaultPda,
  deriveProgramConfigPda,
  outcomeIdlPath,
  resolveOperatorOutputDir,
  sha256,
  toHex,
} from "./outcome_public_sdk.ts";
import { buildArtifact } from "../sdk/artifact.ts";
import type { ArtifactConfig, LootConfig, RaffleConfig } from "../sdk/types.ts";

const DEFAULT_OPERATOR_RPC_URL = "http://127.0.0.1:8899";
const DEFAULT_WALLET_PATH = "~/.config/solana/id.json";
const STATUS_APPROVED = 1;
const CHUNK_WRITE_BYTES = 900;

type CliArgs = Record<string, string | boolean>;

type OutcomeClient = {
  provider: anchor.AnchorProvider;
  program: anchor.Program;
  authority: Keypair;
  programId: PublicKey;
};

type ApprovedArtifactResult = {
  blob: Buffer;
  compiledArtifactHash: Buffer;
  compiledArtifactHashHex: string;
  artifactPath: string;
  artifactPda: PublicKey;
  chunkPdas: PublicKey[];
};

type ApprovedRuntimeResult = ApprovedArtifactResult & {
  runtimeId: Buffer;
  runtimeIdHex: string;
  outcomeConfigPda: PublicKey;
  outcomeVaultPda: PublicKey;
  treasury: PublicKey;
  minInputLamports: bigint;
  maxInputLamports: bigint;
};

type SmokeSetupResult = {
  signature: string;
  program_id: string;
  runtime_id: string;
  resolve_id: string;
  compiled_artifact_hash: string;
  artifact_path: string;
  result_path: string;
};

type OutcomeConfigState = {
  nextResolveId: bigint;
};

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json" || arg === "--raffle" || arg === "--help" || arg === "-h") {
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

function expandHome(inputPath: string): string {
  if (!inputPath.startsWith("~")) return inputPath;
  return path.join(os.homedir(), inputPath.slice(1));
}

function asBigInt(value: any): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  if (value && typeof value.toString === "function") return BigInt(value.toString());
  throw new Error(`Cannot coerce value to bigint: ${String(value)}`);
}

function ensureDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function outputDirFromArg(raw?: string): string {
  if (!raw) return resolveOperatorOutputDir();
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function loadKeypair(walletPath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

const RAFFLE_PARTICIPANTS = [
  "5RbvSHbSuo9CBjZLtw9RoP775KeqaJyMXkXNsb99AeR4",
  "Aip3wC6UCgE5628ukFW6z3rDGDVTAXKDG4V3j15tPvEU",
  "3nafSu5GVq9bDLAxCg2gPucT4Jzhi2Ybyy2QbhzTMFR9",
  "ABKKERBB9i7MvSbB5s9h6EphiCvXa4FvNDmxWFSdHZqY",
  "5a38vhRuQhKPQwRQFcgDAw3SYNQcGo7XKuWyvFDK5xjP",
  "9KpwjbCV3kF8x3puk4fUKa5UTToGSg6giaLQkYFP1J8r",
  "BKo2rXwCgPTtwkNcFV5E7G9SxYW6wByDzSbswhR6oNa4",
];

function defaultRaffleConfig(inputLamports = 10n): RaffleConfig {
  return {
    type: "raffle",
    input_lamports: inputLamports,
    payout_lamports: 3n,
    participants: RAFFLE_PARTICIPANTS.map((address) => ({
      address,
      weight: 1000,
    })),
  };
}

function defaultLootConfig(opts?: {
  inputLamports?: bigint;
  commonWeight?: number;
  rareWeight?: number;
  commonPayoutLamports?: bigint;
  rarePayoutLamports?: bigint;
}): LootConfig {
  const inputLamports = opts?.inputLamports ?? 10n;
  const commonWeight = opts?.commonWeight ?? 700;
  const rareWeight = opts?.rareWeight ?? 300;
  const commonPayoutLamports = opts?.commonPayoutLamports ?? 3n;
  const rarePayoutLamports = opts?.rarePayoutLamports ?? 7n;

  return {
    type: "loot",
    input_lamports: inputLamports,
    outcomes: [
      { id: "common", weight: commonWeight, payout_lamports: commonPayoutLamports },
      { id: "rare", weight: rareWeight, payout_lamports: rarePayoutLamports },
    ],
  };
}

function loadArtifactConfig(configPath: string): ArtifactConfig {
  const resolvedPath = path.isAbsolute(configPath)
    ? configPath
    : path.resolve(process.cwd(), configPath);
  return JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as ArtifactConfig;
}

function artifactBounds(blob: Buffer): {
  minInputLamports: bigint;
  maxInputLamports: bigint;
} {
  if (blob.length < 22 || blob.subarray(0, 4).toString("ascii") !== "W3O1") {
    throw new Error("Invalid W3O1 artifact header");
  }
  return {
    minInputLamports: blob.readBigUInt64LE(6),
    maxInputLamports: blob.readBigUInt64LE(14),
  };
}

function nextArtifactVariant(): {
  label: string;
  commonWeight: number;
  rareWeight: number;
  commonPayoutLamports: bigint;
  rarePayoutLamports: bigint;
} {
  const nonce = crypto.randomBytes(8);
  const primary = nonce.readUInt32LE(0);
  const secondary = nonce.readUInt32LE(4);
  const nonceHex = nonce.toString("hex");

  return {
    label: `operator-${nonceHex}`,
    commonWeight: 10_000 + (primary % 1_000_000),
    rareWeight: 5_000 + (secondary % 1_000_000),
    commonPayoutLamports: 3n,
    rarePayoutLamports: 7n,
  };
}

async function loadOutcomeClient(opts?: {
  url?: string;
  walletPath?: string;
  programId?: string;
}): Promise<OutcomeClient> {
  const url = opts?.url ?? process.env.ANCHOR_PROVIDER_URL ?? DEFAULT_OPERATOR_RPC_URL;
  const walletPath = expandHome(
    opts?.walletPath ?? process.env.ANCHOR_WALLET ?? DEFAULT_WALLET_PATH
  );
  const authority = loadKeypair(walletPath);
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(url, { commitment: "confirmed" }),
    wallet,
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const rawIdl = JSON.parse(fs.readFileSync(outcomeIdlPath(), "utf8"));
  rawIdl.address = opts?.programId ?? rawIdl.address ?? DEFAULT_PROGRAM_ID;
  const program = new anchor.Program(rawIdl as anchor.Idl, provider);

  return {
    provider,
    program,
    authority,
    programId: program.programId,
  };
}

async function ensureWalletFunds(
  client: OutcomeClient,
  minimumLamports = 2_000_000_000
): Promise<void> {
  const balance = await client.provider.connection.getBalance(
    client.authority.publicKey,
    "confirmed"
  );
  if (balance >= minimumLamports) return;
  const endpoint = client.provider.connection.rpcEndpoint;
  if (!endpoint.includes("127.0.0.1") && !endpoint.includes("localhost")) {
    return;
  }
  const sig = await client.provider.connection.requestAirdrop(
    client.authority.publicKey,
    minimumLamports
  );
  await client.provider.connection.confirmTransaction(sig, "confirmed");
}

async function ensureProgramConfig(client: OutcomeClient): Promise<PublicKey> {
  const programConfigPda = deriveProgramConfigPda(client.programId);
  const info = await client.provider.connection.getAccountInfo(
    programConfigPda,
    "confirmed"
  );
  if (!info) {
    await (client.program.methods as any)
      .initializeProgramConfig()
      .accounts({
        payer: client.authority.publicKey,
        programConfig: programConfigPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    return programConfigPda;
  }

  const programConfig = await (client.program.account as any).programConfig.fetch(
    programConfigPda,
    "confirmed"
  );
  const currentAdmin = new PublicKey(programConfig.admin);
  if (!currentAdmin.equals(client.authority.publicKey)) {
    throw new Error(
      `ProgramConfig admin mismatch: expected ${client.authority.publicKey.toBase58()} got ${currentAdmin.toBase58()}`
    );
  }

  if (Boolean(programConfig.allowUnreviewedBinding)) {
    await (client.program.methods as any)
      .setProgramConfig({
        newAdmin: client.authority.publicKey,
        allowUnreviewedBinding: false,
      })
      .accounts({
        programConfig: programConfigPda,
        admin: client.authority.publicKey,
      })
      .rpc();
  }

  return programConfigPda;
}

async function findUnusedRuntimeId(client: OutcomeClient): Promise<Buffer> {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const runtimeId = crypto.randomBytes(16);
    const pda = deriveOutcomeConfigPda(client.programId, runtimeId);
    const info = await client.provider.connection.getAccountInfo(pda, "confirmed");
    if (!info) return runtimeId;
  }
  throw new Error("Failed to derive unused runtime_id");
}

function writeArtifactFixture(
  outputDir: string,
  label: string,
  blob: Buffer
): {
  artifactPath: string;
  compiledArtifactHash: Buffer;
  compiledArtifactHashHex: string;
} {
  ensureDirectory(outputDir);
  const compiledArtifactHash = sha256(blob);
  const compiledArtifactHashHex = toHex(compiledArtifactHash);
  const artifactPath = path.join(
    outputDir,
    `${label}-${compiledArtifactHashHex.slice(0, 16)}.bin`
  );
  fs.writeFileSync(artifactPath, blob);
  return { artifactPath, compiledArtifactHash, compiledArtifactHashHex };
}

async function submitApprovedArtifact(
  client: OutcomeClient,
  opts: {
    blob: Buffer;
    label: string;
    outputDir: string;
    artifactUri?: string;
    auditHash?: Buffer;
  }
): Promise<ApprovedArtifactResult> {
  const { artifactPath, compiledArtifactHash, compiledArtifactHashHex } =
    writeArtifactFixture(opts.outputDir, opts.label, opts.blob);
  const artifactPda = deriveApprovedArtifactPda(
    client.programId,
    compiledArtifactHash
  );

  // If the artifact PDA already exists on-chain, check its state and resume if needed.
  const existingArtifactInfo = await client.provider.connection.getAccountInfo(
    artifactPda,
    "confirmed"
  );
  if (existingArtifactInfo) {
    const chunkCount = Math.ceil(opts.blob.length / CHUNK_SIZE);
    const chunkPdas: PublicKey[] = [];
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      chunkPdas.push(
        deriveApprovedArtifactChunkPda(
          client.programId,
          compiledArtifactHash,
          chunkIndex
        )
      );
    }

    const artifactAccount = await (client.program.account as any).approvedOutcomeArtifact.fetch(
      artifactPda,
      "confirmed"
    );

    if (!artifactAccount.isFinalized) {
      console.log(`[info] artifact found but not finalized — finalizing: ${artifactPda.toBase58()}`);
      await (client.program.methods as any)
        .finalizeCompiledArtifact()
        .accounts({
          publisher: client.authority.publicKey,
          approvedOutcomeArtifact: artifactPda,
        })
        .remainingAccounts(
          chunkPdas.map((pubkey) => ({
            pubkey,
            isSigner: false,
            isWritable: false,
          }))
        )
        .rpc();
    }

    if (artifactAccount.status !== STATUS_APPROVED) {
      console.log(`[info] artifact not yet reviewed — reviewing: ${artifactPda.toBase58()}`);
      await (client.program.methods as any)
        .reviewCompiledArtifact({
          status: STATUS_APPROVED,
          auditHash: [...(opts.auditHash ?? Buffer.alloc(32, 0))],
          artifactUri: Buffer.from(
            opts.artifactUri ?? path.basename(artifactPath),
            "utf8"
          ),
        })
        .accounts({
          programConfig: deriveProgramConfigPda(client.programId),
          admin: client.authority.publicKey,
          approvedOutcomeArtifact: artifactPda,
        })
        .rpc();
    } else {
      console.log(`[info] artifact already approved on-chain: ${artifactPda.toBase58()} — skipping upload`);
    }

    return {
      blob: opts.blob,
      compiledArtifactHash,
      compiledArtifactHashHex,
      artifactPath,
      artifactPda,
      chunkPdas,
    };
  }

  await (client.program.methods as any)
    .submitCompiledArtifact({
      compiledArtifactHash: [...compiledArtifactHash],
      formatVersion: 1,
      blobLen: opts.blob.length,
    })
    .accounts({
      publisher: client.authority.publicKey,
      approvedOutcomeArtifact: artifactPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const chunkCount = Math.ceil(opts.blob.length / CHUNK_SIZE);
  const chunkPdas: PublicKey[] = [];
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const chunkPda = deriveApprovedArtifactChunkPda(
      client.programId,
      compiledArtifactHash,
      chunkIndex
    );
    chunkPdas.push(chunkPda);

    await (client.program.methods as any)
      .initCompiledArtifactChunk({
        compiledArtifactHash: [...compiledArtifactHash],
        chunkIndex,
      })
      .accounts({
        publisher: client.authority.publicKey,
        approvedOutcomeArtifact: artifactPda,
        approvedOutcomeArtifactChunk: chunkPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const chunkStart = chunkIndex * CHUNK_SIZE;
    const chunkBytes = opts.blob.subarray(
      chunkStart,
      Math.min(opts.blob.length, chunkStart + CHUNK_SIZE)
    );
    for (
      let offset = 0;
      offset < chunkBytes.length;
      offset += CHUNK_WRITE_BYTES
    ) {
      const part = chunkBytes.subarray(
        offset,
        Math.min(chunkBytes.length, offset + CHUNK_WRITE_BYTES)
      );
      await (client.program.methods as any)
        .writeCompiledArtifactChunk({
          compiledArtifactHash: [...compiledArtifactHash],
          chunkIndex,
          offset,
          data: Buffer.from(part),
        })
        .accounts({
          publisher: client.authority.publicKey,
          approvedOutcomeArtifact: artifactPda,
          approvedOutcomeArtifactChunk: chunkPda,
        })
        .rpc();
    }
  }

  await (client.program.methods as any)
    .finalizeCompiledArtifact()
    .accounts({
      publisher: client.authority.publicKey,
      approvedOutcomeArtifact: artifactPda,
    })
    .remainingAccounts(
      chunkPdas.map((pubkey) => ({
        pubkey,
        isSigner: false,
        isWritable: false,
      }))
    )
    .rpc();

  await (client.program.methods as any)
    .reviewCompiledArtifact({
      status: STATUS_APPROVED,
      auditHash: [...(opts.auditHash ?? Buffer.alloc(32, 0))],
      artifactUri: Buffer.from(
        opts.artifactUri ?? path.basename(artifactPath),
        "utf8"
      ),
    })
    .accounts({
      programConfig: deriveProgramConfigPda(client.programId),
      admin: client.authority.publicKey,
      approvedOutcomeArtifact: artifactPda,
    })
    .rpc();

  return {
    blob: opts.blob,
    compiledArtifactHash,
    compiledArtifactHashHex,
    artifactPath,
    artifactPda,
    chunkPdas,
  };
}

async function initializeOutcomeRuntime(
  client: OutcomeClient,
  opts: {
    runtimeId: Buffer;
    compiledArtifactHash: Buffer;
    chunkPdas: PublicKey[];
    minInputLamports: bigint;
    maxInputLamports: bigint;
    masterSeed: Buffer;
    treasury?: PublicKey;
    authority?: Keypair;
  }
): Promise<{
  outcomeConfigPda: PublicKey;
  outcomeVaultPda: PublicKey;
  treasury: PublicKey;
}> {
  const outcomeConfigPda = deriveOutcomeConfigPda(client.programId, opts.runtimeId);
  const outcomeVaultPda = deriveOutcomeVaultPda(client.programId, opts.runtimeId);
  const treasury = opts.treasury ?? client.authority.publicKey;
  const authority = opts.authority ?? client.authority;

  await (client.program.methods as any)
    .initializeOutcomeConfig({
      runtimeId: [...opts.runtimeId],
      minInputLamports: new BN(opts.minInputLamports.toString()),
      maxInputLamports: new BN(opts.maxInputLamports.toString()),
      compiledArtifactHash: [...opts.compiledArtifactHash],
      masterSeed: [...opts.masterSeed],
    })
    .accounts({
      authority: authority.publicKey,
      programConfig: deriveProgramConfigPda(client.programId),
      outcomeConfig: outcomeConfigPda,
      outcomeVault: outcomeVaultPda,
      treasury,
      approvedOutcomeArtifact: deriveApprovedArtifactPda(
        client.programId,
        opts.compiledArtifactHash
      ),
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(
      opts.chunkPdas.map((pubkey) => ({
        pubkey,
        isSigner: false,
        isWritable: false,
      }))
    )
    .signers(
      authority.publicKey.equals(client.authority.publicKey) ? [] : [authority]
    )
    .rpc();

  return { outcomeConfigPda, outcomeVaultPda, treasury };
}

async function createApprovedRuntime(
  client: OutcomeClient,
  opts: {
    label: string;
    outputDir: string;
    artifactConfig: ArtifactConfig;
    runtimeId?: Buffer;
    masterSeed?: Buffer;
    authority?: Keypair;
  }
): Promise<ApprovedRuntimeResult> {
  const runtimeId = opts.runtimeId ?? (await findUnusedRuntimeId(client));
  const masterSeed = opts.masterSeed ?? Buffer.alloc(32, 1);
  const blob = buildArtifact(opts.artifactConfig);
  const { minInputLamports, maxInputLamports } = artifactBounds(blob);
  const approvedArtifact = await submitApprovedArtifact(client, {
    blob,
    label: opts.label,
    outputDir: opts.outputDir,
  });
  const initializedRuntime = await initializeOutcomeRuntime(client, {
    runtimeId,
    compiledArtifactHash: approvedArtifact.compiledArtifactHash,
    chunkPdas: approvedArtifact.chunkPdas,
    minInputLamports,
    maxInputLamports,
    masterSeed,
    authority: opts.authority,
  });

  return {
    ...approvedArtifact,
    runtimeId,
    runtimeIdHex: toHex(runtimeId),
    outcomeConfigPda: initializedRuntime.outcomeConfigPda,
    outcomeVaultPda: initializedRuntime.outcomeVaultPda,
    treasury: initializedRuntime.treasury,
    minInputLamports,
    maxInputLamports,
  };
}

async function refreshRuntimeMasterSeed(
  client: OutcomeClient,
  opts: {
    runtimeId: Buffer;
    newMasterSeed: Buffer;
    authority?: Keypair;
  }
): Promise<string> {
  const authority = opts.authority ?? client.authority;
  return (client.program.methods as any)
    .refreshMasterSeed({
      runtimeId: [...opts.runtimeId],
      newMasterSeed: [...opts.newMasterSeed],
    })
    .accounts({
      authority: authority.publicKey,
      programConfig: deriveProgramConfigPda(client.programId),
      outcomeConfig: deriveOutcomeConfigPda(client.programId, opts.runtimeId),
    })
    .signers(
      authority.publicKey.equals(client.authority.publicKey) ? [] : [authority]
    )
    .rpc();
}

async function fetchOutcomeConfigState(
  client: OutcomeClient,
  runtimeId: Buffer
): Promise<OutcomeConfigState> {
  const decoded = await (client.program.account as any).outcomeConfig.fetch(
    deriveOutcomeConfigPda(client.programId, runtimeId),
    "confirmed"
  );
  return {
    nextResolveId: asBigInt(decoded.nextResolveId ?? decoded.next_resolve_id),
  };
}

async function resolveOutcomeAndConfirm(
  client: OutcomeClient,
  opts: {
    runtimeId: Buffer;
    inputLamports: bigint;
    chunkPdas: PublicKey[];
    compiledArtifactHash: Buffer;
    actor?: Keypair;
    treasury?: PublicKey;
  }
): Promise<{ signature: string; resolveId: bigint }> {
  const actor = opts.actor ?? client.authority;
  const resolveId = (await fetchOutcomeConfigState(client, opts.runtimeId))
    .nextResolveId;
  const outcomeResolutionPda = deriveOutcomeResolutionPda(
    client.programId,
    opts.runtimeId,
    resolveId
  );
  const signature = await (client.program.methods as any)
    .resolveOutcome({
      runtimeId: [...opts.runtimeId],
      inputLamports: new BN(opts.inputLamports.toString()),
    })
    .accounts({
      actor: actor.publicKey,
      programConfig: deriveProgramConfigPda(client.programId),
      outcomeConfig: deriveOutcomeConfigPda(client.programId, opts.runtimeId),
      outcomeVault: deriveOutcomeVaultPda(client.programId, opts.runtimeId),
      outcomeResolution: outcomeResolutionPda,
      approvedOutcomeArtifact: deriveApprovedArtifactPda(
        client.programId,
        opts.compiledArtifactHash
      ),
      treasury: opts.treasury ?? client.authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(
      opts.chunkPdas.map((pubkey) => ({
        pubkey,
        isSigner: false,
        isWritable: false,
      }))
    )
    .signers(actor.publicKey.equals(client.authority.publicKey) ? [] : [actor])
    .rpc();

  await client.provider.connection.confirmTransaction(signature, "confirmed");
  return { signature, resolveId };
}

function writeResultManifest(
  outputDir: string,
  label: string,
  result: SmokeSetupResult
): string {
  ensureDirectory(outputDir);
  const resultPath = path.join(outputDir, `${label}-result.json`);
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  return resultPath;
}

async function runResolveOperator(opts?: {
  url?: string;
  walletPath?: string;
  programId?: string;
  outputDir?: string;
  label?: string;
  raffle?: boolean;
  configPath?: string;
}): Promise<SmokeSetupResult> {
  const client = await loadOutcomeClient({
    url: opts?.url,
    walletPath: opts?.walletPath,
    programId: opts?.programId,
  });
  await ensureWalletFunds(client);
  await ensureProgramConfig(client);

  const isRaffle = Boolean(opts?.raffle);
  const artifactVariant = nextArtifactVariant();
  const artifactConfig = opts?.configPath
    ? loadArtifactConfig(opts.configPath)
    : isRaffle
      ? defaultRaffleConfig()
      : defaultLootConfig({
          inputLamports: 10n,
          commonWeight: artifactVariant.commonWeight,
          rareWeight: artifactVariant.rareWeight,
          commonPayoutLamports: artifactVariant.commonPayoutLamports,
          rarePayoutLamports: artifactVariant.rarePayoutLamports,
        });
  const label =
    opts?.label ??
    (opts?.configPath
      ? `${path.basename(opts.configPath, path.extname(opts.configPath))}-${Date.now()}`
      : isRaffle
        ? `raffle-${Date.now()}`
        : artifactVariant.label);
  const outputDir = outputDirFromArg(opts?.outputDir);
  ensureDirectory(outputDir);

  const runtime = await createApprovedRuntime(client, {
    label,
    outputDir,
    artifactConfig,
  });

  await refreshRuntimeMasterSeed(client, {
    runtimeId: runtime.runtimeId,
    newMasterSeed: Buffer.alloc(32, 2),
  });

  const resolution = await resolveOutcomeAndConfirm(client, {
    runtimeId: runtime.runtimeId,
    inputLamports: runtime.minInputLamports,
    chunkPdas: runtime.chunkPdas,
    compiledArtifactHash: runtime.compiledArtifactHash,
    treasury: runtime.treasury,
  });

  const partialResult = {
    signature: resolution.signature,
    program_id: client.programId.toBase58(),
    runtime_id: runtime.runtimeIdHex,
    resolve_id: resolution.resolveId.toString(),
    compiled_artifact_hash: runtime.compiledArtifactHashHex,
    artifact_path: runtime.artifactPath,
    result_path: "",
  };
  const resultPath = writeResultManifest(outputDir, label, partialResult);

  return {
    ...partialResult,
    result_path: resultPath,
  };
}

function printResult(result: SmokeSetupResult, asJson: boolean): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  console.log("signature              :", result.signature);
  console.log("program_id             :", result.program_id);
  console.log("runtime_id             :", result.runtime_id);
  console.log("resolve_id             :", result.resolve_id);
  console.log("compiled_artifact_hash :", result.compiled_artifact_hash);
  console.log("artifact_path          :", result.artifact_path);
  console.log("result_path            :", result.result_path);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(`Usage:
  yarn -s resolve:operator [--url <RPC_URL>] [--wallet <PATH>] [--program-id <PUBKEY>] [--out-dir <DIR>] [--label <TEXT>] [--raffle] [--config <PATH>] [--json]

Flags:
  --raffle   Build a raffle artifact (7 participant wallet addresses) instead of the default demo artifact.
  --config   Build an artifact from a JSON config file.

Notes:
  Optional operator-side path only.
  Default reviewer flow remains verifier-first via 'yarn -s replay'.
  Default output dir: tmp/resolve-operator
`);
    return;
  }

  const result = await runResolveOperator({
    url: (args.url as string | undefined) ?? process.env.ANCHOR_PROVIDER_URL,
    walletPath:
      (args.wallet as string | undefined) ?? process.env.ANCHOR_WALLET,
    programId: (args["program-id"] as string | undefined) ?? DEFAULT_PROGRAM_ID,
    outputDir: args["out-dir"] as string | undefined,
    label: args.label as string | undefined,
    raffle: Boolean(args.raffle),
    configPath: args.config as string | undefined,
  });
  printResult(result, Boolean(args.json));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
