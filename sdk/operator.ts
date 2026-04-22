import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import { buildArtifact } from "./artifact.js";
import { OUTCOME_IDL } from "./idl.js";
import { verifyOutcome } from "./verify.js";
import {
  CHUNK_SIZE,
  DEFAULT_PROGRAM_ID,
  DEFAULT_RPC_URL,
  deriveApprovedArtifactChunkPda,
  deriveApprovedArtifactPda,
  deriveOutcomeConfigPda,
  deriveOutcomeResolutionPda,
  deriveOutcomeVaultPda,
  deriveProgramConfigPda,
  sha256,
  toHex,
} from "./internals.js";
import type { ArtifactConfig } from "./types.js";

const DEFAULT_WALLET_PATH = "~/.config/solana/id.json";
const STATUS_APPROVED = 1;
const CHUNK_WRITE_BYTES = 900;

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

type OutcomeConfigState = {
  nextResolveId: bigint;
};

type ProgramConfigState = {
  feeLamports: bigint;
  treasury: PublicKey;
};

export type ResolveOperatorOptions = {
  configPath: string;
  walletPath?: string;
  rpcUrl?: string;
  programId?: string;
  outputDir?: string;
};

export type ResolveOperatorResult = {
  signature: string;
  program_id: string;
  runtime_id: string;
  resolve_id: string;
  compiled_artifact_hash: string;
  artifact_path: string;
  result_path: string;
};

export type ResolveInlineOptions = {
  walletPath?: string;
  rpcUrl?: string;
  programId?: string;
  outputDir?: string;
  label?: string;
};

export type ResolveInlineResult = {
  signature: string;
  outcome: string;
  runtimeId: string;
  resolveId: string;
  artifactHash: string;
  programId: string;
  artifactPath: string;
  resultPath: string;
};

function expandHome(inputPath: string): string {
  if (!inputPath.startsWith("~")) return inputPath;
  return path.join(os.homedir(), inputPath.slice(1));
}

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  if (value && typeof (value as { toString?: unknown }).toString === "function") {
    return BigInt((value as { toString: () => string }).toString());
  }
  throw new Error(`Cannot coerce value to bigint: ${String(value)}`);
}

function ensureDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function outputDirFromArg(raw?: string): string {
  if (!raw) return path.join(process.cwd(), "tmp", "resolve-operator");
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function loadKeypair(walletPath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadArtifactConfig(configPath: string): ArtifactConfig {
  const resolvedPath = path.isAbsolute(configPath)
    ? configPath
    : path.resolve(process.cwd(), configPath);
  return JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as ArtifactConfig;
}

async function loadOutcomeClient(opts: {
  rpcUrl?: string;
  walletPath?: string;
  programId?: string;
}): Promise<OutcomeClient> {
  const url = opts.rpcUrl ?? process.env.ANCHOR_PROVIDER_URL ?? DEFAULT_RPC_URL;
  const walletPath = expandHome(
    opts.walletPath ?? process.env.ANCHOR_WALLET ?? DEFAULT_WALLET_PATH
  );
  const authority = loadKeypair(walletPath);
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(url, { commitment: "confirmed" }),
    wallet,
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const rawIdl = JSON.parse(JSON.stringify(OUTCOME_IDL));
  rawIdl.address = opts.programId ?? rawIdl.address ?? DEFAULT_PROGRAM_ID;
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
      .initializeProgramConfig({
        feeLamports: new BN(0),
        treasury: client.authority.publicKey,
      })
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
        feeLamports: new BN(0),
        treasury: client.authority.publicKey,
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
    config: ArtifactConfig;
    inputLamports: bigint;
    runtimeId?: Buffer;
    masterSeed?: Buffer;
    authority?: Keypair;
  }
): Promise<ApprovedRuntimeResult> {
  const runtimeId = opts.runtimeId ?? (await findUnusedRuntimeId(client));
  const minInputLamports = opts.inputLamports;
  const maxInputLamports = opts.inputLamports;
  const masterSeed = opts.masterSeed ?? Buffer.alloc(32, 1);
  const blob = buildArtifact(opts.config);
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

async function fetchProgramConfigState(
  client: OutcomeClient
): Promise<ProgramConfigState> {
  const decoded = await (client.program.account as any).programConfig.fetch(
    deriveProgramConfigPda(client.programId),
    "confirmed"
  );
  return {
    feeLamports: asBigInt(decoded.feeLamports ?? decoded.fee_lamports),
    treasury: new PublicKey(decoded.treasury),
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
    protocolTreasury?: PublicKey;
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
      outcomeTreasury: opts.treasury ?? client.authority.publicKey,
      protocolTreasury: opts.protocolTreasury ?? client.authority.publicKey,
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
  result: ResolveOperatorResult
): string {
  ensureDirectory(outputDir);
  const resultPath = path.join(outputDir, `${label}-result.json`);
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  return resultPath;
}

function defaultLabel(configPath: string): string {
  const base = path.basename(configPath, path.extname(configPath)) || "outcome";
  return `${base}-${Date.now()}`;
}

async function resolveConfig(
  config: ArtifactConfig,
  opts: {
    walletPath?: string;
    rpcUrl?: string;
    programId?: string;
    outputDir?: string;
    label: string;
  }
): Promise<ResolveOperatorResult> {
  const inputLamports = asBigInt(config.input_lamports);
  const client = await loadOutcomeClient({
    rpcUrl: opts.rpcUrl,
    walletPath: opts.walletPath,
    programId: opts.programId,
  });
  await ensureWalletFunds(client);
  await ensureProgramConfig(client);

  const label = opts.label;
  const outputDir = outputDirFromArg(opts.outputDir);
  ensureDirectory(outputDir);

  const runtime = await createApprovedRuntime(client, {
    label,
    outputDir,
    config,
    inputLamports,
  });

  await refreshRuntimeMasterSeed(client, {
    runtimeId: runtime.runtimeId,
    newMasterSeed: Buffer.alloc(32, 2),
  });

  const programConfig = await fetchProgramConfigState(client);
  const protocolTreasury =
    programConfig.feeLamports > 0n
      ? programConfig.treasury
      : client.authority.publicKey;
  const resolution = await resolveOutcomeAndConfirm(client, {
    runtimeId: runtime.runtimeId,
    inputLamports: runtime.minInputLamports,
    chunkPdas: runtime.chunkPdas,
    compiledArtifactHash: runtime.compiledArtifactHash,
    treasury: runtime.treasury,
    protocolTreasury,
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

export async function resolveOperator(
  opts: ResolveOperatorOptions
): Promise<ResolveOperatorResult> {
  if (!opts.configPath) {
    throw new Error("Provide --config <PATH>");
  }

  const config = loadArtifactConfig(opts.configPath);
  return resolveConfig(config, {
    walletPath: opts.walletPath,
    rpcUrl: opts.rpcUrl,
    programId: opts.programId,
    outputDir: opts.outputDir,
    label: defaultLabel(opts.configPath),
  });
}

export async function resolveInline(
  config: ArtifactConfig,
  opts: ResolveInlineOptions = {}
): Promise<ResolveInlineResult> {
  const rpcUrl = opts.rpcUrl ?? process.env.ANCHOR_PROVIDER_URL ?? DEFAULT_RPC_URL;
  const base = await resolveConfig(config, {
    walletPath: opts.walletPath,
    rpcUrl,
    programId: opts.programId,
    outputDir: opts.outputDir,
    label: opts.label ?? `live-raffle-${Date.now()}`,
  });

  const verified = await verifyOutcome({
    signature: base.signature,
    rpcUrl,
    programId: base.program_id,
  });
  if (verified.status !== "MATCH") {
    throw new Error(`live raffle replay failed after resolve: ${verified.reason}`);
  }

  return {
    signature: base.signature,
    outcome: verified.outcome_id,
    runtimeId: base.runtime_id,
    resolveId: base.resolve_id,
    artifactHash: base.compiled_artifact_hash,
    programId: base.program_id,
    artifactPath: base.artifact_path,
    resultPath: base.result_path,
  };
}
