import http from "http";
import crypto from "crypto";
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
  "/api/recent-resolutions",
  "/api/resolutions",
  "/api/participant",
  "/api/partner/draw",
  "/api/partner/snapshot/init",
  "/api/partner/snapshot/chunk",
  "/api/partner/snapshot/finalize",
]);
const JSON_BODY_LIMIT_BYTES = Number(process.env.JSON_BODY_LIMIT_BYTES || 16_384);
const REPLAY_TIMEOUT_MS = Number(process.env.REPLAY_TIMEOUT_MS || 30_000);
const API_RATE_LIMIT_WINDOW_MS = Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60_000);
const API_RATE_LIMIT_MAX = Number(process.env.API_RATE_LIMIT_MAX || 60);
const REPLAY_RATE_LIMIT_MAX = Number(process.env.REPLAY_RATE_LIMIT_MAX || 12);
const LIVE_RAFFLE_TIMEOUT_MS = 45_000;
const LIVE_RAFFLE_RATE_LIMIT_MS = 10_000;
const LIVE_RAFFLE_OUTPUT_DIR = path.join(REF_ROOT, "tmp", "live-raffle");
const PARTNER_DRAW_OUTPUT_DIR = path.join(REF_ROOT, "tmp", "partner-draw");
const PARTNER_SNAPSHOT_ROOT_DIR = path.join(REF_ROOT, "tmp", "partner-snapshot");
const WORLD_VERIFY_URL = "https://developer.world.org/api/v4/verify";
const WORLD_VERIFY_URL_STAGING_V2 = "https://developer.worldcoin.org/api/v2/verify";
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOLANA_SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/;
const PRINTABLE_ASCII_RE = /^[\x20-\x7E]+$/;
const MAX_PARTNER_PARTICIPANT_ID_BYTES = 64;
const SAFE_ARTIFACT_ROOTS = [
  path.join(REF_ROOT, "artifacts"),
  path.join(REF_ROOT, "tmp", "live-raffle"),
  path.join(REF_ROOT, "tmp", "partner-draw"),
  path.join(REF_ROOT, "tmp", "partner-snapshot"),
];
const LIVE_RAFFLE_PRESETS = [
  "3nafSu5GVq9bDLAxCg2gPucT4Jzhi2Ybyy2QbhzTMFR9",
  "CktRuQ2mQFucF77t4vZ4QGWJv2a9oW1P1bL6n6LJ9m5H",
  "ESjxDsMvG2SkPpK1FdcD6Lce4RUfMM8Bvg6sfFBUsXkT",
  "7FHkpGMVfKxaRx3rVfxMkgmQJ7o6EdVYuZRpNrAcU6Ha",
];

const liveRaffleRateLimit = new Map();
const partnerDrawRateLimit = new Map(); // partnerKey → blockedUntil ms
const apiRateLimit = new Map();
const PARTNER_DRAW_RATE_LIMIT_MS = 10_000;
const PARTNER_SNAPSHOT_JSON_BODY_LIMIT_BYTES = Number(
  process.env.PARTNER_SNAPSHOT_JSON_BODY_LIMIT_BYTES || 2_000_000
);
const PARTNER_SNAPSHOT_SESSION_TTL_MS = Number(
  process.env.PARTNER_SNAPSHOT_SESSION_TTL_MS || 24 * 60 * 60 * 1000
);
const PARTNER_SNAPSHOT_CHUNK_MAX_PARTICIPANTS = Number(
  process.env.PARTNER_SNAPSHOT_CHUNK_MAX_PARTICIPANTS || 5000
);
const PARTNER_SNAPSHOT_SIMPLE_MAX = Number(
  process.env.PARTNER_SNAPSHOT_SIMPLE_MAX || 1000
);
const PARTNER_SNAPSHOT_MEDIUM_MAX = Number(
  process.env.PARTNER_SNAPSHOT_MEDIUM_MAX || 10000
);
const PARTNER_SNAPSHOT_STREAMING_MIN = Number(
  process.env.PARTNER_SNAPSHOT_STREAMING_MIN || 100000
);
const PARTNER_SNAPSHOT_PAYOUT_LAMPORTS = 3;
const PARTNER_SNAPSHOT_BASE_INPUT_LAMPORTS = 10;
const PARTNER_SNAPSHOT_MAX_WINNERS = Number(
  process.env.PARTNER_SNAPSHOT_MAX_WINNERS || 10
);
const resolutionsCache = new Map();
const worldIdNullifiers = new Set();
const RESOLUTIONS_CACHE_TTL_MS = 60_000;
const RESOLUTIONS_VERIFY_TIMEOUT_MS = 5_000;
let tsSdkRegistered = false;
let resolveInlinePromise;
let verifyOutcomePromise;
let snapshotHelpersPromise;
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

