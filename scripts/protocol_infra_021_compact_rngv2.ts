// PROTOCOL-INFRA-021 — compact artifacts (fmt 1/2/3/5) on the rng_v2 lifecycle.
//
// Localnet e2e: for each case, commit a payout-free compact artifact, prepare_rng_v2, then either
//   v1.2   settle_rng_v2            (single phase, program selects winners)
//   v1.3.2 seal_randomness → attest  (two phase, program selects winners at attest)
// and replay the signature through the public verifier (expects MATCH, entropy_source slot_hash).
// Negatives: caller-supplied winner args on a compact draw, paying compact artifact at prepare,
// settle before the target slot. One fmt-7 (scale) case runs as a regression guard.
//
// Usage (localnet; refuses non-local RPC unless --allow-remote):
//   solana-test-validator --reset   (then deploy target/deploy/outcome.so at 6QtLot…)
//   TS_NODE_PROJECT=tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --loader ts-node/esm \
//     scripts/protocol_infra_021_compact_rngv2.ts --rpc http://127.0.0.1:8899 \
//     --wallet ~/.config/solana/id.json --program-id 6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B

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
} from "@solana/web3.js";

import { buildArtifact } from "../dist/sdk/artifact.js";
import { buildSnapshotHash, buildSnapshotClaimFromFile } from "../dist/sdk/snapshot.js";
import { verifyOutcome, winnerClaimDigest } from "../dist/sdk/verify.js";
import type { ResolutionFormula } from "../dist/sdk/types.js";

const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const STATUS_APPROVED = 1;
const CHUNK_SIZE = 1024;
const CHUNK_WRITE_BYTES = 900;
const CU_LIMIT = 1_400_000;
const HEAP_FRAME_BYTES = 256 * 1024;
const INPUT_LAMPORTS = 100n;
const BOUNTY_LAMPORTS = 50_000n;
const ENTRY_COUNT = 103; // fmt 5 ceiling (no per-entry effects)
const ENTRY_COUNT_W3O1 = 80; // fmt 1/2/3 carry a 16-byte effect per entry → lower ceiling under 8 KB
const ZERO32 = Buffer.alloc(32, 0);
const ZERO64 = Buffer.alloc(64, 0);

type Client = { provider: anchor.AnchorProvider; program: anchor.Program; authority: Keypair; programId: PublicKey };
type Lifecycle = "v1_2_settle" | "v1_3_2_two_phase";
type Case = {
  id: string;
  kind: "raffle" | "formula_draw" | "formula_draw_v5" | "scale";
  formula: ResolutionFormula;
  winnersCount: number;
  lifecycle: Lifecycle;
  target?: bigint;
};
type Runtime = {
  runtimeId: Buffer;
  compiledArtifactHash: Buffer;
  artifactPda: PublicKey;
  chunkPdas: PublicKey[];
  outcomeConfigPda: PublicKey;
  outcomeVaultPda: PublicKey;
  formatVersion: number;
  snapshotPath?: string;
  formula: ResolutionFormula;
  winnersCount: number;
  target?: bigint;
};

