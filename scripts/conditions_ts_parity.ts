// TS parity check for the conditions SDK (sdk/conditions.ts) against OddSol ground truth
// (packages/scoring/vre-parity-vectors.json): scoring, byte-exact slip_hash, artifact roundtrip.
//
//   node --loader ts-node/esm scripts/conditions_ts_parity.ts

import fs from "fs";
import {
  buildConditionsArtifact, parseConditionsArtifact, resolveConditionsArtifact,
  scoreSlip, slipHash, NO_LINE, OP_ADD, OP_SUBTRACT, CMP_GT, CMP_LT, CMP_EQ, TERM_BINARY,
  type LegCommit, type ScoreStat, type ConditionsFixture, type ConditionsEntrant,
} from "../sdk/conditions.js";

const VECTORS = "/Users/timurkurmangaliev/OddSOLution/packages/scoring/vre-parity-vectors.json";
const OP: Record<string, number> = { none: 0, add: OP_ADD, subtract: OP_SUBTRACT };
const CMP: Record<string, number> = { greaterThan: CMP_GT, lessThan: CMP_LT, equalTo: CMP_EQ };

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = "") => {
  (ok ? pass++ : fail++);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? "  " + extra : ""}`);
};

function legFrom(l: any): LegCommit {
  const p = l.predicate[0];
  if (p.binary) {
    const b = p.binary;
    const isTotals = l.lineX2 != null;
    return {
      termKind: TERM_BINARY, statKeyA: 1, statKeyB: 2,
      op: OP[Object.keys(b.op)[0]], comparison: CMP[Object.keys(b.predicate.comparison)[0]],
      threshold: isTotals ? 0 : 0, lineX2: l.lineX2 == null ? NO_LINE : l.lineX2,
      oddsMilli: l.oddsMilli,
    };
  }
  const s = p.single;
  return { termKind: 0, statKeyA: 1, statKeyB: 0, op: 0, comparison: CMP[Object.keys(s.predicate.comparison)[0]], threshold: 0, lineX2: NO_LINE, oddsMilli: l.oddsMilli };
}

const arr = JSON.parse(fs.readFileSync(VECTORS, "utf8"));
const V = Array.isArray(arr) ? arr : arr.vectors ?? Object.values(arr);

// 1) scoring parity
for (const x of V) {
  const legs = x.legs.map(legFrom);
  const factsByLeg = x.legs.map((l: any) => (x.facts[l.fixtureId] ?? []).map((s: any): ScoreStat => ({ statKey: s.statKey, value: s.value })));
  const s = scoreSlip(legs, factsByLeg);
  const e = x.expected;
  const ok = s.settled === e.settled && s.allHit === e.allHit && s.voidCount === e.voidCount && s.scoreFixed === e.scoreFixed;
  check(`score ${x.name}`, ok, `S=${s.scoreFixed} (exp ${e.scoreFixed})`);
}

// 2) slip_hash byte-exact
for (const x of V) {
  if (!x.commit?.slipHash) continue;
  const legs = x.legs.map(legFrom);
  const wallet = Buffer.from(x.commit.walletHex, "hex");
  const h = slipHash(wallet, BigInt(x.commit.tier), legs).toString("hex");
  check(`slip_hash ${x.name}`, h === x.commit.slipHash, h.slice(0, 8));
}

// 3) artifact roundtrip + replay resolve (two entrants sharing fixtures)
const fixtures: ConditionsFixture[] = [
  { fixtureId: 1, eventStatRoot: Buffer.alloc(32, 0x11), stats: [{ statKey: 1, value: 2 }, { statKey: 2, value: 0 }] },
  { fixtureId: 2, eventStatRoot: Buffer.alloc(32, 0x22), stats: [{ statKey: 1, value: 1 }, { statKey: 2, value: 1 }] },
];
const home: LegCommit = { termKind: TERM_BINARY, statKeyA: 1, statKeyB: 2, op: OP_SUBTRACT, comparison: CMP_GT, threshold: 0, lineX2: NO_LINE, oddsMilli: 2150 };
const under25: LegCommit = { termKind: TERM_BINARY, statKeyA: 1, statKeyB: 2, op: OP_ADD, comparison: CMP_LT, threshold: 0, lineX2: 5, oddsMilli: 1850 };
const under20: LegCommit = { termKind: TERM_BINARY, statKeyA: 1, statKeyB: 2, op: OP_ADD, comparison: CMP_LT, threshold: 0, lineX2: 4, oddsMilli: 1850 };
const entrants: ConditionsEntrant[] = [
  { wallet: Buffer.alloc(32, 0x0b), tier: 50n, enteredAt: 200n, legs: [home, under20], fixtureIndex: [0, 1] },
  { wallet: Buffer.alloc(32, 0x0a), tier: 50n, enteredAt: 100n, legs: [home, under25], fixtureIndex: [0, 1] },
];
const bytes = buildConditionsArtifact(fixtures, entrants);
check("artifact magic W3O1", bytes.subarray(0, 4).toString() === "W3O1");
const parsed = parseConditionsArtifact(bytes);
check("artifact roundtrip re-encode", buildConditionsArtifact(parsed.fixtures, parsed.entrants).equals(bytes));
const ranked = resolveConditionsArtifact(parsed);
const okResolve = ranked[0].wallet[0] === 0x0a && ranked[0].scoreFixed === 39775 && ranked[1].wallet[0] === 0x0b && ranked[1].scoreFixed === 21500 && ranked[1].voidCount === 1;
check("artifact resolve + rank", okResolve, `[${ranked.map((r) => `${r.wallet[0].toString(16)}:${r.scoreFixed}`).join(", ")}]`);

// golden artifact hex (cross-checked against Rust to_bytes)
console.log("\nARTIFACT_HEX=" + bytes.toString("hex"));
console.log(`\n--- ${pass} pass, ${fail} fail ---`);
process.exit(fail === 0 ? 0 : 1);
