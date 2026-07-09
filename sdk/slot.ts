// SF1 — Slot Format v1 (format_version = 10): artifact encoder, parser, and deterministic
// spin replay. Byte-compatible with the on-chain Rust module `programs/outcome/src/math/slot.rs`,
// which itself reproduces the legacy slot math (xorshift64* PRNG + line/scatter evaluation)
// bit-for-bit against the Java slotsim RTP balancer.
//
// Layout (little-endian, tightly packed, exact length):
//   magic "W3O1"(4) ‖ format_version:u16(=10) ‖ min_input_lamports:u64 ‖ max_input_lamports:u64 ‖
//   max_win_multiplier:u32(×10000) ‖ rows:u8 ‖ cols:u8 ‖ symbol_count:u8 ‖ wild_idx:u8 ‖
//   scatter_idx:u8 ‖ paylines_count:u16 ‖ paytable_scale_num:u32 ‖ paytable_scale_den:u32 ‖
//   reels[cols]:(reel_len:u16 ‖ reel_len×symbol:u8) ‖ paylines[count×cols]:row:u8 ‖
//   paytable[symbol_count×(cols+1)]:u64.

export const FORMAT_VERSION_SLOT = 10;
export const SLOT_MAGIC = Buffer.from("W3O1");
export const SLOT_MULTIPLIER_SCALE = 10_000n;
export const MAX_SLOT_DIM = 16;
export const SLOT_HEADER_BYTES = 41;
export const SLOT_RNG_TARGET_OFFSETS = [3n, 4n, 5n];
export const MAX_SLOT_ARTIFACT_BYTES = 8192;

const U64_MASK = (1n << 64n) - 1n;
const XORSHIFT_MULT = 0x2545f4914f6cdd1dn;

export type SlotGameSpec = {
  rows: number;
  cols: number;
  /** Symbol strips per column; each entry is a symbol index < symbolCount. */
  reels: number[][];
  /** Row index per column for each payline. */
  paylines: number[][];
  /** paytable[symbol][matchedCount], scaled by 10000; rows of length cols+1. */
  paytable: bigint[][];
  wildIdx: number;
  scatterIdx: number;
  paytableScaleNum: number;
  paytableScaleDen: number;
  minInputLamports: bigint;
  maxInputLamports: bigint;
  /** Max-win cap relative to the bet, scaled by 10000 (e.g. 50_000_000 = 5000x). */
  maxWinMultiplier: number;
};

export type SlotSpec = {
  minInputLamports: bigint;
  maxInputLamports: bigint;
  maxWinMultiplier: number;
  rows: number;
  cols: number;
  symbolCount: number;
  wildIdx: number;
  scatterIdx: number;
  paylinesCount: number;
  paytableScaleNum: number;
  paytableScaleDen: number;
  /** Symbol strip per column. */
  reels: Buffer[];
  paylinesOff: number;
  paytableOff: number;
  blob: Buffer;
};

export type SlotSpinOutcome = {
  totalWinLamports: bigint;
  reelStops: number[];
};

function fail(message: string): never {
  throw new Error(`SF1: ${message}`);
}

// ---- encoder (compiler output → on-chain artifact bytes) ----

