import http from "http";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import net from "net";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "url";
import { PublicKey } from "@solana/web3.js";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { hashSignal } from "@worldcoin/idkit-core/hashing";

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
const PARTNERS_CONFIG_PATH = path.join(REF_ROOT, "config", "partners.json");
const CORS_API_PATHS = new Set([
  "/api/replay",
  "/api/health",
  "/api/live-raffle",
  "/api/world-id/rp-context",
  "/api/resolutions",
  "/api/participant",
]);
const JSON_BODY_LIMIT_BYTES = Number(process.env.JSON_BODY_LIMIT_BYTES || 16_384);
const REPLAY_TIMEOUT_MS = Number(process.env.REPLAY_TIMEOUT_MS || 30_000);
const API_RATE_LIMIT_WINDOW_MS = Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60_000);
const API_RATE_LIMIT_MAX = Number(process.env.API_RATE_LIMIT_MAX || 60);
const REPLAY_RATE_LIMIT_MAX = Number(process.env.REPLAY_RATE_LIMIT_MAX || 12);
const LIVE_RAFFLE_TIMEOUT_MS = 45_000;
const LIVE_RAFFLE_RATE_LIMIT_MS = 60_000;
const LIVE_RAFFLE_OUTPUT_DIR = path.join(REF_ROOT, "tmp", "live-raffle");
const WORLD_VERIFY_URL = "https://developer.world.org/api/v4/verify";
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOLANA_SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/;
const SAFE_ARTIFACT_ROOTS = [
  path.join(REF_ROOT, "artifacts"),
  path.join(REF_ROOT, "tmp", "live-raffle"),
];
const LIVE_RAFFLE_PRESETS = [
  "3nafSu5GVq9bDLAxCg2gPucT4Jzhi2Ybyy2QbhzTMFR9",
  "CktRuQ2mQFucF77t4vZ4QGWJv2a9oW1P1bL6n6LJ9m5H",
  "ESjxDsMvG2SkPpK1FdcD6Lce4RUfMM8Bvg6sfFBUsXkT",
  "7FHkpGMVfKxaRx3rVfxMkgmQJ7o6EdVYuZRpNrAcU6Ha",
];

const liveRaffleRateLimit = new Map();
const apiRateLimit = new Map();
const resolutionsCache = new Map();
const worldIdNullifiers = new Set();
const RESOLUTIONS_CACHE_TTL_MS = 60_000;
const RESOLUTIONS_VERIFY_TIMEOUT_MS = 5_000;
let tsSdkRegistered = false;
let resolveInlinePromise;
let verifyOutcomePromise;
let swigOperatorConfig;
let vanishConfig;
let partnerConfig;

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

function applyCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function readJsonBody(req, limitBytes = JSON_BODY_LIMIT_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let rejected = false;
    req.on("data", (chunk) => {
      received += chunk.length;
      if (received > limitBytes) {
        rejected = true;
        reject(httpError(413, "JSON body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (rejected) return;
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(httpError(400, "Invalid JSON body"));
      }
    });
    req.on("error", (error) => {
      if (!rejected) reject(error);
    });
  });
}

function sendStatic(req, res, pathname) {
  const localPath = pathname === "/" ? "/index.html"
    : (!path.extname(pathname) && fs.existsSync(path.join(STATIC_DIR, pathname.replace(/^\/+/, "") + ".html")))
      ? pathname + ".html"
      : pathname;
  const abs = path.resolve(STATIC_DIR, localPath.replace(/^\/+/, ""));
  const staticRoot = path.resolve(STATIC_DIR);
  if (abs !== staticRoot && !abs.startsWith(`${staticRoot}${path.sep}`)) {
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
      : ext === ".svg"
      ? "image/svg+xml"
      : ext === ".webp"
      ? "image/webp"
      : ext === ".png"
      ? "image/png"
      : ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".ico"
      ? "image/x-icon"
      : ext === ".json"
      ? "application/json; charset=utf-8"
      : ext === ".woff2"
      ? "font/woff2"
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

function allowReplayOverrides() {
  return process.env.VRE_ALLOW_REPLAY_OVERRIDES === "1";
}

function normalizeRpcUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch (_) {
    throw httpError(400, "rpc must be a valid HTTPS URL");
  }
  if (parsed.protocol !== "https:") {
    throw httpError(400, "rpc must use HTTPS");
  }
  parsed.hash = "";
  parsed.username = "";
  parsed.password = "";
  return parsed.toString();
}

function isPrivateIp(hostname) {
  const version = net.isIP(hostname);
  if (version === 4) {
    const parts = hostname.split(".").map((part) => Number(part));
    const [a, b] = parts;
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    );
  }
  if (version === 6) {
    const lower = hostname.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:");
  }
  return false;
}

