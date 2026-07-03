/**
 * Sortition-by-Claim (v1.4.0) + sortition economics (v1.4.1) builders.
 *
 * Part of the canonical protocol on the devnet program `6QtLot…`. The default
 * resolution path remains replay-by-signature + global-Ω resolve; sortition is a
 * canonical alternative resolution path. See README.md "Resolution Paths".
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_SLOT_HASHES_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

import { DEFAULT_PROGRAM_ID } from "./internals.js";

/** Maturity tag for the sortition path (canonical on devnet). */
export const SORTITION_MATURITY = "canonical-devnet" as const;

/**
 * Maturity tag for the Unicorn-G entropy path: canonical but opt-in. The default
 * entropy source remains SlotHashes; Unicorn-G is selected explicitly per draw
 * and relies on a Groth16 trusted setup (devnet RSA modulus).
 */
export const UNICORN_G_MATURITY = "canonical-opt-in" as const;

/** Sortition standard version (v1.4.0). */
export const SORTITION_STANDARD_VERSION = "1.4.0" as const;
/** Sortition economics standard version (v1.4.1). */
export const SORTITION_ECONOMICS_VERSION = "1.4.1" as const;

/** Canonical devnet program id that carries the full protocol. */
export const CANONICAL_PROGRAM_ID = DEFAULT_PROGRAM_ID;
/** Default program id for sortition builders (canonical). */
export const SORTITION_PROGRAM_ID = DEFAULT_PROGRAM_ID;

/** fee_mode bitflags (mirror programs/outcome state/sortition.rs). */
export const SORTITION_FEE_ENTRY = 1 << 0;
export const SORTITION_FEE_CLOSE_SKIM = 1 << 1;

// --- IDL loading (canonical outcome IDL, full protocol) ----------------------

const SDK_DIR = path.dirname(fileURLToPath(import.meta.url));
const IDL_CANDIDATES = [
  path.resolve(SDK_DIR, "../artifacts/outcome_idl.json"),
  path.resolve(SDK_DIR, "../../artifacts/outcome_idl.json"),
  path.resolve(process.cwd(), "artifacts/outcome_idl.json"),
];

type IdlInstruction = { name: string; discriminator: number[] };
type OutcomeIdl = { address?: string; instructions: IdlInstruction[] };

let cachedIdl: OutcomeIdl | null = null;

function loadOutcomeIdl(): OutcomeIdl {
  if (cachedIdl) return cachedIdl;
  for (const candidate of IDL_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      cachedIdl = JSON.parse(fs.readFileSync(candidate, "utf8")) as OutcomeIdl;
      return cachedIdl;
    }
  }
  throw new Error(
    `Unable to locate outcome IDL (sortition surface). Checked: ${IDL_CANDIDATES.join(", ")}`
  );
}

function discriminatorFor(name: string): Buffer {
  const idl = loadOutcomeIdl();
  const ix = idl.instructions.find((entry) => entry.name === name);
  if (!ix || !Array.isArray(ix.discriminator)) {
    throw new Error(`Outcome IDL is missing discriminator for ${name}`);
  }
  return Buffer.from(ix.discriminator);
}

// --- byte helpers ------------------------------------------------------------

function toBuf(value: Buffer | Uint8Array | number[], expectedLen: number, label: string): Buffer {
  const buf = Buffer.from(value);
  if (buf.length !== expectedLen) {
    throw new Error(`${label} must be ${expectedLen} bytes (got ${buf.length})`);
  }
  return buf;
}

function u64le(value: bigint | number): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(typeof value === "bigint" ? value : BigInt(value), 0);
  return out;
}

function u16le(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value, 0);
  return out;
}

export function sha256(...parts: Array<Buffer | Uint8Array | string>): Buffer {
  const hasher = crypto.createHash("sha256");
  for (const part of parts) hasher.update(part);
  return hasher.digest();
}

// --- PDA derivations ---------------------------------------------------------

export function deriveSortitionDrawPda(programId: PublicKey, drawId: Buffer): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sortition_draw"), drawId],
    programId
  )[0];
}

export function deriveSortitionTicketPda(
  programId: PublicKey,
  drawId: Buffer,
  ticketId: Buffer
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sortition_ticket"), drawId, ticketId],
    programId
  )[0];
}

export function deriveProgramConfigPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("outcome_program_config")],
    programId
  )[0];
}

// --- domain helpers ----------------------------------------------------------

/** commitment = sha256(secret || ticket_id || draw_id). */
export function sortitionCommitment(secret: Buffer, ticketId: Buffer, drawId: Buffer): Buffer {
  return sha256(secret, ticketId, drawId);
}