// ---------- small helpers ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = (b: Buffer | Uint8Array) => crypto.createHash("sha256").update(b).digest();
const toHex = (b: Buffer | number[]) => Buffer.from(b).toString("hex");
const u64le = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v, 0); return b; };
const asBigInt = (v: unknown): bigint => typeof v === "bigint" ? v : BigInt(String(v));
const jsonReplacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
const expandHome = (p: string) => (p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);
const pda = (programId: PublicKey, seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, programId)[0];
const programConfigPda = (p: PublicKey) => pda(p, [Buffer.from("outcome_program_config")]);
const artifactPdaOf = (p: PublicKey, h: Buffer) => pda(p, [Buffer.from("approved_outcome_artifact"), h]);
const chunkPdaOf = (p: PublicKey, h: Buffer, i: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(i, 0); return pda(p, [Buffer.from("approved_outcome_artifact_chunk"), h, b]); };
const outcomeConfigPdaOf = (p: PublicKey, r: Buffer) => pda(p, [Buffer.from("outcome_config"), r]);
const vaultPdaOf = (p: PublicKey, r: Buffer) => pda(p, [Buffer.from("outcome_vault"), r]);
const resolutionPdaOf = (p: PublicKey, r: Buffer, id: bigint) => pda(p, [Buffer.from("outcome_resolution"), r, u64le(id)]);
const statePdaOf = (p: PublicKey, r: Buffer, id: bigint) => pda(p, [Buffer.from("rng_v2_state"), r, u64le(id)]);
const chunkAccounts = (rt: Runtime) => rt.chunkPdas.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }));

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[a.slice(2)] = true;
    else { out[a.slice(2)] = next; i += 1; }
  }
  return out;
}
const argString = (a: Record<string, string | boolean>, k: string, d: string) => (typeof a[k] === "string" && (a[k] as string).trim() ? (a[k] as string).trim() : d);

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i += 1) {
    try { return await fn(); } catch (e) { last = e; if (i === attempts) break; console.log(`[RETRY] ${label} ${i}/${attempts}: ${(e as Error).message}`); await sleep(800 * i); }
  }
  throw last;
}

async function sendIxOnce(client: Client, builder: { instruction: () => Promise<anchor.web3.TransactionInstruction> }): Promise<string> {
  const ix = await builder.instruction();
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }),
    ComputeBudgetProgram.requestHeapFrame({ bytes: HEAP_FRAME_BYTES }),
    ix
  );
  return client.provider.sendAndConfirm(tx, []);
}

async function sendIx(client: Client, label: string, builder: { instruction: () => Promise<anchor.web3.TransactionInstruction> }): Promise<string> {
  return withRetry(label, async () => {
    const ix = await builder.instruction();
    // Compact draws parse the whole outcome table on-chain: request the enlarged heap frame.
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }),
      ComputeBudgetProgram.requestHeapFrame({ bytes: HEAP_FRAME_BYTES }),
      ix
    );
    return client.provider.sendAndConfirm(tx, []);
  });
}

async function computeUnits(client: Client, signature: string): Promise<number | null> {
  const tx = await client.provider.connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  return tx?.meta?.computeUnitsConsumed ?? null;
}

