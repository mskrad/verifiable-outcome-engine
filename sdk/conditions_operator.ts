// VRE-operated on-chain flow for the OddSol conditions integration. The partner calls the API;
// VRE does ALL on-chain work with its own (admin) key. Two phases:
//   commit  — anchor the rules (fc7 with empty stats) on-chain before the outcome.
//   resolve — after the match: build the full fc7 (rules + proven facts), submit + finalize +
//             self-review + init OutcomeConfig + resolve_conditions, return the tx signature.
// Reuses sdk/conditions.ts (byte-parity scorer) + sdk/internals.ts (PDAs). No partner key/deploy.
import * as anchor from "@coral-xyz/anchor";
const BN = (anchor as any).BN ?? (anchor as any).default.BN;
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createHash } from "crypto";
import fs from "fs";
import {
  buildConditionsArtifact, parseConditionsArtifact, scoreSlip, rankRound, slipHash,
  winnersDigest, factsRefRoot, winningScoreSum,
  type ConditionsFixture, type ConditionsEntrant,
} from "./conditions.js";
import {
  deriveProgramConfigPda, deriveApprovedArtifactPda, deriveApprovedArtifactChunkPda,
  deriveOutcomeConfigPda, deriveOutcomeVaultPda,
} from "./internals.js";
import { sendAndConfirmSigned } from "./confirm.js";

const CHUNK_SIZE = 1024;
const CHUNK_WRITE_BYTES = 900;
const STATUS_APPROVED = 1;
// sha256("global:resolve_conditions")[..8]
const RESOLVE_CONDITIONS_DISCRIMINATOR = Buffer.from("444dcad7b1c92860", "hex");
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();

export type ConditionsOperator = {
  connection: Connection;
  provider: anchor.AnchorProvider;
  wallet: anchor.Wallet;
  program: anchor.Program;
  m: any;
  programId: PublicKey;
  programConfigPda: PublicKey;
};

export function createConditionsOperator(opts: {
  rpcUrl: string; walletPath: string; programId: string; idl: any;
}): ConditionsOperator {
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(opts.walletPath, "utf8")));
  const wallet = new anchor.Wallet(Keypair.fromSecretKey(secret));
  const connection = new Connection(opts.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed", maxRetries: 5 });
  const programId = new PublicKey(opts.programId);
  const idl = { ...opts.idl, address: programId.toBase58() };
  const program = new anchor.Program(idl as anchor.Idl, provider);
  return { connection, provider, wallet, program, m: program.methods, programId, programConfigPda: deriveProgramConfigPda(programId) };
}

// Submit + chunk + finalize an fc7 blob on-chain (idempotent on hash). Optionally self-review to
// APPROVED (needed before an OutcomeConfig can bind it). Returns the artifact hash + chunk PDAs.
// Anchor `.rpc()` and `sendAndConfirm` confirm through web3.js `confirmTransaction`, whose detached
// status lookup kills the server process on a 429; send through the shared confirmation instead.
function sendTx(op: ConditionsOperator, tx: Transaction): Promise<string> {
  return sendAndConfirmSigned(op.connection, tx, op.wallet.publicKey, (unsigned) =>
    op.provider.wallet.signTransaction(unsigned)
  );
}

