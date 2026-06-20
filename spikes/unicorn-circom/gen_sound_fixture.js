// Fixture for wesolowski_sound (A'): produces a consistent (commit, nonce, u, y, pi, N)
// where commit=SHA256(u||y) low254, l=forcedBits(SHA256(commit||nonce)) is prime,
// r=2^T mod l, and pi^l*u^r == y (mod N). Serialization matches the circuit exactly,
// so a successful witness-gen cross-checks commit-binding + l-derivation + Wesolowski.
//
// Note: pi^l*u^r = u^(Q*l + r) = u^(2^T) = y holds for ANY modulus N (exponent identity),
// so N can be any 2048-bit odd number for this fixture (real RSA modulus is a B2 ceremony).
const fs = require("fs");
const crypto = require("crypto");

const T = 1000;
const TWO_T = 1n << BigInt(T);
const mask64 = (1n << 64n) - 1n;

function modpow(b, e, m) { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
function isPrime(n, k = 40) {
  if (n < 2n) return false;
  for (const p of [2n,3n,5n,7n,11n,13n,17n,19n,23n,29n,31n,37n]) { if (n % p === 0n) return n === p; }
  let d = n - 1n, s = 0n; while (d % 2n === 0n) { d /= 2n; s++; }
  for (let i = 0; i < k; i++) {
    const a = 2n + (BigInt(crypto.randomBytes(8).readBigUInt64BE()) % (n - 4n));
    let x = modpow(a, d, n); if (x === 1n || x === n - 1n) continue;
    let ok = false; for (let j = 0n; j < s - 1n; j++) { x = x * x % n; if (x === n - 1n) { ok = true; break; } }
    if (!ok) return false;
  }
  return true;
}
function randBig(bits) { const x = BigInt("0x" + crypto.randomBytes(bits / 8).toString("hex")); return x | (1n << BigInt(bits - 1)); }
function limbs32(x) { const out = []; let v = x; for (let i = 0; i < 32; i++) { out.push((v & mask64).toString()); v >>= 64n; } return out; }
function be(x, nbytes) { const b = Buffer.alloc(nbytes); let v = x; for (let i = nbytes - 1; i >= 0; i--) { b[i] = Number(v & 0xffn); v >>= 8n; } return b; }

// N = random 2048-bit odd; u random < N.
const N = randBig(2048) | 1n;
const u = (randBig(2048) % N) | 1n;

// y = u^(2^T) mod N via T squarings (matches the VDF definition).
let y = u % N; for (let i = 0; i < T; i++) y = y * y % N;

// commit = low254( SHA256( u-limbs(LE order, each 8B BE) || y-limbs ) )
function limbBytes(x) { const ls = []; let v = x; for (let i = 0; i < 32; i++) { ls.push(be(v & mask64, 8)); v >>= 64n; } return Buffer.concat(ls); }
const preCommit = Buffer.concat([limbBytes(u), limbBytes(y)]); // 512 bytes = 4096 bits
const dC = crypto.createHash("sha256").update(preCommit).digest();
let dCnum = 0n; for (const b of dC) dCnum = (dCnum << 8n) | BigInt(b);
const commit = dCnum & ((1n << 253n) - 1n);  // < 2^253 < bn254 scalar field r

// grind nonce until l = forcedBits(SHA256(commit_be256 || nonce_be64)) is prime.
let nonce = 0n, l = 0n;
while (true) {
  const pre = Buffer.concat([be(commit, 32), be(nonce, 8)]);
  const d = crypto.createHash("sha256").update(pre).digest();
  let dnum = 0n; for (const b of d) dnum = (dnum << 8n) | BigInt(b);
  l = (dnum & ((1n << 128n) - 1n)) | (1n << 127n) | 1n;
  if (isPrime(l)) break;
  nonce++;
}

const r = modpow(2n, BigInt(T), l);          // 2^T mod l
const Q = (TWO_T - r) / l;                    // exact integer
const pi = modpow(u, Q, N);

// sanity: pi^l * u^r == y (mod N)
const lhs = (modpow(pi, l, N) * modpow(u, r, N)) % N;
if (lhs !== y % N) { console.error("FIXTURE BROKEN: pi^l*u^r != y"); process.exit(1); }

const input = { commit: commit.toString(), nonce: nonce.toString(), u: limbs32(u), y: limbs32(y), pi: limbs32(pi), N: limbs32(N) };
fs.mkdirSync("build", { recursive: true });
fs.writeFileSync("build/ws_input.json", JSON.stringify(input, null, 2));
console.log("OK: nonce =", nonce.toString(), " l prime (128b) ; pi^l*u^r==y mod N verified");
console.log("wrote build/ws_input.json");
