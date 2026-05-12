import path from "path";

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

function buildParticipant(rank, count) {
  return {
    id: `trader-${String(rank).padStart(6, "0")}`,
    score: count - rank + 1,
  };
}

function buildChunk(startRank, endRank, count) {
  const participants = [];
  for (let rank = startRank; rank <= endRank; rank += 1) {
    participants.push(buildParticipant(rank, count));
  }
  return participants;
}

function expectedModeForCount(count) {
  if (count <= 1000) return "simple";
  if (count <= 10000) return "medium";
  if (count >= 100000) return "streaming";
  return "bulk";
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  node scripts/partner_snapshot_large_case.mjs \\
    --api-key <KEY> \\
    [--base-url http://127.0.0.1:8787] \\
    [--count 1001|100001] \\
    [--chunk-size 500|5000] \\
    [--formula rank_desc] \\
    [--winners-count 2] \\
    [--label "1001+ snapshot testcase"]
`);
    return;
  }

  const baseUrl = String(args["base-url"] || "http://127.0.0.1:8787").trim();
  const apiKey = String(args["api-key"] || process.env.PARTNER_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("Provide --api-key <KEY> or PARTNER_API_KEY");
  }

  const count = positiveInteger(args.count || "1001", "count");
  const chunkSize = positiveInteger(args["chunk-size"] || "500", "chunk-size");
  const winnersCount = positiveInteger(args["winners-count"] || "2", "winners-count");
  const formula = String(args.formula || "rank_desc").trim();
  if (formula !== "rank_desc") {
    throw new Error("This testcase currently supports only --formula rank_desc");
  }
  if (count <= 1000) {
    throw new Error("count must be > 1000 for the 1000+ testcase");
  }
  if (winnersCount > count) {
    throw new Error("winners-count must be <= count");
  }

  const label = String(args.label || `${count}+ snapshot testcase`).trim();
  const expectedWinners = [];
  for (let rank = 1; rank <= winnersCount; rank += 1) {
    expectedWinners.push(buildParticipant(rank, count).id);
  }

  const init = await postJson(baseUrl, apiKey, "/api/partner/snapshot/init", { label });
  const sessionId = init.session_id;

  const chunkCount = Math.ceil(count / chunkSize);
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const startRank = chunkIndex * chunkSize + 1;
    const endRank = Math.min(count, startRank + chunkSize - 1);
    const chunk = buildChunk(startRank, endRank, count);
    const uploaded = await postJson(baseUrl, apiKey, "/api/partner/snapshot/chunk", {
      session_id: sessionId,
      chunk_index: chunkIndex,
      participants: chunk,
    });
    console.log(
      `chunk ${chunkIndex}: ${uploaded.participant_count} participants uploaded (${uploaded.mode})`
    );
  }

  const finalized = await postJson(baseUrl, apiKey, "/api/partner/snapshot/finalize", {
    session_id: sessionId,
    formula,
    winners_count: winnersCount,
    label,
  });

  console.log(`session_id          : ${sessionId}`);
  console.log(`participant_count   : ${count}`);
  console.log(`chunk_size          : ${chunkSize}`);
  console.log(`chunk_count         : ${chunkCount}`);
  console.log(`expected_mode       : ${expectedModeForCount(count)}`);
  console.log(`expected_winners    : ${expectedWinners.join(",")}`);
  console.log(`actual_winners      : ${(finalized.outcome_ids || []).join(",")}`);
  console.log(`snapshot_hash       : ${finalized.snapshot_hash}`);
  console.log(`snapshot_count      : ${finalized.snapshot_count}`);
  console.log(`signature           : ${finalized.signature}`);
  console.log(`snapshot_uri        : ${finalized.snapshot_uri}`);
  console.log(`manifest_uri        : ${finalized.manifest_uri}`);
  console.log(`replay_command      : yarn -s replay --sig ${finalized.signature} --url http://127.0.0.1:8899 --program-id 9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F`);
  console.log(
    `snapshot_path_rel   : ${path.relative(process.cwd(), finalized.snapshot_uri)}`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
