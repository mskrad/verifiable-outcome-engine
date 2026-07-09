// TS parity check for the SF1 slot SDK (sdk/slot.ts) against the on-chain Rust module
// (programs/outcome/src/math/slot.rs): byte-exact artifact encoding (cross-language golden
// sha256) and spin-replay golden vectors (reel stops + payout).
//
//   TS_NODE_PROJECT=tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --loader ts-node/esm scripts/slot_ts_parity.ts

import crypto from "crypto";
import {
  encodeSlotArtifact,
  parseSlotArtifact,
  replaySpin,
  maxWinCap,
  FORMAT_VERSION_SLOT,
  type SlotGameSpec,
} from "../sdk/slot.js";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, extra = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` ${extra}` : ""}`);
};

// demo_5x3_v1 — the same fixture as the Rust unit tests (slot.rs::tests).
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
  maxWinMultiplier: 1_000_000,
};

// Cross-language golden: Rust test `demo_blob_matches_cross_language_golden` pins the same value.
const GOLDEN_SHA256 = "d4559ef2d4088dd43c94802f51b2725b0869c92e3eaf33330d47517540fbfe39";

const blob = encodeSlotArtifact(DEMO);
check("encode: blob length 326", blob.length === 326, `(got ${blob.length})`);
const sha = crypto.createHash("sha256").update(blob).digest("hex");
check("encode: cross-language golden sha256", sha === GOLDEN_SHA256, `(got ${sha})`);

const spec = parseSlotArtifact(blob);
check(
  "parse: header fields",
  spec.rows === 3 &&
    spec.cols === 5 &&
    spec.symbolCount === 5 &&
    spec.wildIdx === 3 &&
    spec.scatterIdx === 4 &&
    spec.paylinesCount === 3 &&
    spec.minInputLamports === 1_000n &&
    spec.maxInputLamports === 1_000_000_000n &&
    spec.maxWinMultiplier === 1_000_000 &&
    spec.paytableScaleNum === 2_048 &&
    spec.paytableScaleDen === 2_048
);

// Replay golden vectors — identical to Rust tests (independent Python oracle origin):
// randomness = seed u64 LE in the first 8 bytes, rest zero; bet = 100_000.
const bet = 100_000n;
const vector = (seed: bigint) => {
  const randomness = Buffer.alloc(32, 0);
  randomness.writeBigUInt64LE(seed, 0);
  return replaySpin(spec, randomness, bet);
};

const a = vector(1n);
check(
  "replay: vector A (seed=1) stops [1,1,3,1,0]",
  JSON.stringify(a.reelStops) === JSON.stringify([1, 1, 3, 1, 0])
);
check("replay: vector A win 333330", a.totalWinLamports === 333_330n, `(got ${a.totalWinLamports})`);

const b = vector(0n);
check(
  "replay: vector B (seed=0) stops [0,0,0,0,0]",
  JSON.stringify(b.reelStops) === JSON.stringify([0, 0, 0, 0, 0])
);
check("replay: vector B win 0", b.totalWinLamports === 0n);

const c = vector(7n);
check(
  "replay: vector C (seed=7) stops [2,2,2,2,1]",
  JSON.stringify(c.reelStops) === JSON.stringify([2, 2, 2, 2, 1])
);
check("replay: vector C win 66666", c.totalWinLamports === 66_666n, `(got ${c.totalWinLamports})`);

// max-win cap parity with Rust `max_win_cap_rounds_half_up`.
check("cap: 1000 × 2.5x = 2500", maxWinCap(1_000n, 25_000) === 2_500n);
check("cap: 3 × 1.6667x = 5", maxWinCap(3n, 16_667) === 5n);
check("cap: 100k × 5000x", maxWinCap(100_000n, 50_000_000) === 500_000_000n);

// Rejection sanity.
const rejects = (name: string, mutate: (bad: Buffer) => void) => {
  const bad = Buffer.from(blob);
  mutate(bad);
  let threw = false;
  try {
    parseSlotArtifact(bad);
  } catch {
    threw = true;
  }
  check(`reject: ${name}`, threw);
};
rejects("bad magic", (bad) => (bad[0] = 0x58));
rejects("wrong version", (bad) => (bad[4] = 9));
{
  let threw = false;
  try {
    parseSlotArtifact(Buffer.concat([blob, Buffer.from([0])]));
  } catch {
    threw = true;
  }
  check("reject: trailing bytes", threw);
}

check("const: FORMAT_VERSION_SLOT === 10", FORMAT_VERSION_SLOT === 10);

console.log(`\nslot_ts_parity: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