function validateRpcHost(rpcUrl) {
  const parsed = new URL(rpcUrl);
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    isPrivateIp(hostname)
  ) {
    throw httpError(400, "rpc host is not allowed");
  }
}

function allowedRpcUrls() {
  const urls = new Set([normalizeRpcUrl(defaultRpc())]);
  for (const raw of String(process.env.VRE_ALLOWED_RPC_URLS || "").split(",")) {
    const trimmed = raw.trim();
    if (trimmed) urls.add(normalizeRpcUrl(trimmed));
  }
  return urls;
}

function resolveRpcUrl(candidate, defaultValue = defaultRpc()) {
  const fallback = normalizeRpcUrl(defaultValue);
  const rpcUrl = normalizeRpcUrl(candidate || fallback);
  validateRpcHost(rpcUrl);
  if (!allowedRpcUrls().has(rpcUrl) && !allowReplayOverrides()) {
    throw httpError(400, "custom rpc override is disabled");
  }
  return rpcUrl;
}

function validateSignature(value) {
  const signature = String(value || "").trim();
  if (!SOLANA_SIGNATURE_RE.test(signature)) {
    throw httpError(400, "signature must be a base58 transaction signature");
  }
  return signature;
}

function validateProgramId(value) {
  const programId = String(value || "").trim();
  try {
    return new PublicKey(programId).toBase58();
  } catch (_) {
    throw httpError(400, "programId must be a valid Solana public key");
  }
}

function pathInside(candidate, root) {
  const resolved = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
}

function resolveArtifactPath(bodyArtifactPath) {
  const rawPath = bodyArtifactPath || process.env.ARTIFACT_PATH || "";
  if (!rawPath) return undefined;
  if (bodyArtifactPath && !allowReplayOverrides()) {
    throw httpError(400, "artifact override is disabled");
  }
  const artifactPath = path.resolve(REF_ROOT, String(rawPath));
  if (!SAFE_ARTIFACT_ROOTS.some((root) => pathInside(artifactPath, root))) {
    throw httpError(400, "artifact path is outside allowed artifact roots");
  }
  let stat;
  try {
    stat = fs.statSync(artifactPath);
  } catch (_) {
    throw httpError(400, "artifact path does not exist");
  }
  if (!stat.isFile()) {
    throw httpError(400, "artifact path must point to a file");
  }
  return artifactPath;
}

function ensureTsSdkRuntime() {
  if (tsSdkRegistered) return;
  process.env.TS_NODE_PROJECT =
    process.env.TS_NODE_PROJECT || path.join(REF_ROOT, "tsconfig.json");
  process.env.TS_NODE_TRANSPILE_ONLY =
    process.env.TS_NODE_TRANSPILE_ONLY || "true";
  register("ts-node/esm", pathToFileURL(`${REF_ROOT}/`));
  tsSdkRegistered = true;
}

async function loadResolveInline() {
  ensureTsSdkRuntime();
  if (!resolveInlinePromise) {
    resolveInlinePromise = import(
      pathToFileURL(path.join(REF_ROOT, "sdk", "operator.ts")).href
    ).then((module) => {
      if (typeof module.resolveInline !== "function") {
        throw new Error("resolveInline export not found");
      }
      return module.resolveInline;
    });
  }
  return resolveInlinePromise;
}

