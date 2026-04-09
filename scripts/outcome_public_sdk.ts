import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { PublicKey } from "@solana/web3.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const REFERENCE_ROOT = path.resolve(__dirname, "..");
export const DEFAULT_PROGRAM_ID =
  "3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq";
export const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
export const CHUNK_SIZE = 1024;

function u32le(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value, 0);
  return out;
}

function u64le(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value, 0);
  return out;
}

export function sha256(bytes: Buffer): Buffer {
  return crypto.createHash("sha256").update(bytes).digest();
}

export function toHex(bytes: number[] | Buffer): string {
  return Buffer.from(bytes).toString("hex");
}

export function outcomeIdlPath(): string {
  return path.join(REFERENCE_ROOT, "artifacts", "outcome_idl.json");
}

export function blessedSignaturesPath(): string {
  return path.join(
    REFERENCE_ROOT,
    "artifacts",
    "outcome_devnet_blessed_signatures.json"
  );
}

export function publicEvidenceSummaryPath(): string {
  return path.join(
    REFERENCE_ROOT,
    "artifacts",
    "public_evidence_summary.json"
  );
}

export function compiledSpecPath(): string {
  return path.join(REFERENCE_ROOT, "artifacts", "compiled_spec_v2.json");
}

export function metricsPath(): string {
  return path.join(REFERENCE_ROOT, "artifacts", "metrics.json");
}

export function deriveProgramConfigPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("outcome_program_config")],
    programId
  )[0];
}

export function deriveApprovedArtifactPda(
  programId: PublicKey,
  compiledArtifactHash: Buffer
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("approved_outcome_artifact"), compiledArtifactHash],
    programId
  )[0];
}

export function deriveApprovedArtifactChunkPda(
  programId: PublicKey,
  compiledArtifactHash: Buffer,
  chunkIndex: number
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("approved_outcome_artifact_chunk"),
      compiledArtifactHash,
      u32le(chunkIndex),
    ],
    programId
  )[0];
}

export function deriveOutcomeConfigPda(
  programId: PublicKey,
  runtimeId: Buffer
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("outcome_config"), runtimeId],
    programId
  )[0];
}

export function deriveOutcomeResolutionPda(
  programId: PublicKey,
  runtimeId: Buffer,
  resolveId: bigint
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("outcome_resolution"), runtimeId, u64le(resolveId)],
    programId
  )[0];
}
