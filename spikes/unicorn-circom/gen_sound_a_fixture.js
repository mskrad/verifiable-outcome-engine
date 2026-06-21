// Fixture for wesolowski_sound_A (option A): one l that is BOTH VDF-consistent and
// Pocklington-certifiable. Grinds nonce until l=forcedBits(SHA256(commit||nonce)) is prime
// AND l-1 has a smooth Pocklington cert; then builds the VDF witness (r,pi) and the cert
// witness (a,F2,R2,q,e,ediv,sinv) for that same l. Uses the baked N (run bake_n.js first).
const fs = require("fs");
const crypto = require("crypto");

const T = 1000;
const TWO_T = 1n << BigInt(T);
const mask64 = (1n << 64n) - 1n;
const BOUND = 1 << 16;

const sieve = new Uint8Array(BOUND + 1).fill(1); sieve[0] = sieve[1] = 0;
for (let i = 2; i * i <= BOUND; i++) if (sieve[i]) for (let j = i * i; j <= BOUND; j += i) sieve[j] = 0;
const smallPrimes = []; for (let i = 2; i <= BOUND; i++) if (sieve[i]) smallPrimes.push(BigInt(i));

function modpow(b, e, m) { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
function isPrime(n, k = 32) {
  if (n < 2n) return false;
  for (const p of [2n,3n,5n,7n,11n,13n,17n,19n,23n,29n,31n,37n]) { if (n % p === 0n) return n === p; }
  let d = n - 1n, s = 0n; while (d % 2n === 0n) { d /= 2n; s++; }
  for (let i = 0; i < k; i++) { const a = 2n + (BigInt("0x" + crypto.randomBytes(16).toString("hex")) % (n - 4n));
    let x = modpow(a, d, n); if (x === 1n || x === n - 1n) continue; let ok = false;
    for (let j = 0n; j < s - 1n; j++) { x = x * x % n; if (x === n - 1n) { ok = true; break; } } if (!ok) return false; }
  return true;
}
function be(x, n) { const b = Buffer.alloc(n); let v = x; for (let i = n - 1; i >= 0; i--) { b[i] = Number(v & 0xffn); v >>= 8n; } return b; }
function gcd(a, b) { while (b) { [a, b] = [b, a % b]; } return a; }
function modinv(x, m) { let [or_, r] = [((x % m) + m) % m, m], [os, s] = [1n, 0n]; while (r !== 0n) { const qq = or_ / r; [or_, r] = [r, or_ - qq * r]; [os, s] = [s, os - qq * s]; } return ((os % m) + m) % m; }
function lo2(x) { return [(x & mask64).toString(), ((x >> 64n) & mask64).toString()]; }
function limbs32(x) { const o = []; let v = x; for (let i = 0; i < 32; i++) { o.push((v & mask64).toString()); v >>= 64n; } return o; }
function limbBytes(x) { const ls = []; let v = x; for (let i = 0; i < 32; i++) { ls.push(be(v & mask64, 8)); v >>= 64n; } return Buffer.concat(ls); }
function deriveL(commit, nonce) {
  const d = crypto.createHash("sha256").update(Buffer.concat([be(commit, 32), be(BigInt(nonce), 8)])).digest();
  let dn = 0n; for (const x of d) dn = (dn << 8n) | BigInt(x);
  return (dn & ((1n << 128n) - 1n)) | (1n << 127n) | 1n;
}
function smoothPart(lm1) { let f = 1n; const dist = []; let t = lm1;
  for (const p of smallPrimes) { if (p * p > t) break; if (t % p === 0n) { dist.push(p); while (t % p === 0n) { f *= p; t /= p; } } }
  if (t > 1n && t <= BigInt(BOUND)) { dist.push(t); f *= t; } return { f, dist }; }

// baked N
const N = (() => { const limbs = require("./build/prod_n_limbs.json").N.map(BigInt); let n = 0n; for (let i = 31; i >= 0; i--) n = (n << 64n) | limbs[i]; return n; })();
const u = (BigInt("0x" + crypto.randomBytes(256).toString("hex")) % N) | 1n;
let y = u % N; for (let i = 0; i < T; i++) y = y * y % N;
const dC = crypto.createHash("sha256").update(Buffer.concat([limbBytes(u), limbBytes(y)])).digest();
let dCn = 0n; for (const b of dC) dCn = (dCn << 8n) | BigInt(b);
const commit = dCn & ((1n << 253n) - 1n);

// grind for a certifiable l
let nonce = 0n, found = null;
for (; nonce < 5000000n; nonce++) {
  const l = deriveL(commit, nonce);
  if (!isPrime(l)) continue;
  const lm1 = l - 1n; const { f, dist } = smoothPart(lm1);
  if (!(f * f > l) || dist.length > 8) continue;
  let a = 0n;
  for (const cand of [2n,3n,5n,7n,11n,13n,17n,19n,23n]) { if (modpow(cand, lm1, l) !== 1n) continue;
    let ok = true; for (const q of dist) { const g = modpow(cand, lm1 / q, l); if (gcd((g + l - 1n) % l, l) !== 1n) { ok = false; break; } } if (ok) { a = cand; break; } }
  if (a !== 0n) { found = { l, f, r: lm1 / f, a, dist }; break; }
}
if (!found) { console.error("no certifiable l"); process.exit(1); }
const { l, a } = found;
const lm1 = l - 1n;
const r = modpow(2n, BigInt(T), l);
const Q = (TWO_T - r) / l;
const pi = modpow(u, Q, N);
if ((modpow(pi, l, N) * modpow(u, r, N)) % N !== y % N) { console.error("VDF check failed"); process.exit(1); }

const PRIMES = [2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97,101,103,107,109,113,127,131,137,139,149,151,157,163,167,173,179,181,191,193,197,199,211,223,227,229,233,239,241,251];
const q = [], e = [], ediv = [], sinv = [], quo = [];
let Fcap = 1n;
for (let i = 0; i < 8; i++) {
  if (i < found.dist.length) { const p = found.dist[i]; let ee = 0n, t = lm1; while (t % p === 0n) { ee++; t /= p; }
    if (ee > 64n) ee = 64n;
    q.push(p.toString()); e.push(ee.toString()); ediv.push((lm1 / p).toString()); Fcap *= p ** ee;
    const g = modpow(a, lm1 / p, l); sinv.push(lo2(modinv((g - 1n + l) % l, l))); }
  else { q.push("2"); e.push("0"); ediv.push("0"); sinv.push(["0", "0"]); }
  const qi = BigInt(q[i]); quo.push(PRIMES.map((pp) => (qi / BigInt(pp)).toString()));
}
const Rcap = lm1 / Fcap;
if (!(Fcap * Fcap > l)) { console.error("capped F <= sqrt(l)"); process.exit(1); }
const input = { commit: commit.toString(), nonce: nonce.toString(), u: limbs32(u), y: limbs32(y), pi: limbs32(pi),
  pa: a.toString(), F2: lo2(Fcap), R2: lo2(Rcap), q, e, ediv, sinv, quo };
fs.writeFileSync("build/wa_input.json", JSON.stringify(input, null, 2));
console.log(`OK: nonce=${nonce}, l prime+certifiable (${found.dist.length} factors), pi^l*u^r==y. wrote build/wa_input.json`);
