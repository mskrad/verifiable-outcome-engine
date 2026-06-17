/**
 * PROTOCOL-INFRA-013 — C1 sortition economics harness (v1.4.1).
 * Localnet-first, isolated non-canonical program only. Exercises entry-fee,
 * close-skim, single close, batch sweep, and every enforcement negative
 * (free-register on paid draw, late-set economics, skim/treasury bypass).
 *
 * Run: ts-node --esm --transpile-only scripts/protocol_infra_013_economics.ts \
 *   --rpc-url http://127.0.0.1:8899 --program-id <NON_CANONICAL_ID> --wallet ~/.config/solana/id.json
 */
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import {
  Keypair,
  PublicKey,
  SYSVAR_SLOT_HASHES_PUBKEY,
  SystemProgram,
} from "@solana/web3.js";

const DEFAULT_RPC_URL = "http://127.0.0.1:8899";
const DEFAULT_WALLET_PATH = "~/.config/solana/id.json";
const CANONICAL_PROGRAM_ID = "9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F";
const ARTIFACT = "artifacts/protocol_infra_013_economics_localnet.json";

const FEE_ENTRY = 1;
const FEE_CLOSE_SKIM = 2;
const ENTRY_FEE_LAMPORTS = 1_000_000; // 0.001 SOL
const CLOSE_SKIM_BPS = 1_000; // 10%
const REGISTRATION_DURATION_SLOTS = 60;
const CLAIM_DURATION_SLOTS = 20;

type Client = {
  provider: anchor.AnchorProvider;
  program: anchor.Program;
  authority: Keypair;
  programId: PublicKey;
};

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[a.slice(2)] = next;
      i += 1;
    } else {
      out[a.slice(2)] = "true";
    }
  }
  return out;
}

function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}
function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(expandHome(p), "utf8"))));
}
function sha256(...parts: Array<Buffer | Uint8Array | string>): Buffer {
  const h = crypto.createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
}
function toHex(b: Buffer | number[] | Uint8Array): string {
  return Buffer.from(b).toString("hex");
}
function maxThreshold(): Buffer {
  return Buffer.alloc(32, 0xff);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function asBigInt(v: unknown): bigint {
  if (v instanceof BN) return BigInt(v.toString());
  return BigInt(String(v));
}

function loadIdl(programId: string): anchor.Idl {
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "target/idl/outcome.json"), "utf8"));
  raw.address = programId;
  return raw as anchor.Idl;
}

async function loadClient(rpcUrl: string, walletPath: string, programId: string): Promise<Client> {
  if (programId === CANONICAL_PROGRAM_ID) throw new Error("Refusing to run against canonical program id");
  const authority = loadKeypair(walletPath);
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(rpcUrl, {
      commitment: "confirmed",
      fetch: async (url: any, options: any) => {
        let last: Response | null = null;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const r = await fetch(url, options);
          if (r.status !== 429) return r;
          last = r;
          await sleep(1_000 * (attempt + 1));
        }
        return last ?? fetch(url, options);
      },
    }),
    new anchor.Wallet(authority),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);
  return { provider, program: new anchor.Program(loadIdl(programId), provider), authority, programId: new PublicKey(programId) };
}

const drawPda = (c: Client, d: Buffer) => PublicKey.findProgramAddressSync([Buffer.from("sortition_draw"), d], c.programId)[0];
const ticketPda = (c: Client, d: Buffer, t: Buffer) => PublicKey.findProgramAddressSync([Buffer.from("sortition_ticket"), d, t], c.programId)[0];
const programConfigPda = (c: Client) => PublicKey.findProgramAddressSync([Buffer.from("outcome_program_config")], c.programId)[0];

function ticketId(i: number): Buffer {
  const b = Buffer.alloc(16);
  b.writeUInt32LE(i, 0);
  return b;
}
function drawId(label: string): Buffer {
  return sha256(`infra013:${label}:${Date.now()}:${Math.random()}`).subarray(0, 16);
}
function commitment(secret: Buffer, ticket: Buffer, draw: Buffer): Buffer {
  return sha256(secret, ticket, draw);
}