async function loadVerifyOutcome() {
  ensureTsSdkRuntime();
  if (!verifyOutcomePromise) {
    verifyOutcomePromise = import(
      pathToFileURL(path.join(REF_ROOT, "sdk", "verify.ts")).href
    ).then((module) => {
      if (typeof module.verifyOutcome !== "function") {
        throw new Error("verifyOutcome export not found");
      }
      return module.verifyOutcome;
    });
  }
  return verifyOutcomePromise;
}

async function fetchResolutions(limit, opts = {}) {
  const now = Date.now();
  const cacheKey = `${opts.preferBlessed ? "blessed" : "latest"}:${limit}`;
  const cached = resolutionsCache.get(cacheKey);
  if (cached && cached.expireAt > now) return cached.data;

  const rpcUrl = defaultRpc();
  const programId = defaultProgramId();
  const verifyOutcome = await loadVerifyOutcome();

  // Fetch recent sigs from program
  const fetchLimit = Math.min(limit * 4, 100);
  const rawSigs = await rpcCall(rpcUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "getSignaturesForAddress",
    params: [programId, { limit: fetchLimit }],
  });
  if (!Array.isArray(rawSigs)) throw new Error("Failed to fetch program signatures");

  // Always include active blessed sigs so historical winners are discoverable.
  const blessedEntries = (loadBlessedSignatures().entries ?? []).filter(
    (entry) => entry.status === "active"
  );
  const sigMap = new Map();
  for (const s of rawSigs) sigMap.set(s.signature, s);
  for (const b of blessedEntries) {
    if (!sigMap.has(b.signature)) {
      sigMap.set(b.signature, { signature: b.signature, slot: null });
    }
  }
  const blessedSignatures = new Set(blessedEntries.map((entry) => entry.signature));
  const blessedSigs = blessedEntries.map((entry) => ({
    signature: entry.signature,
    slot: null,
  }));
  let recentSigs = [...sigMap.values()].filter(
    (entry) => !blessedSignatures.has(entry.signature)
  );
  if (typeof opts.recentLimit === "number") {
    recentSigs = recentSigs.slice(0, Math.max(0, opts.recentLimit));
  }
  const allSigs = opts.preferBlessed
    ? [...blessedSigs, ...recentSigs]
    : [...recentSigs, ...blessedSigs];

  // Verify in batches to avoid hammering devnet with too many concurrent RPC calls
  const VERIFY_BATCH_SIZE = 8;
  const matches = [];
  for (let i = 0; i < allSigs.length && matches.length < limit; i += VERIFY_BATCH_SIZE) {
    const batch = allSigs.slice(i, i + VERIFY_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (sigEntry) => {
        try {
          const verified = await withTimeout(
            verifyOutcome({ signature: sigEntry.signature, rpcUrl, programId }),
            RESOLUTIONS_VERIFY_TIMEOUT_MS,
            "verify timeout"
          );
          if (verified.status !== "MATCH") return null;
          return { sigEntry, verified };
        } catch (_) {
          return null;
        }
      })
    );
    for (const r of batchResults) {
      if (r && matches.length < limit) matches.push(r);
    }
  }

  // Deduplicate commit_slot lookups by artifact hash (many raffles share an artifact)
  const uniqueHashes = [...new Set(matches.map((m) => m.verified.compiled_artifact_hash))];
  const commitSlotByHash = new Map();
  for (const hash of uniqueHashes) {
    try {
      const [artifactPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("approved_outcome_artifact"),
          Buffer.from(hash, "hex"),
        ],
        new PublicKey(programId)
      );
      const artifactSigs = await rpcCall(rpcUrl, {
        jsonrpc: "2.0",
        id: 2,
        method: "getSignaturesForAddress",
        params: [artifactPda.toBase58(), { limit: 1000 }],
      }, 15_000);
      if (Array.isArray(artifactSigs) && artifactSigs.length > 0) {
        commitSlotByHash.set(hash, artifactSigs[artifactSigs.length - 1].slot);
      }
    } catch (commitErr) {
      console.error("[resolutions] commit_slot lookup failed for hash", hash.slice(0, 12), ":", commitErr?.message || commitErr);
    }
  }

  const results = await Promise.all(
    matches.map(async ({ sigEntry, verified }) => {
      // resolve_slot: prefer from getSignaturesForAddress; fall back to getTransaction
      let resolveSlot = sigEntry.slot ?? null;
      if (resolveSlot === null) {
        try {
          const txInfo = await rpcCall(rpcUrl, {
            jsonrpc: "2.0",
            id: 3,
            method: "getTransaction",
            params: [
              sigEntry.signature,
              { encoding: "json", maxSupportedTransactionVersion: 0 },
            ],
          });
          resolveSlot = txInfo?.slot ?? null;
        } catch (_) {}
      }

      return {
        signature: sigEntry.signature,
        outcome_id: verified.outcome_id,
        outcome_ids: verified.outcome_ids,
        participants: verified.outcomes ?? [],
        participants_count: (verified.outcomes ?? []).length,
        commit_slot: commitSlotByHash.get(verified.compiled_artifact_hash) ?? null,
        resolve_slot: resolveSlot,
        artifact_hash: verified.compiled_artifact_hash,
      };
    })
  );

  resolutionsCache.set(cacheKey, {
    data: results,
    expireAt: Date.now() + RESOLUTIONS_CACHE_TTL_MS,
  });
  return results;
}