async function loadSnapshotHelpers() {
  ensureTsSdkRuntime();
  if (!snapshotHelpersPromise) {
    snapshotHelpersPromise = import(
      pathToFileURL(path.join(REF_ROOT, "sdk", "snapshot.ts")).href
    ).then((module) => {
      const required = [
        "buildSnapshotHash",
        "buildSnapshotManifest",
        "canonicalSnapshotLine",
        "normalizeSnapshotParticipants",
        "inspectSnapshotFile",
      ];
      for (const name of required) {
        if (typeof module[name] !== "function") {
          throw new Error(`snapshot helper export not found: ${name}`);
        }
      }
      return module;
    });
  }
  return snapshotHelpersPromise;
}

async function fetchResolutions(limit, opts = {}) {
  const now = Date.now();
  const cacheKey = `${opts.preferBlessed ? "blessed" : "latest"}:${opts.includeBlessed === false ? "recent-only" : "with-blessed"}:${limit}:${typeof opts.recentLimit === "number" ? opts.recentLimit : "auto"}`;
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
  const includeBlessed = opts.includeBlessed !== false;
  const allSigs = opts.preferBlessed
    ? [...blessedSigs, ...recentSigs]
    : [...recentSigs, ...(includeBlessed ? blessedSigs : [])];

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
        winners_count: verified.winners_count ?? (Array.isArray(verified.outcome_ids) ? verified.outcome_ids.length : 1),
        artifact_format_version: verified.artifact_format_version ?? 1,
        resolution_formula: verified.resolution_formula ?? null,
        target: verified.target ?? null,
        verification_result: verified.status,
        verification_reason: verified.reason,
        runtime_id: verified.runtime_id,
        resolve_id: verified.resolve_id,
        compiled_artifact_hash: verified.compiled_artifact_hash,
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
      draw_enabled: item?.draw_enabled === true,
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

function operatorModeCapability() {
  const walletPath = process.env.LIVE_RAFFLE_WALLET || process.env.ANCHOR_WALLET || null;
  return {
    mode: swigOperatorConfig ? "swig" : "raw_keypair",
    program_id: process.env.LIVE_RAFFLE_PROGRAM_ID || defaultProgramId(),
    swig_address: swigOperatorConfig?.swigAddress || null,
    swig_role_id: swigOperatorConfig?.roleId ?? null,
    wallet_path: swigOperatorConfig ? null : walletPath,
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
  console.log("[WorldID] normalizing proof", JSON.stringify({ worldId, address, configAction: config.action, configEnv: config.environment }));
  if (!worldId || typeof worldId !== "object" || Array.isArray(worldId)) {
    console.error("[WorldID] fail: not object");
    throw httpError(400, "World ID verification failed");
  }
  const protocolVersion = String(worldId.protocol_version || "").trim();
  const isStaging = config.environment === "staging";
  if (!isStaging && protocolVersion !== "4.0") {
    console.error("[WorldID] fail: protocol_version", protocolVersion);
    throw httpError(400, "World ID verification failed");
  }
  if (String(worldId.action || "").trim() !== config.action) {
    console.error("[WorldID] fail: action mismatch", worldId.action, "vs", config.action);
    throw httpError(400, "World ID verification failed");
  }
  const environment = String(worldId.environment || "").trim();
  if (environment && environment !== config.environment) {
    console.error("[WorldID] fail: environment mismatch", environment, "vs", config.environment);
    throw httpError(400, "World ID verification failed");
  }
  const responses = Array.isArray(worldId.responses) ? worldId.responses : [];
  if (!responses.length) {
    console.error("[WorldID] fail: no responses");
    throw httpError(400, "World ID verification failed");
  }
  const expectedSignalHash = String(hashSignal(address)).toLowerCase();
  const hasExpectedSignal = responses.some(
    (responseItem) =>
      String(responseItem?.signal_hash || "").trim().toLowerCase() === expectedSignalHash
  );
  if (!isStaging && !hasExpectedSignal) {
    console.error("[WorldID] fail: signal_hash mismatch, expected", expectedSignalHash, "got", responses.map(r => r?.signal_hash));
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
  const isStaging = config.environment === "staging";

  // Staging uses World ID Simulator (protocol v3).
  // Staging app lives in World ID staging backend — no public remote verify API available.
  // Proof structure is validated locally (action, environment, responses checked above).
  if (isStaging) {
    const response0 = normalized.proof.responses?.[0];
    const nullifier = response0?.nullifier;
    if (!nullifier) {
      console.error("[WorldID] staging: no nullifier in proof");
      throw httpError(400, "World ID verification failed");
    }
    console.log("[WorldID] staging: local proof accepted, nullifier", nullifier);
    return { nullifier: String(nullifier), verification: { success: true, environment: "staging" } };
  }

  const verifyUrl = `${WORLD_VERIFY_URL}/${encodeURIComponent(config.rpId)}`;
  console.log("[WorldID] posting to verifier", verifyUrl);
  let response;
  try {
    response = await fetch(verifyUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "verifiable-outcome-engine/0.3.0" },
      body: JSON.stringify(normalized.proof),
    });
  } catch (err) {
    console.error("[WorldID] fetch error", String(err));
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
    console.error("[WorldID] verify failed", config.environment, response.status, JSON.stringify(payload));
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

function checkPartnerDrawRateLimit(partnerKey) {
  const now = Date.now();
  for (const [key, until] of partnerDrawRateLimit) {
    if (until <= now) partnerDrawRateLimit.delete(key);
  }
  const blockedUntil = partnerDrawRateLimit.get(partnerKey) || 0;
  if (blockedUntil > now) {
    return { ok: false, retryAfterMs: blockedUntil - now };
  }
  partnerDrawRateLimit.set(partnerKey, now + PARTNER_DRAW_RATE_LIMIT_MS);
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

const PARTNER_DRAW_FORMULAS = new Set([
  "weighted_random",
  "rank_desc",
  "rank_asc",
  "first_n",
  "closest_to",
]);
const PARTNER_DRAW_BASE_INPUT_LAMPORTS = 10;
const PARTNER_DRAW_PAYOUT_LAMPORTS = 3;

function buildPartnerDrawConfig(participants, winnersCount, formula, target) {
  const inputLamports = Math.max(
    PARTNER_DRAW_BASE_INPUT_LAMPORTS,
    winnersCount * PARTNER_DRAW_PAYOUT_LAMPORTS
  );
  return {
    type: "formula_draw",
    formula,
    input_lamports: inputLamports,
    payout_lamports: PARTNER_DRAW_PAYOUT_LAMPORTS,
    winners_count: winnersCount,
    ...(target === undefined ? {} : { target }),
    participants,
  };
}

function validatePartnerParticipantId(value, index) {
  const participantId = String(value ?? "").trim();
  if (!participantId) {
    throw httpError(400, `participants[${index}] must be a non-empty string`);
  }
  const byteLength = Buffer.byteLength(participantId, "ascii");
  if (
    byteLength === 0 ||
    byteLength > MAX_PARTNER_PARTICIPANT_ID_BYTES ||
    !PRINTABLE_ASCII_RE.test(participantId)
  ) {
    throw httpError(
      400,
      `participants[${index}] must be printable ASCII <= ${MAX_PARTNER_PARTICIPANT_ID_BYTES} bytes`
    );
  }
  return participantId;
}

function validatePartnerFormula(value) {
  const formula = String(value || "").trim();
  if (!PARTNER_DRAW_FORMULAS.has(formula)) {
    throw httpError(
      400,
      "formula must be weighted_random, rank_desc, rank_asc, first_n, or closest_to"
    );
  }
  return formula;
}

function parsePartnerSignedSafeInteger(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw httpError(400, `${label} must be a signed safe integer`);
  }
  return value;
}

function validatePartnerWeight(value, label) {
  if (!Number.isInteger(value) || value <= 0 || value > 0xffffffff) {
    throw httpError(400, `${label} must be an integer 1–4294967295`);
  }
  return value;
}

function snapshotThresholds() {
  const simpleMax = PARTNER_SNAPSHOT_SIMPLE_MAX;
  const mediumMax = PARTNER_SNAPSHOT_MEDIUM_MAX;
  const streamingMin = PARTNER_SNAPSHOT_STREAMING_MIN;
  if (
    !Number.isInteger(simpleMax) ||
    !Number.isInteger(mediumMax) ||
    !Number.isInteger(streamingMin) ||
    simpleMax < 1 ||
    mediumMax <= simpleMax ||
    streamingMin <= mediumMax
  ) {
    throw new Error("Invalid snapshot threshold configuration");
  }
  return { simpleMax, mediumMax, streamingMin };
}

function classifySnapshotMode(snapshotCount) {
  const { simpleMax, mediumMax, streamingMin } = snapshotThresholds();
  if (snapshotCount <= simpleMax) return "simple";
  if (snapshotCount <= mediumMax) return "medium";
  if (snapshotCount >= streamingMin) return "streaming";
  return "bulk";
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function snapshotSessionDir(sessionId) {
  return path.join(PARTNER_SNAPSHOT_ROOT_DIR, sessionId);
}

function snapshotMetaPath(sessionId) {
  return path.join(snapshotSessionDir(sessionId), "meta.json");
}

function cleanupExpiredSnapshotSessions() {
  ensureDir(PARTNER_SNAPSHOT_ROOT_DIR);
  const now = Date.now();
  for (const entry of fs.readdirSync(PARTNER_SNAPSHOT_ROOT_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(PARTNER_SNAPSHOT_ROOT_DIR, entry.name, "meta.json");
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = readJsonFile(metaPath);
      const createdAtMs = Number(meta.created_at_ms || 0);
      if (createdAtMs > 0 && now - createdAtMs > PARTNER_SNAPSHOT_SESSION_TTL_MS) {
        fs.rmSync(path.join(PARTNER_SNAPSHOT_ROOT_DIR, entry.name), {
          recursive: true,
          force: true,
        });
      }
    } catch (_) {
      // ignore malformed session metadata
    }
  }
}

function createSnapshotSession(partnerKey, label, useCase) {
  cleanupExpiredSnapshotSessions();
  const sessionId = crypto.randomUUID();
  const dir = snapshotSessionDir(sessionId);
  ensureDir(dir);
  const meta = {
    session_id: sessionId,
    partner_key: partnerKey,
    label,
    use_case: useCase || null,
    created_at_ms: Date.now(),
    chunks_received: 0,
    participant_count: 0,
    chunk_indexes: [],
    status: "open",
  };
  writeJsonFile(snapshotMetaPath(sessionId), meta);
  return meta;
}

function loadSnapshotSession(sessionId, partnerKey) {
  const metaPath = snapshotMetaPath(sessionId);
  if (!fs.existsSync(metaPath)) {
    throw httpError(404, "snapshot session not found");
  }
  const meta = readJsonFile(metaPath);
  if (meta.partner_key !== partnerKey) {
    throw httpError(403, "snapshot session belongs to another partner");
  }
  if (meta.status && meta.status !== "open") {
    throw httpError(409, `snapshot session is ${meta.status}`);
  }
  if (Date.now() - Number(meta.created_at_ms || 0) > PARTNER_SNAPSHOT_SESSION_TTL_MS) {
    throw httpError(410, "snapshot session expired");
  }
  return meta;
}

function saveSnapshotSession(meta) {
  writeJsonFile(snapshotMetaPath(meta.session_id), meta);
}

function validateSnapshotChunkParticipant(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw httpError(400, `participants[${index}] must be an object`);
  }
  const participant = {
    id: validatePartnerParticipantId(value.id, index),
  };
  if (value.weight !== undefined) {
    participant.weight = validatePartnerWeight(value.weight, `participants[${index}].weight`);
  }
  if (value.score !== undefined) {
    participant.score = parsePartnerSignedSafeInteger(value.score, `participants[${index}].score`);
  }
  return participant;
}

function snapshotChunkPath(sessionId, chunkIndex) {
  return path.join(snapshotSessionDir(sessionId), `chunk_${String(chunkIndex).padStart(6, "0")}.json`);
}

function listSnapshotChunkIndexes(sessionId) {
  return fs
    .readdirSync(snapshotSessionDir(sessionId))
    .map((name) => {
      const match = name.match(/^chunk_(\d{6})\.json$/);
      return match ? Number(match[1]) : null;
    })
    .filter((value) => value !== null)
    .sort((left, right) => left - right);
}

async function sortSnapshotFile(inputPath, outputPath) {
  await new Promise((resolve, reject) => {
    const child = spawn("sort", [inputPath, "-o", outputPath], {
      cwd: REF_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `sort exited with code ${code}`));
    });
  });
}

function isLocalRpcUrl(rpcUrl) {
  const parsed = new URL(rpcUrl);
  const hostname = parsed.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    isPrivateIp(hostname)
  );
}

