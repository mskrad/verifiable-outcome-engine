#!/usr/bin/env node
// Guards the public spec against drift from the code.
// Fails when a reason code, API route, program id, SDK version or section order
// in web/public/spec.html / web/public/spec.md stops matching the source.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const errors = [];
const fail = (msg) => errors.push(msg);

const html = read("web/public/spec.html");
const md = read("web/public/spec.md");
const llms = read("web/public/llms.txt");
const errorsDoc = read("VERIFICATION_ERRORS.md");
const verifyTs = read("sdk/verify.ts");
const server = read("web/server.mjs");
const pkg = JSON.parse(read("package.json"));

// 1. Reason codes: every code the SDK emits is documented everywhere, and nothing stale is.
const emitted = new Set([...verifyTs.matchAll(/"(ERR_[A-Z0-9_]+)"/g)].map((m) => m[1]));
const docs = { "spec.html": html, "spec.md": md, "VERIFICATION_ERRORS.md": errorsDoc };
for (const [name, text] of Object.entries(docs)) {
  const documented = new Set([...text.matchAll(/\b(ERR_[A-Z0-9_]+)\b/g)].map((m) => m[1]));
  for (const code of emitted) if (!documented.has(code)) fail(`${name}: missing reason code ${code}`);
  for (const code of documented) if (!emitted.has(code)) fail(`${name}: documents ${code}, which sdk/verify.ts no longer emits`);
}

// 2. API routes: every exact route the server handles appears in both specs.
const routes = new Set([...server.matchAll(/pathname === "(\/api\/[^"]+)"/g)].map((m) => m[1]));
routes.add("/api/partner/draw/:signature/proof");
for (const route of routes) {
  if (!html.includes(route)) fail(`spec.html: missing API route ${route}`);
  if (!md.includes(route)) fail(`spec.md: missing API route ${route}`);
}

// 3. Program id and SDK version.
const programId = (read(".env.example").match(/^PROGRAM_ID=(\S+)/m) || [])[1];
if (!programId) fail(".env.example: PROGRAM_ID not found");
for (const [name, text] of Object.entries({ "spec.html": html, "spec.md": md, "llms.txt": llms })) {
  if (programId && !text.includes(programId)) fail(`${name}: canonical program id ${programId} not found`);
  if (!text.includes(pkg.version)) fail(`${name}: SDK version ${pkg.version} from package.json not found`);
}

// 4. Section order: spec.html sections and spec.md anchors must match one to one.
const htmlSections = [...html.matchAll(/<section id="([a-z0-9-]+)" class="spec-section">/g)].map((m) => m[1]);
const mdSections = [...md.matchAll(/<a id="([a-z0-9-]+)"><\/a>/g)].map((m) => m[1]);
if (htmlSections.join(",") !== mdSections.join(",")) {
  fail(`section order differs\n  spec.html: ${htmlSections.join(", ")}\n  spec.md:   ${mdSections.join(", ")}`);
}
const tocTargets = [...html.matchAll(/<li><a href="#([a-z0-9-]+)">\d\d · /g)].map((m) => m[1]);
if (tocTargets.join(",") !== htmlSections.join(",")) fail("spec.html: table of contents does not match section order");

// 5. Public surfaces must not link to the private repository, and the agent index must point at spec.md.
for (const [name, text] of Object.entries({ "spec.html": html, "spec.md": md, "llms.txt": llms })) {
  if (/github\.com\/mskrad/i.test(text)) fail(`${name}: links to the private GitHub repository`);
}
if (!llms.includes("/spec.md")) fail("llms.txt: does not reference /spec.md");
if (!html.includes('type="text/markdown" href="/spec.md"')) fail("spec.html: missing <link rel=\"alternate\" type=\"text/markdown\" href=\"/spec.md\">");

if (errors.length) {
  console.error(`check:spec FAILED (${errors.length})`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`check:spec OK — ${emitted.size} reason codes, ${routes.size} routes, ${htmlSections.length} sections, program ${programId}, SDK ${pkg.version}`);