async function balance(c: Client, pk: PublicKey): Promise<bigint> {
  return BigInt(await c.provider.connection.getBalance(pk, "confirmed"));
}
async function waitUntilSlot(c: Client, target: bigint): Promise<void> {
  for (;;) {
    if (BigInt(await c.provider.connection.getSlot("confirmed")) >= target) return;
    await sleep(400);
  }
}
async function getCU(c: Client, sig: string): Promise<number | null> {
  for (let i = 0; i < 10; i += 1) {
    const tx = await c.provider.connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (typeof tx?.meta?.computeUnitsConsumed === "number") return tx.meta.computeUnitsConsumed;
    await sleep(500);
  }
  return null;
}
async function fund(c: Client, to: PublicKey, lamports: number): Promise<void> {
  const tx = new anchor.web3.Transaction().add(
    SystemProgram.transfer({ fromPubkey: c.authority.publicKey, toPubkey: to, lamports })
  );
  await c.provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
}

async function ensureProgramConfig(c: Client, treasury: PublicKey): Promise<PublicKey> {
  const pda = programConfigPda(c);
  const info = await c.provider.connection.getAccountInfo(pda, "confirmed");
  if (info) {
    const cfg: any = await (c.program.account as any).programConfig.fetch(pda);
    const current = new PublicKey(cfg.treasury);
    // If we are admin, repoint treasury to a dedicated keypair for clean deltas.
    if (!current.equals(treasury) && new PublicKey(cfg.admin).equals(c.authority.publicKey)) {
      await (c.program.methods as any)
        .setProgramConfig({
          newAdmin: cfg.admin,
          allowUnreviewedBinding: cfg.allowUnreviewedBinding,
          feeLamports: cfg.feeLamports,
          treasury,
        })
        .accounts({ programConfig: pda, admin: c.authority.publicKey })
        .rpc();
      return treasury;
    }
    return current;
  }
  const BPF_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  const [programData] = PublicKey.findProgramAddressSync([c.programId.toBuffer()], BPF_UPGRADEABLE);
  await (c.program.methods as any)
    .initializeProgramConfig({ feeLamports: new BN(0), treasury })
    .accounts({
      payer: c.authority.publicKey,
      program: c.programId,
      programData,
      upgradeAuthority: c.authority.publicKey,
      programConfig: pda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  return treasury;
}

async function createDraw(c: Client, draw: Buffer): Promise<void> {
  await (c.program.methods as any)
    .createSortitionDraw({
      drawId: [...draw],
      threshold: [...maxThreshold()],
      registrationDurationSlots: new BN(REGISTRATION_DURATION_SLOTS),
      claimDurationSlots: new BN(CLAIM_DURATION_SLOTS),
      unclaimedRule: 0,
    })
    .accounts({ authority: c.authority.publicKey, sortitionDraw: drawPda(c, draw), systemProgram: SystemProgram.programId })
    .rpc();
}

async function initEconomics(c: Client, draw: Buffer, feeMode: number, entryFee: number, skimBps: number): Promise<string> {
  return (c.program.methods as any)
    .initSortitionEconomics({ drawId: [...draw], feeMode, entryFeeLamports: new BN(entryFee), closeSkimBps: skimBps })
    .accounts({ authority: c.authority.publicKey, sortitionDraw: drawPda(c, draw) })
    .rpc();
}

async function registerPaid(c: Client, draw: Buffer, t: Buffer, commit: Buffer, participant: Keypair, treasury: PublicKey): Promise<string> {
  return (c.program.methods as any)
    .registerSortitionTicketPaid({ drawId: [...draw], ticketId: [...t], commitment: [...commit] })
    .accounts({
      participant: participant.publicKey,
      sortitionDraw: drawPda(c, draw),
      ticketCommit: ticketPda(c, draw, t),
      programConfig: programConfigPda(c),
      treasury,
      systemProgram: SystemProgram.programId,
    })
    .signers([participant])
    .rpc();
}

async function registerFree(c: Client, draw: Buffer, t: Buffer, commit: Buffer, participant: Keypair): Promise<string> {
  return (c.program.methods as any)
    .registerSortitionTicket({ drawId: [...draw], ticketId: [...t], commitment: [...commit] })
    .accounts({
      participant: participant.publicKey,
      sortitionDraw: drawPda(c, draw),
      ticketCommit: ticketPda(c, draw, t),
      systemProgram: SystemProgram.programId,
    })
    .signers([participant])
    .rpc();
}

async function seal(c: Client, draw: Buffer): Promise<void> {
  const state: any = await (c.program.account as any).sortitionDraw.fetch(drawPda(c, draw));
  await waitUntilSlot(c, asBigInt(state.targetSlots[2]) + 1n);
  await (c.program.methods as any)
    .sealSortitionDraw({ drawId: [...draw] })
    .accounts({ sealer: c.authority.publicKey, sortitionDraw: drawPda(c, draw), slotHashes: SYSVAR_SLOT_HASHES_PUBKEY })
    .rpc();
}

async function closeTicket(c: Client, draw: Buffer, t: Buffer, owner: PublicKey, treasury: PublicKey): Promise<string> {
  return (c.program.methods as any)
    .closeSortitionTicket({ drawId: [...draw], ticketId: [...t] })
    .accounts({
      caller: c.authority.publicKey,
      sortitionDraw: drawPda(c, draw),
      ticketCommit: ticketPda(c, draw, t),
      owner,
      programConfig: programConfigPda(c),
      treasury,
    })
    .rpc();
}

async function sweep(c: Client, draw: Buffer, pairs: Array<{ ticket: Buffer; owner: PublicKey }>, treasury: PublicKey): Promise<string> {
  const remaining = pairs.flatMap((p) => [
    { pubkey: ticketPda(c, draw, p.ticket), isWritable: true, isSigner: false },
    { pubkey: p.owner, isWritable: true, isSigner: false },
  ]);
  return (c.program.methods as any)
    .sweepSortitionTickets({ drawId: [...draw] })
    .accounts({ caller: c.authority.publicKey, sortitionDraw: drawPda(c, draw), programConfig: programConfigPda(c), treasury })
    .remainingAccounts(remaining)
    .rpc();
}

async function expectFail(label: string, expected: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    return { label, expected, ok: false, matched: false, error: "unexpected success" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { label, expected, ok: true, matched: msg.includes(expected), error: msg.slice(0, 200) };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifactPath = args["artifact"] ?? ARTIFACT;
  const c = await loadClient(args["rpc-url"] ?? DEFAULT_RPC_URL, args["wallet"] ?? DEFAULT_WALLET_PATH, args["program-id"]);
  const results: any = { generated_at: new Date().toISOString(), program_id: c.programId.toBase58(), cu: {}, positive: {}, negatives: [], pass: true };

  // Dedicated treasury + participants for clean lamport deltas.
  const treasuryKp = Keypair.generate();
  await fund(c, treasuryKp.publicKey, 10_000_000); // pre-fund so it exists
  const treasury = await ensureProgramConfig(c, treasuryKp.publicKey);
  results.treasury = treasury.toBase58();
  results.treasury_is_dedicated = treasury.equals(treasuryKp.publicKey);

  const participants = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  for (const p of participants) await fund(c, p.publicKey, 50_000_000);

  // ---------- HAPPY: entry-fee + skim + close + sweep ----------
  const hd = drawId("happy");
  await createDraw(c, hd);
  const initSig = await initEconomics(c, hd, FEE_ENTRY | FEE_CLOSE_SKIM, ENTRY_FEE_LAMPORTS, CLOSE_SKIM_BPS);

  // entry fee: treasury delta == N * entry_fee
  const tBefore = await balance(c, treasury);
  const fixtures = participants.map((p, i) => {
    const t = ticketId(i);
    const secret = sha256(`infra013-secret:${i}`);
    return { t, secret, commit: commitment(secret, t, hd), participant: p };
  });
  let regSig = "";
  for (const f of fixtures) regSig = await registerPaid(c, hd, f.t, f.commit, f.participant, treasury);
  const tAfterReg = await balance(c, treasury);
  results.positive.entry_fee = {
    per_ticket: ENTRY_FEE_LAMPORTS,
    tickets: fixtures.length,
    treasury_delta: (tAfterReg - tBefore).toString(),
    expected: (BigInt(ENTRY_FEE_LAMPORTS) * BigInt(fixtures.length)).toString(),
    ok: tAfterReg - tBefore === BigInt(ENTRY_FEE_LAMPORTS) * BigInt(fixtures.length),
  };
  results.cu.register_paid = await getCU(c, regSig);
  results.cu.init_economics = await getCU(c, initSig);

  await seal(c, hd);

  // ticket rent (read account lamports before close)
  const rent = BigInt(
    (await c.provider.connection.getAccountInfo(ticketPda(c, hd, fixtures[0].t), "confirmed"))!.lamports
  );
  const expectedSkim = (rent * BigInt(CLOSE_SKIM_BPS)) / 10_000n;
  const expectedRefund = rent - expectedSkim;

  await waitUntilSlot(c, asBigInt((await (c.program.account as any).sortitionDraw.fetch(drawPda(c, hd))).claimDeadline) + 1n);

  // single close: owner gets refund, treasury gets skim, caller(keeper) gets nothing
  const ownerBefore = await balance(c, fixtures[0].participant.publicKey);
  const tBeforeClose = await balance(c, treasury);
  const closeSig = await closeTicket(c, hd, fixtures[0].t, fixtures[0].participant.publicKey, treasury);
  const ownerAfter = await balance(c, fixtures[0].participant.publicKey);
  const tAfterClose = await balance(c, treasury);
  results.cu.close = await getCU(c, closeSig);
  results.positive.close = {
    rent: rent.toString(),
    expected_refund: expectedRefund.toString(),
    owner_delta: (ownerAfter - ownerBefore).toString(),
    expected_skim: expectedSkim.toString(),
    treasury_delta: (tAfterClose - tBeforeClose).toString(),
    ok: ownerAfter - ownerBefore === expectedRefund && tAfterClose - tBeforeClose === expectedSkim,
  };

  // batch sweep tickets 1 & 2
  const tBeforeSweep = await balance(c, treasury);
  const o1Before = await balance(c, fixtures[1].participant.publicKey);
  const o2Before = await balance(c, fixtures[2].participant.publicKey);
  const sweepSig = await sweep(
    c,
    hd,
    [
      { ticket: fixtures[1].t, owner: fixtures[1].participant.publicKey },
      { ticket: fixtures[2].t, owner: fixtures[2].participant.publicKey },
    ],
    treasury
  );
  const tAfterSweep = await balance(c, treasury);
  results.cu.sweep_2 = await getCU(c, sweepSig);
  results.positive.sweep = {
    tickets: 2,
    treasury_delta: (tAfterSweep - tBeforeSweep).toString(),
    expected_skim_total: (expectedSkim * 2n).toString(),
    o1_delta: ((await balance(c, fixtures[1].participant.publicKey)) - o1Before).toString(),
    o2_delta: ((await balance(c, fixtures[2].participant.publicKey)) - o2Before).toString(),
    expected_refund_each: expectedRefund.toString(),
    ok: tAfterSweep - tBeforeSweep === expectedSkim * 2n,
  };

  // ---------- NEGATIVES (enforcement / regression) ----------
  // N1: free register blocked on an entry-fee draw
  {
    const d = drawId("n1");
    await createDraw(c, d);
    await initEconomics(c, d, FEE_ENTRY, ENTRY_FEE_LAMPORTS, 0);
    const f = { t: ticketId(0), secret: sha256("n1") };
    results.negatives.push(
      await expectFail("free_register_on_paid_draw", "SortitionPaidRegistrationRequired", () =>
        registerFree(c, d, f.t, commitment(f.secret, f.t, d), participants[0])
      )
    );
  }
  // N2: late-set economics after a registration exists
  {
    const d = drawId("n2");
    await createDraw(c, d);
    const f = { t: ticketId(0), secret: sha256("n2") };
    await registerFree(c, d, f.t, commitment(f.secret, f.t, d), participants[0]);
    results.negatives.push(
      await expectFail("late_set_economics", "SortitionEconomicsAfterRegistration", () =>
        initEconomics(c, d, FEE_CLOSE_SKIM, 0, 10_000)
      )
    );
  }
  // N3: economics set twice
  {
    const d = drawId("n3");
    await createDraw(c, d);
    await initEconomics(c, d, FEE_CLOSE_SKIM, 0, 500);
    results.negatives.push(
      await expectFail("economics_already_set", "SortitionEconomicsAlreadySet", () =>
        initEconomics(c, d, FEE_CLOSE_SKIM, 0, 500)
      )
    );
  }
  // N4: close before claim deadline
  {
    const d = drawId("n4");
    await createDraw(c, d);
    await initEconomics(c, d, FEE_CLOSE_SKIM, 0, CLOSE_SKIM_BPS);
    const f = { t: ticketId(0), secret: sha256("n4") };
    await registerPaid(c, d, f.t, commitment(f.secret, f.t, d), participants[0], treasury);
    results.negatives.push(
      await expectFail("close_before_deadline", "SortitionCloseTooEarly", () =>
        closeTicket(c, d, f.t, participants[0].publicKey, treasury)
      )
    );
  }
  // N5: invalid fee_mode bits
  {
    const d = drawId("n5");
    await createDraw(c, d);
    results.negatives.push(
      await expectFail("invalid_fee_mode_bits", "InvalidSortitionConfig", () =>
        initEconomics(c, d, 255, 0, 0)
      )
    );
  }
  // N6: skim bps > 10000
  {
    const d = drawId("n6");
    await createDraw(c, d);
    results.negatives.push(
      await expectFail("skim_bps_over_max", "InvalidSkimBps", () =>
        initEconomics(c, d, FEE_CLOSE_SKIM, 0, 10_001)
      )
    );
  }
  // N7: entry fee zero with ENTRY bit
  {
    const d = drawId("n7");
    await createDraw(c, d);
    results.negatives.push(
      await expectFail("entry_fee_zero", "InvalidEntryFee", () => initEconomics(c, d, FEE_ENTRY, 0, 0))
    );
  }
  // N8: register_paid with wrong treasury (skim/fee redirection blocked)
  {
    const d = drawId("n8");
    await createDraw(c, d);
    await initEconomics(c, d, FEE_ENTRY, ENTRY_FEE_LAMPORTS, 0);
    const f = { t: ticketId(0), secret: sha256("n8") };
    results.negatives.push(
      await expectFail("register_paid_wrong_treasury", "InvalidTreasuryAccount", () =>
        registerPaid(c, d, f.t, commitment(f.secret, f.t, d), participants[0], Keypair.generate().publicKey)
      )
    );
  }
  // N9: close with wrong treasury (skim cannot be redirected). Fresh ticket; the
  // treasury address constraint is validated before the claim-deadline handler gate.
  {
    const d = drawId("n9");
    await createDraw(c, d);
    await initEconomics(c, d, FEE_CLOSE_SKIM, 0, CLOSE_SKIM_BPS);
    const f = { t: ticketId(0), secret: sha256("n9") };
    await registerPaid(c, d, f.t, commitment(f.secret, f.t, d), participants[0], treasury);
    results.negatives.push(
      await expectFail("close_wrong_treasury", "InvalidTreasuryAccount", () =>
        closeTicket(c, d, f.t, participants[0].publicKey, Keypair.generate().publicKey)
      )
    );
  }

  // ---------- summary ----------
  const posOk = results.positive.entry_fee.ok && results.positive.close.ok && results.positive.sweep.ok;
  const negOk = results.negatives.every((n: any) => n.ok && n.matched);
  results.pass = posOk && negOk;
  results.summary = {
    positive_ok: posOk,
    negatives_passed: `${results.negatives.filter((n: any) => n.ok && n.matched).length}/${results.negatives.length}`,
  };

  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync(artifactPath, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.summary, null, 2));
  console.log(`cu: ${JSON.stringify(results.cu)}`);
  console.log(`entry_fee_ok=${results.positive.entry_fee.ok} close_ok=${results.positive.close.ok} sweep_ok=${results.positive.sweep.ok}`);
  for (const n of results.negatives) console.log(`  [${n.ok && n.matched ? "PASS" : "FAIL"}] ${n.label} (${n.expected})`);
  console.log(`artifact: ${artifactPath}`);
  if (!results.pass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