export function encodeSlotArtifact(spec: SlotGameSpec): Buffer {
  const {
    rows,
    cols,
    reels,
    paylines,
    paytable,
    wildIdx,
    scatterIdx,
    paytableScaleNum,
    paytableScaleDen,
    minInputLamports,
    maxInputLamports,
    maxWinMultiplier,
  } = spec;
  const symbolCount = paytable.length;

  if (rows <= 0 || cols <= 0 || rows > MAX_SLOT_DIM || cols > MAX_SLOT_DIM) {
    fail(`invalid dims ${rows}x${cols}`);
  }
  if (symbolCount <= 0 || symbolCount > 255) fail("invalid symbol count");
  if (wildIdx >= symbolCount || scatterIdx >= symbolCount) fail("wild/scatter out of range");
  if (reels.length !== cols) fail("reels length must equal cols");
  if (paylines.length === 0 || paylines.length > 0xffff) fail("invalid paylines count");
  if (paytableScaleNum <= 0 || paytableScaleDen <= 0) fail("invalid paytable scale");
  if (minInputLamports > maxInputLamports) fail("min bet exceeds max bet");
  if (maxWinMultiplier <= 0) fail("max win multiplier must be positive");

  const chunks: Buffer[] = [];
  const u16 = (v: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v, 0);
    chunks.push(b);
  };
  const u32 = (v: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v, 0);
    chunks.push(b);
  };
  const u64 = (v: bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(v, 0);
    chunks.push(b);
  };
  const u8 = (v: number) => chunks.push(Buffer.from([v]));

  chunks.push(SLOT_MAGIC);
  u16(FORMAT_VERSION_SLOT);
  u64(minInputLamports);
  u64(maxInputLamports);
  u32(maxWinMultiplier);
  u8(rows);
  u8(cols);
  u8(symbolCount);
  u8(wildIdx);
  u8(scatterIdx);
  u16(paylines.length);
  u32(paytableScaleNum);
  u32(paytableScaleDen);

  for (const reel of reels) {
    if (reel.length === 0 || reel.length > 0xffff) fail("invalid reel length");
    u16(reel.length);
    for (const sym of reel) {
      if (sym < 0 || sym >= symbolCount) fail("reel symbol out of range");
    }
    chunks.push(Buffer.from(reel));
  }
  for (const line of paylines) {
    if (line.length !== cols) fail("payline length must equal cols");
    for (const row of line) {
      if (row < 0 || row >= rows) fail("payline row out of range");
    }
    chunks.push(Buffer.from(line));
  }
  for (const symRow of paytable) {
    if (symRow.length !== cols + 1) fail("paytable row length must be cols+1");
    for (const mult of symRow) u64(mult);
  }

  const blob = Buffer.concat(chunks);
  if (blob.length > MAX_SLOT_ARTIFACT_BYTES) fail("artifact exceeds max size");
  return blob;
}

// ---- parser (mirror of Rust slot::parse, same validation order) ----

export function parseSlotArtifact(blob: Buffer): SlotSpec {
  if (blob.length === 0 || blob.length > MAX_SLOT_ARTIFACT_BYTES) fail("bad blob size");
  if (blob.length < SLOT_HEADER_BYTES) fail("blob shorter than header");
  if (!blob.subarray(0, 4).equals(SLOT_MAGIC)) fail("bad magic");

  let off = 4;
  const formatVersion = blob.readUInt16LE(off);
  off += 2;
  if (formatVersion !== FORMAT_VERSION_SLOT) fail(`format_version ${formatVersion} != 10`);

  const minInputLamports = blob.readBigUInt64LE(off);
  off += 8;
  const maxInputLamports = blob.readBigUInt64LE(off);
  off += 8;
  if (minInputLamports > maxInputLamports) fail("min bet exceeds max bet");

  const maxWinMultiplier = blob.readUInt32LE(off);
  off += 4;
  if (maxWinMultiplier === 0) fail("zero max win multiplier");

  const rows = blob[off];
  const cols = blob[off + 1];
  const symbolCount = blob[off + 2];
  const wildIdx = blob[off + 3];
  const scatterIdx = blob[off + 4];
  off += 5;
  if (rows === 0 || cols === 0) fail("zero dims");
  if (rows > MAX_SLOT_DIM || cols > MAX_SLOT_DIM) fail("dims exceed max");
  if (symbolCount === 0) fail("zero symbols");
  if (wildIdx >= symbolCount || scatterIdx >= symbolCount) fail("wild/scatter out of range");

  const paylinesCount = blob.readUInt16LE(off);
  off += 2;
  if (paylinesCount === 0) fail("zero paylines");

  const paytableScaleNum = blob.readUInt32LE(off);
  off += 4;
  const paytableScaleDen = blob.readUInt32LE(off);
  off += 4;
  if (paytableScaleNum === 0 || paytableScaleDen === 0) fail("zero paytable scale");

  const reels: Buffer[] = [];
  for (let col = 0; col < cols; col += 1) {
    if (off + 2 > blob.length) fail("truncated reel length");
    const len = blob.readUInt16LE(off);
    off += 2;
    if (len === 0) fail("empty reel");
    if (off + len > blob.length) fail("truncated reel");
    const strip = blob.subarray(off, off + len);
    for (const sym of strip) {
      if (sym >= symbolCount) fail("reel symbol out of range");
    }
    reels.push(strip);
    off += len;
  }

  const paylinesOff = off;
  const paylinesBytes = paylinesCount * cols;
  if (off + paylinesBytes > blob.length) fail("truncated paylines");
  for (let i = 0; i < paylinesBytes; i += 1) {
    if (blob[off + i] >= rows) fail("payline row out of range");
  }
  off += paylinesBytes;

  const paytableOff = off;
  const paytableBytes = symbolCount * (cols + 1) * 8;
  if (off + paytableBytes > blob.length) fail("truncated paytable");
  off += paytableBytes;

  if (off !== blob.length) fail("trailing bytes");

  return {
    minInputLamports,
    maxInputLamports,
    maxWinMultiplier,
    rows,
    cols,
    symbolCount,
    wildIdx,
    scatterIdx,
    paylinesCount,
    paytableScaleNum,
    paytableScaleDen,
    reels,
    paylinesOff,
    paytableOff,
    blob,
  };
}

