#!/usr/bin/env node
// Fails when the published SDK would not load: every module reachable from the package
// entry points (JS and .d.ts, following relative imports) must be listed in package.json
// "files". Runs from prepack, so `npm publish` refuses a broken package.
// Usage: node scripts/check_package_files.mjs [--package path/to/package.json]
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const argIdx = process.argv.indexOf("--package");
const pkgPath = argIdx > -1 ? path.resolve(process.argv[argIdx + 1]) : path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const files = new Set((pkg.files || []).map((f) => f.replace(/^\.\//, "")));

const entries = [pkg.main, pkg.types].filter(Boolean);
for (const target of Object.values(pkg.exports || {})) {
  if (typeof target === "string") entries.push(target);
  else for (const v of Object.values(target)) if (typeof v === "string") entries.push(v);
}

const missing = new Set();
const seen = new Set();
const importRe = /(?:import|export)\s[^'"]*?from\s*["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;

function visit(rel) {
  const norm = path.posix.normalize(rel.replace(/^\.\//, ""));
  if (seen.has(norm)) return;
  seen.add(norm);
  if (!files.has(norm)) missing.add(norm);
  const abs = path.join(root, norm);
  if (!fs.existsSync(abs)) {
    missing.add(`${norm} (not built)`);
    return;
  }
  const src = fs.readFileSync(abs, "utf8");
  for (const m of src.matchAll(importRe)) {
    const spec = m[1] || m[2];
    const resolved = path.posix.join(path.posix.dirname(norm), spec);
    visit(resolved);
    // a .js module's type declarations ship alongside it when the package exposes types
    if (resolved.endsWith(".js") && norm.endsWith(".d.ts")) visit(resolved.replace(/\.js$/, ".d.ts"));
  }
}
for (const e of entries) visit(e);

if (missing.size) {
  console.error(`check:package FAILED — ${pkgPath}`);
  for (const m of [...missing].sort()) console.error(`- not in "files": ${m}`);
  process.exit(1);
}
console.log(`check:package OK — ${seen.size} modules reachable from ${entries.length} entry points, all in "files" (${pkg.name}@${pkg.version})`);