// ---------- client / program config ----------
async function loadClient(rpcUrl: string, walletPath: string, programId: string): Promise<Client> {
  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8"))));
  const provider = new anchor.AnchorProvider(new anchor.web3.Connection(rpcUrl, { commitment: "confirmed" }), new anchor.Wallet(authority), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const rawIdl = JSON.parse(fs.readFileSync(path.join(process.cwd(), "artifacts/outcome_idl.json"), "utf8"));
  rawIdl.address = programId;
  return { provider, program: new anchor.Program(rawIdl as anchor.Idl, provider), authority, programId: new PublicKey(programId) };
}

async function ensureFunds(client: Client): Promise<void> {
  let balance = await client.provider.connection.getBalance(client.authority.publicKey, "confirmed");
  while (balance < 5_000_000_000) {
    const sig = await client.provider.connection.requestAirdrop(client.authority.publicKey, 5_000_000_000);
    await client.provider.connection.confirmTransaction(sig, "confirmed");
    balance = await client.provider.connection.getBalance(client.authority.publicKey, "confirmed");
  }
}

async function ensureProgramConfig(client: Client): Promise<string | null> {
  const cfg = programConfigPda(client.programId);
  if (await client.provider.connection.getAccountInfo(cfg, "confirmed")) return null;
  const [programData] = PublicKey.findProgramAddressSync([client.programId.toBuffer()], BPF_LOADER_UPGRADEABLE_PROGRAM_ID);
  return withRetry("initializeProgramConfig", () =>
    (client.program.methods as any)
      .initializeProgramConfig({ feeLamports: new BN(0), treasury: client.authority.publicKey })
      .accounts({ payer: client.authority.publicKey, program: client.programId, programData, upgradeAuthority: client.authority.publicKey, programConfig: cfg, systemProgram: SystemProgram.programId })
      .rpc()
  );
}

// ---------- artifact commit (submit → chunks → finalize → review) ----------
async function submitApprovedArtifact(client: Client, blob: Buffer, label: string) {
  const hash = sha256(blob);
  const artifactPda = artifactPdaOf(client.programId, hash);
  const chunkCount = Math.ceil(blob.length / CHUNK_SIZE);
  const chunkPdas = Array.from({ length: chunkCount }, (_, i) => chunkPdaOf(client.programId, hash, i));
  if (await client.provider.connection.getAccountInfo(artifactPda, "confirmed")) return { hash, artifactPda, chunkPdas };
  const m = client.program.methods as any;
  await withRetry(`submit:${label}`, () => m.submitCompiledArtifact({ compiledArtifactHash: [...hash], formatVersion: blob.readUInt16LE(4), blobLen: blob.length })
    .accounts({ publisher: client.authority.publicKey, approvedOutcomeArtifact: artifactPda, systemProgram: SystemProgram.programId }).rpc());
  for (let ci = 0; ci < chunkCount; ci += 1) {
    await withRetry(`initChunk:${label}:${ci}`, () => m.initCompiledArtifactChunk({ compiledArtifactHash: [...hash], chunkIndex: ci })
      .accounts({ publisher: client.authority.publicKey, approvedOutcomeArtifact: artifactPda, approvedOutcomeArtifactChunk: chunkPdas[ci], systemProgram: SystemProgram.programId }).rpc());
    const chunk = blob.subarray(ci * CHUNK_SIZE, Math.min(blob.length, (ci + 1) * CHUNK_SIZE));
    for (let off = 0; off < chunk.length; off += CHUNK_WRITE_BYTES) {
      await withRetry(`write:${label}:${ci}:${off}`, () => m.writeCompiledArtifactChunk({ compiledArtifactHash: [...hash], chunkIndex: ci, offset: off, data: Buffer.from(chunk.subarray(off, Math.min(chunk.length, off + CHUNK_WRITE_BYTES))) })
        .accounts({ publisher: client.authority.publicKey, approvedOutcomeArtifact: artifactPda, approvedOutcomeArtifactChunk: chunkPdas[ci] }).rpc());
    }
  }
  await withRetry(`finalize:${label}`, () => m.finalizeCompiledArtifact().accounts({ publisher: client.authority.publicKey, approvedOutcomeArtifact: artifactPda })
    .remainingAccounts(chunkPdas.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }))).rpc());
  await withRetry(`review:${label}`, () => m.reviewCompiledArtifact({ status: STATUS_APPROVED, auditHash: [...ZERO32], artifactUri: Buffer.from(`${label}.bin`, "utf8") })
    .accounts({ programConfig: programConfigPda(client.programId), admin: client.authority.publicKey, approvedOutcomeArtifact: artifactPda }).rpc());
  return { hash, artifactPda, chunkPdas };
}

// ---------- artifact configs ----------
const scoreFor = (i: number) => BigInt(((i * 7919) % 100_003) - 50_000);

function compactConfig(c: Case, payoutLamports: number): any {
  const base = { input_lamports: Number(INPUT_LAMPORTS), payout_lamports: payoutLamports, winners_count: c.winnersCount };
  if (c.kind === "raffle") {
    return { type: "raffle", ...base, participants: Array.from({ length: ENTRY_COUNT_W3O1 }, (_, i) => ({ address: Keypair.generate().publicKey.toBase58(), weight: (i % 17) + 1 })) };
  }
  const participants = Array.from({ length: c.kind === "formula_draw" ? ENTRY_COUNT_W3O1 : ENTRY_COUNT }, (_, i) => {
    const id = `p_${String(i).padStart(4, "0")}`;
    if (c.formula === "weighted_random") return { id, weight: (i % 17) + 1 };
    if (c.formula === "first_n") return { id }; // order = list position
    return { id, score: scoreFor(i) };
  });
  return { type: c.kind, formula: c.formula, ...base, participants, ...(c.target === undefined ? {} : { target: c.target }) };
}

