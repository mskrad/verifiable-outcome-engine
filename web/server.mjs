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
  // public /examples page — keyless demo draws, rate limited per IP
  "/api/examples/draw",
  "/api/partner/snapshot/init",
  "/api/partner/snapshot/chunk",
  "/api/partner/snapshot/finalize",
  // sortition (canonical resolution path)
  "/api/partner/sortition/draw",
  "/api/partner/sortition/register",
  "/api/partner/sortition/seal",
  "/api/partner/sortition/claim",
  // conditions (fc7/fv9) — public one-call scoring demo
  "/api/conditions/score",
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
const PARTNER_SNAPSHOT_SIGNATURE_DIR = path.join(
  PARTNER_SNAPSHOT_ROOT_DIR,
  "by-signature"
);
const IRYS_GATEWAY_BASE_URL = "https://gateway.irys.xyz";
const WORLD_VERIFY_URL =
  process.env.WORLD_VERIFY_URL || "https://developer.world.org/api/v4/verify";
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
const examplesDrawRateLimit = new Map(); // ip → blockedUntil ms
const apiRateLimit = new Map();
const PARTNER_DRAW_RATE_LIMIT_MS = 10_000;
// /examples runs every visitor through one shared demo key, so the throttle has
// to be per-IP — a per-key limit would let one clicker lock out the whole page.
const EXAMPLES_DRAW_RATE_LIMIT_MS = Number(
  process.env.EXAMPLES_DRAW_RATE_LIMIT_MS || 15_000
);
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
let artifactBuilderPromise;
let sortitionOpsPromise;
let conditionsOpsPromise;
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

function isCorsApiPath(pathname) {
  return (
    CORS_API_PATHS.has(pathname) ||
    /^\/api\/partner\/draw\/[^/]+\/proof$/.test(pathname)
  );
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

// Permanent moves of public pages. /showcase was the pre-design-system demo page;
// its live scenarios now live on /examples.
const STATIC_REDIRECTS = new Map([
  ["/showcase", "/examples"],
  ["/showcase.html", "/examples"],
]);

function sendStatic(req, res, pathname) {
  const redirectTo = STATIC_REDIRECTS.get(pathname);
  if (redirectTo) {
    res.writeHead(301, { location: redirectTo });
    res.end();
    return;
  }
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
        "buildOutcomeStandardV12SnapshotManifest",
        "buildOutcomeStandardV12ProofManifest",
        "buildSnapshotMerkleProofFromFile",
        "canonicalSnapshotLine",
        "buildMerkleRoot",
        "hashSnapshotLeafLine",
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

async function loadArtifactBuilder() {
  ensureTsSdkRuntime();
  if (!artifactBuilderPromise) {
    artifactBuilderPromise = import(
      pathToFileURL(path.join(REF_ROOT, "sdk", "artifact.ts")).href
    ).then((module) => {
      if (typeof module.buildArtifact !== "function") {
        throw new Error("artifact builder export not found");
      }
      return module.buildArtifact;
    });
  }
  return artifactBuilderPromise;
}

// sortition (v1.4.0/v1.4.1) inline ops — canonical resolution path.
// Defaults to the canonical program id (overridable via SORTITION_PROGRAM_ID).
async function loadSortitionOps() {
  ensureTsSdkRuntime();
  if (!sortitionOpsPromise) {
    sortitionOpsPromise = import(
      pathToFileURL(path.join(REF_ROOT, "sdk", "sortition.ts")).href
    ).then((module) => {
      const required = [
        "createSortitionClient",
        "sortitionCreateDrawInline",
        "sortitionRegisterTicketInline",
        "sortitionSealDrawInline",
        "sortitionClaimTicketInline",
        "SORTITION_PROGRAM_ID",
        "SORTITION_MATURITY",
      ];
      for (const name of required) {
        if (module[name] === undefined) {
          throw new Error(`sortition export not found: ${name}`);
        }
      }
      return module;
    });
  }
  return sortitionOpsPromise;
}

// conditions (fc7/fv9) scoring — OddSol partner integration. Off-chain deterministic
// scorer that matches on-chain `resolve_conditions` bit-for-bit.
async function loadConditionsOps() {
  ensureTsSdkRuntime();
  if (!conditionsOpsPromise) {
    conditionsOpsPromise = import(
      pathToFileURL(path.join(REF_ROOT, "sdk", "conditions.ts")).href
    ).then((module) => {
      for (const name of [
        "buildConditionsArtifact",
        "parseConditionsArtifact",
        "resolveConditionsArtifact",
        "scoreSlip",
        "rankRound",
        "slipHash",
        "NO_LINE",
        "FORMAT_VERSION_CONDITIONS",
        "FORMULA_CODE_CONDITIONS",
      ]) {
        if (module[name] === undefined) {
          throw new Error(`conditions export not found: ${name}`);
        }
      }
      return module;
    });
  }
  return conditionsOpsPromise;
}

function conditionsWalletBytes(value, label) {
  if (typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, "hex");
  }
  try {
    return new PublicKey(String(value)).toBuffer();
  } catch {
    throw httpError(400, `${label} must be a base58 pubkey or 32-byte hex`);
  }
}

function conditionsRoot32(value) {
  if (value === undefined || value === null) return Buffer.alloc(32);
  if (typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, "hex");
  }
  throw httpError(400, "event_stat_root must be 32-byte hex");
}

// A u64 bigint → number when it fits MAX_SAFE_INTEGER, else a decimal string (lossless).
function bigToJson(v) {
  return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
}