function resolveSnapshotRpcUrl() {
  const raw = String(
    process.env.PARTNER_SNAPSHOT_RPC_URL ||
      process.env.LIVE_RAFFLE_RPC_URL ||
      process.env.ANCHOR_PROVIDER_URL ||
      ""
  ).trim();
  if (!raw) {
    throw httpError(
      503,
      "snapshot v4 finalize requires PARTNER_SNAPSHOT_RPC_URL pointing to a local validator or isolated runtime"
    );
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw httpError(400, "PARTNER_SNAPSHOT_RPC_URL must be a valid URL");
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw httpError(400, "PARTNER_SNAPSHOT_RPC_URL must use http or https");
  }
  parsed.hash = "";
  parsed.username = "";
  parsed.password = "";
  const rpcUrl = parsed.toString();
  if (!isLocalRpcUrl(rpcUrl) && process.env.PARTNER_SNAPSHOT_ALLOW_NONLOCAL !== "1") {
    throw httpError(
      503,
      "snapshot v4 finalize is local-only by default; set PARTNER_SNAPSHOT_RPC_URL to localhost or use PARTNER_SNAPSHOT_ALLOW_NONLOCAL=1 with an isolated program id"
    );
  }
  return rpcUrl;
}

function resolveSnapshotProgramId(rpcUrl) {
  const defaultProgram = defaultProgramId();
  const programId = validateProgramId(
    process.env.PARTNER_SNAPSHOT_PROGRAM_ID ||
      process.env.LIVE_RAFFLE_PROGRAM_ID ||
      defaultProgram
  );
  if (!isLocalRpcUrl(rpcUrl) && programId === defaultProgram) {
    throw httpError(
      503,
      "snapshot v4 non-local validation requires a brand new isolated program id; canonical hackathon program is blocked for this path"
    );
  }
  return programId;
}