async function createRuntime(client: Client, c: Case, outDir: string, payoutLamports = 0): Promise<Runtime> {
  let blob: Buffer;
  let snapshotPath: string | undefined;
  if (c.kind === "scale") {
    const participants = Array.from({ length: 250 }, (_, i) => ({ id: `p_${String(i).padStart(4, "0")}`, order: i, weight: (i % 17) + 1 }));
    const snap = buildSnapshotHash({ formula: c.formula, participants });
    snapshotPath = path.join(outDir, `${c.id}-snapshot.jsonl`);
    fs.writeFileSync(snapshotPath, snap.canonicalSnapshot);
    blob = buildArtifact({ type: "outcome_standard_v1_2_1", formula: c.formula, input_lamports: Number(INPUT_LAMPORTS), payout_lamports: payoutLamports, snapshot_hash: snap.snapshotHash, snapshot_count: snap.snapshotCount, snapshot_uri: snapshotPath, merkle_root: snap.merkleRoot, winners_count: c.winnersCount } as any);
  } else {
    blob = buildArtifact(compactConfig(c, payoutLamports));
  }
  const art = await submitApprovedArtifact(client, blob, c.id);
  const runtimeId = crypto.randomBytes(16);
  const outcomeConfigPda = outcomeConfigPdaOf(client.programId, runtimeId);
  const outcomeVaultPda = vaultPdaOf(client.programId, runtimeId);
  await withRetry(`initRuntime:${c.id}`, () => (client.program.methods as any)
    .initializeOutcomeConfig({ runtimeId: [...runtimeId], minInputLamports: new BN(INPUT_LAMPORTS.toString()), maxInputLamports: new BN(INPUT_LAMPORTS.toString()), compiledArtifactHash: [...art.hash], masterSeed: [...Buffer.alloc(32, 1)] })
    .accounts({ authority: client.authority.publicKey, programConfig: programConfigPda(client.programId), outcomeConfig: outcomeConfigPda, outcomeVault: outcomeVaultPda, treasury: client.authority.publicKey, approvedOutcomeArtifact: art.artifactPda, systemProgram: SystemProgram.programId })
    .remainingAccounts(art.chunkPdas.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }))).rpc());
  return { runtimeId, compiledArtifactHash: art.hash, artifactPda: art.artifactPda, chunkPdas: art.chunkPdas, outcomeConfigPda, outcomeVaultPda, formatVersion: blob.readUInt16LE(4), snapshotPath, formula: c.formula, winnersCount: c.winnersCount, target: c.target };
}

// ---------- rng_v2 lifecycle ----------
async function nextResolveId(client: Client, rt: Runtime): Promise<bigint> {
  const cfg = await (client.program.account as any).outcomeConfig.fetch(rt.outcomeConfigPda, "confirmed");
  return asBigInt(cfg.nextResolveId ?? cfg.next_resolve_id);
}
async function fetchState(client: Client, rt: Runtime, id: bigint): Promise<any> {
  return (client.program.account as any).rngV2State.fetch(statePdaOf(client.programId, rt.runtimeId, id), "confirmed");
}
async function waitUntilSlot(client: Client, target: bigint): Promise<void> {
  for (;;) { if (BigInt(await client.provider.connection.getSlot("confirmed")) >= target) return; await sleep(400); }
}

async function prepare(client: Client, rt: Runtime): Promise<bigint> {
  const id = await nextResolveId(client, rt);
  await sendIx(client, `prepare:${toHex(rt.runtimeId)}`, (client.program.methods as any)
    .prepareRngV2({ runtimeId: [...rt.runtimeId], inputLamports: new BN(INPUT_LAMPORTS.toString()), bountyLamports: new BN(BOUNTY_LAMPORTS.toString()), operatorCommitPresent: false, operatorCommitHash: [...ZERO32] })
    .accounts({ actor: client.authority.publicKey, programConfig: programConfigPda(client.programId), outcomeConfig: rt.outcomeConfigPda, outcomeVault: rt.outcomeVaultPda, rngV2State: statePdaOf(client.programId, rt.runtimeId, id), approvedOutcomeArtifact: rt.artifactPda, systemProgram: SystemProgram.programId })
    .remainingAccounts(chunkAccounts(rt)));
  return id;
}

