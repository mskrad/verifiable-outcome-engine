// OddSol `conditions` mode — fc7/fv9 artifact builder, parser, and deterministic replay
// scorer. Byte-compatible (borsh, little-endian) with the on-chain Rust module
// `programs/outcome/src/math/conditions.rs`. Reproduces OddSol `scoreExpress` bit-for-bit
// (`packages/scoring/src/index.mjs`), verified against `vre-parity-vectors.json`.
//
// Fixed-point: odds ×1000 (odds_milli), product in BigInt, S emitted ×10000 with a single
// round-half-up `(P*10000 + denom/2)/denom`, denom = 1000^N. Totals push via line_x2
// (`total2 = 2*(g1+g2)`, void iff line_x2 even && total2 == line_x2).

import crypto from "crypto";

export const FORMAT_VERSION_CONDITIONS = 9;
export const FORMULA_CODE_CONDITIONS = 7;
export const MAGIC = Buffer.from("W3O1");
export const ODDS_SCALE = 1000n;
export const FIXED_SCALE = 10000n;
export const MAX_LEGS = 8;
export const MIN_ODDS_MILLI = 1001;
export const MAX_ODDS_MILLI = 1_000_000;
export const WINNERS_MODE_ALL_HIT_PRORATA = 0;

// Tag encodings (locked borsh layout).
export const TERM_SINGLE = 0;
export const TERM_BINARY = 1;
export const OP_NONE = 0;
export const OP_ADD = 1;
export const OP_SUBTRACT = 2;
export const CMP_GT = 0;
export const CMP_LT = 1;
export const CMP_EQ = 2;
export const NO_LINE = -2147483648; // i32::MIN

export type LegCommit = {
  termKind: number;
  statKeyA: number;
  statKeyB: number;
  op: number;
  comparison: number;
  threshold: number;
  lineX2: number;
  oddsMilli: number;
};

export type ScoreStat = { statKey: number; value: number };
export type ConditionsFixture = { fixtureId: number; eventStatRoot: Buffer; stats: ScoreStat[] };
export type ConditionsEntrant = {
  wallet: Buffer; // 32 bytes
  tier: bigint;
  enteredAt: bigint;
  legs: LegCommit[];
  fixtureIndex: number[];
};
export type ConditionsArtifact = {
  formatVersion: number;
  formulaCode: number;
  winnersMode: number;
  fixtures: ConditionsFixture[];
  entrants: ConditionsEntrant[];
};

export type LegResult = "hit" | "miss" | "void" | "pending";
export type SlipScore = { settled: boolean; allHit: boolean; voidCount: number; scoreFixed: number };
export type RankedEntrant = {
  wallet: Buffer;
  enteredAt: bigint;
  scoreFixed: number;
  allHit: boolean;
  voidCount: number;
  settled: boolean;
};

// ---- byte writers (borsh LE) ----
function u16(v: number): Buffer { const b = Buffer.alloc(2); b.writeUInt16LE(v >>> 0, 0); return b; }
function u32(v: number): Buffer { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b; }
function i32(v: number): Buffer { const b = Buffer.alloc(4); b.writeInt32LE(v | 0, 0); return b; }
function u64(v: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(v, 0); return b; }
function i64(v: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigInt64LE(v, 0); return b; }
function fixed32(b: Buffer): Buffer { if (b.length !== 32) throw new Error("expected 32 bytes"); return b; }
function vec<T>(items: T[], enc: (t: T) => Buffer): Buffer {
  return Buffer.concat([u32(items.length), ...items.map(enc)]);
}

