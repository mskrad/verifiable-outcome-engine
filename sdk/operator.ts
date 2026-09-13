import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_SLOT_HASHES_PUBKEY,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";

const PRIORITY_FEE_MICRO_LAMPORTS = 100_000;

import { buildArtifact } from "./artifact.js";
import { OUTCOME_IDL } from "./idl.js";
import {
  buildSnapshotClaimFromFile,
  deriveResolveRandomness,
} from "./snapshot.js";
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
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);
const STATUS_APPROVED = 1;
const CHUNK_WRITE_BYTES = 900;
const REFRESHED_MASTER_SEED = Buffer.alloc(32, 2);

type OutcomeClient = {
  provider: anchor.AnchorProvider;
  program: anchor.Program;
  authority: OperatorAuthority;
  programId: PublicKey;
};

type OperatorAuthority = { kind: "keypair"; keypair: Keypair; publicKey: PublicKey };

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

type InstructionBuilder = {
  accounts(accounts: Record<string, unknown>): InstructionBuilder;
  remainingAccounts(accounts: Array<{
    pubkey: PublicKey;
    isSigner: boolean;
    isWritable: boolean;
  }>): InstructionBuilder;
  instruction(): Promise<TransactionInstruction>;
};

type OutcomeMethods = Record<string, (...args: unknown[]) => InstructionBuilder>;

type AccountFetcher = {
  fetch(address: PublicKey, commitment?: anchor.web3.Commitment): Promise<unknown>;
};

type OutcomeProgram = anchor.Program & {
  methods: OutcomeMethods;
  account: {
    approvedOutcomeArtifact: AccountFetcher;
    outcomeConfig: AccountFetcher;
    programConfig: AccountFetcher;
  };
};

type ProgramConfigAccount = {
  admin: PublicKey | string;
  allowUnreviewedBinding?: boolean;
  feeLamports?: unknown;
  fee_lamports?: unknown;
  treasury: PublicKey | string;
};

type ApprovedOutcomeArtifactAccount = {
  isFinalized: boolean;
  status: number;
};

