// Unicorn-G off-chain prover (keeper) core — B5.
// Given the on-chain-derived entropy u (and the baked RSA modulus N, delay T), produces the
// full circom witness for wesolowski_sound_A: runs the VDF y=u^(2^T) mod N, the Wesolowski
// proof pi, grinds a Pocklington-certifiable Fiat-Shamir prime l, and assembles the cert
// witness (q,e,ediv,sinv,quo). This is the deterministic crypto a permissionless prover runs;
// the proof itself is then produced by rapidsnark over circuit_prod.zkey (env-dependent), and
// the seal tx carries (y, proof). Witness logic is identical to the box fixture (box-validated).
//
// CLI:
//   node keeper.js test                 # self-test on a fresh test modulus + random u
//   node keeper.js witness <u-hex> <out>   # real: witness for a given u (N from build/prod_n_limbs.json)
const fs = require("fs");
const crypto = require("crypto");

const T = 1000;                    // delay (squarings); circuit is independent of its value
const TWO_T = 1n << BigInt(T);
const M = (1n << 64n) - 1n;
const BOUND = 1 << 16;
const PRIMES = [2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97,101,103,107,109,113,127,131,137,139,149,151,157,163,167,173,179,181,191,193,197,199,211,223,227,229,233,239,241,251];

const sieve = new Uint8Array(BOUND + 1).fill(1); sieve[0] = sieve[1] = 0;
for (let i = 2; i * i <= BOUND; i++) if (sieve[i]) for (let j = i * i; j <= BOUND; j += i) sieve[j] = 0;
const smallPrimes = []; for (let i = 2; i <= BOUND; i++) if (sieve[i]) smallPrimes.push(BigInt(i));

const modpow = (b, e, m) => { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; };
function isPrime(n, k = 32) {
  if (n < 2n) return false;
  for (const p of [2n,3n,5n,7n,11n,13n,17n,19n,23n,29n,31n,37n]) { if (n % p === 0n) return n === p; }
  let d = n - 1n, s = 0n; while (d % 2n === 0n) { d /= 2n; s++; }
  for (let i = 0; i < k; i++) { const a = 2n + (BigInt("0x" + crypto.randomBytes(16).toString("hex")) % (n - 4n));
    let x = modpow(a, d, n); if (x === 1n || x === n - 1n) continue; let ok = false;
    for (let j = 0n; j < s - 1n; j++) { x = x * x % n; if (x === n - 1n) { ok = true; break; } } if (!ok) return false; }
  return true;
}
const be = (x, n) => { const b = Buffer.alloc(n); let v = x; for (let i = n - 1; i >= 0; i--) { b[i] = Number(v & 0xffn); v >>= 8n; } return b; };
const gcd = (a, b) => { while (b) { [a, b] = [b, a % b]; } return a; };
const modinv = (x, m) => { let [or_, r] = [((x % m) + m) % m, m], [os, s] = [1n, 0n]; while (r !== 0n) { const q = or_ / r; [or_, r] = [r, or_ - q * r]; [os, s] = [s, os - q * s]; } return ((os % m) + m) % m; };
const lo2 = (x) => [(x & M).toString(), ((x >> 64n) & M).toString()];
const limbs32 = (x) => { const o = []; let v = x; for (let i = 0; i < 32; i++) { o.push((v & M).toString()); v >>= 64n; } return o; };
const limbBytes = (x) => { const ls = []; let v = x; for (let i = 0; i < 32; i++) { ls.push(be(v & M, 8)); v >>= 64n; } return Buffer.concat(ls); };
const deriveL = (commit, nonce) => { const d = crypto.createHash("sha256").update(Buffer.concat([be(commit, 32), be(BigInt(nonce), 8)])).digest(); let dn = 0n; for (const x of d) dn = (dn << 8n) | BigInt(x); return (dn & ((1n << 128n) - 1n)) | (1n << 127n) | 1n; };
function smoothPart(lm1) { let f = 1n; const dist = []; let t = lm1; for (const p of smallPrimes) { if (p * p > t) break; if (t % p === 0n) { dist.push(p); while (t % p === 0n) { f *= p; t /= p; } } } if (t > 1n && t <= BigInt(BOUND)) { dist.push(t); f *= t; } return { f, dist }; }