function encodeLeg(l: LegCommit): Buffer {
  return Buffer.concat([
    Buffer.from([l.termKind]), u32(l.statKeyA), u32(l.statKeyB),
    Buffer.from([l.op]), Buffer.from([l.comparison]),
    i32(l.threshold), i32(l.lineX2), u64(BigInt(l.oddsMilli)),
  ]);
}
function encodeStat(s: ScoreStat): Buffer { return Buffer.concat([u32(s.statKey), i32(s.value)]); }
function encodeFixture(f: ConditionsFixture): Buffer {
  return Buffer.concat([u32(f.fixtureId), fixed32(f.eventStatRoot), vec(f.stats, encodeStat)]);
}
function encodeEntrant(e: ConditionsEntrant): Buffer {
  return Buffer.concat([
    fixed32(e.wallet), u64(e.tier), i64(e.enteredAt),
    vec(e.legs, encodeLeg), vec(e.fixtureIndex, u16),
  ]);
}

// ---- canonical leg sort (must match Rust `sort_legs`) ----
export function sortLegs(legs: LegCommit[]): LegCommit[] {
  return [...legs].sort((a, b) =>
    a.statKeyA - b.statKeyA || a.statKeyB - b.statKeyB || a.op - b.op ||
    a.comparison - b.comparison || a.threshold - b.threshold ||
    a.lineX2 - b.lineX2 || a.oddsMilli - b.oddsMilli);
}

/** slip_hash = sha256(borsh(EntryCommit{wallet, tier, sorted legs})). */
export function slipHash(wallet: Buffer, tier: bigint, legs: LegCommit[]): Buffer {
  const sorted = sortLegs(legs);
  const preimage = Buffer.concat([fixed32(wallet), u64(tier), vec(sorted, encodeLeg)]);
  return crypto.createHash("sha256").update(preimage).digest();
}

// ---- artifact build / parse ----
export function buildConditionsArtifact(
  fixtures: ConditionsFixture[], entrants: ConditionsEntrant[]
): Buffer {
  return Buffer.concat([
    MAGIC, u16(FORMAT_VERSION_CONDITIONS),
    Buffer.from([FORMULA_CODE_CONDITIONS]), Buffer.from([WINNERS_MODE_ALL_HIT_PRORATA]),
    vec(fixtures, encodeFixture), vec(entrants, encodeEntrant),
  ]);
}

class Reader {
  constructor(private buf: Buffer, private off = 0) {}
  take(n: number): Buffer { const b = this.buf.subarray(this.off, this.off + n); this.off += n; return b; }
  u8(): number { return this.take(1)[0]; }
  u16(): number { return this.take(2).readUInt16LE(0); }
  u32(): number { return this.take(4).readUInt32LE(0); }
  i32(): number { return this.take(4).readInt32LE(0); }
  u64(): bigint { return this.take(8).readBigUInt64LE(0); }
  i64(): bigint { return this.take(8).readBigInt64LE(0); }
  vec<T>(dec: () => T): T[] { const n = this.u32(); const out: T[] = []; for (let i = 0; i < n; i++) out.push(dec()); return out; }
}

export function parseConditionsArtifact(bytes: Buffer): ConditionsArtifact {
  const r = new Reader(bytes);
  const magic = r.take(4);
  if (!magic.equals(MAGIC)) throw new Error("conditions artifact: bad magic");
  const formatVersion = r.u16();
  const formulaCode = r.u8();
  const winnersMode = r.u8();
  if (formatVersion !== FORMAT_VERSION_CONDITIONS || formulaCode !== FORMULA_CODE_CONDITIONS) {
    throw new Error("conditions artifact: unexpected format/formula");
  }
  const fixtures = r.vec<ConditionsFixture>(() => ({
    fixtureId: r.u32(),
    eventStatRoot: Buffer.from(r.take(32)),
    stats: r.vec<ScoreStat>(() => ({ statKey: r.u32(), value: r.i32() })),
  }));
  const entrants = r.vec<ConditionsEntrant>(() => ({
    wallet: Buffer.from(r.take(32)),
    tier: r.u64(),
    enteredAt: r.i64(),
    legs: r.vec<LegCommit>(() => ({
      termKind: r.u8(), statKeyA: r.u32(), statKeyB: r.u32(),
      op: r.u8(), comparison: r.u8(), threshold: r.i32(), lineX2: r.i32(),
      oddsMilli: Number(r.u64()),
    })),
    fixtureIndex: r.vec<number>(() => r.u16()),
  }));
  return { formatVersion, formulaCode, winnersMode, fixtures, entrants };
}