// ---- deterministic replay (mirror of Rust slot::replay_spin) ----

/** xorshift64*: state mutated before the multiply; unsigned modulo, no rejection sampling. */
function nextInt(state: { value: bigint }, bound: number): number {
  let x = state.value;
  x ^= x >> 12n;
  x = (x ^ ((x << 25n) & U64_MASK)) & U64_MASK;
  x ^= x >> 27n;
  state.value = x;
  const result = (x * XORSHIFT_MULT) & U64_MASK;
  return Number(result % BigInt(bound));
}

/** Round-half-up scale `base × num / den` (the RTP-balancing knob). */
function scaleMultiplierRound(base: bigint, num: number, den: number): bigint {
  if (den === 0) return 0n;
  const scaled = base * BigInt(num);
  return (scaled + BigInt(den) / 2n) / BigInt(den);
}

/** Per-spin vault exposure cap: `round(bet × max_win_multiplier / 10000)`. */
export function maxWinCap(betLamports: bigint, maxWinMultiplier: number): bigint {
  const scaled = betLamports * BigInt(maxWinMultiplier);
  return (scaled + SLOT_MULTIPLIER_SCALE / 2n) / SLOT_MULTIPLIER_SCALE;
}

/**
 * Replay one spin: 32-byte rng_v2 randomness → reel stops → line + scatter wins.
 * Returns the RAW win (the settle instruction clamps it by `maxWinCap`).
 */
export function replaySpin(
  spec: SlotSpec,
  randomness: Buffer,
  betLamports: bigint
): SlotSpinOutcome {
  if (randomness.length !== 32) fail("randomness must be 32 bytes");
  const { rows, cols, wildIdx, scatterIdx, blob } = spec;

  const state = { value: randomness.readBigUInt64LE(0) };
  const reelStops: number[] = [];
  const grid: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let col = 0; col < cols; col += 1) {
    const strip = spec.reels[col];
    const stop = nextInt(state, strip.length);
    reelStops.push(stop);
    for (let row = 0; row < rows; row += 1) {
      grid[row][col] = strip[(stop + row) % strip.length];
    }
  }

  const lineBet = betLamports / BigInt(spec.paylinesCount);
  const paytableStride = (cols + 1) * 8;
  let totalWin = 0n;

  // Line wins: left-to-right, scatter breaks the run, wild counts and continues.
  for (let line = 0; line < spec.paylinesCount; line += 1) {
    let target = -1;
    let count = 0;
    for (let col = 0; col < cols; col += 1) {
      const row = blob[spec.paylinesOff + line * cols + col];
      const symbol = grid[row][col];
      if (symbol === scatterIdx) break;
      if (symbol === wildIdx) {
        count += 1;
        continue;
      }
      if (target === -1) {
        target = symbol;
        count += 1;
      } else if (symbol === target) {
        count += 1;
      } else {
        break;
      }
    }
    if (count >= 3) {
      const idx = target === -1 ? wildIdx : target;
      const countClamped = Math.min(count, cols);
      const multScaled = blob.readBigUInt64LE(
        spec.paytableOff + idx * paytableStride + countClamped * 8
      );
      if (multScaled === 0n) continue;
      // Two-stage rounding, do not fuse: truncate by MULTIPLIER_SCALE, then round-half-up scale.
      const base = (lineBet * multScaled) / SLOT_MULTIPLIER_SCALE;
      totalWin += scaleMultiplierRound(base, spec.paytableScaleNum, spec.paytableScaleDen);
    }
  }

  // Scatter wins: counted anywhere on the grid, scaling the FULL bet (Java parity).
  let scatterCount = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (grid[row][col] === scatterIdx) scatterCount += 1;
    }
  }
  if (scatterCount >= 3) {
    const countClamped = Math.min(scatterCount, cols);
    const multScaled = blob.readBigUInt64LE(
      spec.paytableOff + scatterIdx * paytableStride + countClamped * 8
    );
    if (multScaled > 0n) {
      const base = (betLamports * multScaled) / SLOT_MULTIPLIER_SCALE;
      totalWin += scaleMultiplierRound(base, spec.paytableScaleNum, spec.paytableScaleDen);
    }
  }

  return { totalWinLamports: totalWin, reelStops };
}
