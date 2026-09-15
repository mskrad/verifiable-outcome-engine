import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/** Hash-addressed mirrors tried after the committed URI: `<mirror>/sha256/<snapshot_hash>.jsonl`. */
export const DEFAULT_SNAPSHOT_MIRRORS = ["https://verifiableoutcome.online"];

/**
 * Gateways for storage schemes that do not name a host. The on-chain `snapshot_uri` keeps the
 * scheme (for example `irys-devnet://<id>`), so a gateway can change without touching old draws.
 */
export const SNAPSHOT_URI_GATEWAYS: Record<string, string[]> = {
  "ar:": ["https://arweave.net", "https://turbo-gateway.com"],
  "irys:": ["https://gateway.irys.xyz"],
  "irys-devnet:": ["https://devnet.irys.xyz", "https://gateway.irys.xyz"],
};

export const DEFAULT_SNAPSHOT_TIMEOUT_MS = 20_000;
export const DEFAULT_SNAPSHOT_MAX_BYTES = 512 * 1024 * 1024;

export type SnapshotSourceAttempt = {
  source: string;
  outcome: "ok" | "hash_mismatch" | "http_error" | "timeout" | "too_large" | "unsupported" | "error";
  detail?: string;
};

export class SnapshotUnavailableError extends Error {
  readonly code = "ERR_SNAPSHOT_UNAVAILABLE";
  readonly attempts: SnapshotSourceAttempt[];

  constructor(attempts: SnapshotSourceAttempt[]) {
    super(
      `No source served the committed snapshot: ${
        attempts.map((a) => `${a.source} → ${a.outcome}${a.detail ? ` (${a.detail})` : ""}`).join("; ") ||
        "no sources"
      }`
    );
    this.attempts = attempts;
  }
}

function hostlessSource(uri: string, gateways: Record<string, string[]>): string[] | null {
  const match = /^([a-z][a-z0-9+.-]*:)\/\/(.+)$/i.exec(uri);
  if (!match) return null;
  const scheme = match[1].toLowerCase();
  const list = gateways[scheme];
  if (!list) return null;
  return list.map((gateway) => `${gateway.replace(/\/+$/, "")}/${match[2]}`);
}

/**
 * Lists where a committed snapshot can be read, in order: the committed URI (through gateways for
 * host-less schemes), then hash-addressed mirrors. Every copy is still checked against the hash.
 */
export function snapshotSourceCandidates(opts: {
  snapshotUri: string;
  snapshotHash: string;
  mirrors?: string[];
  gateways?: Record<string, string[]>;
}): string[] {
  const gateways = opts.gateways ?? SNAPSHOT_URI_GATEWAYS;
  const uri = String(opts.snapshotUri || "").trim();
  const out: string[] = [];
  if (uri) {
    if (/^https?:\/\//i.test(uri) || /^file:\/\//i.test(uri)) out.push(uri);
    else {
      const viaGateways = hostlessSource(uri, gateways);
      if (viaGateways) out.push(...viaGateways);
      else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) out.push(uri); // unknown scheme, reported as unsupported
      else out.push(uri); // local path, meaningful only on the machine that wrote it
    }
  }
  const hash = String(opts.snapshotHash || "").toLowerCase();
  for (const mirror of opts.mirrors ?? []) {
    const base = String(mirror || "").trim().replace(/\/+$/, "");
    if (base) out.push(`${base}/sha256/${hash}.jsonl`);
  }
  return [...new Set(out)];
}

async function readHttp(url: string, timeoutMs: number, maxBytes: number): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) {
      throw Object.assign(new Error(`HTTP ${response.status}`), { outcome: "http_error" });
    }
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > maxBytes) {
      throw Object.assign(new Error(`${declared} bytes`), { outcome: "too_large" });
    }
    const chunks: Buffer[] = [];
    let total = 0;
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          controller.abort();
          throw Object.assign(new Error(`over ${maxBytes} bytes`), { outcome: "too_large" });
        }
        chunks.push(Buffer.from(value));
      }
    }
    return Buffer.concat(chunks);
  } catch (error: any) {
    if (error?.outcome) throw error;
    if (controller.signal.aborted) {
      throw Object.assign(new Error(`no answer in ${timeoutMs} ms`), { outcome: "timeout" });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function readLocal(source: string, maxBytes: number): Buffer {
  const filePath = /^file:\/\//i.test(source)
    ? fileURLToPath(source)
    : path.isAbsolute(source)
      ? source
      : path.resolve(process.cwd(), source);
  const size = fs.statSync(filePath).size;
  if (size > maxBytes) {
    throw Object.assign(new Error(`${size} bytes`), { outcome: "too_large" });
  }
  return fs.readFileSync(filePath);
}

/**
 * Reads the snapshot a draw committed to: an explicit local copy first, then the committed URI,
 * then hash-addressed mirrors. A source counts only if the SHA-256 of what it served equals the
 * committed snapshot hash; otherwise the next source is tried. Throws SnapshotUnavailableError,
 * with every attempt, when no source serves the committed bytes.
 */
export async function fetchCommittedSnapshot(opts: {
  snapshotUri: string;
  snapshotHash: string;
  mirrors?: string[];
  localFile?: string;
  gateways?: Record<string, string[]>;
  timeoutMs?: number;
  maxBytes?: number;
}): Promise<{ bytes: Buffer; source: string; attempts: SnapshotSourceAttempt[] }> {
  const expected = String(opts.snapshotHash || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new TypeError("snapshotHash must be 32-byte hex");
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SNAPSHOT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_SNAPSHOT_MAX_BYTES;
  const sources = [
    ...(opts.localFile ? [opts.localFile] : []),
    ...snapshotSourceCandidates({
      snapshotUri: opts.snapshotUri,
      snapshotHash: expected,
      mirrors: opts.mirrors,
      gateways: opts.gateways,
    }),
  ];
  const attempts: SnapshotSourceAttempt[] = [];
  for (const source of [...new Set(sources)]) {
    let bytes: Buffer;
    try {
      if (/^https?:\/\//i.test(source)) bytes = await readHttp(source, timeoutMs, maxBytes);
      else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source) && !/^file:\/\//i.test(source)) {
        attempts.push({ source, outcome: "unsupported", detail: "unknown URI scheme" });
        continue;
      } else bytes = readLocal(source, maxBytes);
    } catch (error: any) {
      attempts.push({
        source,
        outcome: error?.outcome ?? "error",
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const actual = crypto.createHash("sha256").update(bytes).digest("hex");
    if (actual !== expected) {
      attempts.push({ source, outcome: "hash_mismatch", detail: `sha256 ${actual.slice(0, 16)}…` });
      continue;
    }
    attempts.push({ source, outcome: "ok" });
    return { bytes, source, attempts };
  }
  throw new SnapshotUnavailableError(attempts);
}