type ClaimArgs = { winnerCount: number; winnerClaimHash: number[]; outcomeIdLen: number; outcomeId: number[] };
const emptyClaim = (winnerCount: number): ClaimArgs => ({ winnerCount, winnerClaimHash: [...ZERO32], outcomeIdLen: 0, outcomeId: [...ZERO64] });

// Resolve SlotHashes evidence for target slots from the live sysvar (mirror of rng_v2::resolve_slot_hashes).
async function resolveSlotEvidence(client: Client, targetSlots: bigint[]): Promise<{ resolvedSlots: bigint[]; slotHashes: Buffer[] }> {
  const account = await client.provider.connection.getAccountInfo(SYSVAR_SLOT_HASHES_PUBKEY, "confirmed");
  if (!account) throw new Error("SlotHashes sysvar not found");
  const data = account.data;
  const entryCount = Number(data.readBigUInt64LE(0));
  const resolvedSlots: bigint[] = [];
  const slotHashes: Buffer[] = [];
  let previous = 0n;
  for (const target of targetSlots) {
    let selSlot: bigint | null = null;
    let selHash: Buffer | null = null;
    for (let i = 0; i < entryCount; i += 1) {
      const start = 8 + i * 40;
      const slot = data.readBigUInt64LE(start);
      if (slot <= previous) continue;
      const hash = Buffer.from(data.subarray(start + 8, start + 40));
      if (slot === target) { selSlot = slot; selHash = hash; break; }
      if (slot > target && (selSlot === null || slot < selSlot)) { selSlot = slot; selHash = hash; }
    }
    if (selSlot === null || selHash === null) throw new Error(`no SlotHashes entry after ${target}`);
    resolvedSlots.push(selSlot); slotHashes.push(selHash); previous = selSlot;
  }
  return { resolvedSlots, slotHashes };
}

async function scaleClaim(client: Client, rt: Runtime, id: bigint, fromSysvar = false): Promise<ClaimArgs> {
  // fmt 7: the caller claims the winners (proved by replay against the snapshot).
  const st = await fetchState(client, rt, id);
  const evidence = fromSysvar
    ? await resolveSlotEvidence(client, (st.targetSlots as unknown[]).map(asBigInt))
    : { resolvedSlots: (st.resolvedSlots as unknown[]).map(asBigInt), slotHashes: (st.slotHashes as number[][]).map((v) => Buffer.from(v)) };
  const { resolvedSlots, slotHashes } = evidence;
  const parts: Buffer[] = [Buffer.from("VRE_RNG_V2", "ascii"), rt.runtimeId, u64le(id), rt.compiledArtifactHash, Buffer.from(st.snapshotHash)];
  for (let i = 0; i < 3; i += 1) { parts.push(u64le(resolvedSlots[i])); parts.push(slotHashes[i]); }
  const seed = sha256(Buffer.concat(parts));
  const randomness = sha256(Buffer.concat([seed, rt.runtimeId, u64le(id), client.authority.publicKey.toBuffer()]));
  const claim = await buildSnapshotClaimFromFile({ snapshotPath: rt.snapshotPath!, formula: rt.formula, winnersCount: rt.winnersCount, randomness, payoutLamports: 0n });
  const primary = Buffer.from(claim.outcomeIds[0], "ascii");
  return { winnerCount: claim.winnersCount, winnerClaimHash: [...claim.winnerClaimHash], outcomeIdLen: primary.length, outcomeId: [...Buffer.concat([primary, Buffer.alloc(64 - primary.length)])] };
}

