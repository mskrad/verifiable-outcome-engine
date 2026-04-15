import http from "http";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { PublicKey } from "@solana/web3.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REF_ROOT = path.resolve(__dirname, "..");
const STATIC_DIR = path.join(__dirname, "public");
const DEFAULT_BLESSED_PATH = path.join(
  REF_ROOT,
  "artifacts",
  "outcome_devnet_blessed_signatures.json"
);
const DEFAULT_SUMMARY_PATH = path.join(
  REF_ROOT,
  "artifacts",
  "public_evidence_summary.json"
);

function loadEnvFile() {
  const envPath = path.join(REF_ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const rows = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const row of rows) {
    const line = row.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function json(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendStatic(req, res, pathname) {
  const localPath = pathname === "/" ? "/index.html" : pathname;
  const abs = path.join(STATIC_DIR, localPath.replace(/^\/+/, ""));
  if (!abs.startsWith(STATIC_DIR)) {
    json(res, 400, { ok: false, error: "invalid path" });
    return;
  }
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    json(res, 404, { ok: false, error: "not found" });
    return;
  }
  const ext = path.extname(abs).toLowerCase();
  const contentType =
    ext === ".html"
      ? "text/html; charset=utf-8"
      : ext === ".js"
      ? "text/javascript; charset=utf-8"
      : ext === ".css"
      ? "text/css; charset=utf-8"
      : "application/octet-stream";
  const data = fs.readFileSync(abs);
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": data.length,
  });
  res.end(data);
}

function parseReplayJson(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch (_) {
      // ignore non-json lines
    }
  }
  return null;
}

function findTsNodeBin() {
  const fromEnv = process.env.TS_NODE_BIN;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const localBin = path.join(REF_ROOT, "node_modules", ".bin", "ts-node");
  if (fs.existsSync(localBin)) return localBin;
  throw new Error("ts-node not found. Run `yarn install` in the repository root or set TS_NODE_BIN.");
}

function loadBlessedSignatures() {
  return JSON.parse(fs.readFileSync(DEFAULT_BLESSED_PATH, "utf8"));
}

function loadSummary() {
  return JSON.parse(fs.readFileSync(DEFAULT_SUMMARY_PATH, "utf8"));
}

function defaultProgramId() {
  const blessed = loadBlessedSignatures();
  return process.env.PROGRAM_ID || blessed.program_id;
}

function defaultRpc() {
  const blessed = loadBlessedSignatures();
  return process.env.ANCHOR_PROVIDER_URL || blessed.rpc_url;
}

function runReplay({ signature, rpcUrl, programId, artifactPath }) {
  const args = [
    "--loader",
    "ts-node/esm",
    "scripts/replay_verify.ts",
    "--sig",
    signature,
    "--url",
    rpcUrl,
    "--program-id",
    programId,
    "--json",
  ];
  if (artifactPath) {
    args.push("--artifact", artifactPath);
  }

  const env = {
    ...process.env,
    TS_NODE_PROJECT: path.join(REF_ROOT, "tsconfig.json"),
    TS_NODE_TRANSPILE_ONLY: "true",
    ANCHOR_PROVIDER_URL: rpcUrl,
    PROGRAM_ID: programId,
  };
  const out = spawnSync(process.execPath, args, {
    cwd: REF_ROOT,
    env,
    encoding: "utf8",
  });
  const stdout = out.stdout || "";
  const stderr = out.stderr || "";
  const parsed = parseReplayJson(stdout);
  if (!parsed) {
    const details = [stdout, stderr].filter(Boolean).join("\n");
    const error = new Error("Replay output did not return JSON");
    error.details = details;
    throw error;
  }
  return {
    status: out.status ?? 0,
    replay: parsed,
    stdout,
    stderr,
  };
}