// POST /api/conditions/score — public, off-chain, no key/wallet. The one-call
// integration demo: send slips (committed conditions + odds) + proven facts, get back a
// verifiable per-entrant score S, the round ranking, per-slip commitment hashes, and the
// exact fc7 artifact bytes that on-chain `resolve_conditions` would recompute to MATCH.
async function handleConditionsScore(req, res) {
  const c = await loadConditionsOps();
  const body = await readJsonBody(req);
  if (!Array.isArray(body.fixtures) || !Array.isArray(body.entrants)) {
    throw httpError(400, "body must be { fixtures: [...], entrants: [...] }");
  }
  const fixtures = body.fixtures.map((f, i) => ({
    fixtureId: Number(f.fixture_id ?? i),
    eventStatRoot: conditionsRoot32(f.event_stat_root),
    stats: (f.stats || []).map((s) => ({ statKey: Number(s.stat_key), value: Number(s.value) })),
  }));
  const entrants = body.entrants.map((e, i) => ({
    wallet: conditionsWalletBytes(e.wallet, `entrants[${i}].wallet`),
    tier: BigInt(e.tier ?? 0),
    enteredAt: BigInt(e.entered_at ?? 0),
    legs: (e.legs || []).map((l) => ({
      termKind: Number(l.term_kind ?? 1),
      statKeyA: Number(l.stat_key_a),
      statKeyB: Number(l.stat_key_b ?? 0),
      op: Number(l.op),
      comparison: Number(l.comparison),
      threshold: Number(l.threshold ?? 0),
      lineX2: l.line_x2 === undefined || l.line_x2 === null ? c.NO_LINE : Number(l.line_x2),
      oddsMilli: Number(l.odds_milli),
    })),
    fixtureIndex: (e.fixture_index || []).map(Number),
  }));

  const bytes = c.buildConditionsArtifact(fixtures, entrants);
  const parsed = c.parseConditionsArtifact(bytes); // roundtrip sanity
  // Rank with each entrant's slip_hash carried through by identity — two slips from the same
  // wallet must each keep their own hash (a wallet-keyed map would collide to the last one).
  const ranked = c.rankRound(
    parsed.entrants.map((e) => {
      const factsByLeg = e.fixtureIndex.map((fi) => parsed.fixtures[fi]?.stats ?? []);
      const s = c.scoreSlip(e.legs, factsByLeg);
      return {
        wallet: e.wallet,
        enteredAt: e.enteredAt,
        scoreFixed: s.scoreFixed,
        allHit: s.allHit,
        voidCount: s.voidCount,
        settled: s.settled,
        slipHash: c.slipHash(e.wallet, e.tier, e.legs).toString("hex"),
      };
    })
  );
  const artifactHash = crypto.createHash("sha256").update(bytes).digest("hex");

  const winners = ranked.filter((r) => r.allHit);
  json(res, 200, {
    ok: true,
    formula: "conditions",
    formula_code: c.FORMULA_CODE_CONDITIONS,
    format_version: c.FORMAT_VERSION_CONDITIONS,
    program_id: defaultProgramId(),
    maturity: "canonical-devnet",
    maturity_note:
      "Off-chain deterministic conditions scoring — bit-for-bit identical to on-chain resolve_conditions. OddSol partner integration (WIP); payout is pro-rata over winners and executed by the partner, not by VRE.",
    winners_count: winners.length,
    // scoreFixed is a u64 bigint; emit as a JS number when it fits (realistic coefficients do),
    // else as a decimal string — never lose precision silently.
    winning_score_sum: bigToJson(winners.reduce((sum, r) => sum + r.scoreFixed, 0n)),
    ranking: ranked.map((r, idx) => {
      const wallet = new PublicKey(r.wallet).toBase58();
      return {
        rank: idx + 1,
        wallet,
        all_hit: r.allHit,
        score: Number(r.scoreFixed) / 10000,
        score_fixed: bigToJson(r.scoreFixed),
        void_count: r.voidCount,
        settled: r.settled,
        slip_hash: r.slipHash,
      };
    }),
    artifact: {
      hash: artifactHash,
      bytes: bytes.length,
      hex: bytes.toString("hex"),
    },
  });
}

// ---- conditions VRE-operated on-chain flow (OddSol partner endpoints) ----
// commit anchors the rules on-chain (VRE key); resolve builds the full artifact + resolve_conditions
// (VRE key). Partner calls the API only — no partner key on-chain, no deploy, no approve on their side.

const CONDITIONS_NO_LINE = -2147483648; // i32::MIN sentinel (must match sdk/conditions.ts NO_LINE)
const CONDITIONS_STORE_PATH =
  process.env.CONDITIONS_STORE_PATH || path.join(REF_ROOT, "data", "conditions_commits.json");

function conditionsFixturesFromBody(list, requireStats) {
  if (!Array.isArray(list)) throw httpError(400, "fixtures must be an array");
  return list.map((f, i) => ({
    fixtureId: Number(f.fixture_id ?? i),
    eventStatRoot: conditionsRoot32(f.event_stat_root),
    stats: requireStats
      ? (Array.isArray(f.stats) ? f.stats : []).map((s) => ({ statKey: Number(s.stat_key), value: Number(s.value) }))
      : [],
  }));
}