/** Winning predicate: sha256(secret || omega) < threshold (big-endian). */
export function sortitionWins(secret: Buffer, omega: Buffer, threshold: Buffer): boolean {
  const digest = sha256(secret, omega);
  for (let i = 0; i < 32; i += 1) {
    if (digest[i] < threshold[i]) return true;
    if (digest[i] > threshold[i]) return false;
  }
  return false;
}

/** threshold = floor(2^256 * numerator / denominator), as a 32-byte big-endian value. */
export function sortitionThresholdFromProbability(numerator: bigint, denominator: bigint): Buffer {
  if (denominator <= 0n) throw new Error("denominator must be positive");
  const value = ((1n << 256n) * numerator) / denominator;
  const out = Buffer.alloc(32);
  let cursor = value;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(cursor & 0xffn);
    cursor >>= 8n;
  }
  return out;
}

// --- instruction builders ----------------------------------------------------

function asPublicKey(value: PublicKey | string): PublicKey {
  return typeof value === "string" ? new PublicKey(value) : value;
}

type Meta = { pubkey: PublicKey; isSigner: boolean; isWritable: boolean };

function instruction(
  programId: PublicKey,
  name: string,
  argsData: Buffer,
  keys: Meta[]
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys,
    data: Buffer.concat([discriminatorFor(name), argsData]),
  });
}

export interface CreateSortitionDrawParams {
  programId?: PublicKey | string;
  authority: PublicKey | string;
  drawId: Buffer | Uint8Array | number[];
  threshold: Buffer | Uint8Array | number[];
  registrationDurationSlots: bigint | number;
  claimDurationSlots: bigint | number;
  unclaimedRule?: number;
}