function buildPartnerSnapshotConfig({
  formula,
  snapshotHash,
  snapshotCount,
  snapshotUri,
  winnersCount,
  target,
}) {
  const inputLamports = Math.max(
    PARTNER_SNAPSHOT_BASE_INPUT_LAMPORTS,
    winnersCount * PARTNER_SNAPSHOT_PAYOUT_LAMPORTS
  );
  return {
    type: "formula_draw_snapshot",
    formula,
    input_lamports: inputLamports,
    payout_lamports: PARTNER_SNAPSHOT_PAYOUT_LAMPORTS,
    winners_count: winnersCount,
    snapshot_hash: snapshotHash,
    snapshot_count: snapshotCount,
    snapshot_uri: snapshotUri,
    ...(target === undefined ? {} : { target }),
  };
}

async function finalizeSnapshotSession({
  sessionMeta,
  formula,
  winnersCount,
  target,
}) {
  const snapshotHelpers = await loadSnapshotHelpers();
  const chunkIndexes = listSnapshotChunkIndexes(sessionMeta.session_id);
  if (chunkIndexes.length === 0) {
    throw httpError(400, "snapshot session has no chunks");
  }
  for (let index = 0; index < chunkIndexes.length; index += 1) {
    if (chunkIndexes[index] !== index) {
      throw httpError(400, "snapshot chunk indexes must be contiguous and start at 0");
    }
  }

  const participantCount = Number(sessionMeta.participant_count || 0);
  if (participantCount < 2) {
    throw httpError(400, "snapshot session must contain at least 2 participants");
  }
  if (winnersCount > participantCount) {
    throw httpError(400, "winners_count must be <= participants length");
  }

  const mode = classifySnapshotMode(participantCount);
  const sessionDir = snapshotSessionDir(sessionMeta.session_id);
  const canonicalPath = path.join(sessionDir, "canonical_snapshot.jsonl");
  if (mode === "simple" || mode === "medium") {
    const collected = [];
    let globalOrder = 0;
    for (const chunkIndex of chunkIndexes) {
      const chunkParticipants = readJsonFile(
        snapshotChunkPath(sessionMeta.session_id, chunkIndex)
      );
      for (const participant of chunkParticipants) {
        collected.push({ ...participant, order: globalOrder });
        globalOrder += 1;
      }
    }
    const built = snapshotHelpers.buildSnapshotHash({
      formula,
      participants: collected,
    });
    fs.writeFileSync(canonicalPath, built.canonicalSnapshot, "utf8");
    return {
      mode,
      snapshotHash: built.snapshotHash,
      snapshotCount: built.snapshotCount,
      canonicalPath,
      manifest: snapshotHelpers.buildSnapshotManifest({
        snapshotHash: built.snapshotHash,
        snapshotCount: built.snapshotCount,
        formula,
        winnersCount,
        snapshotUri: canonicalPath,
        payoutLamports: BigInt(PARTNER_SNAPSHOT_PAYOUT_LAMPORTS),
        ...(target === undefined ? {} : { targetScore: BigInt(target) }),
        thresholdMode: mode === "streaming" ? "streaming" : mode,
      }),
    };
  }

  const unsortedPath = path.join(sessionDir, "canonical_snapshot.unsorted.jsonl");
  const unsortedFd = fs.openSync(unsortedPath, "w");
  let globalOrder = 0;
  try {
    for (const chunkIndex of chunkIndexes) {
      const chunkParticipants = readJsonFile(
        snapshotChunkPath(sessionMeta.session_id, chunkIndex)
      ).map((participant, index) => ({
        ...participant,
        order: globalOrder + index,
      }));
      const normalized = snapshotHelpers.normalizeSnapshotParticipants(
        chunkParticipants,
        formula
      );
      for (const entry of normalized) {
        fs.writeSync(
          unsortedFd,
          snapshotHelpers.canonicalSnapshotLine(entry, formula),
          null,
          "utf8"
        );
      }
      globalOrder += chunkParticipants.length;
    }
  } finally {
    fs.closeSync(unsortedFd);
  }

  await sortSnapshotFile(unsortedPath, canonicalPath);
  const inspected = await snapshotHelpers.inspectSnapshotFile({
    snapshotPath: canonicalPath,
    formula,
    expectedCount: participantCount,
  });
  return {
    mode,
    snapshotHash: inspected.snapshotHash,
    snapshotCount: inspected.snapshotCount,
    canonicalPath,
    manifest: snapshotHelpers.buildSnapshotManifest({
      snapshotHash: inspected.snapshotHash,
      snapshotCount: inspected.snapshotCount,
      formula,
      winnersCount,
      snapshotUri: canonicalPath,
      payoutLamports: BigInt(PARTNER_SNAPSHOT_PAYOUT_LAMPORTS),
      ...(target === undefined ? {} : { targetScore: BigInt(target) }),
      thresholdMode: mode === "streaming" ? "streaming" : mode,
    }),
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

async function handlePartnerDraw(req, res) {
  const partner = requirePartnerApiKey(req, "/api/partner/draw");
  if (!partner.draw_enabled) throw httpError(403, "draw not enabled for this partner");

  const body = await readJsonBody(req);
  const formula = validatePartnerFormula(body.formula);

  if (!Array.isArray(body.participants))
    throw httpError(400, "participants must be an array");
  if (body.participants.length < 2 || body.participants.length > 100)
    throw httpError(400, "participants must contain 2–100 entries");

  const participants = body.participants.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw httpError(400, `participants[${index}] must be an object`);
    }
    const id = validatePartnerParticipantId(value.id, index);
    const participant = { id };

    if (formula === "weighted_random") {
      if (value.score !== undefined) {
        throw httpError(400, `participants[${index}].score is not supported for weighted_random`);
      }
      if (value.weight !== undefined) {
        participant.weight = validatePartnerWeight(
          value.weight,
          `participants[${index}].weight`
        );
      }
      return participant;
    }

    if (value.weight !== undefined) {
      throw httpError(400, `participants[${index}].weight is only supported for weighted_random`);
    }

    if (formula === "first_n") {
      if (value.score !== undefined) {
        throw httpError(400, `participants[${index}].score is not supported for first_n`);
      }
      return participant;
    }

    if (value.score === undefined) {
      throw httpError(400, `participants[${index}].score is required for ${formula}`);
    }
    participant.score = parsePartnerSignedSafeInteger(
      value.score,
      `participants[${index}].score`
    );
    return participant;
  });
  if (new Set(participants.map((participant) => participant.id)).size !== participants.length)
    throw httpError(400, "duplicate participants not allowed");

  const winnersCount = body.winners_count === undefined ? 1 : body.winners_count;
  if (!Number.isInteger(winnersCount) || winnersCount < 1 || winnersCount > 10)
    throw httpError(400, "winners_count must be an integer 1–10");
  if (winnersCount > participants.length)
    throw httpError(400, "winners_count must be <= participants length");

  let target;
  if (formula === "closest_to") {
    if (body.target === undefined) {
      throw httpError(400, "target is required for closest_to");
    }
    target = parsePartnerSignedSafeInteger(body.target, "target");
  } else if (body.target !== undefined) {
    throw httpError(400, "target is only supported for closest_to");
  }

  const rawLabel = body.label !== undefined ? String(body.label).trim().slice(0, 80) : "";
  const label = rawLabel || `partner-draw-${Date.now()}`;

  const VALID_USE_CASES = new Set(["raffle", "airdrop", "competition"]);
  if (body.use_case !== undefined && !VALID_USE_CASES.has(body.use_case))
    throw httpError(400, "use_case must be raffle, airdrop, or competition");

  const rateCheck = checkPartnerDrawRateLimit(partner.key);
  if (!rateCheck.ok) {
    json(res, 429, { ok: false, error: "rate limit exceeded; retry in 60s", retry_after_ms: rateCheck.retryAfterMs });
    return;
  }

  const config = buildPartnerDrawConfig(participants, winnersCount, formula, target);
  const resolveInline = await loadResolveInline();
  const rpcUrl = resolveRpcUrl(process.env.LIVE_RAFFLE_RPC_URL || defaultRpc());
  const programId = validateProgramId(process.env.LIVE_RAFFLE_PROGRAM_ID || defaultProgramId());
  const walletPath = swigOperatorConfig
    ? undefined
    : process.env.LIVE_RAFFLE_WALLET || process.env.ANCHOR_WALLET || undefined;

  let result;
  try {
    result = await withTimeout(
      resolveInline(config, {
        rpcUrl,
        programId,
        walletPath,
        swigWallet: swigOperatorConfig,
        outputDir: PARTNER_DRAW_OUTPUT_DIR,
        label,
      }),
      LIVE_RAFFLE_TIMEOUT_MS,
      "Devnet is slow right now, try again"
    );
  } catch (error) {
    const msg = error?.message || String(error);
    const isTimeout = msg.includes("Devnet is slow");
    json(res, isTimeout ? 504 : 500, { ok: false, error: msg });
    return;
  }

  let artifact_slot = null;
  let resolution_slot = null;
  try {
    const timeline = await fetchTimeline({
      signature: result.signature,
      rpcUrl,
      programId,
      compiledArtifactHash: result.artifactHash,
    });
    artifact_slot = timeline.artifact_slot;
    resolution_slot = timeline.resolution_slot;
  } catch (_) {
    // non-fatal
  }

  json(res, 200, {
    ok: true,
    signature: result.signature,
    outcome_id: result.outcome,
    outcome_ids: result.outcomeIds ?? [result.outcome],
    replay_url: `https://verifiableoutcome.online/verify?sig=${result.signature}`,
    artifact_slot,
    resolution_slot,
  });
}