function validateSolanaAddress(value) {
  const address = String(value || "").trim();
  if (!SOLANA_ADDRESS_RE.test(address)) {
    throw new Error("invalid address");
  }
  try {
    new PublicKey(address);
  } catch (_) {
    throw new Error("invalid address");
  }
  return address;
}

function parseSwigOperatorConfig() {
  const swigAddress = String(process.env.SWIG_WALLET_ADDRESS || "").trim();
  const delegateKeypairPath = String(process.env.SWIG_DELEGATE_KEYPAIR || "").trim();
  if ((swigAddress && !delegateKeypairPath) || (!swigAddress && delegateKeypairPath)) {
    throw new Error(
      "SWIG_WALLET_ADDRESS and SWIG_DELEGATE_KEYPAIR must be set together"
    );
  }
  if (!swigAddress) return undefined;

  const roleRaw = String(process.env.SWIG_ROLE_ID || "").trim();
  let roleId;
  if (roleRaw) {
    roleId = Number(roleRaw);
    if (!Number.isSafeInteger(roleId) || roleId < 0) {
      throw new Error("SWIG_ROLE_ID must be a non-negative integer");
    }
  }

  return {
    swigAddress: validateSolanaAddress(swigAddress),
    delegateKeypairPath,
    roleId,
  };
}

function parseVanishConfig() {
  const apiKey = String(process.env.VANISH_API_KEY || "").trim();
  if (!apiKey) return undefined;
  const amountRaw = String(process.env.VANISH_PAYOUT_LAMPORTS || "100000").trim();
  const amountLamports = BigInt(amountRaw);
  if (amountLamports <= 0n) throw new Error("VANISH_PAYOUT_LAMPORTS must be > 0");
  return { apiKey, amountLamports };
}

