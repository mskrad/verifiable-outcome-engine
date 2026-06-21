// Regression negative (B4c-FIX): the composite-l forgery the independent audit used to break
// the pre-fix in-circuit Pocklington. Builds a fraudulent certificate for the COMPOSITE
// l = 2^64+1 (= 274177 * 67280421310721, a base-2 Fermat pseudoprime) that claims a single
// "prime" factor q[0] = l-1 = 2^64 with e=1, ediv=1 — so the gcd check degenerates to
// gcd(2^1-1, l) = 1. The PRE-FIX circuit ACCEPTED this. The FIXED PockVerify must REJECT it
// (q[0]=2^64 fails the q < 2^16 range-check; a genuine cert would need q=2 with e=64).
//
// Usage: node forge_composite.js  -> build/pv_forge.json ; then run it through pock_verify.wasm:
//   node build/pock_verify_js/generate_witness.js build/pock_verify_js/pock_verify.wasm \
//        build/pv_forge.json build/pv_forge.wtns   # MUST throw "Assert Failed"
const fs = require("fs");
const M = (1n << 64n) - 1n;
const l = (1n << 64n) + 1n;
const PRIMES = [2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97,101,103,107,109,113,127,131,137,139,149,151,157,163,167,173,179,181,191,193,197,199,211,223,227,229,233,239,241,251];
const lo2 = (x) => [(x & M).toString(), ((x >> 64n) & M).toString()];
const q = [], e = [], ediv = [], sinv = [], quo = [];
for (let i = 0; i < 8; i++) {
  if (i === 0) { q.push((1n << 64n).toString()); e.push("1"); ediv.push("1"); sinv.push(["1", "0"]); }
  else { q.push("2"); e.push("0"); ediv.push("0"); sinv.push(["0", "0"]); }
  const qi = BigInt(q[i]);
  quo.push(PRIMES.map((pp) => (qi / BigInt(pp)).toString()));
}
fs.mkdirSync("build", { recursive: true });
fs.writeFileSync("build/pv_forge.json", JSON.stringify({ l2: lo2(l), a: "2", F2: lo2(1n << 64n), R2: lo2(1n), q, e, ediv, sinv, quo }));
console.log("wrote build/pv_forge.json (composite l=2^64+1 forgery) — fixed circuit must reject it");
