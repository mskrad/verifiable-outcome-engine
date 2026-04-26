import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import {
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";

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
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);
const STATUS_APPROVED = 1;
const CHUNK_WRITE_BYTES = 900;

type OutcomeClient = {
  provider: anchor.AnchorProvider;
  program: anchor.Program;
  authority: OperatorAuthority;
  programId: PublicKey;
};

type OperatorAuthority =
  | { kind: "keypair"; keypair: Keypair; publicKey: PublicKey }
  | {
      kind: "swig";
      swigAddress: PublicKey;
      swigWalletAddress: PublicKey;
      delegate: Keypair;
      roleId?: number;
      publicKey: PublicKey;
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
  swigWallet?: ResolveInlineSwigWallet;
};

export type ResolveInlineSwigWallet = {
  swigAddress: string;
  delegateKeypairPath?: string;
  delegateKeypair?: Keypair;
  roleId?: number;
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

async function loadSwigClassic() {
  const mod = await import("@swig-wallet/classic");
  return ((mod as any).default ?? mod) as typeof import("@swig-wallet/classic");
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
  swigWallet?: ResolveInlineSwigWallet;
}): Promise<OutcomeClient> {
  const url = opts.rpcUrl ?? process.env.ANCHOR_PROVIDER_URL ?? DEFAULT_RPC_URL;
  const connection = new anchor.web3.Connection(url, { commitment: "confirmed" });
  let authority: OperatorAuthority;
  let wallet: anchor.Wallet;

  if (opts.swigWallet) {
    const delegate =
      opts.swigWallet.delegateKeypair ??
      (opts.swigWallet.delegateKeypairPath
        ? loadKeypair(expandHome(opts.swigWallet.delegateKeypairPath))
        : undefined);
    if (!delegate) {
      throw new Error("Swig operator requires delegateKeypairPath or delegateKeypair");
    }
    const swigAddress = new PublicKey(opts.swigWallet.swigAddress);
    const { fetchSwig, getSwigWalletAddress } = await loadSwigClassic();
    const swig = await fetchSwig(connection, swigAddress, {
      commitment: "confirmed",
    });
    const swigWalletAddress = await getSwigWalletAddress(swig);
    authority = {
      kind: "swig",
      swigAddress,
      swigWalletAddress,
      delegate,
      roleId: opts.swigWallet.roleId,
      publicKey: swigWalletAddress,
    };
    wallet = new anchor.Wallet(delegate);
  } else {
    const walletPath = expandHome(
      opts.walletPath ?? process.env.ANCHOR_WALLET ?? DEFAULT_WALLET_PATH
    );
    const keypair = loadKeypair(walletPath);
    authority = {
      kind: "keypair",
      keypair,
      publicKey: keypair.publicKey,
    };
    wallet = new anchor.Wallet(keypair);
  }

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

async function sendOperatorInstructions(
  client: OutcomeClient,
  instructions: TransactionInstruction[]
): Promise<string> {
  if (instructions.length === 0) {
    throw new Error("No operator instructions to send");
  }

  const connection = client.provider.connection;
  if (client.authority.kind === "keypair") {
    const tx = new Transaction().add(...instructions);
    return client.provider.sendAndConfirm(tx, []);
  }

  const { fetchSwig, getSignInstructions } = await loadSwigClassic();
  const swig = await fetchSwig(connection, client.authority.swigAddress, {
    commitment: "confirmed",
  });
  const role =
    typeof client.authority.roleId === "number"
      ? swig.findRoleById(client.authority.roleId)
      : swig.findRolesByEd25519SignerPk(client.authority.delegate.publicKey)[0];
  if (!role) {
    throw new Error(
      `Swig delegate role not found for ${client.authority.delegate.publicKey.toBase58()}`
    );
  }
  const signedInstructions = await getSignInstructions(
    swig,
    role.id,
    instructions,
    false,
    { payer: client.authority.delegate.publicKey }
  );
  const tx = new Transaction().add(...signedInstructions);
  tx.feePayer = client.authority.delegate.publicKey;
  return sendAndConfirmTransaction(connection, tx, [client.authority.delegate], {
    commitment: "confirmed",
  });
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
  if (client.authority.kind === "swig") {
    throw new Error(
      `Swig wallet ${client.authority.swigWalletAddress.toBase58()} has insufficient balance: ${balance} lamports`
    );
  }
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
    const instruction = await (client.program.methods as any)
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
    const instruction = await (client.program.methods as any)
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
      const instruction = await (client.program.methods as any)
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
        .instruction();
      await sendOperatorInstructions(client, [instruction]);
    }

    if (artifactAccount.status !== STATUS_APPROVED) {
      const instruction = await (client.program.methods as any)
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
        .instruction();
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

  let instruction = await (client.program.methods as any)
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

    instruction = await (client.program.methods as any)
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
      instruction = await (client.program.methods as any)
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

  instruction = await (client.program.methods as any)
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
    .instruction();
  await sendOperatorInstructions(client, [instruction]);

  instruction = await (client.program.methods as any)
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
    .instruction();
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

  const instruction = await (client.program.methods as any)
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
    .remainingAccounts(
      opts.chunkPdas.map((pubkey) => ({
        pubkey,
        isSigner: false,
        isWritable: false,
      }))
    )
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
  const instruction = await (client.program.methods as any)
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
  const instruction = await (client.program.methods as any)
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
    swigWallet?: ResolveInlineSwigWallet;
  }
): Promise<ResolveOperatorResult> {
  const inputLamports = asBigInt(config.input_lamports);
  const client = await loadOutcomeClient({
    rpcUrl: opts.rpcUrl,
    walletPath: opts.walletPath,
    programId: opts.programId,
    swigWallet: opts.swigWallet,
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
    swigWallet: opts.swigWallet,
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
}
