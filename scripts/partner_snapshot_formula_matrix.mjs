import { spawn } from "child_process";

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    out[key] = value;
    index += 1;
  }
  return out;
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function positiveIntegerList(value, label) {
  const parsed = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => positiveInteger(item, label));
  if (parsed.length === 0) {
    throw new Error(`${label} must contain at least one integer`);
  }
  return [...new Set(parsed)];
}

function buildParticipant(rank, count, formula, target) {
  const participant = {
    id: `trader-${String(rank).padStart(6, "0")}`,
  };
  if (formula === "weighted_random") {
    participant.weight = count - rank + 1;
    return participant;
  }
  if (formula === "first_n") {
    return participant;
  }
  if (formula === "rank_desc") {
    participant.score = count - rank + 1;
    return participant;
  }
  if (formula === "rank_asc") {
    participant.score = rank;
    return participant;
  }
  if (formula === "closest_to") {
    const offset = rank - 1;
    const direction = offset % 2 === 0 ? -1 : 1;
    const distance = Math.floor(offset / 2);
    participant.score = target + direction * distance;
    return participant;
  }
  throw new Error(`Unsupported formula: ${formula}`);
}

function buildChunk(startRank, endRank, count, formula, target) {
  const participants = [];
  for (let rank = startRank; rank <= endRank; rank += 1) {
    participants.push(buildParticipant(rank, count, formula, target));
  }
  return participants;
}

function expectedWinners(formula, winnersCount) {
  const ids = [];
  for (let rank = 1; rank <= winnersCount; rank += 1) {
    ids.push(`trader-${String(rank).padStart(6, "0")}`);
  }
  if (
    formula === "rank_desc" ||
    formula === "rank_asc" ||
    formula === "first_n" ||
    formula === "closest_to"
  ) {
    return ids;
  }
  return null;
}

