// Fixture for sme_fermat128: a known 128-bit prime l, base a, exponent l-1.
// Emits build/sme_input.json with a[2], l[2] (64-bit little-endian limbs) and lm1.
const fs = require("fs");

// 128-bit prime: candidate with top + bottom bits forced, search upward (hash-to-prime style).
const a = 5n;

function isProbablePrime(n, k = 40) {
  if (n < 2n) return false;
  for (const p of [2n,3n,5n,7n,11n,13n,17n,19n,23n,29n,31n,37n]) {
    if (n % p === 0n) return n === p;
  }
  let d = n - 1n, r = 0n;
  while (d % 2n === 0n) { d /= 2n; r++; }
  const modpow = (b, e, m) => { let res = 1n; b %= m; while (e > 0n) { if (e & 1n) res = res * b % m; b = b * b % m; e >>= 1n; } return res; };
  for (let i = 0; i < k; i++) {
    const aa = 2n + BigInt(Math.floor(Math.random() * 1e9)) % (n - 4n);
    let x = modpow(aa, d, n);
    if (x === 1n || x === n - 1n) continue;
    let ok = false;
    for (let j = 0n; j < r - 1n; j++) { x = x * x % n; if (x === n - 1n) { ok = true; break; } }
    if (!ok) return false;
  }
  return true;
}

// candidate: fixed 128-bit base with top bit (127) and bit0 set; search +2 until prime.
let l = (0xdcd2f8e9a1b34c7f1122334455667700n | (1n << 127n) | 1n);
while (!isProbablePrime(l)) l += 2n;
if (l >> 128n !== 0n) { console.error("l exceeded 128 bits"); process.exit(1); }

const modpow = (b, e, m) => { let res = 1n; b %= m; while (e > 0n) { if (e & 1n) res = res * b % m; b = b * b % m; e >>= 1n; } return res; };
const check = modpow(a, l - 1n, l);
if (check !== 1n) { console.error("Fermat failed: a^(l-1) mod l =", check); process.exit(1); }

const limbs2 = (x) => { const m = (1n << 64n) - 1n; return [(x & m).toString(), ((x >> 64n) & m).toString()]; };
const input = { a: limbs2(a), l: limbs2(l), lm1: (l - 1n).toString() };
fs.mkdirSync("build", { recursive: true });
fs.writeFileSync("build/sme_input.json", JSON.stringify(input, null, 2));
console.log("OK: l is prime, a^(l-1) mod l == 1; wrote build/sme_input.json");
console.log("l =", l.toString(), "( bits:", l.toString(2).length, ")");
