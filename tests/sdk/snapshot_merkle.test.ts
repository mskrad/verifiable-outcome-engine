import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import {
  buildMerkleLevels,
  buildMerkleProof,
  buildSnapshotHash,
  buildSnapshotMerkleProofFromFile,
  computeSnapshotMerkleRootFromProof,
  hashSnapshotLeafLine,
  verifySnapshotMerkleProof,
} from "../../sdk/snapshot.ts";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function walletLikeId(seed: number): string {
  const bytes = crypto.createHash("sha256").update(`p-${seed}`).digest();
  let out = "";
  for (let i = 0; i < 44; i += 1) out += BASE58[bytes[i % 32] % BASE58.length];
  return out;
}

function snapshotTree(formula: "weighted_random" | "rank_desc", count: number) {
  const participants = Array.from({ length: count }, (_, i) =>
    formula === "weighted_random"
      ? { id: walletLikeId(i), weight: 1 + (i % 1000) }
      : { id: walletLikeId(i), score: (i * 7919) % 10_000_000 }
  );
  const built = buildSnapshotHash({ formula, participants });
  const lines = built.canonicalSnapshot.split("\n").filter(Boolean).map((line) => `${line}\n`);
  const levels = buildMerkleLevels(lines.map(hashSnapshotLeafLine));
  return { built, lines, levels, root: levels[levels.length - 1][0] };
}

function flipHex(hex: string): string {
  const b = Buffer.from(hex, "hex");
  b[0] ^= 0x01;
  return b.toString("hex");
}

test("every one of 10,000 proofs verifies against the snapshot root", () => {
  const { built, lines, levels, root } = snapshotTree("weighted_random", 10_000);
  assert.equal(lines.length, 10_000);
  assert.equal(root.toString("hex"), built.merkleRoot, "root rebuilt from lines equals buildSnapshotHash");
  for (let i = 0; i < lines.length; i += 1) {
    const proof = buildMerkleProof(levels, i);
    assert.equal(proof.length, 14);
    assert.ok(verifySnapshotMerkleProof({ line: lines[i], proof, merkleRoot: built.merkleRoot }), `proof ${i}`);
  }
});

test("tampered sibling, position, line or root is rejected", () => {
  const { lines, levels, root } = snapshotTree("rank_desc", 10_000);
  for (const i of [0, 1, 4_999, 9_998, 9_999]) {
    const proof = buildMerkleProof(levels, i);
    assert.ok(verifySnapshotMerkleProof({ line: lines[i], proof, merkleRoot: root }));
    for (let depth = 0; depth < proof.length; depth += 1) {
      const badSibling = proof.map((n, d) => (d === depth ? { ...n, sibling: flipHex(n.sibling) } : n));
      assert.equal(verifySnapshotMerkleProof({ line: lines[i], proof: badSibling, merkleRoot: root }), false);
      const badPosition = proof.map((n, d) =>
        d === depth ? { ...n, position: n.position === "left" ? ("right" as const) : ("left" as const) } : n
      );
      if (badPosition[depth].sibling !== hashAt(levels, depth, i)) {
        assert.equal(verifySnapshotMerkleProof({ line: lines[i], proof: badPosition, merkleRoot: root }), false);
      }
    }
    const entry = JSON.parse(lines[i]);
    const otherLine = `${JSON.stringify({ ...entry, score: String(BigInt(entry.score) + 1n) })}\n`;
    assert.equal(verifySnapshotMerkleProof({ line: otherLine, proof, merkleRoot: root }), false);
    assert.equal(verifySnapshotMerkleProof({ line: lines[i], proof: proof.slice(1), merkleRoot: root }), false);
    assert.equal(verifySnapshotMerkleProof({ line: lines[i], proof, merkleRoot: flipHex(root.toString("hex")) }), false);
    assert.equal(verifySnapshotMerkleProof({ line: lines[i], proof: [{ position: "up", sibling: "zz" } as any], merkleRoot: root }), false);
  }
});

// a node whose sibling is itself (odd level tail) hashes the same either way, so swapping sides proves nothing there
function hashAt(levels: Buffer[][], depth: number, leafIndex: number): string {
  const index = Math.floor(leafIndex / 2 ** depth);
  return levels[depth][index].toString("hex");
}

test("odd participant counts duplicate the last node and still verify", () => {
  for (const count of [1, 2, 3, 7, 1_001]) {
    const { lines, levels, root } = snapshotTree("weighted_random", count);
    lines.forEach((line, i) => {
      assert.ok(verifySnapshotMerkleProof({ line, proof: buildMerkleProof(levels, i), merkleRoot: root }), `count ${count} index ${i}`);
    });
  }
});

test("entry with formula builds the same canonical line", () => {
  const { lines, levels, root } = snapshotTree("rank_desc", 50);
  const parsed = JSON.parse(lines[17]);
  const entry = { id: parsed.id, order: parsed.order, weight: 1, score: BigInt(parsed.score) };
  assert.ok(verifySnapshotMerkleProof({ entry, formula: "rank_desc", proof: buildMerkleProof(levels, 17), merkleRoot: root }));
  assert.throws(() => verifySnapshotMerkleProof({ proof: [], merkleRoot: root }), TypeError);
  assert.throws(() => verifySnapshotMerkleProof({ line: lines[0], proof: [], merkleRoot: "00" }), TypeError);
  assert.throws(() => computeSnapshotMerkleRootFromProof("no newline", []), TypeError);
});

test("proofs served from a snapshot file (as the proof endpoint builds them) verify client-side", async () => {
  const { built, lines } = snapshotTree("weighted_random", 2_500);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vre-merkle-"));
  const file = path.join(dir, "canonical_snapshot.jsonl");
  fs.writeFileSync(file, built.canonicalSnapshot);
  try {
    for (const i of [0, 1_234, 2_499]) {
      const id = JSON.parse(lines[i]).id;
      const served = await buildSnapshotMerkleProofFromFile({
        snapshotPath: file,
        formula: "weighted_random",
        participantId: id,
        expectedHash: built.snapshotHash,
        expectedCount: built.snapshotCount,
        expectedMerkleRoot: built.merkleRoot,
      });
      assert.ok(served.participant, `participant ${id} found`);
      assert.ok(
        verifySnapshotMerkleProof({
          entry: served.participant!,
          formula: "weighted_random",
          proof: (served as any).proof,
          merkleRoot: built.merkleRoot,
        })
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