async function postJson(baseUrl, apiKey, pathname, body) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`${pathname} -> HTTP ${response.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

function runReplay(signature, rpcUrl, programId) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "yarn",
      [
        "-s",
        "replay",
        "--sig",
        signature,
        "--url",
        rpcUrl,
        "--program-id",
        programId,
        "--json",
      ],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const lastJson = [...lines].reverse().find((line) => line.startsWith("{"));
      if (!lastJson) {
        reject(new Error(stderr.trim() || `replay exited with code ${code}`));
        return;
      }
      const parsed = JSON.parse(lastJson);
      if (code !== 0 && parsed.verification_result !== "MATCH") {
        reject(
          new Error(
            stderr.trim() ||
              `replay exited with code ${code}: ${parsed.verification_reason || "unknown"}`
          )
        );
        return;
      }
      resolve(parsed);
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runCase({
  apiKey,
  baseUrl,
  rpcUrl,
  programId,
  count,
  chunkSize,
  formula,
  winnersCount,
  labelPrefix,
  target,
}) {
  const label = `${labelPrefix} ${formula} w${winnersCount}`;
  const init = await postJson(baseUrl, apiKey, "/api/partner/snapshot/init", { label });
  const sessionId = init.session_id;
  const chunkCount = Math.ceil(count / chunkSize);
  let lastMode = null;

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const startRank = chunkIndex * chunkSize + 1;
    const endRank = Math.min(count, startRank + chunkSize - 1);
    const chunk = buildChunk(startRank, endRank, count, formula, target);
    const uploaded = await postJson(baseUrl, apiKey, "/api/partner/snapshot/chunk", {
      session_id: sessionId,
      chunk_index: chunkIndex,
      participants: chunk,
    });
    lastMode = uploaded.mode;
  }

  const finalizeBody = {
    session_id: sessionId,
    formula,
    winners_count: winnersCount,
    label,
    ...(formula === "closest_to" ? { target } : {}),
  };
  const finalized = await postJson(baseUrl, apiKey, "/api/partner/snapshot/finalize", finalizeBody);
  const replay = await runReplay(finalized.signature, rpcUrl, programId);

  assert(replay.verification_result === "MATCH", `${formula} w${winnersCount}: replay mismatch`);
  assert(replay.artifact_format_version === 4, `${formula} w${winnersCount}: expected v4`);
  assert(replay.snapshot_count === count, `${formula} w${winnersCount}: snapshot_count mismatch`);
  assert(
    replay.snapshot_hash === finalized.snapshot_hash,
    `${formula} w${winnersCount}: snapshot_hash mismatch`
  );
  assert(
    Array.isArray(replay.outcome_ids) && replay.outcome_ids.length === winnersCount,
    `${formula} w${winnersCount}: winners_count mismatch`
  );

  const expected = expectedWinners(formula, winnersCount);
  if (expected) {
    assert(
      replay.outcome_ids.join(",") === expected.join(","),
      `${formula} w${winnersCount}: expected ${expected.join(",")} got ${replay.outcome_ids.join(",")}`
    );
  }
  if (formula === "closest_to") {
    assert(replay.target === target, `${formula} w${winnersCount}: target mismatch`);
  }

  return {
    formula,
    winnersCount,
    sessionId,
    signature: finalized.signature,
    snapshotHash: finalized.snapshot_hash,
    snapshotCount: finalized.snapshot_count,
    outcomeIds: replay.outcome_ids,
    resolutionFormula: replay.resolution_formula,
    mode: lastMode,
    target: replay.target,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  node scripts/partner_snapshot_formula_matrix.mjs \\
    --api-key <KEY> \\
    [--base-url http://127.0.0.1:8787] \\
    [--rpc-url http://127.0.0.1:8899] \\
    [--program-id 9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F] \\
    [--count 1001] \\
    [--chunk-size 500] \\
    [--winners 1,2,3,5] \\
    [--label-prefix "formula matrix"]
`);
    return;
  }

  const apiKey = String(args["api-key"] || process.env.PARTNER_API_KEY || "").trim();
  if (!apiKey) throw new Error("Provide --api-key <KEY> or PARTNER_API_KEY");
  const baseUrl = String(args["base-url"] || "http://127.0.0.1:8787").trim();
  const rpcUrl = String(args["rpc-url"] || "http://127.0.0.1:8899").trim();
  const programId = String(
    args["program-id"] || "9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F"
  ).trim();
  const count = positiveInteger(args.count || "1001", "count");
  const chunkSize = positiveInteger(args["chunk-size"] || "500", "chunk-size");
  const winnersList = positiveIntegerList(args.winners || "1,2,3,5", "winners");
  const labelPrefix = String(args["label-prefix"] || "formula matrix").trim();
  const formulas = [
    "weighted_random",
    "rank_desc",
    "rank_asc",
    "first_n",
    "closest_to",
  ];

  const cases = [];
  for (const formula of formulas) {
    for (const winnersCount of winnersList) {
      if (winnersCount > 10) {
        throw new Error("winners_count must stay within partner snapshot limit 1..10");
      }
      cases.push({
        formula,
        winnersCount,
        target: formula === "closest_to" ? 0 : undefined,
      });
    }
  }

  const results = [];
  for (const testCase of cases) {
    const result = await runCase({
      apiKey,
      baseUrl,
      rpcUrl,
      programId,
      count,
      chunkSize,
      formula: testCase.formula,
      winnersCount: testCase.winnersCount,
      target: testCase.target,
      labelPrefix,
    });
    results.push(result);
    console.log(
      `[PASS] ${result.formula} w${result.winnersCount} -> ${result.outcomeIds.join(",")} sig=${result.signature} mode=${result.mode}`
    );
  }

  console.log("");
  console.log("Matrix summary:");
  for (const result of results) {
    console.log(
      `${result.formula.padEnd(15)} w${String(result.winnersCount).padEnd(2)} ${result.outcomeIds.join(",")} ${result.signature}`
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