async function rpcCall(rpcUrl, payload, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`RPC HTTP ${response.status}`);
    }
    const jsonBody = await response.json();
    if (jsonBody.error) {
      throw new Error(jsonBody.error.message || "RPC error");
    }
    return jsonBody.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTimeline({
  signature,
  rpcUrl,
  programId,
  compiledArtifactHash,
}) {
  if (!signature) throw new Error("signature is required");
  if (!rpcUrl) throw new Error("rpcUrl is required");
  if (!programId) throw new Error("programId is required");
  if (!/^[0-9a-fA-F]{64}$/.test(compiledArtifactHash || "")) {
    throw new Error("compiledArtifactHash must be 32-byte hex");
  }

  const tx = await rpcCall(rpcUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "getTransaction",
    params: [
      signature,
      { encoding: "json", maxSupportedTransactionVersion: 0 },
    ],
  });
  if (!tx || typeof tx.slot !== "number") {
    throw new Error("resolution transaction slot not found");
  }

  const [artifactPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("approved_outcome_artifact"),
      Buffer.from(compiledArtifactHash, "hex"),
    ],
    new PublicKey(programId)
  );
  const signatures = await rpcCall(rpcUrl, {
    jsonrpc: "2.0",
    id: 2,
    method: "getSignaturesForAddress",
    params: [artifactPda.toBase58(), { limit: 1000 }],
  });
  if (!Array.isArray(signatures) || signatures.length === 0) {
    throw new Error("artifact PDA transaction history not found");
  }

  const oldest = signatures[signatures.length - 1];
  if (!oldest || typeof oldest.slot !== "number") {
    throw new Error("artifact creation slot not found");
  }

  return {
    artifact_slot: oldest.slot,
    resolution_slot: tx.slot,
    gap_slots: tx.slot - oldest.slot,
  };
}

async function handleApi(req, res, pathname) {
  try {
    if (req.method === "GET" && pathname === "/api/health") {
      const blessed = loadBlessedSignatures();
      json(res, 200, {
        ok: true,
        mode: "standalone_public_reference",
        program_id: defaultProgramId(),
        rpc: defaultRpc(),
        blessed_signatures_count: blessed.entries.filter(
          (entry) => entry.status === "active"
        ).length,
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/blessed-signatures") {
      json(res, 200, { ok: true, data: loadBlessedSignatures() });
      return;
    }

    if (req.method === "GET" && pathname === "/api/spec") {
      json(res, 200, {
        ok: true,
        summary: loadSummary(),
        blessed: loadBlessedSignatures(),
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/replay") {
      const body = await readJsonBody(req);
      const signature = String(body.signature || body.sig || "");
      if (!signature) {
        json(res, 400, { ok: false, error: "signature is required" });
        return;
      }
      const rpcUrl = String(body.rpc || defaultRpc());
      const programId = String(body.programId || defaultProgramId());
      const artifactPath = body.artifactPath
        ? path.resolve(REF_ROOT, String(body.artifactPath))
        : process.env.ARTIFACT_PATH || undefined;
      const replayResult = runReplay({
        signature,
        rpcUrl,
        programId,
        artifactPath,
      });
      json(res, 200, {
        ok: true,
        replay: replayResult.replay,
        stdout: replayResult.stdout,
        stderr: replayResult.stderr,
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/timeline") {
      try {
        const body = await readJsonBody(req);
        const timeline = await fetchTimeline({
          signature: String(body.signature || body.sig || ""),
          rpcUrl: String(body.rpcUrl || body.rpc || defaultRpc()),
          programId: String(body.programId || defaultProgramId()),
          compiledArtifactHash: String(body.compiledArtifactHash || ""),
        });
        json(res, 200, { ok: true, ...timeline });
      } catch (error) {
        json(res, 200, {
          ok: false,
          error:
            error?.name === "AbortError"
              ? "timeline RPC request timed out"
              : error?.message || String(error),
        });
      }
      return;
    }

    json(res, 404, { ok: false, error: "api route not found" });
  } catch (error) {
    json(res, 500, {
      ok: false,
      error: error?.message || String(error),
      details: error?.details || undefined,
    });
  }
}

loadEnvFile();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url.pathname);
    return;
  }
  sendStatic(req, res, url.pathname);
});

const port = Number(process.env.PORT || 8787);
server.listen(port, () => {
  console.log(`verifiable-outcome-engine web listening on http://127.0.0.1:${port}`);
});
