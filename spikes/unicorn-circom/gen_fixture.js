// Generate a valid Wesolowski RSA-VDF witness for wesolowski_verify.circom.
//
//   y  = u^(2^T) mod N                 (VDF output)
//   l  = fixed 128-bit prime           (Fiat-Shamir, simplified to a constant here)
//   r  = 2^T mod l
//   q  = (2^T - r) / l
//   pi = u^q mod N                     (Wesolowski proof element)
//   identity:  pi^l * u^r == u^(q*l + r) == u^(2^T) == y  (mod N)
//
// Writes build/wv_input.json with 2048-bit values as 32 little-endian 64-bit limbs
// (a[0] = least-significant, matching the 0xPARC bigint convention), l and r as
// decimal scalars. Self-checks the equation before writing.
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const NLIMBS = 32;
const LIMB = 64n;
const MASK = (1n << LIMB) - 1n;
const T = 1000;                       // delay (does NOT affect circuit size)

// EXPBITS chooses the modexp exponent width. Default 128 = full circuit (l = 2^127-1,
// a real 127-bit Mersenne prime). Smaller EXPBITS (passed as argv[2]) builds reduced
// fixtures for the prover-slope anchors and the logic/tamper validation; there l =
// 2^EXPBITS-1 (the Wesolowski algebraic identity holds for any l>=1 — primality of l
// is irrelevant to the witness and to the constraint count, which never checks it).
const EXPBITS = process.argv[2] ? parseInt(process.argv[2], 10) : 128;
const L = EXPBITS === 128 ? (1n << 127n) - 1n : (1n << BigInt(EXPBITS)) - 1n;
const SUFFIX = EXPBITS === 128 ? "" : `_n${EXPBITS}`;

function modpow(base, exp, mod) {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return result;
}

function randBig(bytes) {
  return BigInt("0x" + crypto.randomBytes(bytes).toString("hex"));
}

function toLimbs(x) {
  const out = [];
  for (let i = 0; i < NLIMBS; i++) {
    out.push(((x >> (LIMB * BigInt(i))) & MASK).toString());
  }
  return out;
}

// 2048-bit odd modulus N (top + bottom bits set). The Wesolowski identity holds for
// any modulus, so a random 2048-bit N is a faithful fixture for the spike.
let N = randBig(256);
N |= 1n << 2047n;
N |= 1n;

let u = randBig(256) % N;

const e = 1n << BigInt(T);            // 2^T
const y = modpow(u, e, N);
const r = e % L;
const q = (e - r) / L;
const pi = modpow(u, q, N);

// Self-check the verification equation before emitting the fixture.
const lhs = (modpow(pi, L, N) * modpow(u, r, N)) % N;
if (lhs !== y) {
  console.error("FIXTURE SELF-CHECK FAILED: pi^l * u^r != y mod N");
  process.exit(1);
}
console.log("fixture self-check OK: pi^l * u^r == y (mod N)");

const input = {
  u: toLimbs(u),
  y: toLimbs(y),
  pi: toLimbs(pi),
  N: toLimbs(N),
  l: L.toString(),
  r: r.toString(),
};

const outDir = path.join(__dirname, "build");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `wv_input${SUFFIX}.json`);
fs.writeFileSync(outPath, JSON.stringify(input, null, 2));
console.log(`wrote ${outPath} (EXPBITS=${EXPBITS})`);

// Also emit a tampered copy (flip one limb of y) for the negative sanity check.
const bad = JSON.parse(JSON.stringify(input));
bad.y[0] = ((BigInt(bad.y[0]) ^ 1n) & MASK).toString();
const badPath = path.join(outDir, `wv_input${SUFFIX}_bad.json`);
fs.writeFileSync(badPath, JSON.stringify(bad, null, 2));
console.log(`wrote ${badPath} (tampered y[0])`);