async function submitArtifact(op: ConditionsOperator, blob: Buffer, review: boolean): Promise<{
  hash: Buffer; artifactPda: PublicKey; chunkPdas: PublicKey[]; signature: string | null;
}> {
  const hash = sha256(blob);
  const artifactPda = deriveApprovedArtifactPda(op.programId, hash);
  const chunkCount = Math.ceil(blob.length / CHUNK_SIZE);
  const chunkPdas = Array.from({ length: chunkCount }, (_, i) => deriveApprovedArtifactChunkPda(op.programId, hash, i));
  const authority = op.wallet.publicKey;
  let signature: string | null = null;

  const existing = await op.connection.getAccountInfo(artifactPda);
  if (!existing) {
    await op.m.submitCompiledArtifact({ compiledArtifactHash: [...hash], formatVersion: blob.readUInt16LE(4), blobLen: blob.length })
      .accounts({ publisher: authority, approvedOutcomeArtifact: artifactPda, systemProgram: SystemProgram.programId }).transaction().then((tx: Transaction) => sendTx(op, tx));
  }
  // A new artifact, or one an earlier call left half-written: create missing chunks, append each
  // from its on-chain written_len, then finalize.
  const artifactState: any = existing ? await (op.program.account as any).approvedOutcomeArtifact.fetch(artifactPda) : null;
  if (!artifactState || !artifactState.isFinalized) {
    for (let ci = 0; ci < chunkCount; ci++) {
      let written = 0;
      if (!(await op.connection.getAccountInfo(chunkPdas[ci]))) {
        await op.m.initCompiledArtifactChunk({ compiledArtifactHash: [...hash], chunkIndex: ci })
          .accounts({ publisher: authority, approvedOutcomeArtifact: artifactPda, approvedOutcomeArtifactChunk: chunkPdas[ci], systemProgram: SystemProgram.programId }).transaction().then((tx: Transaction) => sendTx(op, tx));
      } else {
        written = Number(((await (op.program.account as any).approvedOutcomeArtifactChunk.fetch(chunkPdas[ci])) as any).writtenLen);
      }
      const chunk = blob.subarray(ci * CHUNK_SIZE, Math.min(blob.length, (ci + 1) * CHUNK_SIZE));
      for (let off = written; off < chunk.length; off += CHUNK_WRITE_BYTES) {
        await op.m.writeCompiledArtifactChunk({ compiledArtifactHash: [...hash], chunkIndex: ci, offset: off, data: Buffer.from(chunk.subarray(off, Math.min(chunk.length, off + CHUNK_WRITE_BYTES))) })
          .accounts({ publisher: authority, approvedOutcomeArtifact: artifactPda, approvedOutcomeArtifactChunk: chunkPdas[ci] }).transaction().then((tx: Transaction) => sendTx(op, tx));
      }
    }
    signature = await op.m.finalizeCompiledArtifact().accounts({ publisher: authority, approvedOutcomeArtifact: artifactPda })
      .remainingAccounts(chunkPdas.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }))).transaction().then((tx: Transaction) => sendTx(op, tx));
  }
  if (review) {
    const acc: any = await (op.program.account as any).approvedOutcomeArtifact.fetch(artifactPda);
    if (Number(acc.status) !== STATUS_APPROVED) {
      await op.m.reviewCompiledArtifact({ status: STATUS_APPROVED, auditHash: [...Buffer.alloc(32, 0)], artifactUri: Buffer.from("oddsol-conditions") })
        .accounts({ programConfig: op.programConfigPda, admin: authority, approvedOutcomeArtifact: artifactPda }).transaction().then((tx: Transaction) => sendTx(op, tx));
    }
  }
  return { hash, artifactPda, chunkPdas, signature };
}

// The fc7 "rules commitment" is the artifact with EMPTY per-fixture stats and a ZEROED
// event_stat_root — it binds the legs, odds, entrants, and fixture skeleton (the rules), but NOT
// the outcome or the facts-ref (both revealed only at resolve). Its hash is the commitment_ref.
function rulesBlob(fixtures: ConditionsFixture[], entrants: ConditionsEntrant[]): Buffer {
  return buildConditionsArtifact(
    fixtures.map((f) => ({ ...f, eventStatRoot: Buffer.alloc(32), stats: [] })),
    entrants
  );
}

export async function commitConditions(op: ConditionsOperator, args: {
  fixtures: ConditionsFixture[]; entrants: ConditionsEntrant[];
}): Promise<{ commitmentRef: string; conditionsHash: string; commitSignature: string | null; committedAtSlot: number }> {
  const blob = rulesBlob(args.fixtures, args.entrants);
  const { hash, signature } = await submitArtifact(op, blob, false);
  const committedAtSlot = await op.connection.getSlot("confirmed");
  return { commitmentRef: hash.toString("hex"), conditionsHash: hash.toString("hex"), commitSignature: signature, committedAtSlot };
}