function loadPartnerConfig() {
  if (!fs.existsSync(PARTNERS_CONFIG_PATH)) {
    console.warn(`[partner] config missing at ${PARTNERS_CONFIG_PATH}`);
    return {
      configured: false,
      partnersByKey: new Map(),
    };
  }
  const raw = JSON.parse(fs.readFileSync(PARTNERS_CONFIG_PATH, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error("config/partners.json must contain an array");
  }
  const partnersByKey = new Map();
  for (const item of raw) {
    const key = String(item?.key || "").trim();
    const name = String(item?.name || "").trim();
    if (!key || !name) {
      throw new Error("Each partner entry must include non-empty key and name");
    }
    partnersByKey.set(key, {
      key,
      name,
      tier: item?.tier ?? null,
      created: item?.created ?? null,
    });
  }
  return {
    configured: true,
    partnersByKey,
  };
}

function redactApiKeyPrefix(value) {
  const key = String(value || "").trim();
  if (!key) return "missing";
  return `${key.slice(0, Math.min(8, key.length))}...`;
}

function requirePartnerApiKey(req, pathname) {
  if (!partnerConfig?.configured) {
    throw httpError(503, "Partner API not configured");
  }
  const key = String(req.headers["x-api-key"] || "").trim();
  const partner = partnerConfig.partnersByKey.get(key);
  if (!partner) {
    console.warn(`[partner] rejected unknown key ${redactApiKeyPrefix(key)}`);
    throw httpError(401, "Invalid or missing API key");
  }
  console.log(`[partner] ${partner.name} called ${pathname}`);
  return partner;
}

function normalizeWorldEnvironment(value) {
  const environment = String(value || "production").trim().toLowerCase();
  return environment === "staging" ? "staging" : "production";
}

function normalizeWorldSigningKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

function worldIdConfig() {
  const appId = String(process.env.WORLD_APP_ID || "").trim();
  const rpId = String(process.env.WORLD_RP_ID || "").trim();
  const signingKey = normalizeWorldSigningKey(process.env.WORLD_RP_SIGNING_KEY);
  const action = String(process.env.WORLD_ACTION_ID || "vre-raffle-entry").trim();
  const environment = normalizeWorldEnvironment(process.env.WORLD_ENVIRONMENT);
  return {
    enabled: Boolean(appId && rpId && signingKey),
    appId,
    rpId,
    signingKey,
    action,
    environment,
  };
}

function worldIdCapability() {
  const config = worldIdConfig();
  return {
    enabled: config.enabled,
    flow: "v4-first",
    app_id: config.appId || null,
    rp_id: config.rpId || null,
    action: config.action,
    environment: config.environment,
  };
}

function buildWorldIdRpContext() {
  const config = worldIdConfig();
  if (!config.enabled) {
    return {
      ok: true,
      ...worldIdCapability(),
      rp_context: null,
    };
  }
  const signature = signRequest({
    action: config.action,
    signingKeyHex: config.signingKey,
  });
  return {
    ok: true,
    ...worldIdCapability(),
    rp_context: {
      rp_id: config.rpId,
      nonce: signature.nonce,
      created_at: signature.createdAt,
      expires_at: signature.expiresAt,
      signature: signature.sig,
    },
  };
}

function normalizeWorldIdProof(worldId, address) {
  const config = worldIdConfig();
  if (!worldId || typeof worldId !== "object" || Array.isArray(worldId)) {
    throw httpError(400, "World ID verification failed");
  }
  if (String(worldId.protocol_version || "").trim() !== "4.0") {
    throw httpError(400, "World ID verification failed");
  }
  if (String(worldId.action || "").trim() !== config.action) {
    throw httpError(400, "World ID verification failed");
  }
  const environment = String(worldId.environment || "").trim();
  if (environment && environment !== config.environment) {
    throw httpError(400, "World ID verification failed");
  }
  const responses = Array.isArray(worldId.responses) ? worldId.responses : [];
  if (!responses.length) {
    throw httpError(400, "World ID verification failed");
  }
  const expectedSignalHash = String(hashSignal(address)).toLowerCase();
  const hasExpectedSignal = responses.some(
    (responseItem) =>
      String(responseItem?.signal_hash || "").trim().toLowerCase() === expectedSignalHash
  );
  if (!hasExpectedSignal) {
    throw httpError(400, "World ID verification failed");
  }
  return {
    proof: worldId,
    expectedSignalHash,
  };
}

async function verifyWorldIdOrThrow(worldId, address) {
  const config = worldIdConfig();
  if (!config.enabled) {
    throw httpError(400, "World ID is not configured");
  }
  const normalized = normalizeWorldIdProof(worldId, address);

  let response;
  try {
    response = await fetch(`${WORLD_VERIFY_URL}/${encodeURIComponent(config.rpId)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "verifiable-outcome-engine/0.3.0",
      },
      body: JSON.stringify(normalized.proof),
    });
  } catch (_) {
    throw httpError(400, "World ID verification failed");
  }

  let payload;
  try {
    payload = await response.json();
  } catch (_) {
    throw httpError(400, "World ID verification failed");
  }

  const nullifier =
    payload?.nullifier ||
    payload?.results?.find((result) => result?.success === true && result?.nullifier)?.nullifier;
  if (!response.ok || payload?.success !== true || !nullifier) {
    throw httpError(400, "World ID verification failed");
  }

  return {
    nullifier: String(nullifier),
    verification: payload,
  };
}

function clientIp(req) {
  if (process.env.TRUST_PROXY === "1") {
    const forwarded = String(req.headers["x-forwarded-for"] || "")
      .split(",")[0]
      .trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || "unknown";
}

function checkRateLimit(store, key, maxRequests, windowMs) {
  const now = Date.now();
  const current = store.get(key);
  if (!current || current.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterMs: 0 };
  }
  if (current.count >= maxRequests) {
    return { ok: false, retryAfterMs: current.resetAt - now };
  }
  current.count += 1;
  return { ok: true, retryAfterMs: 0 };
}

function enforceApiRateLimit(req, pathname, maxRequests = API_RATE_LIMIT_MAX) {
  for (const [key, value] of apiRateLimit) {
    if (value.resetAt <= Date.now()) apiRateLimit.delete(key);
  }
  const limit = checkRateLimit(
    apiRateLimit,
    `${clientIp(req)}:${pathname}`,
    maxRequests,
    API_RATE_LIMIT_WINDOW_MS
  );
  if (!limit.ok) {
    throw httpError(429, `rate limit exceeded; retry in ${Math.ceil(limit.retryAfterMs / 1000)}s`);
  }
}

function checkLiveRaffleRateLimit(req) {
  const ip = clientIp(req);
  const now = Date.now();
  for (const [key, until] of liveRaffleRateLimit) {
    if (until <= now) liveRaffleRateLimit.delete(key);
  }
  const blockedUntil = liveRaffleRateLimit.get(ip) || 0;
  if (blockedUntil > now) {
    return { ok: false, retryAfterMs: blockedUntil - now };
  }
  liveRaffleRateLimit.set(ip, now + LIVE_RAFFLE_RATE_LIMIT_MS);
  return { ok: true, retryAfterMs: 0 };
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function buildLiveRaffleConfig(judgeAddress) {
  const weights = new Map();
  for (const address of LIVE_RAFFLE_PRESETS) {
    weights.set(address, 250);
  }
  weights.set(judgeAddress, (weights.get(judgeAddress) || 0) + 9000);

  return {
    type: "raffle",
    input_lamports: 10,
    payout_lamports: 3,
    participants: [...weights.entries()].map(([address, weight]) => ({
      address,
      weight,
    })),
  };
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
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: REF_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, REPLAY_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(httpError(504, "replay timed out"));
        return;
      }
      const parsed = parseReplayJson(stdout);
      if (!parsed) {
        const details = [stdout, stderr].filter(Boolean).join("\n");
        const error = new Error("Replay output did not return JSON");
        error.details = details;
        reject(error);
        return;
      }
      resolve({
        status: status ?? 0,
        replay: parsed,
        stdout,
        stderr,
      });
    });
  });
}

async function handleLiveRaffle(req, res) {
  const body = await readJsonBody(req);
  let address;
  try {
    address = validateSolanaAddress(body.address);
  } catch (_) {
    json(res, 400, { ok: false, error: "Invalid Solana address" });
    return;
  }

  const requireWorldId = body.requireWorldId === true;
  let worldIdVerification;
  if (requireWorldId) {
    worldIdVerification = await verifyWorldIdOrThrow(body.worldId, address);
    if (worldIdNullifiers.has(worldIdVerification.nullifier)) {
      json(res, 400, { ok: false, error: "World ID nullifier already used" });
      return;
    }
  }

  const limit = checkLiveRaffleRateLimit(req);
  if (!limit.ok) {
    json(res, 429, {
      ok: false,
      error: "Please wait 60 seconds between raffles",
      retry_after_ms: limit.retryAfterMs,
    });
    return;
  }

  let reservedWorldIdNullifier;
  try {
    if (worldIdVerification?.nullifier) {
      worldIdNullifiers.add(worldIdVerification.nullifier);
      reservedWorldIdNullifier = worldIdVerification.nullifier;
    }
    const config = buildLiveRaffleConfig(address);
    const resolveInline = await loadResolveInline();
    const rpcUrl = resolveRpcUrl(process.env.LIVE_RAFFLE_RPC_URL || defaultRpc());
    const programId = validateProgramId(process.env.LIVE_RAFFLE_PROGRAM_ID || defaultProgramId());
    const walletPath = swigOperatorConfig
      ? undefined
      : process.env.LIVE_RAFFLE_WALLET || process.env.ANCHOR_WALLET || undefined;
    const label = `live-raffle-${Date.now()}`;
    const result = await withTimeout(
      resolveInline(config, {
        rpcUrl,
        programId,
        walletPath,
        swigWallet: swigOperatorConfig,
        outputDir: process.env.LIVE_RAFFLE_OUTPUT_DIR || LIVE_RAFFLE_OUTPUT_DIR,
        label,
      }),
      LIVE_RAFFLE_TIMEOUT_MS,
      "Devnet is slow right now, try again"
    );

    const responseBody = {
      ok: true,
      signature: result.signature,
      outcome: result.outcome,
      runtimeId: result.runtimeId,
      resolveId: result.resolveId,
      artifactHash: result.artifactHash,
      programId: result.programId,
      participantCount: config.participants.length,
    };
    if (worldIdVerification) {
      responseBody.world_id = {
        verified: true,
        environment:
          worldIdVerification.verification?.environment || worldIdConfig().environment,
      };
    }

    if (vanishConfig) {
      try {
        const { vanishPayoutRoute: routePayout } = await import(
          pathToFileURL(path.join(REF_ROOT, "sdk", "vanish.ts")).href
        );
        const walletPath =
          process.env.LIVE_RAFFLE_WALLET || process.env.ANCHOR_WALLET;
        if (walletPath) {
          const { Keypair } = await import("@solana/web3.js");
          const raw = JSON.parse(fs.readFileSync(walletPath, "utf8"));
          const operatorKeypair = Keypair.fromSecretKey(Uint8Array.from(raw));
          const payout = await routePayout({
            apiKey: vanishConfig.apiKey,
            amountLamports: vanishConfig.amountLamports,
            winnerAddress: result.outcome,
            operatorKeypair,
            rpcUrl,
          });
          responseBody.vanish_deposit_tx = payout.depositTx;
          responseBody.vanish_tx = payout.withdrawTx;
        }
      } catch (vanishErr) {
        console.error("[vanish] payout failed (non-fatal):", vanishErr?.message || vanishErr);
        responseBody.vanish_error = vanishErr?.message || String(vanishErr);
      }
    }

    json(res, 200, responseBody);
  } catch (error) {
    if (reservedWorldIdNullifier) {
      worldIdNullifiers.delete(reservedWorldIdNullifier);
    }
    const message = error?.message || String(error);
    const isTimeout = message.includes("Devnet is slow");
    json(res, isTimeout ? 504 : 500, {
      ok: false,
      error: isTimeout ? "Devnet is slow right now, try again" : message,
    });
  }
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
  signature = validateSignature(signature);
  rpcUrl = resolveRpcUrl(rpcUrl);
  programId = validateProgramId(programId);
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
    const corsEnabled = CORS_API_PATHS.has(pathname);
    if (corsEnabled) applyCorsHeaders(res);

    if (req.method === "OPTIONS") {
      if (corsEnabled) {
        res.writeHead(204);
        res.end();
        return;
      }
      json(res, 404, { ok: false, error: "api route not found" });
      return;
    }

    if (req.method === "GET" && pathname === "/api/health") {
      const blessed = loadBlessedSignatures();
      json(res, 200, {
        ok: true,
        mode: "standalone_public_reference",
        program_id: defaultProgramId(),
        rpc: defaultRpc(),
        world_id: worldIdCapability(),
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

    if (req.method === "GET" && pathname === "/api/resolutions") {
      requirePartnerApiKey(req, pathname);
      enforceApiRateLimit(req, pathname);
      const reqUrl = new URL(req.url || "/", "http://localhost");
      const rawLimit = reqUrl.searchParams.get("limit");
      const limit = rawLimit
        ? Math.min(Math.max(1, parseInt(rawLimit, 10) || 10), 50)
        : 10;
      const resolutions = await fetchResolutions(limit);
      json(res, 200, {
        ok: true,
        resolutions: resolutions.map((r) => ({
          signature: r.signature,
          outcome_id: r.outcome_id,
          participants_count: r.participants_count,
          commit_slot: r.commit_slot,
          resolve_slot: r.resolve_slot,
          artifact_hash: r.artifact_hash,
        })),
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/participant") {
      requirePartnerApiKey(req, pathname);
      enforceApiRateLimit(req, pathname);
      const reqUrl = new URL(req.url || "/", "http://localhost");
      const address = reqUrl.searchParams.get("address") || "";
      if (!address) {
        json(res, 400, { ok: false, error: "address is required" });
        return;
      }
      try {
        validateSolanaAddress(address);
      } catch (_) {
        json(res, 400, { ok: false, error: "Invalid Solana address" });
        return;
      }
      const resolutions = await fetchResolutions(50, {
        preferBlessed: true,
        recentLimit: 0,
      });
      const raffles = [];
      for (const r of resolutions) {
        const isWinner =
          r.outcome_id === address ||
          (Array.isArray(r.outcome_ids) && r.outcome_ids.includes(address));
        const isParticipant =
          isWinner ||
          (Array.isArray(r.participants) && r.participants.some((p) => p.id === address));
        if (!isParticipant) continue;
        raffles.push({
          signature: r.signature,
          resolve_slot: r.resolve_slot,
          won: isWinner,
          outcome_id: r.outcome_id,
        });
      }
      json(res, 200, {
        ok: true,
        address,
        participated: raffles.length > 0,
        raffles,
      });
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

    if (req.method === "POST" && pathname === "/api/world-id/rp-context") {
      json(res, 200, buildWorldIdRpContext());
      return;
    }

    if (req.method === "POST" && pathname === "/api/replay") {
      enforceApiRateLimit(req, pathname, REPLAY_RATE_LIMIT_MAX);
      const body = await readJsonBody(req);
      const signature = validateSignature(body.signature || body.sig || "");
      const rpcUrl = resolveRpcUrl(body.rpc || defaultRpc());
      const programId = validateProgramId(body.programId || defaultProgramId());
      const artifactPath = resolveArtifactPath(body.artifactPath);
      const replayResult = await runReplay({
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

    if (req.method === "POST" && pathname === "/api/live-raffle") {
      await handleLiveRaffle(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/timeline") {
      try {
        enforceApiRateLimit(req, pathname);
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
    const statusCode = error?.statusCode || 500;
    json(res, statusCode, {
      ok: false,
      error: error?.message || String(error),
      details: statusCode >= 500 ? error?.details || undefined : undefined,
    });
  }
}

loadEnvFile();
swigOperatorConfig = parseSwigOperatorConfig();
vanishConfig = parseVanishConfig();
partnerConfig = loadPartnerConfig();

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
