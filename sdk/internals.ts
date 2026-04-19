import crypto from "crypto";
import { PublicKey } from "@solana/web3.js";

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

export function deriveOutcomeVaultPda(
  programId: PublicKey,
  runtimeId: Buffer
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("outcome_vault"), runtimeId],
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