function conditionsEntrantsFromBody(list) {
  if (!Array.isArray(list)) throw httpError(400, "entrants must be an array");
  return list.map((e, i) => ({
    wallet: conditionsWalletBytes(e.wallet, `entrants[${i}].wallet`),
    tier: BigInt(e.tier ?? 0),
    enteredAt: BigInt(e.entered_at ?? 0),
    legs: (Array.isArray(e.legs) ? e.legs : []).map((l) => ({
      termKind: Number(l.term_kind ?? 1),
      statKeyA: Number(l.stat_key_a),
      statKeyB: Number(l.stat_key_b ?? 0),
      op: Number(l.op),
      comparison: Number(l.comparison),
      threshold: Number(l.threshold ?? 0),
      lineX2: l.line_x2 === undefined || l.line_x2 === null ? CONDITIONS_NO_LINE : Number(l.line_x2),
      oddsMilli: Number(l.odds_milli),
    })),
    fixtureIndex: (Array.isArray(e.fixture_index) ? e.fixture_index : []).map(Number),
  }));
}

function loadConditionsCommits() {
  try {
    return JSON.parse(fs.readFileSync(CONDITIONS_STORE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveConditionsCommit(roundId, entry) {
  const store = loadConditionsCommits();
  store[roundId] = entry;
  fs.mkdirSync(path.dirname(CONDITIONS_STORE_PATH), { recursive: true });
  fs.writeFileSync(CONDITIONS_STORE_PATH, JSON.stringify(store, null, 2));
}

let conditionsOperatorModPromise;
async function loadConditionsOperator() {
  ensureTsSdkRuntime();
  if (!conditionsOperatorModPromise) {
    conditionsOperatorModPromise = import(
      pathToFileURL(path.join(REF_ROOT, "sdk", "conditions_operator.ts")).href
    );
  }
  const mod = await conditionsOperatorModPromise;
  const walletPath = process.env.CONDITIONS_OPERATOR_WALLET || process.env.ANCHOR_WALLET || "";
  if (!walletPath) {
    throw httpError(503, "Conditions operator not configured (set CONDITIONS_OPERATOR_WALLET)");
  }
  const idl = JSON.parse(fs.readFileSync(path.join(REF_ROOT, "artifacts", "outcome_idl.json"), "utf8"));
  const rpcUrl = resolveRpcUrl(process.env.CONDITIONS_RPC_URL || defaultRpc());
  const op = mod.createConditionsOperator({ rpcUrl, walletPath, programId: defaultProgramId(), idl });
  return { mod, op };
}

// POST /api/partner/conditions/commit — anchor the round rules on-chain (VRE key), before outcome.
async function handlePartnerConditionsCommit(req, res) {
  requirePartnerApiKey(req, "/api/partner/conditions/commit");
  const body = await readJsonBody(req);
  const roundId = String(body.round_id || "").trim();
  if (!roundId) throw httpError(400, "round_id is required");
  const fixtures = conditionsFixturesFromBody(body.fixtures, false);
  const entrants = conditionsEntrantsFromBody(body.entrants);
  const { mod, op } = await loadConditionsOperator();
  const result = await mod.commitConditions(op, { fixtures, entrants });
  saveConditionsCommit(roundId, {
    round_id: roundId,
    commitment_ref: result.commitmentRef,
    fixtures: body.fixtures,
    entrants: body.entrants,
    committed_at_slot: result.committedAtSlot,
    created_utc: new Date().toISOString(),
  });
  json(res, 200, {
    ok: true,
    round_id: roundId,
    commitment_ref: result.commitmentRef,
    conditions_hash: result.conditionsHash,
    commit_signature: result.commitSignature,
    committed_at_slot: result.committedAtSlot,
    program_id: defaultProgramId(),
  });
}

// POST /api/partner/conditions/resolve — reveal facts, resolve on-chain (VRE key), return signature.
async function handlePartnerConditionsResolve(req, res) {
  requirePartnerApiKey(req, "/api/partner/conditions/resolve");
  const body = await readJsonBody(req);
  const roundId = body.round_id ? String(body.round_id).trim() : "";
  const stored = roundId ? loadConditionsCommits()[roundId] : null;
  if (!stored) throw httpError(404, "unknown round_id — commit the rules first");

  // Merge revealed facts (event_stat_root + stats, keyed by fixture_id) onto the committed skeleton.
  const revealed = new Map();
  for (const f of Array.isArray(body.fixtures) ? body.fixtures : []) {
    revealed.set(Number(f.fixture_id), f);
  }
  const mergedFixtures = (stored.fixtures || []).map((f, i) => {
    const rf = revealed.get(Number(f.fixture_id ?? i)) || {};
    return {
      fixture_id: f.fixture_id ?? i,
      event_stat_root: rf.event_stat_root ?? f.event_stat_root,
      stats: rf.stats ?? [],
    };
  });
  const fixtures = conditionsFixturesFromBody(mergedFixtures, true);
  const entrants = conditionsEntrantsFromBody(stored.entrants);
  const { mod, op } = await loadConditionsOperator();
  const result = await mod.resolveConditionsRound(op, { fixtures, entrants, commitmentRef: stored.commitment_ref });
  json(res, 200, {
    ok: true,
    round_id: roundId,
    signature: result.signature,
    verify_url: `https://verifiableoutcome.online/verify?sig=${result.signature}`,
    program_id: defaultProgramId(),
    winners_count: result.winnersCount,
    winning_score_sum: result.winningScoreSum,
    winners: result.winners,
    ranking: result.ranking,
    artifact: { hash: result.artifactHash, bytes: result.artifactBytes, hex: result.artifactHex },
    runtime_id: result.runtimeId,
    winners_digest: result.winnersDigest,
    facts_ref_root: result.factsRefRoot,
  });
}

async function fetchResolutions(limit, opts = {}) {
  const now = Date.now();
  const cacheKey = `${opts.preferBlessed ? "blessed" : "latest"}:${opts.includeBlessed === false ? "recent-only" : "with-blessed"}:${limit}:${typeof opts.recentLimit === "number" ? opts.recentLimit : "auto"}`;
  const cached = resolutionsCache.get(cacheKey);
  if (cached && cached.expireAt > now) return cached.data;

  const rpcUrl = defaultRpc();
  const programId = defaultProgramId();
  const verifyOutcome = await loadVerifyOutcome();

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
        } catch (err) {
          console.warn(`[resolutions] unable to fetch slot for ${sigEntry.signature}:`, err);
        }
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
    return { nullifier: String(nullifier), verification: { success: true, environment: "staging" } };
  }

  if (!WORLD_VERIFY_URL) {
    throw httpError(500, "World ID verifier URL is not configured");
  }
  const verifyUrl = `${WORLD_VERIFY_URL}/${encodeURIComponent(config.rpId)}`;
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

function checkExamplesDrawRateLimit(req) {
  const ip = clientIp(req);
  const now = Date.now();
  for (const [key, until] of examplesDrawRateLimit) {
    if (until <= now) examplesDrawRateLimit.delete(key);
  }
  const blockedUntil = examplesDrawRateLimit.get(ip) || 0;
  if (blockedUntil > now) {
    return { ok: false, retryAfterMs: blockedUntil - now };
  }
  examplesDrawRateLimit.set(ip, now + EXAMPLES_DRAW_RATE_LIMIT_MS);
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
    type: "formula_draw_v5",
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

function validateSnapshotProofAddress(value) {
  const participantId = String(value ?? "").trim();
  if (!participantId) {
    throw httpError(400, "address is required");
  }
  const byteLength = Buffer.byteLength(participantId, "ascii");
  if (
    byteLength === 0 ||
    byteLength > MAX_PARTNER_PARTICIPANT_ID_BYTES ||
    !PRINTABLE_ASCII_RE.test(participantId)
  ) {
    throw httpError(
      400,
      `address must be printable ASCII <= ${MAX_PARTNER_PARTICIPANT_ID_BYTES} bytes`
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

function snapshotSignatureIndexPath(signature) {
  return path.join(PARTNER_SNAPSHOT_SIGNATURE_DIR, `${signature}.json`);
}

function writeSnapshotSignatureIndex(meta) {
  if (!meta?.signature) return;
  ensureDir(PARTNER_SNAPSHOT_SIGNATURE_DIR);
  writeJsonFile(snapshotSignatureIndexPath(meta.signature), {
    session_id: meta.session_id,
    signature: meta.signature,
    updated_at_ms: Date.now(),
  });
}

function loadSnapshotSessionBySignature(signature) {
  const filePath = snapshotSignatureIndexPath(signature);
  if (fs.existsSync(filePath)) {
    const record = readJsonFile(filePath);
    const metaPath = snapshotMetaPath(String(record.session_id || ""));
    if (fs.existsSync(metaPath)) {
      return readJsonFile(metaPath);
    }
  }

  cleanupExpiredSnapshotSessions();
  for (const entry of fs.readdirSync(PARTNER_SNAPSHOT_ROOT_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "by-signature") continue;
    const metaPath = path.join(PARTNER_SNAPSHOT_ROOT_DIR, entry.name, "meta.json");
    if (!fs.existsSync(metaPath)) continue;
    const meta = readJsonFile(metaPath);
    if (meta.signature === signature) {
      writeSnapshotSignatureIndex(meta);
      return meta;
    }
  }
  throw httpError(404, "snapshot draw proof not found");
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
      "scale snapshot finalize requires PARTNER_SNAPSHOT_RPC_URL pointing to a local validator or isolated runtime"
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
      "scale snapshot finalize is local-only by default; set PARTNER_SNAPSHOT_RPC_URL to localhost or use PARTNER_SNAPSHOT_ALLOW_NONLOCAL=1 with an isolated program id"
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
      "scale snapshot non-local validation requires a brand new isolated program id; canonical hackathon program is blocked for this path"
    );
  }
  return programId;
}

function buildPartnerSnapshotConfig({
  formula,
  snapshotHash,
  snapshotCount,
  snapshotUri,
  merkleRoot,
  winnersCount,
  target,
}) {
  const inputLamports = Math.max(
    PARTNER_SNAPSHOT_BASE_INPUT_LAMPORTS,
    winnersCount * PARTNER_SNAPSHOT_PAYOUT_LAMPORTS
  );
  return {
    type: "outcome_standard_v1_2",
    formula,
    input_lamports: inputLamports,
    payout_lamports: PARTNER_SNAPSHOT_PAYOUT_LAMPORTS,
    winners_count: winnersCount,
    snapshot_hash: snapshotHash,
    snapshot_count: snapshotCount,
    snapshot_uri: snapshotUri,
    ...(merkleRoot === undefined ? {} : { merkle_root: merkleRoot }),
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
      merkleRoot: built.merkleRoot,
      canonicalPath,
      manifest: snapshotHelpers.buildOutcomeStandardV12SnapshotManifest({
        snapshotHash: built.snapshotHash,
        snapshotCount: built.snapshotCount,
        formula,
        winnersCount,
        snapshotUri: canonicalPath,
        merkleRoot: built.merkleRoot,
        payoutLamports: BigInt(PARTNER_SNAPSHOT_PAYOUT_LAMPORTS),
        ...(target === undefined ? {} : { targetScore: BigInt(target) }),
        thresholdMode: mode === "streaming" ? "streaming" : mode,
        publicationStatus: "pending",
        proofStatus: "pending",
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
    merkleRoot: inspected.merkleRoot,
    canonicalPath,
    manifest: snapshotHelpers.buildOutcomeStandardV12SnapshotManifest({
      snapshotHash: inspected.snapshotHash,
      snapshotCount: inspected.snapshotCount,
      formula,
      winnersCount,
      snapshotUri: canonicalPath,
      merkleRoot: inspected.merkleRoot,
      payoutLamports: BigInt(PARTNER_SNAPSHOT_PAYOUT_LAMPORTS),
      ...(target === undefined ? {} : { targetScore: BigInt(target) }),
      thresholdMode: mode === "streaming" ? "streaming" : mode,
      publicationStatus: "pending",
      proofStatus: "pending",
    }),
  };
}

function buildSnapshotProofManifest({
  signature,
  programId,
  finalized,
  outcomeIds,
  formula,
  target,
  manifestPath,
}) {
  return {
    version: "outcome_standard_proof_manifest_v1",
    standard_version: "1.2",
    standard_kind: "scale_snapshot",
    signature,
    program_id: programId,
    snapshot_hash: finalized.snapshotHash,
    snapshot_count: finalized.snapshotCount,
    snapshot_uri: finalized.canonicalPath,
    merkle_root: finalized.merkleRoot,
    formula,
    winners_count: outcomeIds.length,
    selected_ids: outcomeIds,
    entry_hash_scheme: "sha256d_canonical_named_entry_v1",
    merkle_hash_scheme: "sha256_pair_v1",
    snapshot_manifest_uri: manifestPath,
    proof_endpoint_template:
      "/api/partner/draw/:sig/proof?address=<wallet>",
    publication_status: "pending",
    publication_url: null,
    proof_status: "pending",
    ...(target === undefined ? {} : { target: String(target) }),
  };
}

function resolveIrysPublicationConfig() {
  return {
    enabled: process.env.PARTNER_SNAPSHOT_IRYS_ENABLED !== "0",
    privateKey: String(process.env.PARTNER_SNAPSHOT_IRYS_PRIVATE_KEY || "").trim(),
    network: String(process.env.PARTNER_SNAPSHOT_IRYS_NETWORK || "devnet")
      .trim()
      .toLowerCase(),
    providerUrl: String(
      process.env.PARTNER_SNAPSHOT_IRYS_PROVIDER_URL ||
        process.env.LIVE_RAFFLE_RPC_URL ||
        process.env.ANCHOR_PROVIDER_URL ||
        ""
    ).trim(),
  };
}

function buildIrysGatewayUrl(id, fileName = "") {
  const base = `${IRYS_GATEWAY_BASE_URL}/${id}`;
  return fileName ? `${base}/${fileName}` : base;
}

async function publishSnapshotBundleToIrys(bundleDir) {
  const config = resolveIrysPublicationConfig();
  if (!config.enabled) {
    return { publicationStatus: "skipped_disabled", irysUrl: null, proofManifestUrl: null };
  }
  if (!config.privateKey) {
    return {
      publicationStatus: "skipped_unconfigured",
      irysUrl: null,
      proofManifestUrl: null,
      publicationError: "PARTNER_SNAPSHOT_IRYS_PRIVATE_KEY is not configured",
    };
  }
  if (config.network === "devnet" && !config.providerUrl) {
    return {
      publicationStatus: "skipped_unconfigured",
      irysUrl: null,
      proofManifestUrl: null,
      publicationError: "PARTNER_SNAPSHOT_IRYS_PROVIDER_URL is required for Irys devnet uploads",
    };
  }

  let Uploader;
  let Solana;
  try {
    ({ Uploader } = await import("@irys/upload"));
    ({ Solana } = await import("@irys/upload-solana"));
  } catch (error) {
    return {
      publicationStatus: "failed_missing_sdk",
      irysUrl: null,
      proofManifestUrl: null,
      publicationError: error?.message || String(error),
    };
  }

  try {
    let uploaderPromise = Uploader(Solana).withWallet(config.privateKey);
    if (config.network === "devnet") {
      uploaderPromise = uploaderPromise.withRpc(config.providerUrl).devnet();
    } else if (config.providerUrl) {
      uploaderPromise = uploaderPromise.withRpc(config.providerUrl);
    }
    const uploader = await uploaderPromise;
    const receipt = await uploader.uploadFolder(bundleDir, {
      indexFile: "manifest.json",
      batchSize: 10,
      keepDeleted: false,
    });
    const manifestId = receipt?.manifestId || receipt?.id;
    if (!manifestId) {
      throw new Error("Irys upload did not return manifestId");
    }
    return {
      publicationStatus: "published",
      irysUrl: buildIrysGatewayUrl(manifestId, "canonical_snapshot.jsonl"),
      proofManifestUrl: buildIrysGatewayUrl(manifestId, "proof_manifest.json"),
      manifestUrl: buildIrysGatewayUrl(manifestId),
      irys_manifest_id: manifestId,
      irys_receipt_id: receipt?.id || null,
    };
  } catch (error) {
    return {
      publicationStatus: "failed",
      irysUrl: null,
      proofManifestUrl: null,
      publicationError: error?.message || String(error),
    };
  }
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

// opts.demoKey — server-side partner key used by the keyless /api/examples/draw route.
// When set, the request carries no x-api-key and the per-partner draw rate limit is skipped:
// the demo partner is shared by every visitor, so /examples throttles per IP instead.
async function handlePartnerDraw(req, res, opts = {}) {
  const demoKey = String(opts.demoKey || "").trim();
  let partner;
  if (demoKey) {
    if (!partnerConfig?.configured) throw httpError(503, "Partner API not configured");
    partner = partnerConfig.partnersByKey.get(demoKey);
    if (!partner) throw httpError(503, "demo draws are not configured");
  } else {
    partner = requirePartnerApiKey(req, "/api/partner/draw");
  }
  if (!partner.draw_enabled) throw httpError(403, "draw not enabled for this partner");

  const body = await readJsonBody(req);
  const formula = validatePartnerFormula(body.formula);

  if (!Array.isArray(body.participants))
    throw httpError(400, "participants must be an array");
  if (body.participants.length < 2)
    throw httpError(400, "participants must contain at least 2 entries");

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

  const wantsScale =
    body.mode === "scale" ||
    body.scale === true ||
    body.public_proof === true ||
    body.standard_version === "1.2";
  if (wantsScale) {
    json(res, 409, {
      ok: false,
      standard_version: "1.2",
      route: "scale_snapshot",
      error:
        "This draw requires the Outcome Standard V1.2 snapshot flow. Use /api/partner/snapshot/init, /api/partner/snapshot/chunk, and /api/partner/snapshot/finalize.",
      endpoints: [
        "/api/partner/snapshot/init",
        "/api/partner/snapshot/chunk",
        "/api/partner/snapshot/finalize",
      ],
    });
    return;
  }

  if (!demoKey) {
    const rateCheck = checkPartnerDrawRateLimit(partner.key);
    if (!rateCheck.ok) {
      json(res, 429, { ok: false, error: "rate limit exceeded; retry in 60s", retry_after_ms: rateCheck.retryAfterMs });
      return;
    }
  }

  const config = buildPartnerDrawConfig(participants, winnersCount, formula, target);
  const buildArtifact = await loadArtifactBuilder();
  try {
    buildArtifact(config);
  } catch (error) {
    const message = error?.message || String(error);
    if (message.includes("route larger draws")) {
      json(res, 413, {
        ok: false,
        standard_version: "1.2",
        route: "scale_snapshot",
        error:
          "Compact Outcome Standard V1.1 artifact exceeds byte limits. Use the Outcome Standard V1.2 snapshot flow.",
        failure_reason: message,
        endpoints: [
          "/api/partner/snapshot/init",
          "/api/partner/snapshot/chunk",
          "/api/partner/snapshot/finalize",
        ],
      });
      return;
    }
    throw error;
  }
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
  const proofManifestPath = path.join(sessionDir, "proof_manifest.json");
  writeJsonFile(manifestPath, finalized.manifest);
  const config = buildPartnerSnapshotConfig({
    formula,
    snapshotHash: finalized.snapshotHash,
    snapshotCount: finalized.snapshotCount,
    snapshotUri: finalized.canonicalPath,
    merkleRoot: finalized.merkleRoot,
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
  const outcomeIds = result.outcomeIds ?? [result.outcome];
  let proofManifest = buildSnapshotProofManifest({
    signature: result.signature,
    programId,
    finalized,
    outcomeIds,
    formula,
    target,
    manifestPath,
  });
  writeJsonFile(proofManifestPath, proofManifest);

  const bundleDir = path.join(sessionDir, "publication_bundle");
  ensureDir(bundleDir);
  fs.copyFileSync(finalized.canonicalPath, path.join(bundleDir, "canonical_snapshot.jsonl"));
  fs.copyFileSync(manifestPath, path.join(bundleDir, "manifest.json"));
  fs.copyFileSync(proofManifestPath, path.join(bundleDir, "proof_manifest.json"));

  const publication = await publishSnapshotBundleToIrys(bundleDir);
  finalized.manifest = {
    ...finalized.manifest,
    proof_manifest_url: publication.proofManifestUrl || proofManifestPath,
    publication_url: publication.irysUrl || null,
    publication_status: publication.publicationStatus,
    ...(publication.publicationError
      ? { publication_error: publication.publicationError }
      : {}),
    proof_status: "ready",
  };
  writeJsonFile(manifestPath, finalized.manifest);
  proofManifest = {
    ...proofManifest,
    publication_url: publication.irysUrl || null,
    proof_manifest_url: publication.proofManifestUrl || proofManifestPath,
    publication_status: publication.publicationStatus,
    ...(publication.publicationError
      ? { publication_error: publication.publicationError }
      : {}),
    proof_status: "ready",
  };
  writeJsonFile(proofManifestPath, proofManifest);
  fs.copyFileSync(manifestPath, path.join(bundleDir, "manifest.json"));
  fs.copyFileSync(proofManifestPath, path.join(bundleDir, "proof_manifest.json"));
  writeJsonFile(path.join(sessionDir, "publication_result.json"), publication);

  meta.status = "finalized";
  meta.formula = formula;
  meta.winners_count = winnersCount;
  meta.target = target ?? null;
  meta.snapshot_hash = finalized.snapshotHash;
  meta.snapshot_count = finalized.snapshotCount;
  meta.merkle_root = finalized.merkleRoot;
  meta.snapshot_uri = finalized.canonicalPath;
  meta.manifest_path = manifestPath;
  meta.proof_manifest_path = proofManifestPath;
  meta.proof_manifest_url = publication.proofManifestUrl || proofManifestPath;
  meta.irys_url = publication.irysUrl || null;
  meta.publication_status = publication.publicationStatus;
  meta.publication_error = publication.publicationError || null;
  meta.mode = finalized.mode;
  meta.signature = result.signature;
  meta.program_id = result.programId;
  meta.artifact_path = result.artifactPath;
  meta.result_path = result.resultPath;
  meta.compiled_artifact_hash = result.artifactHash;
  meta.runtime_id = result.runtimeId;
  meta.resolve_id = result.resolveId;
  meta.outcome_id = result.outcome;
  meta.outcome_ids = outcomeIds;
  saveSnapshotSession(meta);
  writeSnapshotSignatureIndex(meta);

  json(res, 200, {
    ok: true,
    standard_version: "1.2",
    session_id: sessionId,
    signature: result.signature,
    outcome_id: result.outcome,
    outcome_ids: outcomeIds,
    replay_url: `https://verifiableoutcome.online/verify?sig=${result.signature}`,
    snapshot_hash: finalized.snapshotHash,
    snapshot_count: finalized.snapshotCount,
    snapshot_uri: finalized.canonicalPath,
    manifest_uri: manifestPath,
    merkle_root: finalized.merkleRoot,
    publication_url: publication.irysUrl,
    proof_manifest_url: publication.proofManifestUrl || proofManifestPath,
    publication_status: publication.publicationStatus,
    ...(publication.publicationError
      ? { publication_error: publication.publicationError }
      : {}),
    proof_status: "ready",
    mode: finalized.mode,
    thresholds: snapshotThresholds(),
  });
}

async function handlePartnerDrawProof(req, res, signature) {
  const reqUrl = new URL(req.url || "/", "http://localhost");
  const address = validateSnapshotProofAddress(reqUrl.searchParams.get("address") || "");
  const meta = loadSnapshotSessionBySignature(validateSignature(signature));
  if (meta.status !== "finalized") {
    throw httpError(409, "snapshot draw proof is not finalized");
  }
  const formula = validatePartnerFormula(meta.formula);
  const snapshotHelpers = await loadSnapshotHelpers();
  const proof = await snapshotHelpers.buildSnapshotMerkleProofFromFile({
    snapshotPath: String(meta.snapshot_uri || ""),
    formula,
    participantId: address,
    expectedHash: meta.snapshot_hash,
    expectedCount: Number(meta.snapshot_count || 0),
    ...(meta.merkle_root ? { expectedMerkleRoot: meta.merkle_root } : {}),
  });
  const outcomeIds = Array.isArray(meta.outcome_ids)
    ? meta.outcome_ids.map((value) => String(value))
    : meta.outcome_id
      ? [String(meta.outcome_id)]
      : [];
  json(res, 200, {
    ok: true,
    standard_version: "1.2",
    signature: String(meta.signature),
    program_id: String(meta.program_id || defaultProgramId()),
    snapshot_hash: proof.snapshotHash,
    snapshot_count: proof.snapshotCount,
    snapshot_uri: String(meta.snapshot_uri),
    merkle_root: proof.merkleRoot,
    publication_url: meta.irys_url || null,
    proof_manifest_url: meta.proof_manifest_url || meta.proof_manifest_path || null,
    publication_status: meta.publication_status || null,
    proof_status: "ready",
    address,
    participant: proof.participant
      ? {
          id: proof.participant.id,
          order: proof.participant.order,
          ...(proof.participant.weight !== 1 ? { weight: proof.participant.weight } : {}),
          ...(formula === "weighted_random"
            ? {}
            : { score: proof.participant.score.toString() }),
        }
      : null,
    leaf_hash: proof.leafHash,
    proof: proof.proof,
    included: Boolean(proof.participant),
    winner: Boolean(proof.participant && outcomeIds.includes(address)),
    outcome_id: outcomeIds[0] || "",
    outcome_ids: outcomeIds,
    resolution_formula: formula,
    ...(meta.target === undefined || meta.target === null
      ? {}
      : { target: Number(meta.target) }),
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

// --- sortition partner routes (canonical protocol path) ----------------------
// Build/transact against the canonical program id (overridable via env). Every
// response carries a `maturity` field. The default resolution path stays
// replay-by-signature; sortition is an alternative canonical path.

const SORTITION_MATURITY_NOTE = "canonical-devnet; default resolution path is replay-by-signature";

function sortitionProgramId(sortitionModule) {
  return (
    String(process.env.SORTITION_PROGRAM_ID || "").trim() ||
    sortitionModule.SORTITION_PROGRAM_ID
  );
}

function sortitionOperatorWalletPath() {
  return (
    process.env.SORTITION_OPERATOR_WALLET ||
    process.env.LIVE_RAFFLE_WALLET ||
    process.env.ANCHOR_WALLET ||
    ""
  );
}

function buildSortitionClient(sortitionModule) {
  const programId = sortitionProgramId(sortitionModule);
  const walletPath = sortitionOperatorWalletPath();
  if (!walletPath) {
    throw httpError(
      503,
      "Sortition operator not configured (set SORTITION_OPERATOR_WALLET)"
    );
  }
  const rpcUrl = resolveRpcUrl(
    process.env.SORTITION_RPC_URL || process.env.LIVE_RAFFLE_RPC_URL || defaultRpc()
  );
  return sortitionModule.createSortitionClient({ rpcUrl, walletPath, programId });
}

function sortitionHexBytes(value, byteLen, label) {
  const hex = String(value || "").trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length !== byteLen * 2) {
    throw httpError(400, `${label} must be ${byteLen} bytes hex`);
  }
  return Buffer.from(hex, "hex");
}

function sortitionBoundedSlots(value, label, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > 1_000_000) {
    throw httpError(400, `${label} must be an integer 1–1000000`);
  }
  return value;
}

async function handlePartnerSortitionDraw(req, res) {
  requirePartnerApiKey(req, "/api/partner/sortition/draw");
  const body = await readJsonBody(req);
  const sortition = await loadSortitionOps();
  const client = buildSortitionClient(sortition);
  const drawId = sortitionHexBytes(body.draw_id, 16, "draw_id");
  const threshold = sortitionHexBytes(body.threshold, 32, "threshold");
  const registrationDurationSlots = sortitionBoundedSlots(
    body.registration_duration_slots,
    "registration_duration_slots",
    60
  );
  const claimDurationSlots = sortitionBoundedSlots(
    body.claim_duration_slots,
    "claim_duration_slots",
    120
  );
  const unclaimedRule = body.unclaimed_rule === undefined ? 0 : body.unclaimed_rule;
  if (!Number.isInteger(unclaimedRule) || unclaimedRule < 0 || unclaimedRule > 255) {
    throw httpError(400, "unclaimed_rule must be a byte 0–255");
  }
  const result = await sortition.sortitionCreateDrawInline(client, {
    drawId,
    threshold,
    registrationDurationSlots,
    claimDurationSlots,
    unclaimedRule,
  });
  json(res, 200, {
    ok: true,
    maturity: result.maturity,
    maturity_note: SORTITION_MATURITY_NOTE,
    program_id: client.programId.toBase58(),
    draw_id: drawId.toString("hex"),
    draw_pda: result.drawPda,
    signature: result.signature,
  });
}

async function handlePartnerSortitionRegister(req, res) {
  requirePartnerApiKey(req, "/api/partner/sortition/register");
  const body = await readJsonBody(req);
  const sortition = await loadSortitionOps();
  const client = buildSortitionClient(sortition);
  const drawId = sortitionHexBytes(body.draw_id, 16, "draw_id");
  const ticketId = sortitionHexBytes(body.ticket_id, 16, "ticket_id");
  const commitment = sortitionHexBytes(body.commitment, 32, "commitment");
  const result = await sortition.sortitionRegisterTicketInline(client, {
    drawId,
    ticketId,
    commitment,
  });
  json(res, 200, {
    ok: true,
    maturity: result.maturity,
    maturity_note: SORTITION_MATURITY_NOTE,
    program_id: client.programId.toBase58(),
    draw_id: drawId.toString("hex"),
    ticket_id: ticketId.toString("hex"),
    ticket_pda: result.ticketPda,
    signature: result.signature,
  });
}

async function handlePartnerSortitionSeal(req, res) {
  requirePartnerApiKey(req, "/api/partner/sortition/seal");
  const body = await readJsonBody(req);
  const sortition = await loadSortitionOps();
  const client = buildSortitionClient(sortition);
  const drawId = sortitionHexBytes(body.draw_id, 16, "draw_id");
  const result = await sortition.sortitionSealDrawInline(client, { drawId });
  json(res, 200, {
    ok: true,
    maturity: result.maturity,
    maturity_note: SORTITION_MATURITY_NOTE,
    program_id: client.programId.toBase58(),
    draw_id: drawId.toString("hex"),
    signature: result.signature,
  });
}

async function handlePartnerSortitionClaim(req, res) {
  requirePartnerApiKey(req, "/api/partner/sortition/claim");
  const body = await readJsonBody(req);
  const sortition = await loadSortitionOps();
  const client = buildSortitionClient(sortition);
  const drawId = sortitionHexBytes(body.draw_id, 16, "draw_id");
  const ticketId = sortitionHexBytes(body.ticket_id, 16, "ticket_id");
  const secret = sortitionHexBytes(body.secret, 32, "secret");
  const result = await sortition.sortitionClaimTicketInline(client, {
    drawId,
    ticketId,
    secret,
  });
  json(res, 200, {
    ok: true,
    maturity: result.maturity,
    maturity_note: SORTITION_MATURITY_NOTE,
    program_id: client.programId.toBase58(),
    draw_id: drawId.toString("hex"),
    ticket_id: ticketId.toString("hex"),
    signature: result.signature,
  });
}

async function handleApi(req, res, pathname) {
  try {
    const corsEnabled = isCorsApiPath(pathname);
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

    const proofMatch = pathname.match(/^\/api\/partner\/draw\/([^/]+)\/proof$/);
    if (req.method === "GET" && proofMatch) {
      await handlePartnerDrawProof(req, res, proofMatch[1]);
      return;
    }

    if (req.method === "POST" && pathname === "/api/partner/draw") {
      await handlePartnerDraw(req, res);
      return;
    }

    // Keyless demo draws for the public /examples page. The partner key stays server-side
    // and every visitor shares one demo partner, so the throttle is per IP.
    if (req.method === "POST" && pathname === "/api/examples/draw") {
      const rate = checkExamplesDrawRateLimit(req);
      if (!rate.ok) {
        json(res, 429, {
          ok: false,
          error: "one demo draw per 15s from this IP",
          retry_after_ms: rate.retryAfterMs,
        });
        return;
      }
      const demoKey = String(process.env.EXAMPLES_DEMO_API_KEY || "").trim();
      if (!demoKey) {
        json(res, 503, { ok: false, error: "demo draws are not configured" });
        return;
      }
      await handlePartnerDraw(req, res, { demoKey });
      return;
    }

    // sortition routes (canonical resolution path)
    if (req.method === "POST" && pathname === "/api/partner/sortition/draw") {
      await handlePartnerSortitionDraw(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/partner/sortition/register") {
      await handlePartnerSortitionRegister(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/partner/sortition/seal") {
      await handlePartnerSortitionSeal(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/partner/sortition/claim") {
      await handlePartnerSortitionClaim(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/conditions/score") {
      enforceApiRateLimit(req, pathname);
      await handleConditionsScore(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/partner/conditions/commit") {
      await handlePartnerConditionsCommit(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/partner/conditions/resolve") {
      await handlePartnerConditionsResolve(req, res);
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
});