function settleBuilder(client: Client, rt: Runtime, id: bigint, claim: ClaimArgs, slotHashesAccount = SYSVAR_SLOT_HASHES_PUBKEY) {
  return (client.program.methods as any)
    .settleRngV2({ runtimeId: [...rt.runtimeId], resolveId: new BN(id.toString()), ...claim, operatorRevealLen: 0, operatorReveal: [...ZERO32] })
    .accounts({ actor: client.authority.publicKey, programConfig: programConfigPda(client.programId), outcomeConfig: rt.outcomeConfigPda, outcomeVault: rt.outcomeVaultPda, rngV2State: statePdaOf(client.programId, rt.runtimeId, id), outcomeResolution: resolutionPdaOf(client.programId, rt.runtimeId, id), approvedOutcomeArtifact: rt.artifactPda, outcomeTreasury: client.authority.publicKey, protocolTreasury: client.authority.publicKey, slotHashes: slotHashesAccount, systemProgram: SystemProgram.programId })
    .remainingAccounts(chunkAccounts(rt));
}

async function seal(client: Client, rt: Runtime, id: bigint): Promise<string> {
  return sendIx(client, `seal:${toHex(rt.runtimeId)}`, (client.program.methods as any)
    .sealRandomness({ runtimeId: [...rt.runtimeId], resolveId: new BN(id.toString()) })
    .accounts({ sealer: client.authority.publicKey, outcomeConfig: rt.outcomeConfigPda, rngV2State: statePdaOf(client.programId, rt.runtimeId, id), slotHashes: SYSVAR_SLOT_HASHES_PUBKEY }));
}

function attestBuilder(client: Client, rt: Runtime, id: bigint, claim: ClaimArgs) {
  return (client.program.methods as any)
    .attestWinners({ runtimeId: [...rt.runtimeId], resolveId: new BN(id.toString()), ...claim, operatorRevealLen: 0, operatorReveal: [...ZERO32] })
    .accounts({ attester: client.authority.publicKey, programConfig: programConfigPda(client.programId), outcomeConfig: rt.outcomeConfigPda, outcomeVault: rt.outcomeVaultPda, rngV2State: statePdaOf(client.programId, rt.runtimeId, id), outcomeResolution: resolutionPdaOf(client.programId, rt.runtimeId, id), approvedOutcomeArtifact: rt.artifactPda, operator: client.authority.publicKey, protocolTreasury: client.authority.publicKey, systemProgram: SystemProgram.programId })
    .remainingAccounts(chunkAccounts(rt));
}

async function replay(client: Client, rpcUrl: string, signature: string) {
  return verifyOutcome({ signature, rpcUrl, programId: client.programId.toBase58() });
}

async function expectFailure(label: string, fn: () => Promise<unknown>, expectedCode: string) {
  try { await fn(); return { label, ok: false, error: "unexpected success", expected: expectedCode }; }
  catch (e) { const msg = (e as Error).message ?? String(e); return { label, ok: msg.includes(expectedCode), error: msg.slice(0, 4000), expected: expectedCode }; }
}

