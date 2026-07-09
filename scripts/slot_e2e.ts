// Localnet/devnet SF1 slot e2e: program config -> commit SF1 artifact (submit/chunk/finalize/
// review) -> outcome config -> fund vault -> prepare_slot_spin -> wait for target slots ->
// settle_slot_spin. Prints the settle signature for `yarn replay --sig <sig>`.
//
// The commit + config instructions use the (present) IDL via anchor .methods; the two new slot
// instructions are built as RAW instructions (computed Anchor discriminators) so a stale IDL is
// not a blocker.
//
//   TS_NODE_PROJECT=tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --loader ts-node/esm scripts/slot_e2e.ts
import * as anchor from "@coral-xyz/anchor";
const BN = (anchor as any).BN ?? (anchor as any).default.BN;
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  SYSVAR_SLOT_HASHES_PUBKEY,
} from "@solana/web3.js";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import { encodeSlotArtifact, maxWinCap, type SlotGameSpec } from "../sdk/slot.js";
import {
  deriveProgramConfigPda,
  deriveApprovedArtifactPda,
  deriveApprovedArtifactChunkPda,
  deriveOutcomeConfigPda,
  deriveOutcomeVaultPda,
} from "../sdk/internals.js";

const RPC = process.env.VRE_RPC ?? "http://127.0.0.1:8899";
const PROGRAM_ID = new PublicKey(
  process.env.VRE_PROGRAM_ID ?? "6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B"
);
const WALLET_PATH = process.env.VRE_WALLET ?? `${os.homedir()}/.config/solana/id.json`;
const BPF_LOADER_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const CHUNK_SIZE = 1024;
const CHUNK_WRITE_BYTES = 900;
const STATUS_APPROVED = 1;
const BET_LAMPORTS = 100_000n;

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();
const ixDisc = (name: string) => sha256(Buffer.from(`global:${name}`)).subarray(0, 8);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// demo_5x3_v1 — same fixture as the Rust/TS parity tests.
const DEMO: SlotGameSpec = {
  rows: 3,
  cols: 5,
  reels: [
    [0, 1, 2, 3],
    [1, 0, 2, 3],
    [0, 0, 1, 2],
    [2, 1, 0, 3],
    [1, 2, 0, 3],
  ],
  paylines: [
    [0, 0, 0, 0, 0],
    [1, 1, 1, 1, 1],
    [2, 2, 2, 2, 2],
  ],
  paytable: [
    [0n, 0n, 0n, 20_000n, 50_000n, 100_000n],
    [0n, 0n, 0n, 15_000n, 30_000n, 60_000n],
    [0n, 0n, 0n, 10_000n, 20_000n, 40_000n],
    [0n, 0n, 0n, 30_000n, 70_000n, 120_000n],
    [0n, 0n, 0n, 20_000n, 50_000n, 80_000n],
  ],
  wildIdx: 3,
  scatterIdx: 4,
  paytableScaleNum: 2_048,
  paytableScaleDen: 2_048,
  minInputLamports: 1_000n,
  maxInputLamports: 1_000_000_000n,
  maxWinMultiplier: 1_000_000, // 100x
};

function deriveRngV2StatePda(runtimeId: Buffer, resolveId: bigint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("rng_v2_state"), runtimeId, new BN(resolveId.toString()).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];
}
function deriveProgramDataPda() {
  return PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], BPF_LOADER_UPGRADEABLE)[0];
}
const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => ({
  pubkey,
  isSigner,
  isWritable,
});

