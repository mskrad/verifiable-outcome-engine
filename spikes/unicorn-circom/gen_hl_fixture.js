// Cross-check fixture for hl_test: compute l = forcedBits(SHA256(commit_be256||nonce_be64))
// in plain JS with the SAME serialization as hash_to_l.circom, so we can compare the
// circuit's l2 output to this reference.
const fs = require("fs");
const crypto = require("crypto");

const commit = 0x123456789abcdef0fedcba9876543210aabbccddeeff00112233445566778899n; // < 2^254
const nonce = 0x0102030405060708n;

function be(x, nbytes) {
  const b = Buffer.alloc(nbytes);
  let v = x;
  for (let i = nbytes - 1; i >= 0; i--) { b[i] = Number(v & 0xffn); v >>= 8n; }
  return b;
}

const preimage = Buffer.concat([be(commit, 32), be(nonce, 8)]); // 40 bytes
const digest = crypto.createHash("sha256").update(preimage).digest();
let digestNum = 0n;
for (const byte of digest) digestNum = (digestNum << 8n) | BigInt(byte);

const lLow = digestNum & ((1n << 128n) - 1n);
const l = lLow | (1n << 127n) | 1n;
const mask64 = (1n << 64n) - 1n;
const l0 = l & mask64;
const l1 = (l >> 64n) & mask64;

fs.mkdirSync("build", { recursive: true });
fs.writeFileSync("build/hl_input.json", JSON.stringify({ commit: commit.toString(), nonce: nonce.toString() }, null, 2));
fs.writeFileSync("build/hl_expected.json", JSON.stringify({ l0: l0.toString(), l1: l1.toString() }, null, 2));
console.log("expected l0 =", l0.toString());
console.log("expected l1 =", l1.toString());
console.log("l bits =", l.toString(2).length);