// ---------- cases ----------
function buildCases(): Case[] {
  const cases: Case[] = [];
  const lifecycles: Lifecycle[] = ["v1_2_settle", "v1_3_2_two_phase"];
  for (const lifecycle of lifecycles) {
    const tag = lifecycle === "v1_2_settle" ? "s" : "t";
    cases.push({ id: `fmt1-wr-w1-${tag}`, kind: "raffle", formula: "weighted_random", winnersCount: 1, lifecycle });
    cases.push({ id: `fmt2-wr-w5-${tag}`, kind: "raffle", formula: "weighted_random", winnersCount: 5, lifecycle });
    cases.push({ id: `fmt3-rd-w3-${tag}`, kind: "formula_draw", formula: "rank_desc", winnersCount: 3, lifecycle });
    for (const formula of ["weighted_random", "rank_desc", "rank_asc", "first_n", "closest_to"] as ResolutionFormula[]) {
      for (const winnersCount of [1, 32]) {
        cases.push({ id: `fmt5-${formula}-w${winnersCount}-${tag}`, kind: "formula_draw_v5", formula, winnersCount, lifecycle, ...(formula === "closest_to" ? { target: scoreFor(51) } : {}) });
      }
    }
    cases.push({ id: `fmt7-wr-w2-${tag}`, kind: "scale", formula: "weighted_random", winnersCount: 2, lifecycle });
  }
  return cases;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rpcUrl = argString(args, "rpc", process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899");
  const walletPath = expandHome(argString(args, "wallet", process.env.ANCHOR_WALLET ?? "~/.config/solana/id.json"));
  const programId = argString(args, "program-id", process.env.PROGRAM_ID ?? "6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B");
  const isLocal = /127\.0\.0\.1|localhost/.test(rpcUrl);
  if (!isLocal && !args["allow-remote"]) throw new Error("This harness targets localnet; pass --allow-remote to run elsewhere");
  const outDir = path.join(process.cwd(), "tmp", "protocol-infra-021");
  fs.mkdirSync(outDir, { recursive: true });

  const client = await loadClient(rpcUrl, walletPath, programId);
  if (isLocal) await ensureFunds(client);
  const initSig = await ensureProgramConfig(client);

  const only = typeof args.only === "string" ? (args.only as string).split(",") : null;
  const cases = buildCases().filter((c) => !only || only.some((prefix) => c.id.startsWith(prefix)));
  const skipNegatives = Boolean(args["skip-negatives"]);
  console.log(`[021] ${cases.length} cases → prepare`);
  const prepared: Array<{ c: Case; rt: Runtime; id: bigint; targetSlots: bigint[] }> = [];
  for (const c of cases) {
    const rt = await createRuntime(client, c, outDir);
    const id = await prepare(client, rt);
    const st = await fetchState(client, rt, id);
    prepared.push({ c, rt, id, targetSlots: (st.targetSlots as unknown[]).map(asBigInt) });
    console.log(`  prepared ${c.id} fmt=${rt.formatVersion} resolve_id=${id} targets=${prepared[prepared.length - 1].targetSlots.join(",")}`);
  }

  // Negatives run on dedicated draws so no main-loop case is consumed, and send once without
  // retries: with draw offsets [8, 16, 24] a retried call can outlive the not-ready window.
  const negatives: any[] = [];

  // Negative 1: settle right after prepare, before the target slots exist.
  if (!skipNegatives) {
    const c: Case = { id: "neg-early-fmt5", kind: "formula_draw_v5", formula: "weighted_random", winnersCount: 1, lifecycle: "v1_2_settle" };
    const rt = await createRuntime(client, c, outDir);
    const id = await prepare(client, rt);
    negatives.push(await expectFailure("settle_before_target_slot", () => sendIxOnce(client, settleBuilder(client, rt, id, emptyClaim(rt.winnersCount))), "RngV2TargetSlotNotReady"));
  }

  // Negative 2: paying compact artifact rejected at prepare.
  if (!skipNegatives) {
    const c: Case = { id: "neg-paying-fmt5", kind: "formula_draw_v5", formula: "weighted_random", winnersCount: 1, lifecycle: "v1_2_settle" };
    const rt = await createRuntime(client, c, outDir, 3);
    negatives.push(await expectFailure("prepare_rejects_paying_compact_artifact", () => prepare(client, rt), "RngV2PayoutMustBeZero"));
  }

  // Negative 3: caller-supplied winner args on a matured compact draw.
  if (!skipNegatives) {
    const c: Case = { id: "neg-args-fmt5", kind: "formula_draw_v5", formula: "weighted_random", winnersCount: 1, lifecycle: "v1_2_settle" };
    const rt = await createRuntime(client, c, outDir);
    const id = await prepare(client, rt);
    const st = await fetchState(client, rt, id);
    await waitUntilSlot(client, asBigInt(st.targetSlots[2]) + 1n);
    const bogus: ClaimArgs = { winnerCount: rt.winnersCount, winnerClaimHash: [...Buffer.alloc(32, 1)], outcomeIdLen: 6, outcomeId: [...Buffer.concat([Buffer.from("p_0000"), Buffer.alloc(58)])] };
    negatives.push(await expectFailure("settle_rejects_caller_winner_args_on_compact", () => sendIxOnce(client, settleBuilder(client, rt, id, bogus)), "RngV2CompactArgsMustBeEmpty"));
  }

  const maxTarget = prepared.reduce((m, p) => (p.targetSlots[2] > m ? p.targetSlots[2] : m), 0n);
  console.log(`[021] waiting for slot ${maxTarget + 1n}`);
  await waitUntilSlot(client, maxTarget + 1n);

  const rows: any[] = [];
  for (const p of prepared) {
    const row: any = { id: p.c.id, kind: p.c.kind, format_version: p.rt.formatVersion, formula: p.c.formula, winners_count: p.rt.winnersCount, lifecycle: p.c.lifecycle, resolve_id: p.id.toString(), target_slots: p.targetSlots.map(String) };
    try {
      let signature: string;
      if (p.c.lifecycle === "v1_2_settle") {
        // fmt 7 single-phase: the caller derives the randomness from the live sysvar right before settle.
        const claim = p.c.kind === "scale" ? await scaleClaim(client, p.rt, p.id, true) : emptyClaim(p.rt.winnersCount);
        signature = await sendIx(client, `settle:${p.c.id}`, settleBuilder(client, p.rt, p.id, claim));
        row.settle_signature = signature;
        row.settle_cu = await computeUnits(client, signature);
      } else {
        row.seal_signature = await seal(client, p.rt, p.id);
        const claim = p.c.kind === "scale" ? await scaleClaim(client, p.rt, p.id) : emptyClaim(p.rt.winnersCount);
        signature = await sendIx(client, `attest:${p.c.id}`, attestBuilder(client, p.rt, p.id, claim));
        row.attest_signature = signature;
        row.attest_cu = await computeUnits(client, signature);
      }
      const result: any = await replay(client, rpcUrl, signature);
      row.replay = { status: result.status, reason: result.reason, outcome_id: result.outcome_id, outcome_ids: result.outcome_ids, entropy_source: result.entropy_source, rng_version: result.rng_version, protocol_revision: result.protocol_revision, winner_claim_hash: result.winner_claim_hash };
      // Compact: the on-chain claim hash must equal the digest of the replayed winner list.
      if (p.c.kind !== "scale" && result.status === "MATCH") {
        const ids: string[] = result.outcome_ids ?? [result.outcome_id];
        const digest = winnerClaimDigest(ids.map((s) => Buffer.byteLength(s, "ascii")), ids.map((s) => Buffer.from(s, "ascii")));
        row.claim_digest_ok = digest.toString("hex") === result.winner_claim_hash;
      }
      row.status = result.status === "MATCH" && result.reason === "OK" && (p.c.kind === "scale" || (result.entropy_source === "slot_hash" && row.claim_digest_ok)) ? "pass" : "fail";
    } catch (e) {
      row.status = "fail";
      row.error = (e as Error).message?.slice(0, 4000) ?? String(e);
    }
    console.log(`  ${row.status.toUpperCase()} ${row.id} ${row.replay?.status ?? ""} ${row.replay?.reason ?? row.error ?? ""} cu=${row.settle_cu ?? row.attest_cu ?? "-"}`);
    rows.push(row);
  }

  const report = {
    generated_at: new Date().toISOString(),
    task_id: "PROTOCOL-INFRA-021",
    rpc_url: rpcUrl,
    program_id: client.programId.toBase58(),
    wallet: client.authority.publicKey.toBase58(),
    init_program_config_signature: initSig,
    summary: { rows: rows.length, passed: rows.filter((r) => r.status === "pass").length, negatives: negatives.length, negatives_passed: negatives.filter((n) => n.ok).length },
    rows,
    negatives,
  };
  const outPath = path.join(process.cwd(), "artifacts", `protocol_infra_021_compact_rngv2_${isLocal ? "localnet" : "devnet"}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(report, jsonReplacer, 2)}\n`);
  console.log(JSON.stringify(report.summary));
  console.log(`Evidence: ${outPath}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