async function handlePartnerSnapshotInit(req, res) {
  const partner = requirePartnerApiKey(req, "/api/partner/snapshot/init");
  if (!partner.draw_enabled) throw httpError(403, "draw not enabled for this partner");
  const body = await readJsonBody(req);
  const rawLabel = body.label !== undefined ? String(body.label).trim().slice(0, 80) : "";
  const label = rawLabel || `partner-snapshot-${Date.now()}`;
  const VALID_USE_CASES = new Set(["raffle", "airdrop", "competition"]);
  if (body.use_case !== undefined && !VALID_USE_CASES.has(body.use_case)) {
    throw httpError(400, "use_case must be raffle, airdrop, or competition");
  }
  const meta = createSnapshotSession(partner.key, label, body.use_case);
  json(res, 200, {
    ok: true,
    session_id: meta.session_id,
    thresholds: snapshotThresholds(),
    expires_in_ms: PARTNER_SNAPSHOT_SESSION_TTL_MS,
  });
}

async function handlePartnerSnapshotChunk(req, res) {
  const partner = requirePartnerApiKey(req, "/api/partner/snapshot/chunk");
  if (!partner.draw_enabled) throw httpError(403, "draw not enabled for this partner");
  const body = await readJsonBody(req, PARTNER_SNAPSHOT_JSON_BODY_LIMIT_BYTES);
  const sessionId = String(body.session_id || "").trim();
  const chunkIndex = Number(body.chunk_index);
  if (!sessionId) throw httpError(400, "session_id is required");
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw httpError(400, "chunk_index must be a non-negative integer");
  }
  if (!Array.isArray(body.participants)) {
    throw httpError(400, "participants must be an array");
  }
  if (
    body.participants.length === 0 ||
    body.participants.length > PARTNER_SNAPSHOT_CHUNK_MAX_PARTICIPANTS
  ) {
    throw httpError(
      400,
      `participants must contain 1–${PARTNER_SNAPSHOT_CHUNK_MAX_PARTICIPANTS} entries`
    );
  }

  const meta = loadSnapshotSession(sessionId, partner.key);
  if (meta.chunk_indexes.includes(chunkIndex)) {
    throw httpError(409, "chunk_index already uploaded");
  }
  const participants = body.participants.map((participant, index) =>
    validateSnapshotChunkParticipant(participant, index)
  );
  const chunkFile = snapshotChunkPath(sessionId, chunkIndex);
  writeJsonFile(chunkFile, participants);
  meta.chunk_indexes.push(chunkIndex);
  meta.chunk_indexes.sort((left, right) => left - right);
  meta.chunks_received = meta.chunk_indexes.length;
  meta.participant_count = Number(meta.participant_count || 0) + participants.length;
  saveSnapshotSession(meta);

  json(res, 200, {
    ok: true,
    session_id: sessionId,
    chunk_index: chunkIndex,
    participant_count: meta.participant_count,
    mode: classifySnapshotMode(meta.participant_count),
  });
}