/** Build a `create_sortition_draw` instruction. */
export function buildCreateSortitionDrawInstruction(
  params: CreateSortitionDrawParams
): TransactionInstruction {
  const programId = asPublicKey(params.programId ?? SORTITION_PROGRAM_ID);
  const authority = asPublicKey(params.authority);
  const drawId = toBuf(params.drawId, 16, "drawId");
  const threshold = toBuf(params.threshold, 32, "threshold");
  const data = Buffer.concat([
    drawId,
    threshold,
    u64le(params.registrationDurationSlots),
    u64le(params.claimDurationSlots),
    Buffer.from([params.unclaimedRule ?? 0]),
  ]);
  return instruction(programId, "create_sortition_draw", data, [
    { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: deriveSortitionDrawPda(programId, drawId), isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]);
}

export interface RegisterSortitionTicketParams {
  programId?: PublicKey | string;
  participant: PublicKey | string;
  drawId: Buffer | Uint8Array | number[];
  ticketId: Buffer | Uint8Array | number[];
  commitment: Buffer | Uint8Array | number[];
}

/** Build a `register_sortition_ticket` instruction (no entry fee). */
export function buildRegisterSortitionTicketInstruction(
  params: RegisterSortitionTicketParams
): TransactionInstruction {
  const programId = asPublicKey(params.programId ?? SORTITION_PROGRAM_ID);
  const participant = asPublicKey(params.participant);
  const drawId = toBuf(params.drawId, 16, "drawId");
  const ticketId = toBuf(params.ticketId, 16, "ticketId");
  const commitment = toBuf(params.commitment, 32, "commitment");
  const data = Buffer.concat([drawId, ticketId, commitment]);
  return instruction(programId, "register_sortition_ticket", data, [
    { pubkey: participant, isSigner: true, isWritable: true },
    { pubkey: deriveSortitionDrawPda(programId, drawId), isSigner: false, isWritable: true },
    {
      pubkey: deriveSortitionTicketPda(programId, drawId, ticketId),
      isSigner: false,
      isWritable: true,
    },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]);
}

export interface RegisterSortitionTicketPaidParams extends RegisterSortitionTicketParams {
  treasury: PublicKey | string;
}

/** Build a `register_sortition_ticket_paid` instruction (economics, v1.4.1). */
export function buildRegisterSortitionTicketPaidInstruction(
  params: RegisterSortitionTicketPaidParams
): TransactionInstruction {
  const programId = asPublicKey(params.programId ?? SORTITION_PROGRAM_ID);
  const participant = asPublicKey(params.participant);
  const treasury = asPublicKey(params.treasury);
  const drawId = toBuf(params.drawId, 16, "drawId");
  const ticketId = toBuf(params.ticketId, 16, "ticketId");
  const commitment = toBuf(params.commitment, 32, "commitment");
  const data = Buffer.concat([drawId, ticketId, commitment]);
  return instruction(programId, "register_sortition_ticket_paid", data, [
    { pubkey: participant, isSigner: true, isWritable: true },
    { pubkey: deriveSortitionDrawPda(programId, drawId), isSigner: false, isWritable: true },
    {
      pubkey: deriveSortitionTicketPda(programId, drawId, ticketId),
      isSigner: false,
      isWritable: true,
    },
    { pubkey: deriveProgramConfigPda(programId), isSigner: false, isWritable: false },
    { pubkey: treasury, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]);
}

export interface SealSortitionDrawParams {
  programId?: PublicKey | string;
  sealer: PublicKey | string;
  drawId: Buffer | Uint8Array | number[];
}

/** Build a `seal_sortition_draw` instruction. */
export function buildSealSortitionDrawInstruction(
  params: SealSortitionDrawParams
): TransactionInstruction {
  const programId = asPublicKey(params.programId ?? SORTITION_PROGRAM_ID);
  const sealer = asPublicKey(params.sealer);
  const drawId = toBuf(params.drawId, 16, "drawId");
  return instruction(programId, "seal_sortition_draw", drawId, [
    { pubkey: sealer, isSigner: true, isWritable: true },
    { pubkey: deriveSortitionDrawPda(programId, drawId), isSigner: false, isWritable: true },
    { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
  ]);
}

export interface ClaimSortitionTicketParams {
  programId?: PublicKey | string;
  participant: PublicKey | string;
  drawId: Buffer | Uint8Array | number[];
  ticketId: Buffer | Uint8Array | number[];
  secret: Buffer | Uint8Array | number[];
}

/** Build a `claim_sortition_ticket` instruction. */
export function buildClaimSortitionTicketInstruction(
  params: ClaimSortitionTicketParams
): TransactionInstruction {
  const programId = asPublicKey(params.programId ?? SORTITION_PROGRAM_ID);
  const participant = asPublicKey(params.participant);
  const drawId = toBuf(params.drawId, 16, "drawId");
  const ticketId = toBuf(params.ticketId, 16, "ticketId");
  const secret = toBuf(params.secret, 32, "secret");
  const data = Buffer.concat([drawId, ticketId, secret]);
  return instruction(programId, "claim_sortition_ticket", data, [
    { pubkey: participant, isSigner: true, isWritable: true },
    { pubkey: deriveSortitionDrawPda(programId, drawId), isSigner: false, isWritable: true },
    {
      pubkey: deriveSortitionTicketPda(programId, drawId, ticketId),
      isSigner: false,
      isWritable: true,
    },
  ]);
}

export interface CloseSortitionTicketParams {
  programId?: PublicKey | string;
  caller: PublicKey | string;
  owner: PublicKey | string;
  treasury: PublicKey | string;
  drawId: Buffer | Uint8Array | number[];
  ticketId: Buffer | Uint8Array | number[];
}

/** Build a `close_sortition_ticket` instruction. */
export function buildCloseSortitionTicketInstruction(
  params: CloseSortitionTicketParams
): TransactionInstruction {
  const programId = asPublicKey(params.programId ?? SORTITION_PROGRAM_ID);
  const caller = asPublicKey(params.caller);
  const owner = asPublicKey(params.owner);
  const treasury = asPublicKey(params.treasury);
  const drawId = toBuf(params.drawId, 16, "drawId");
  const ticketId = toBuf(params.ticketId, 16, "ticketId");
  const data = Buffer.concat([drawId, ticketId]);
  return instruction(programId, "close_sortition_ticket", data, [
    { pubkey: caller, isSigner: true, isWritable: true },
    { pubkey: deriveSortitionDrawPda(programId, drawId), isSigner: false, isWritable: false },
    {
      pubkey: deriveSortitionTicketPda(programId, drawId, ticketId),
      isSigner: false,
      isWritable: true,
    },
    { pubkey: owner, isSigner: false, isWritable: true },
    { pubkey: deriveProgramConfigPda(programId), isSigner: false, isWritable: false },
    { pubkey: treasury, isSigner: false, isWritable: true },
  ]);
}

export interface SweepSortitionTicketsParams {
  programId?: PublicKey | string;
  caller: PublicKey | string;
  treasury: PublicKey | string;
  drawId: Buffer | Uint8Array | number[];
}

/** Build a `sweep_sortition_tickets` instruction. */
export function buildSweepSortitionTicketsInstruction(
  params: SweepSortitionTicketsParams
): TransactionInstruction {
  const programId = asPublicKey(params.programId ?? SORTITION_PROGRAM_ID);
  const caller = asPublicKey(params.caller);
  const treasury = asPublicKey(params.treasury);
  const drawId = toBuf(params.drawId, 16, "drawId");
  return instruction(programId, "sweep_sortition_tickets", drawId, [
    { pubkey: caller, isSigner: true, isWritable: true },
    { pubkey: deriveSortitionDrawPda(programId, drawId), isSigner: false, isWritable: false },
    { pubkey: deriveProgramConfigPda(programId), isSigner: false, isWritable: false },
    { pubkey: treasury, isSigner: false, isWritable: true },
  ]);
}

export interface InitSortitionEconomicsParams {
  programId?: PublicKey | string;
  authority: PublicKey | string;
  drawId: Buffer | Uint8Array | number[];
  feeMode: number;
  entryFeeLamports: bigint | number;
  closeSkimBps: number;
}

/** Build an `init_sortition_economics` instruction (v1.4.1). */
export function buildInitSortitionEconomicsInstruction(
  params: InitSortitionEconomicsParams
): TransactionInstruction {
  const programId = asPublicKey(params.programId ?? SORTITION_PROGRAM_ID);
  const authority = asPublicKey(params.authority);
  const drawId = toBuf(params.drawId, 16, "drawId");
  const data = Buffer.concat([
    drawId,
    Buffer.from([params.feeMode & 0xff]),
    u64le(params.entryFeeLamports),
    u16le(params.closeSkimBps),
  ]);
  return instruction(programId, "init_sortition_economics", data, [
    { pubkey: authority, isSigner: true, isWritable: false },
    { pubkey: deriveSortitionDrawPda(programId, drawId), isSigner: false, isWritable: true },
  ]);
}

// --- inline executor (used by the partner API) -------------------------------

function expandHome(inputPath: string): string {
  if (!inputPath.startsWith("~")) return inputPath;
  return path.join(os.homedir(), inputPath.slice(1));
}

/** Load an operator keypair for the sortition routes. */
export function loadSortitionKeypair(walletPath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(expandHome(walletPath), "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export interface SortitionClientConfig {
  rpcUrl: string;
  walletPath: string;
  programId?: string;
}

export interface SortitionClient {
  connection: Connection;
  payer: Keypair;
  programId: PublicKey;
}

/** Build a sortition client bound to the canonical program id (overridable). */
export function createSortitionClient(config: SortitionClientConfig): SortitionClient {
  const programId = asPublicKey(config.programId ?? SORTITION_PROGRAM_ID);
  return {
    connection: new Connection(config.rpcUrl, { commitment: "confirmed" }),
    payer: loadSortitionKeypair(config.walletPath),
    programId,
  };
}

async function sendInstruction(
  client: SortitionClient,
  ix: TransactionInstruction
): Promise<string> {
  const tx = new Transaction().add(ix);
  return sendAndConfirmTransaction(client.connection, tx, [client.payer], {
    commitment: "confirmed",
  });
}

/** Create a draw and return the signature + PDA. */
export async function sortitionCreateDrawInline(
  client: SortitionClient,
  params: Omit<CreateSortitionDrawParams, "authority" | "programId">
): Promise<{ signature: string; drawPda: string; maturity: typeof SORTITION_MATURITY }> {
  const drawId = toBuf(params.drawId, 16, "drawId");
  const ix = buildCreateSortitionDrawInstruction({
    ...params,
    programId: client.programId,
    authority: client.payer.publicKey,
  });
  const signature = await sendInstruction(client, ix);
  return {
    signature,
    drawPda: deriveSortitionDrawPda(client.programId, drawId).toBase58(),
    maturity: SORTITION_MATURITY,
  };
}

/** Register a ticket and return the signature + ticket PDA. */
export async function sortitionRegisterTicketInline(
  client: SortitionClient,
  params: Omit<RegisterSortitionTicketParams, "participant" | "programId">
): Promise<{ signature: string; ticketPda: string; maturity: typeof SORTITION_MATURITY }> {
  const drawId = toBuf(params.drawId, 16, "drawId");
  const ticketId = toBuf(params.ticketId, 16, "ticketId");
  const ix = buildRegisterSortitionTicketInstruction({
    ...params,
    programId: client.programId,
    participant: client.payer.publicKey,
  });
  const signature = await sendInstruction(client, ix);
  return {
    signature,
    ticketPda: deriveSortitionTicketPda(client.programId, drawId, ticketId).toBase58(),
    maturity: SORTITION_MATURITY,
  };
}

/** Seal a draw. */
export async function sortitionSealDrawInline(
  client: SortitionClient,
  params: Omit<SealSortitionDrawParams, "sealer" | "programId">
): Promise<{ signature: string; maturity: typeof SORTITION_MATURITY }> {
  const ix = buildSealSortitionDrawInstruction({
    ...params,
    programId: client.programId,
    sealer: client.payer.publicKey,
  });
  const signature = await sendInstruction(client, ix);
  return { signature, maturity: SORTITION_MATURITY };
}

/** Claim a ticket. */
export async function sortitionClaimTicketInline(
  client: SortitionClient,
  params: Omit<ClaimSortitionTicketParams, "participant" | "programId">
): Promise<{ signature: string; maturity: typeof SORTITION_MATURITY }> {
  const ix = buildClaimSortitionTicketInstruction({
    ...params,
    programId: client.programId,
    participant: client.payer.publicKey,
  });
  const signature = await sendInstruction(client, ix);
  return { signature, maturity: SORTITION_MATURITY };
}