export async function resolveConditionsRound(op: ConditionsOperator, args: {
  fixtures: ConditionsFixture[]; entrants: ConditionsEntrant[]; commitmentRef?: string;
}): Promise<{
  signature: string; runtimeId: string; artifactHash: string; artifactHex: string; artifactBytes: number;
  winnersCount: number; winningScoreSum: string; winnersDigest: string; factsRefRoot: string;
  winners: string[]; ranking: Array<{ rank: number; wallet: string; all_hit: boolean; score_fixed: string; void_count: number; slip_hash: string }>;
}> {
  // Bind honesty: the rules (empty-stats) hash must equal the commitment made at slate open.
  if (args.commitmentRef) {
    const rulesHash = sha256(rulesBlob(args.fixtures, args.entrants)).toString("hex");
    if (rulesHash !== args.commitmentRef) {
      throw new Error("conditions do not match commitment_ref (rules changed since commit)");
    }
  }

  const blob = buildConditionsArtifact(args.fixtures, args.entrants);
  const { hash, artifactPda, chunkPdas } = await submitArtifact(op, blob, true);

  const runtimeId = Buffer.from(sha256(Buffer.from(`oddsol-${hash.toString("hex")}-${Date.now()}`)).subarray(0, 16));
  const outcomeConfigPda = deriveOutcomeConfigPda(op.programId, runtimeId);
  const outcomeVaultPda = deriveOutcomeVaultPda(op.programId, runtimeId);
  const authority = op.wallet.publicKey;
  await op.m.initializeOutcomeConfig({ runtimeId: [...runtimeId], minInputLamports: new BN(0), maxInputLamports: new BN(0), compiledArtifactHash: [...hash], masterSeed: [...Buffer.alloc(32, 0)] })
    .accounts({ authority, programConfig: op.programConfigPda, outcomeConfig: outcomeConfigPda, outcomeVault: outcomeVaultPda, treasury: authority, approvedOutcomeArtifact: artifactPda, systemProgram: SystemProgram.programId })
    .remainingAccounts(chunkPdas.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }))).transaction().then((tx: Transaction) => sendTx(op, tx));

  const keys = [
    { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: op.programConfigPda, isSigner: false, isWritable: false },
    { pubkey: outcomeConfigPda, isSigner: false, isWritable: false },
    { pubkey: artifactPda, isSigner: false, isWritable: false },
    ...chunkPdas.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })),
  ];
  const ix = new TransactionInstruction({ programId: op.programId, keys, data: Buffer.concat([RESOLVE_CONDITIONS_DISCRIMINATOR, runtimeId]) });
  const signature = await sendTx(op, new Transaction().add(ix));

  // Ranking with per-entrant slip_hash (same order the on-chain event uses).
  const ranked = rankRound(
    args.entrants.map((e) => {
      const factsByLeg = e.fixtureIndex.map((fi) => args.fixtures[fi]?.stats ?? []);
      const s = scoreSlip(e.legs, factsByLeg);
      return { wallet: e.wallet, enteredAt: e.enteredAt, scoreFixed: s.scoreFixed, allHit: s.allHit, voidCount: s.voidCount, settled: s.settled, slipHash: slipHash(e.wallet, e.tier, e.legs).toString("hex") };
    })
  );
  const artifact = parseConditionsArtifact(blob);
  const winners = ranked.filter((r) => r.allHit);
  return {
    signature,
    runtimeId: runtimeId.toString("hex"),
    artifactHash: hash.toString("hex"),
    artifactHex: blob.toString("hex"),
    artifactBytes: blob.length,
    winnersCount: winners.length,
    winningScoreSum: winningScoreSum(ranked).toString(),
    winnersDigest: winnersDigest(ranked).toString("hex"),
    factsRefRoot: factsRefRoot(artifact).toString("hex"),
    winners: winners.map((w) => new PublicKey(w.wallet).toBase58()),
    ranking: ranked.map((r, idx) => ({
      rank: idx + 1,
      wallet: new PublicKey(r.wallet).toBase58(),
      all_hit: r.allHit,
      score_fixed: r.scoreFixed.toString(),
      void_count: r.voidCount,
      slip_hash: (r as any).slipHash,
    })),
  };
}
