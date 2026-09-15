import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import {
  SnapshotUnavailableError,
  fetchCommittedSnapshot,
  snapshotSourceCandidates,
} from "../../sdk/snapshot_source.ts";

const good = Buffer.from('{"id":"a","order":0,"weight":1}\n{"id":"b","order":1,"weight":2}\n');
const hash = crypto.createHash("sha256").update(good).digest("hex");

async function withServer(fn: (base: string) => Promise<void>) {
  const server = http.createServer((req, res) => {
    const url = req.url || "/";
    if (url === "/good.jsonl" || url === `/sha256/${hash}.jsonl` || url === "/gw/abc") return void res.end(good);
    if (url === "/bad.jsonl") return void res.end(Buffer.from("tampered\n"));
    if (url === "/big.jsonl") return void res.end(Buffer.alloc(4096, 0x61));
    if (url === "/slow.jsonl") return; // never answers
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await fn(base);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("committed https URI is used when it serves the committed bytes", async () => {
  await withServer(async (base) => {
    const r = await fetchCommittedSnapshot({ snapshotUri: `${base}/good.jsonl`, snapshotHash: hash, mirrors: [base] });
    assert.equal(r.source, `${base}/good.jsonl`);
    assert.ok(r.bytes.equals(good));
  });
});

test("a missing, tampered, slow or oversized URI falls through to the hash-addressed mirror", async () => {
  await withServer(async (base) => {
    for (const [name, outcome] of [["missing.jsonl", "http_error"], ["bad.jsonl", "hash_mismatch"], ["slow.jsonl", "timeout"], ["big.jsonl", "too_large"]] as const) {
      const r = await fetchCommittedSnapshot({
        snapshotUri: `${base}/${name}`,
        snapshotHash: hash,
        mirrors: [base],
        timeoutMs: 300,
        maxBytes: 1024,
      });
      assert.equal(r.source, `${base}/sha256/${hash}.jsonl`, name);
      assert.equal(r.attempts[0].outcome, outcome, name);
      assert.equal(r.attempts.at(-1)!.outcome, "ok");
    }
  });
});

test("host-less schemes resolve through the configured gateways", async () => {
  await withServer(async (base) => {
    const gateways = { "ar:": [`${base}/nowhere`, `${base}/gw`], "irys-devnet:": [`${base}/gw`] };
    const ar = await fetchCommittedSnapshot({ snapshotUri: "ar://abc", snapshotHash: hash, gateways });
    assert.equal(ar.source, `${base}/gw/abc`);
    assert.equal(ar.attempts[0].outcome, "http_error");
    const irys = await fetchCommittedSnapshot({ snapshotUri: "irys-devnet://abc", snapshotHash: hash, gateways });
    assert.equal(irys.source, `${base}/gw/abc`);
  });
});

test("an explicit local copy is tried first and accepted only if its hash matches", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vre-source-"));
  const goodFile = path.join(dir, "good.jsonl");
  const badFile = path.join(dir, "bad.jsonl");
  fs.writeFileSync(goodFile, good);
  fs.writeFileSync(badFile, "tampered\n");
  try {
    const r = await fetchCommittedSnapshot({ snapshotUri: "ar://gone", snapshotHash: hash, localFile: goodFile, gateways: {} });
    assert.equal(r.source, goodFile);
    await assert.rejects(
      fetchCommittedSnapshot({ snapshotUri: "", snapshotHash: hash, localFile: badFile }),
      (e: any) => e instanceof SnapshotUnavailableError && e.attempts[0].outcome === "hash_mismatch"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("no valid copy anywhere raises ERR_SNAPSHOT_UNAVAILABLE with every attempt", async () => {
  await withServer(async (base) => {
    await assert.rejects(
      fetchCommittedSnapshot({ snapshotUri: "weird://x", snapshotHash: hash, mirrors: [`${base}/empty`, `${base}/bad.jsonl`], timeoutMs: 300 }),
      (e: any) => {
        assert.ok(e instanceof SnapshotUnavailableError);
        assert.equal(e.code, "ERR_SNAPSHOT_UNAVAILABLE");
        assert.deepEqual(e.attempts.map((a: any) => a.outcome), ["unsupported", "http_error", "http_error"]);
        return true;
      }
    );
  });
});

test("candidate order: committed URI, then mirrors; duplicates dropped", () => {
  const list = snapshotSourceCandidates({
    snapshotUri: "irys-devnet://id1",
    snapshotHash: hash.toUpperCase(),
    mirrors: ["https://m1.example/", "https://m1.example", "https://m2.example"],
    gateways: { "irys-devnet:": ["https://g1.example", "https://g2.example/"] },
  });
  assert.deepEqual(list, [
    "https://g1.example/id1",
    "https://g2.example/id1",
    `https://m1.example/sha256/${hash}.jsonl`,
    `https://m2.example/sha256/${hash}.jsonl`,
  ]);
});