// The keeper core: u (on-chain entropy) + N (baked modulus) + T -> full witness for the circuit.
function genWitness(u, N) {
  u = (u % N) | 1n;
  // 1. VDF: y = u^(2^T) mod N  (T squarings)
  let y = u % N; for (let i = 0; i < T; i++) y = y * y % N;
  // 2. commit = low253( SHA256(u-limbs || y-limbs) )
  const dC = crypto.createHash("sha256").update(Buffer.concat([limbBytes(u), limbBytes(y)])).digest();
  let dCn = 0n; for (const b of dC) dCn = (dCn << 8n) | BigInt(b);
  const commit = dCn & ((1n << 253n) - 1n);
  // 3. grind nonce -> l prime AND Pocklington-certifiable
  let nonce = 0n, found = null;
  for (; nonce < 5000000n; nonce++) {
    const l = deriveL(commit, nonce);
    if (!isPrime(l)) continue;
    const lm1 = l - 1n; const { f, dist } = smoothPart(lm1);
    if (!(f * f > l) || dist.length > 8) continue;
    let a = 0n;
    for (const c of [2n,3n,5n,7n,11n,13n,17n,19n,23n]) { if (modpow(c, lm1, l) !== 1n) continue;
      let ok = true; for (const q of dist) { const g = modpow(c, lm1 / q, l); if (gcd((g + l - 1n) % l, l) !== 1n) { ok = false; break; } } if (ok) { a = c; break; } }
    if (a !== 0n) { found = { l, a, dist }; break; }
  }
  if (!found) throw new Error("no certifiable l within budget");
  const { l, a } = found, lm1 = l - 1n;
  // 4. Wesolowski: r = 2^T mod l ; Q = (2^T - r)/l ; pi = u^Q mod N
  const r = modpow(2n, BigInt(T), l);
  const pi = modpow(u, (TWO_T - r) / l, N);
  if ((modpow(pi, l, N) * modpow(u, r, N)) % N !== y % N) throw new Error("VDF check failed");
  // 5. Pocklington cert witness (capped e, quotients)
  const q = [], e = [], ediv = [], sinv = [], quo = []; let Fcap = 1n;
  for (let i = 0; i < 8; i++) {
    if (i < found.dist.length) { const p = found.dist[i]; let ee = 0n, t = lm1; while (t % p === 0n) { ee++; t /= p; } if (ee > 64n) ee = 64n;
      q.push(p.toString()); e.push(ee.toString()); ediv.push((lm1 / p).toString()); Fcap *= p ** ee;
      const g = modpow(a, lm1 / p, l); sinv.push(lo2(modinv((g - 1n + l) % l, l))); }
    else { q.push("2"); e.push("0"); ediv.push("0"); sinv.push(["0", "0"]); }
    const qi = BigInt(q[i]); quo.push(PRIMES.map((pp) => (qi / BigInt(pp)).toString()));
  }
  if (!(Fcap * Fcap > l)) throw new Error("capped F <= sqrt(l)");
  return { commit: commit.toString(), nonce: nonce.toString(), u: limbs32(u), y: limbs32(y), pi: limbs32(pi),
    pa: a.toString(), F2: lo2(Fcap), R2: lo2(lm1 / Fcap), q, e, ediv, sinv, quo,
    _meta: { factors: found.dist.length, grind_nonces: Number(nonce), F_bits: Fcap.toString(2).length } };
}

function readBakedN() { const limbs = require("./build/prod_n_limbs.json").N.map(BigInt); let n = 0n; for (let i = 31; i >= 0; i--) n = (n << 64n) | limbs[i]; return n; }

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === "test") {
    // self-test: fresh test modulus (we know factors — fine; real N is the box's canonical RSA-2048)
    const rp = (b) => { while (true) { let x = BigInt("0x" + crypto.randomBytes(b / 8).toString("hex")) | (1n << BigInt(b - 1)) | 1n; if (isPrime(x)) return x; } };
    const N = rp(1024) * rp(1024);
    const u = BigInt("0x" + crypto.randomBytes(256).toString("hex"));
    const t0 = Date.now();
    const w = genWitness(u, N);
    console.log("keeper.genWitness OK in", ((Date.now() - t0) / 1000).toFixed(1), "s");
    console.log("  grind:", w._meta.grind_nonces, "nonces |", w._meta.factors, "factors | F", w._meta.F_bits, "bits");
    console.log("  self-checks passed: VDF pi^l*u^r==y, F>sqrt(l), cert assembled. Witness ready for rapidsnark.");
  } else if (cmd === "witness") {
    const u = BigInt(process.argv[3].startsWith("0x") ? process.argv[3] : "0x" + process.argv[3]);
    const out = process.argv[4] || "build/keeper_witness.json";
    const w = genWitness(u, readBakedN());
    const { _meta, ...clean } = w;  // strip debug metadata — circom rejects unknown input signals
    fs.mkdirSync("build", { recursive: true }); fs.writeFileSync(out, JSON.stringify(clean, null, 2));
    console.log("wrote", out, "(grind", _meta.grind_nonces, "nonces). Next: rapidsnark prover circuit_prod.zkey", out);
  } else {
    console.log("usage: node keeper.js test | node keeper.js witness <u-hex> [out.json]");
  }
}
module.exports = { genWitness, readBakedN };