async function handlePartnerSnapshotFinalize(req, res) {
  const partner = requirePartnerApiKey(req, "/api/partner/snapshot/finalize");
  if (!partner.draw_enabled) throw httpError(403, "draw not enabled for this partner");
  const body = await readJsonBody(req);
  const sessionId = String(body.session_id || "").trim();
  if (!sessionId) throw httpError(400, "session_id is required");
  const formula = validatePartnerFormula(body.formula);
  const winnersCount = body.winners_count === undefined ? 1 : body.winners_count;
  if (
    !Number.isInteger(winnersCount) ||
    winnersCount < 1 ||
    winnersCount > PARTNER_SNAPSHOT_MAX_WINNERS
  ) {
    throw httpError(
      400,
      `winners_count must be an integer 1–${PARTNER_SNAPSHOT_MAX_WINNERS}`
    );
  }

  let target;
  if (formula === "closest_to") {
    if (body.target === undefined) {
      throw httpError(400, "target is required for closest_to");
    }
    target = parsePartnerSignedSafeInteger(body.target, "target");
  } else if (body.target !== undefined) {
    throw httpError(400, "target is only supported for closest_to");
  }

  const meta = loadSnapshotSession(sessionId, partner.key);
  const finalized = await finalizeSnapshotSession({
    sessionMeta: meta,
    formula,
    winnersCount,
    target,
  });

  const sessionDir = snapshotSessionDir(sessionId);
  const manifestPath = path.join(sessionDir, "manifest.json");
  writeJsonFile(manifestPath, finalized.manifest);
  const config = buildPartnerSnapshotConfig({
    formula,
    snapshotHash: finalized.snapshotHash,
    snapshotCount: finalized.snapshotCount,
    snapshotUri: finalized.canonicalPath,
    winnersCount,
    target,
  });

  const resolveInline = await loadResolveInline();
  const rpcUrl = resolveSnapshotRpcUrl();
  const programId = resolveSnapshotProgramId(rpcUrl);
  const walletPath = swigOperatorConfig
    ? undefined
    : process.env.PARTNER_SNAPSHOT_WALLET ||
      process.env.LIVE_RAFFLE_WALLET ||
      process.env.ANCHOR_WALLET ||
      undefined;
  const result = await resolveInline(config, {
    rpcUrl,
    programId,
    walletPath,
    swigWallet: swigOperatorConfig,
    outputDir: sessionDir,
    label: meta.label || `partner-snapshot-${Date.now()}`,
  });

  meta.status = "finalized";
  meta.formula = formula;
  meta.winners_count = winnersCount;
  meta.snapshot_hash = finalized.snapshotHash;
  meta.snapshot_count = finalized.snapshotCount;
  meta.snapshot_uri = finalized.canonicalPath;
  meta.manifest_path = manifestPath;
  meta.mode = finalized.mode;
  meta.signature = result.signature;
  saveSnapshotSession(meta);

  json(res, 200, {
    ok: true,
    session_id: sessionId,
    signature: result.signature,
    outcome_id: result.outcome,
    outcome_ids: result.outcomeIds ?? [result.outcome],
    replay_url: `https://verifiableoutcome.online/verify?sig=${result.signature}`,
    snapshot_hash: finalized.snapshotHash,
    snapshot_count: finalized.snapshotCount,
    snapshot_uri: finalized.canonicalPath,
    manifest_uri: manifestPath,
    mode: finalized.mode,
    thresholds: snapshotThresholds(),
  });
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
        operator: operatorModeCapability(),
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

    if (req.method === "GET" && pathname === "/api/recent-resolutions") {
      enforceApiRateLimit(req, pathname);
      const reqUrl = new URL(req.url || "/", "http://localhost");
      const rawLimit = reqUrl.searchParams.get("limit");
      const limit = rawLimit
        ? Math.min(Math.max(1, parseInt(rawLimit, 10) || 6), 20)
        : 6;
      const resolutions = await fetchResolutions(limit, {
        preferBlessed: false,
        includeBlessed: false,
        recentLimit: Math.max(limit * 3, 12),
      });
      json(res, 200, {
        ok: true,
        resolutions: resolutions.map((r) => ({
          signature: r.signature,
          outcome_id: r.outcome_id,
          outcome_ids: r.outcome_ids ?? [r.outcome_id],
          winners_count: r.winners_count ?? 1,
          artifact_format_version: r.artifact_format_version ?? 1,
          resolution_formula: r.resolution_formula ?? null,
          target: r.target ?? null,
          verification_result: r.verification_result ?? "MATCH",
          verification_reason: r.verification_reason ?? "OK",
          runtime_id: r.runtime_id,
          resolve_id: r.resolve_id,
          compiled_artifact_hash: r.compiled_artifact_hash,
          participants_count: r.participants_count,
          commit_slot: r.commit_slot,
          resolve_slot: r.resolve_slot,
          source: "historical",
        })),
      });
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

    if (req.method === "POST" && pathname === "/api/partner/snapshot/init") {
      await handlePartnerSnapshotInit(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/partner/snapshot/chunk") {
      await handlePartnerSnapshotChunk(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/partner/snapshot/finalize") {
      await handlePartnerSnapshotFinalize(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/partner/draw") {
      await handlePartnerDraw(req, res);
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