type OutcomeConfigAccount = {
  nextResolveId?: unknown;
  next_resolve_id?: unknown;
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
  outcomeIds?: string[];
  winnersCount?: number;
  artifactFormatVersion?: number;
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

function outcomeProgram(client: OutcomeClient): OutcomeProgram {
  return client.program as OutcomeProgram;
}

function outcomeMethods(client: OutcomeClient): OutcomeMethods {
  return outcomeProgram(client).methods;
}

function outcomeAccounts(client: OutcomeClient): OutcomeProgram["account"] {
  return outcomeProgram(client).account;
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
  const connection = new anchor.web3.Connection(url, { commitment: "confirmed" });
  const walletPath = expandHome(
    opts.walletPath ?? process.env.ANCHOR_WALLET ?? DEFAULT_WALLET_PATH
  );
  const keypair = loadKeypair(walletPath);
  const authority: OperatorAuthority = {
    kind: "keypair",
    keypair,
    publicKey: keypair.publicKey,
  };
  const wallet = new anchor.Wallet(keypair);

  const provider = new anchor.AnchorProvider(
    connection,
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

type ComputeBudgetOptions = { units?: number; heapBytes?: number };

// rng_v2 prepare/settle on a compact artifact parse the whole outcome table on-chain:
// they need a raised compute limit and the enlarged heap frame the program's allocator uses.
const RNG_V2_BUDGET: ComputeBudgetOptions = { units: 1_400_000, heapBytes: 256 * 1024 };

async function sendOperatorInstructions(
  client: OutcomeClient,
  instructions: TransactionInstruction[],
  budget?: ComputeBudgetOptions
): Promise<string> {
  if (instructions.length === 0) {
    throw new Error("No operator instructions to send");
  }

  const preamble: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: PRIORITY_FEE_MICRO_LAMPORTS,
    }),
  ];
  if (budget?.units) {
    preamble.push(ComputeBudgetProgram.setComputeUnitLimit({ units: budget.units }));
  }
  if (budget?.heapBytes) {
    preamble.push(ComputeBudgetProgram.requestHeapFrame({ bytes: budget.heapBytes }));
  }
  const tx = new Transaction().add(...preamble, ...instructions);
  return client.provider.sendAndConfirm(tx, []);
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
  const [programDataPda] = PublicKey.findProgramAddressSync(
    [client.programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID
  );
  const info = await client.provider.connection.getAccountInfo(
    programConfigPda,
    "confirmed"
  );
  if (!info) {
    const instruction = await outcomeMethods(client)
      .initializeProgramConfig({
        feeLamports: new BN(0),
        treasury: client.authority.publicKey,
      })
      .accounts({
        payer: client.authority.publicKey,
        program: client.programId,
        programData: programDataPda,
        upgradeAuthority: client.authority.publicKey,
        programConfig: programConfigPda,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    await sendOperatorInstructions(client, [instruction]);
    return programConfigPda;
  }

  const programConfig = await outcomeAccounts(client).programConfig.fetch(
    programConfigPda,
    "confirmed"
  ) as ProgramConfigAccount;
  const currentAdmin = new PublicKey(programConfig.admin);
  if (!currentAdmin.equals(client.authority.publicKey)) {
    throw new Error(
      `ProgramConfig admin mismatch: expected ${client.authority.publicKey.toBase58()} got ${currentAdmin.toBase58()}`
    );
  }

  if (programConfig.allowUnreviewedBinding) {
    const instruction = await outcomeMethods(client)
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
      .instruction();
    await sendOperatorInstructions(client, [instruction]);
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

function artifactFormatVersion(blob: Buffer): number {
  if (blob.length < 6 || blob.subarray(0, 4).toString("ascii") !== "W3O1") {
    throw new Error("Invalid W3O1 artifact header");
  }
  return blob.readUInt16LE(4);
}

function readonlyRemainingAccounts(pubkeys: PublicKey[]): Array<{
  pubkey: PublicKey;
  isSigner: boolean;
  isWritable: boolean;
}> {
  return pubkeys.map((pubkey) => ({
    pubkey,
    isSigner: false,
    isWritable: false,
  }));
}

async function buildFinalizeCompiledArtifactInstruction(
  client: OutcomeClient,
  artifactPda: PublicKey,
  chunkPdas: PublicKey[]
): Promise<TransactionInstruction> {
  return outcomeMethods(client)
    .finalizeCompiledArtifact()
    .accounts({
      publisher: client.authority.publicKey,
      approvedOutcomeArtifact: artifactPda,
    })
    .remainingAccounts(readonlyRemainingAccounts(chunkPdas))
    .instruction();
}

async function buildReviewCompiledArtifactInstruction(
  client: OutcomeClient,
  opts: {
    artifactPda: PublicKey;
    auditHash?: Buffer;
    artifactUri: string;
  }
): Promise<TransactionInstruction> {
  return outcomeMethods(client)
    .reviewCompiledArtifact({
      status: STATUS_APPROVED,
      auditHash: [...(opts.auditHash ?? Buffer.alloc(32, 0))],
      artifactUri: Buffer.from(opts.artifactUri, "utf8"),
    })
    .accounts({
      programConfig: deriveProgramConfigPda(client.programId),
      admin: client.authority.publicKey,
      approvedOutcomeArtifact: opts.artifactPda,
    })
    .instruction();
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

    const artifactAccount = await outcomeAccounts(client).approvedOutcomeArtifact.fetch(
      artifactPda,
      "confirmed"
    ) as ApprovedOutcomeArtifactAccount;

    if (!artifactAccount.isFinalized) {
      const instruction = await buildFinalizeCompiledArtifactInstruction(
        client,
        artifactPda,
        chunkPdas
      );
      await sendOperatorInstructions(client, [instruction]);
    }

    if (artifactAccount.status !== STATUS_APPROVED) {
      const instruction = await buildReviewCompiledArtifactInstruction(client, {
        artifactPda,
        auditHash: opts.auditHash,
        artifactUri: opts.artifactUri ?? path.basename(artifactPath),
      });
      await sendOperatorInstructions(client, [instruction]);
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

  let instruction = await outcomeMethods(client)
    .submitCompiledArtifact({
      compiledArtifactHash: [...compiledArtifactHash],
      formatVersion: artifactFormatVersion(opts.blob),
      blobLen: opts.blob.length,
    })
    .accounts({
      publisher: client.authority.publicKey,
      approvedOutcomeArtifact: artifactPda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  await sendOperatorInstructions(client, [instruction]);

  const chunkCount = Math.ceil(opts.blob.length / CHUNK_SIZE);
  const chunkPdas: PublicKey[] = [];
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const chunkPda = deriveApprovedArtifactChunkPda(
      client.programId,
      compiledArtifactHash,
      chunkIndex
    );
    chunkPdas.push(chunkPda);

    instruction = await outcomeMethods(client)
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
      .instruction();
    await sendOperatorInstructions(client, [instruction]);

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
      instruction = await outcomeMethods(client)
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
        .instruction();
      await sendOperatorInstructions(client, [instruction]);
    }
  }

  instruction = await buildFinalizeCompiledArtifactInstruction(
    client,
    artifactPda,
    chunkPdas
  );
  await sendOperatorInstructions(client, [instruction]);

  instruction = await buildReviewCompiledArtifactInstruction(client, {
    artifactPda,
    auditHash: opts.auditHash,
    artifactUri: opts.artifactUri ?? path.basename(artifactPath),
  });
  await sendOperatorInstructions(client, [instruction]);

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
  }
): Promise<{
  outcomeConfigPda: PublicKey;
  outcomeVaultPda: PublicKey;
  treasury: PublicKey;
}> {
  const outcomeConfigPda = deriveOutcomeConfigPda(client.programId, opts.runtimeId);
  const outcomeVaultPda = deriveOutcomeVaultPda(client.programId, opts.runtimeId);
  const treasury = opts.treasury ?? client.authority.publicKey;

  const instruction = await outcomeMethods(client)
    .initializeOutcomeConfig({
      runtimeId: [...opts.runtimeId],
      minInputLamports: new BN(opts.minInputLamports.toString()),
      maxInputLamports: new BN(opts.maxInputLamports.toString()),
      compiledArtifactHash: [...opts.compiledArtifactHash],
      masterSeed: [...opts.masterSeed],
    })
    .accounts({
      authority: client.authority.publicKey,
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
    .remainingAccounts(readonlyRemainingAccounts(opts.chunkPdas))
    .instruction();
  await sendOperatorInstructions(client, [instruction]);

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
  }
): Promise<string> {
  const instruction = await outcomeMethods(client)
    .refreshMasterSeed({
      runtimeId: [...opts.runtimeId],
      newMasterSeed: [...opts.newMasterSeed],
    })
    .accounts({
      authority: client.authority.publicKey,
      programConfig: deriveProgramConfigPda(client.programId),
      outcomeConfig: deriveOutcomeConfigPda(client.programId, opts.runtimeId),
    })
    .instruction();
  return sendOperatorInstructions(client, [instruction]);
}

async function fetchOutcomeConfigState(
  client: OutcomeClient,
  runtimeId: Buffer
): Promise<OutcomeConfigState> {
  const decoded = await outcomeAccounts(client).outcomeConfig.fetch(
    deriveOutcomeConfigPda(client.programId, runtimeId),
    "confirmed"
  ) as OutcomeConfigAccount;
  return {
    nextResolveId: asBigInt(decoded.nextResolveId ?? decoded.next_resolve_id),
  };
}

async function fetchProgramConfigState(
  client: OutcomeClient
): Promise<ProgramConfigState> {
  const decoded = await outcomeAccounts(client).programConfig.fetch(
    deriveProgramConfigPda(client.programId),
    "confirmed"
  ) as ProgramConfigAccount;
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
    treasury?: PublicKey;
    protocolTreasury?: PublicKey;
  }
): Promise<{ signature: string; resolveId: bigint }> {
  const resolveId = (await fetchOutcomeConfigState(client, opts.runtimeId))
    .nextResolveId;
  const outcomeResolutionPda = deriveOutcomeResolutionPda(
    client.programId,
    opts.runtimeId,
    resolveId
  );
  const instruction = await outcomeMethods(client)
    .resolveOutcome({
      runtimeId: [...opts.runtimeId],
      inputLamports: new BN(opts.inputLamports.toString()),
    })
    .accounts({
      actor: client.authority.publicKey,
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
    .remainingAccounts(readonlyRemainingAccounts(opts.chunkPdas))
    .instruction();

  const signature = await sendOperatorInstructions(client, [instruction]);
  await client.provider.connection.confirmTransaction(signature, "confirmed");
  return { signature, resolveId };
}

function padOutcomeId(id: string): Buffer {
  const raw = Buffer.from(id, "ascii");
  if (raw.length === 0 || raw.length > 64) {
    throw new Error(`Invalid outcome id length for snapshot claim: ${id}`);
  }
  const out = Buffer.alloc(64, 0);
  raw.copy(out, 0);
  return out;
}

async function resolveOutcomeV4AndConfirm(
  client: OutcomeClient,
  opts: {
    runtimeId: Buffer;
    inputLamports: bigint;
    chunkPdas: PublicKey[];
    compiledArtifactHash: Buffer;
    winnerIds: string[];
    treasury?: PublicKey;
    protocolTreasury?: PublicKey;
  }
): Promise<{ signature: string; resolveId: bigint }> {
  const resolveId = (await fetchOutcomeConfigState(client, opts.runtimeId)).nextResolveId;
  const outcomeResolutionPda = deriveOutcomeResolutionPda(
    client.programId,
    opts.runtimeId,
    resolveId
  );
  const instruction = await (client.program.methods as any)
    .resolveOutcomeV4({
      runtimeId: [...opts.runtimeId],
      inputLamports: new BN(opts.inputLamports.toString()),
      outcomeIdLens: Buffer.from(
        opts.winnerIds.map((id) => Buffer.byteLength(id, "ascii"))
      ),
      outcomeIds: opts.winnerIds.map((id) => padOutcomeId(id)),
    })
    .accounts({
      actor: client.authority.publicKey,
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
    .instruction();

  const signature = await sendOperatorInstructions(client, [instruction]);
  await client.provider.connection.confirmTransaction(signature, "confirmed");
  return { signature, resolveId };
}

async function resolveOutcomeV121AndConfirm(
  client: OutcomeClient,
  opts: {
    runtimeId: Buffer;
    inputLamports: bigint;
    chunkPdas: PublicKey[];
    compiledArtifactHash: Buffer;
    winnerIds: string[];
    winnerClaimHash: Buffer;
    treasury?: PublicKey;
    protocolTreasury?: PublicKey;
  }
): Promise<{ signature: string; resolveId: bigint }> {
  const resolveId = (await fetchOutcomeConfigState(client, opts.runtimeId)).nextResolveId;
  const outcomeResolutionPda = deriveOutcomeResolutionPda(
    client.programId,
    opts.runtimeId,
    resolveId
  );
  const primaryWinnerId = opts.winnerIds[0];
  const instruction = await (client.program.methods as any)
    .resolveOutcomeV121({
      runtimeId: [...opts.runtimeId],
      inputLamports: new BN(opts.inputLamports.toString()),
      winnerCount: opts.winnerIds.length,
      winnerClaimHash: [...opts.winnerClaimHash],
      outcomeIdLen: Buffer.byteLength(primaryWinnerId, "ascii"),
      outcomeId: padOutcomeId(primaryWinnerId),
    })
    .accounts({
      actor: client.authority.publicKey,
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
    .instruction();

  const signature = await sendOperatorInstructions(client, [instruction]);
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
    newMasterSeed: REFRESHED_MASTER_SEED,
  });

  const programConfig = await fetchProgramConfigState(client);
  const protocolTreasury =
    programConfig.feeLamports > 0n
      ? programConfig.treasury
      : client.authority.publicKey;
  const resolution =
    config.type === "formula_draw_snapshot" || config.type === "outcome_standard_v1_2"
      ? await resolveOutcomeV4AndConfirm(client, {
          runtimeId: runtime.runtimeId,
          inputLamports: runtime.minInputLamports,
          chunkPdas: runtime.chunkPdas,
          compiledArtifactHash: runtime.compiledArtifactHash,
          treasury: runtime.treasury,
          protocolTreasury,
          winnerIds: (
            await buildSnapshotClaimFromFile({
              snapshotPath: config.snapshot_uri,
              formula: config.formula,
              winnersCount: Number(config.winners_count ?? 1),
              randomness: deriveResolveRandomness(
                REFRESHED_MASTER_SEED,
                runtime.runtimeId,
                (await fetchOutcomeConfigState(client, runtime.runtimeId)).nextResolveId,
                client.authority.publicKey.toBuffer()
              ),
              payoutLamports: asBigInt(config.payout_lamports ?? 3),
              ...(config.target === undefined
                ? {}
                : { targetScore: asBigInt(config.target) }),
            })
          ).outcomeIds,
        })
      : config.type === "outcome_standard_v1_2_1"
      ? await (async () => {
          const claim = await buildSnapshotClaimFromFile({
            snapshotPath: config.snapshot_uri,
            formula: config.formula,
            winnersCount: Number(config.winners_count ?? 1),
            randomness: deriveResolveRandomness(
              REFRESHED_MASTER_SEED,
              runtime.runtimeId,
              (await fetchOutcomeConfigState(client, runtime.runtimeId)).nextResolveId,
              client.authority.publicKey.toBuffer()
            ),
            payoutLamports: asBigInt(config.payout_lamports ?? 3),
            ...(config.target === undefined
              ? {}
              : { targetScore: asBigInt(config.target) }),
          });
          return resolveOutcomeV121AndConfirm(client, {
            runtimeId: runtime.runtimeId,
            inputLamports: runtime.minInputLamports,
            chunkPdas: runtime.chunkPdas,
            compiledArtifactHash: runtime.compiledArtifactHash,
            treasury: runtime.treasury,
            protocolTreasury,
            winnerIds: claim.outcomeIds,
            winnerClaimHash: claim.winnerClaimHash,
          });
        })()
      : await resolveOutcomeAndConfirm(client, {
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

  const result: ResolveInlineResult = {
    signature: base.signature,
    outcome: verified.outcome_id,
    outcomeIds: verified.outcome_ids,
    winnersCount: verified.winners_count,
    artifactFormatVersion: verified.artifact_format_version,
    runtimeId: base.runtime_id,
    resolveId: base.resolve_id,
    artifactHash: base.compiled_artifact_hash,
    programId: base.program_id,
    artifactPath: base.artifact_path,
    resultPath: base.result_path,
  };

  return result;
}

// ---------------------------------------------------------------------------------------
// rng_v2 single-phase draws (Outcome Standard v1.2) for compact artifacts.
//
// prepareInlineRngV2 commits the artifact, binds a runtime and calls prepare_rng_v2, which
// fixes three future target slots. The winners do not exist yet. Once the last target slot
// has passed, settleInlineRngV2 calls settle_rng_v2: the program reads SlotHashes, derives
// the randomness, selects the winners from the committed table and records them. If the
// settle window is missed, expireInlineRngV2 refunds the stake.
// ---------------------------------------------------------------------------------------

export type RngV2PreparedDraw = {
  programId: string;
  runtimeId: string;
  resolveId: string;
  artifactHash: string;
  chunkCount: number;
  winnersCount: number;
  actor: string;
  targetSlots: string[];
  expirySlot: string;
  prepareSignature: string;
  artifactPath: string;
};

export type RngV2SettleResult = {
  signature: string;
  outcome: string;
  outcomeIds: string[];
  winnersCount?: number;
  entropySource?: string;
  resolvedSlots?: string[];
  winnerClaimHash?: string;
  runtimeId: string;
  resolveId: string;
  artifactHash: string;
  programId: string;
};

const SCALE_CONFIG_TYPES = new Set([
  "formula_draw_snapshot",
  "outcome_standard_v1_2",
  "outcome_standard_v1_2_1",
]);

function deriveRngV2StatePda(programId: PublicKey, runtimeId: Buffer, resolveId: bigint): PublicKey {
  const id = Buffer.alloc(8);
  id.writeBigUInt64LE(resolveId, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("rng_v2_state"), runtimeId, id],
    programId
  )[0];
}

async function fetchRngV2State(client: OutcomeClient, statePda: PublicKey): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await (outcomeAccounts(client) as any).rngV2State.fetch(statePda, "confirmed");
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError;
}

export async function prepareInlineRngV2(
  config: ArtifactConfig,
  opts: ResolveInlineOptions = {}
): Promise<RngV2PreparedDraw> {
  if (SCALE_CONFIG_TYPES.has(String((config as { type?: string }).type))) {
    throw new Error("rng_v2 inline draws support compact artifacts only; use the snapshot flow for scale draws");
  }
  const rpcUrl = opts.rpcUrl ?? process.env.ANCHOR_PROVIDER_URL ?? DEFAULT_RPC_URL;
  const client = await loadOutcomeClient({
    rpcUrl,
    walletPath: opts.walletPath,
    programId: opts.programId,
  });
  await ensureWalletFunds(client);
  await ensureProgramConfig(client);

  const label = opts.label ?? `rngv2-draw-${Date.now()}`;
  const outputDir = outputDirFromArg(opts.outputDir);
  ensureDirectory(outputDir);
  const inputLamports = asBigInt(config.input_lamports);

  const runtime = await createApprovedRuntime(client, { label, outputDir, config, inputLamports });
  const resolveId = asBigInt(
    (await fetchOutcomeConfigState(client, runtime.runtimeId)).nextResolveId
  );
  const statePda = deriveRngV2StatePda(client.programId, runtime.runtimeId, resolveId);

  const instruction = await (outcomeMethods(client) as any)
    .prepareRngV2({
      runtimeId: [...runtime.runtimeId],
      inputLamports: new BN(inputLamports.toString()),
      bountyLamports: new BN(0),
      operatorCommitPresent: false,
      operatorCommitHash: [...Buffer.alloc(32, 0)],
    })
    .accounts({
      actor: client.authority.publicKey,
      programConfig: deriveProgramConfigPda(client.programId),
      outcomeConfig: runtime.outcomeConfigPda,
      outcomeVault: runtime.outcomeVaultPda,
      rngV2State: statePda,
      approvedOutcomeArtifact: deriveApprovedArtifactPda(
        client.programId,
        runtime.compiledArtifactHash
      ),
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(readonlyRemainingAccounts(runtime.chunkPdas))
    .instruction();
  const prepareSignature = await sendOperatorInstructions(client, [instruction], RNG_V2_BUDGET);

  const state = await fetchRngV2State(client, statePda);
  return {
    programId: client.programId.toBase58(),
    runtimeId: runtime.runtimeIdHex,
    resolveId: resolveId.toString(),
    artifactHash: runtime.compiledArtifactHashHex,
    chunkCount: runtime.chunkPdas.length,
    winnersCount: Number((config as { winners_count?: number }).winners_count ?? 1),
    actor: client.authority.publicKey.toBase58(),
    targetSlots: (state.targetSlots as unknown[]).map((slot) => asBigInt(slot).toString()),
    expirySlot: asBigInt(state.expirySlot).toString(),
    prepareSignature,
    artifactPath: runtime.artifactPath,
  };
}

export async function settleInlineRngV2(
  draw: RngV2PreparedDraw,
  opts: ResolveInlineOptions = {}
): Promise<RngV2SettleResult> {
  const rpcUrl = opts.rpcUrl ?? process.env.ANCHOR_PROVIDER_URL ?? DEFAULT_RPC_URL;
  const client = await loadOutcomeClient({
    rpcUrl,
    walletPath: opts.walletPath,
    programId: draw.programId,
  });
  const runtimeId = Buffer.from(draw.runtimeId, "hex");
  const resolveId = BigInt(draw.resolveId);
  const artifactHash = Buffer.from(draw.artifactHash, "hex");
  const outcomeConfigPda = deriveOutcomeConfigPda(client.programId, runtimeId);

  const programConfig = await fetchProgramConfigState(client);
  const protocolTreasury =
    programConfig.feeLamports > 0n ? programConfig.treasury : client.authority.publicKey;
  const outcomeConfig = await (outcomeAccounts(client) as any).outcomeConfig.fetch(
    outcomeConfigPda,
    "confirmed"
  );
  const chunkPdas = Array.from({ length: draw.chunkCount }, (_, index) =>
    deriveApprovedArtifactChunkPda(client.programId, artifactHash, index)
  );

  // Compact artifact: the program selects the winners, so every winner argument stays empty.
  const instruction = await (outcomeMethods(client) as any)
    .settleRngV2({
      runtimeId: [...runtimeId],
      resolveId: new BN(draw.resolveId),
      winnerCount: draw.winnersCount,
      winnerClaimHash: [...Buffer.alloc(32, 0)],
      outcomeIdLen: 0,
      outcomeId: [...Buffer.alloc(64, 0)],
      operatorRevealLen: 0,
      operatorReveal: [...Buffer.alloc(32, 0)],
    })
    .accounts({
      actor: client.authority.publicKey,
      programConfig: deriveProgramConfigPda(client.programId),
      outcomeConfig: outcomeConfigPda,
      outcomeVault: deriveOutcomeVaultPda(client.programId, runtimeId),
      rngV2State: deriveRngV2StatePda(client.programId, runtimeId, resolveId),
      outcomeResolution: deriveOutcomeResolutionPda(client.programId, runtimeId, resolveId),
      approvedOutcomeArtifact: deriveApprovedArtifactPda(client.programId, artifactHash),
      outcomeTreasury: outcomeConfig.treasury,
      protocolTreasury,
      slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(readonlyRemainingAccounts(chunkPdas))
    .instruction();
  const signature = await sendOperatorInstructions(client, [instruction], RNG_V2_BUDGET);

  // A fresh transaction can lag on public RPC; retry the replay briefly before failing.
  let verified = await verifyOutcome({ signature, rpcUrl, programId: draw.programId });
  for (let attempt = 0; attempt < 4 && verified.status !== "MATCH"; attempt += 1) {
    if (!/TX_NOT_FOUND|REPLAY_UNHANDLED/.test(verified.reason)) break;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    verified = await verifyOutcome({ signature, rpcUrl, programId: draw.programId });
  }
  if (verified.status !== "MATCH") {
    throw new Error(`rng_v2 replay failed after settle: ${verified.reason}`);
  }

  return {
    signature,
    outcome: verified.outcome_id,
    outcomeIds: verified.outcome_ids ?? [verified.outcome_id],
    winnersCount: verified.winners_count,
    entropySource: verified.entropy_source,
    resolvedSlots: verified.resolved_slots,
    winnerClaimHash: verified.winner_claim_hash,
    runtimeId: draw.runtimeId,
    resolveId: draw.resolveId,
    artifactHash: draw.artifactHash,
    programId: draw.programId,
  };
}

export async function expireInlineRngV2(
  draw: RngV2PreparedDraw,
  opts: ResolveInlineOptions = {}
): Promise<string> {
  const rpcUrl = opts.rpcUrl ?? process.env.ANCHOR_PROVIDER_URL ?? DEFAULT_RPC_URL;
  const client = await loadOutcomeClient({
    rpcUrl,
    walletPath: opts.walletPath,
    programId: draw.programId,
  });
  const runtimeId = Buffer.from(draw.runtimeId, "hex");
  const resolveId = BigInt(draw.resolveId);
  const programConfig = await fetchProgramConfigState(client);
  const instruction = await (outcomeMethods(client) as any)
    .expireRngV2({ runtimeId: [...runtimeId], resolveId: new BN(draw.resolveId) })
    .accounts({
      payer: client.authority.publicKey,
      programConfig: deriveProgramConfigPda(client.programId),
      outcomeConfig: deriveOutcomeConfigPda(client.programId, runtimeId),
      outcomeVault: deriveOutcomeVaultPda(client.programId, runtimeId),
      rngV2State: deriveRngV2StatePda(client.programId, runtimeId, resolveId),
      operator: new PublicKey(draw.actor),
      protocolTreasury: programConfig.treasury,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return sendOperatorInstructions(client, [instruction]);
}

export type RngV2ResolveResult = ResolveInlineResult & {
  rngVersion: 2;
  prepareSignature: string;
  targetSlots: string[];
  expirySlot: string;
  resolvedSlots?: string[];
  entropySource?: string;
  winnerClaimHash?: string;
};

// Wait until the cluster has passed `targetSlot`, sleeping by the slot clock instead of
// polling every few hundred milliseconds, and fail once the settle window has closed.
async function waitForSlotAfter(rpcUrl: string, targetSlot: bigint, expirySlot: bigint): Promise<void> {
  const connection = new anchor.web3.Connection(rpcUrl, { commitment: "confirmed" });
  for (;;) {
    const slot = BigInt(await connection.getSlot("confirmed"));
    if (slot > expirySlot) throw new Error("rng_v2 settle window passed before the target slots matured");
    if (slot > targetSlot) return;
    const slotsLeft = Number(targetSlot - slot) + 1;
    await new Promise((resolve) => setTimeout(resolve, Math.min(8000, Math.max(800, slotsLeft * 400))));
  }
}

const SETTLE_RETRYABLE = /RngV2TargetSlotNotReady|RngV2SlotHashNotFound|429|blockhash/i;

/**
 * Single-phase rng_v2 draw in one call (Outcome Standard v1.2): commit the rules, prepare
 * (fixes future target slots), wait for those slots, settle and replay. The winners come from
 * the hashes of slots that did not exist when the rules were committed.
 */
export async function resolveInlineRngV2(
  config: ArtifactConfig,
  opts: ResolveInlineOptions = {}
): Promise<RngV2ResolveResult> {
  const rpcUrl = opts.rpcUrl ?? process.env.ANCHOR_PROVIDER_URL ?? DEFAULT_RPC_URL;
  const draw = await prepareInlineRngV2(config, { ...opts, rpcUrl });
  const lastTarget = BigInt(draw.targetSlots[draw.targetSlots.length - 1]);
  const expiry = BigInt(draw.expirySlot);

  let settled: RngV2SettleResult | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 4 && !settled; attempt += 1) {
    await waitForSlotAfter(rpcUrl, lastTarget + BigInt(attempt * 2), expiry);
    try {
      settled = await settleInlineRngV2(draw, { ...opts, rpcUrl });
    } catch (error) {
      lastError = error;
      if (!SETTLE_RETRYABLE.test(String((error as Error)?.message ?? error))) break;
    }
  }
  if (!settled) {
    const reason = String((lastError as Error)?.message ?? lastError);
    throw new Error(`rng_v2 settle failed after prepare ${draw.prepareSignature}: ${reason}`);
  }

  return {
    signature: settled.signature,
    outcome: settled.outcome,
    outcomeIds: settled.outcomeIds,
    winnersCount: settled.winnersCount,
    runtimeId: draw.runtimeId,
    resolveId: draw.resolveId,
    artifactHash: draw.artifactHash,
    programId: draw.programId,
    artifactPath: draw.artifactPath,
    resultPath: "",
    rngVersion: 2,
    prepareSignature: draw.prepareSignature,
    targetSlots: draw.targetSlots,
    expirySlot: draw.expirySlot,
    resolvedSlots: settled.resolvedSlots,
    entropySource: settled.entropySource,
    winnerClaimHash: settled.winnerClaimHash,
  };
}