async function main() {
  const wallet = new anchor.Wallet(
    Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8"))))
  );
  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const idl = JSON.parse(fs.readFileSync("target/idl/outcome.json", "utf8"));
  idl.address = PROGRAM_ID.toBase58();
  const program = new anchor.Program(idl as anchor.Idl, provider);
  const m = program.methods as any;
  const authority = wallet.publicKey;
  const send = (ixs: TransactionInstruction[]) =>
    provider.sendAndConfirm(new Transaction().add(...ixs), []);

  // localnet: make sure we have funds.
  if (RPC.includes("127.0.0.1") || RPC.includes("localhost")) {
    const bal = await connection.getBalance(authority);
    if (bal < 2e9) {
      await connection.confirmTransaction(await connection.requestAirdrop(authority, 5e9), "confirmed");
    }
  }

  // 1. program config (idempotent)
  const programConfigPda = deriveProgramConfigPda(PROGRAM_ID);
  if (!(await connection.getAccountInfo(programConfigPda))) {
    await m
      .initializeProgramConfig({ feeLamports: new BN(0), treasury: authority })
      .accounts({
        payer: authority,
        program: PROGRAM_ID,
        programData: deriveProgramDataPda(),
        upgradeAuthority: authority,
        programConfig: programConfigPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("program config initialized");
  }

  // 2. SF1 artifact
  const blob = encodeSlotArtifact(DEMO);
  const compiledArtifactHash = sha256(blob);
  console.log("SF1 blob:", blob.length, "bytes; hash", compiledArtifactHash.toString("hex"));
  const artifactPda = deriveApprovedArtifactPda(PROGRAM_ID, compiledArtifactHash);
  const chunkCount = Math.ceil(blob.length / CHUNK_SIZE);
  const chunkPdas = Array.from({ length: chunkCount }, (_, i) =>
    deriveApprovedArtifactChunkPda(PROGRAM_ID, compiledArtifactHash, i)
  );
  const chunkMetas = chunkPdas.map((pubkey) => meta(pubkey, false, false));

  if (!(await connection.getAccountInfo(artifactPda))) {
    await m
      .submitCompiledArtifact({
        compiledArtifactHash: [...compiledArtifactHash],
        formatVersion: blob.readUInt16LE(4),
        blobLen: blob.length,
      })
      .accounts({
        publisher: authority,
        approvedOutcomeArtifact: artifactPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    for (let ci = 0; ci < chunkCount; ci++) {
      await m
        .initCompiledArtifactChunk({ compiledArtifactHash: [...compiledArtifactHash], chunkIndex: ci })
        .accounts({
          publisher: authority,
          approvedOutcomeArtifact: artifactPda,
          approvedOutcomeArtifactChunk: chunkPdas[ci],
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      const chunk = blob.subarray(ci * CHUNK_SIZE, Math.min(blob.length, (ci + 1) * CHUNK_SIZE));
      for (let off = 0; off < chunk.length; off += CHUNK_WRITE_BYTES) {
        await m
          .writeCompiledArtifactChunk({
            compiledArtifactHash: [...compiledArtifactHash],
            chunkIndex: ci,
            offset: off,
            data: Buffer.from(chunk.subarray(off, Math.min(chunk.length, off + CHUNK_WRITE_BYTES))),
          })
          .accounts({
            publisher: authority,
            approvedOutcomeArtifact: artifactPda,
            approvedOutcomeArtifactChunk: chunkPdas[ci],
          })
          .rpc();
      }
    }
    await m
      .finalizeCompiledArtifact()
      .accounts({ publisher: authority, approvedOutcomeArtifact: artifactPda })
      .remainingAccounts(chunkMetas)
      .rpc();
    await m
      .reviewCompiledArtifact({
        status: STATUS_APPROVED,
        auditHash: [...Buffer.alloc(32, 0)],
        artifactUri: Buffer.from("slot-e2e.sf1"),
      })
      .accounts({ programConfig: programConfigPda, admin: authority, approvedOutcomeArtifact: artifactPda })
      .rpc();
    console.log("SF1 artifact submitted + finalized + approved");
  }

  // 3. outcome config (fresh runtime each run) — bind the artifact bet band.
  const runtimeId = Buffer.from(sha256(Buffer.from(`slot-e2e-${Date.now()}`)).subarray(0, 16));
  const outcomeConfigPda = deriveOutcomeConfigPda(PROGRAM_ID, runtimeId);
  const outcomeVaultPda = deriveOutcomeVaultPda(PROGRAM_ID, runtimeId);
  await m
    .initializeOutcomeConfig({
      runtimeId: [...runtimeId],
      minInputLamports: new BN(DEMO.minInputLamports.toString()),
      maxInputLamports: new BN(DEMO.maxInputLamports.toString()),
      compiledArtifactHash: [...compiledArtifactHash],
      masterSeed: [...Buffer.alloc(32, 0)],
    })
    .accounts({
      authority,
      programConfig: programConfigPda,
      outcomeConfig: outcomeConfigPda,
      outcomeVault: outcomeVaultPda,
      treasury: authority,
      approvedOutcomeArtifact: artifactPda,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(chunkMetas)
    .rpc();
  console.log("outcome config:", outcomeConfigPda.toBase58());

  // 4. fund the house vault above this spin's max-win exposure.
  const cap = maxWinCap(BET_LAMPORTS, DEMO.maxWinMultiplier);
  const fund = cap * 3n; // comfortable headroom
  await send([
    SystemProgram.transfer({
      fromPubkey: authority,
      toPubkey: outcomeVaultPda,
      lamports: Number(fund),
    }),
  ]);
  console.log("vault funded:", fund.toString(), "lamports (cap per spin:", cap.toString(), ")");

  // 5. prepare_slot_spin (RAW) — resolve_id = current next_resolve_id (0 for a fresh config).
  const resolveId = 0n;
  const rngState = deriveRngV2StatePda(runtimeId, resolveId);
  const prepareData = Buffer.concat([
    ixDisc("prepare_slot_spin"),
    runtimeId,
    new BN(BET_LAMPORTS.toString()).toArrayLike(Buffer, "le", 8),
  ]);
  const prepareIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(authority, true, true), // actor
      meta(programConfigPda, false, false),
      meta(outcomeConfigPda, false, true),
      meta(outcomeVaultPda, false, true),
      meta(rngState, false, true),
      meta(artifactPda, false, false),
      meta(SystemProgram.programId, false, false),
      ...chunkMetas,
    ],
    data: prepareData,
  });
  const prepareSig = await send([prepareIx]);
  console.log("prepared spin, resolve_id", resolveId.toString(), "sig", prepareSig);

  // read target slots to know when to settle.
  const state = await (program.account as any).rngV2State.fetch(rngState);
  const targetSlots: bigint[] = state.targetSlots.map((s: any) => BigInt(s.toString()));
  console.log("target_slots:", targetSlots.map(String), "→ waiting for maturity (~2s)");
  const lastTarget = targetSlots[2];
  for (;;) {
    const slot = BigInt(await connection.getSlot("confirmed"));
    if (slot > lastTarget) break;
    await sleep(200);
  }

  // 6. settle_slot_spin (RAW, permissionless crank — signed here by the same wallet).
  const settleData = Buffer.concat([
    ixDisc("settle_slot_spin"),
    runtimeId,
    new BN(resolveId.toString()).toArrayLike(Buffer, "le", 8),
  ]);
  const settleIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(authority, true, true), // cranker
      meta(programConfigPda, false, false),
      meta(outcomeConfigPda, false, false),
      meta(outcomeVaultPda, false, true),
      meta(rngState, false, true),
      meta(authority, false, true), // actor (== state.actor)
      meta(artifactPda, false, false),
      meta(authority, false, true), // protocol_treasury (unused when fee=0; any system acct)
      meta(SYSVAR_SLOT_HASHES_PUBKEY, false, false),
      meta(SystemProgram.programId, false, false),
      ...chunkMetas,
    ],
    data: settleData,
  });
  const settleSig = await send([settleIx]);

  console.log("\n=== SETTLED ===");
  console.log("runtime-id:", runtimeId.toString("hex"));
  console.log("resolve-id:", resolveId.toString());
  console.log("settle sig:", settleSig);
  console.log(`\nVerify:\n  yarn -s replay --sig ${settleSig} --url ${RPC} --program-id ${PROGRAM_ID.toBase58()}`);
  fs.writeFileSync(
    "/tmp/slot_e2e.json",
    JSON.stringify(
      { runtimeId: runtimeId.toString("hex"), resolveId: resolveId.toString(), settleSig, prepareSig, rpc: RPC, programId: PROGRAM_ID.toBase58() },
      null,
      2
    )
  );
}
main().catch((e) => {
  console.error(e?.stack ?? String(e));
  process.exit(1);
});