// ---- deterministic scoring (mirror conditions.rs) ----
function statValue(facts: ScoreStat[], key: number): number | null {
  const s = facts.find((x) => x.statKey === key);
  return s ? s.value : null;
}

export function evalLeg(leg: LegCommit, facts: ScoreStat[]): LegResult {
  let value: number;
  if (leg.termKind === TERM_SINGLE) {
    const v = statValue(facts, leg.statKeyA);
    if (v === null) return "pending";
    value = v;
  } else {
    const a = statValue(facts, leg.statKeyA);
    const b = statValue(facts, leg.statKeyB);
    if (a === null || b === null) return "pending";
    value = leg.op === OP_ADD ? a + b : leg.op === OP_SUBTRACT ? a - b : NaN;
    if (Number.isNaN(value)) return "miss";
  }
  if (leg.lineX2 === NO_LINE) {
    const hit = leg.comparison === CMP_GT ? value > leg.threshold
      : leg.comparison === CMP_LT ? value < leg.threshold
      : leg.comparison === CMP_EQ ? value === leg.threshold : false;
    return hit ? "hit" : "miss";
  }
  const total2 = value * 2;
  if (leg.lineX2 % 2 === 0 && total2 === leg.lineX2) return "void";
  const hit = leg.comparison === CMP_GT ? total2 > leg.lineX2
    : leg.comparison === CMP_LT ? total2 < leg.lineX2 : false;
  return hit ? "hit" : "miss";
}

export function coefficientFixed(oddsMilli: number[]): number | null {
  if (oddsMilli.length > MAX_LEGS) return null;
  let product = 1n;
  let denom = 1n;
  for (const o of oddsMilli) {
    if (o < MIN_ODDS_MILLI || o > MAX_ODDS_MILLI) return null;
    product *= BigInt(o);
    denom *= ODDS_SCALE;
  }
  if (product > (1n << 128n) - 1n) return null;
  return Number((product * FIXED_SCALE + denom / 2n) / denom);
}

export function scoreSlip(legs: LegCommit[], factsByLeg: ScoreStat[][]): SlipScore {
  let settled = true, allHit = true, voidCount = 0;
  const effective: number[] = [];
  legs.forEach((leg, i) => {
    switch (evalLeg(leg, factsByLeg[i] ?? [])) {
      case "pending": settled = false; break;
      case "void": voidCount += 1; break;
      case "hit": effective.push(leg.oddsMilli); break;
      case "miss": effective.push(leg.oddsMilli); allHit = false; break;
    }
  });
  const settledAllHit = settled && allHit;
  const scoreFixed = settledAllHit ? (coefficientFixed(effective) ?? 0) : 0;
  return { settled, allHit: settledAllHit, voidCount, scoreFixed };
}

export function rankRound(entrants: RankedEntrant[]): RankedEntrant[] {
  return [...entrants].sort((a, b) =>
    Number(b.allHit) - Number(a.allHit) ||
    b.scoreFixed - a.scoreFixed ||
    (a.enteredAt < b.enteredAt ? -1 : a.enteredAt > b.enteredAt ? 1 : 0) ||
    a.wallet.compare(b.wallet));
}

/** Replay: recompute per-entrant S from the committed artifact, then rank. */
export function resolveConditionsArtifact(a: ConditionsArtifact): RankedEntrant[] {
  const ranked = a.entrants.map((e) => {
    const factsByLeg = e.fixtureIndex.map((fi) => a.fixtures[fi]?.stats ?? []);
    const s = scoreSlip(e.legs, factsByLeg);
    return {
      wallet: e.wallet, enteredAt: e.enteredAt, scoreFixed: s.scoreFixed,
      allHit: s.allHit, voidCount: s.voidCount, settled: s.settled,
    };
  });
  return rankRound(ranked);
}
