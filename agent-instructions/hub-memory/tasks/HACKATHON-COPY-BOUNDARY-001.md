# Task: HACKATHON-COPY-BOUNDARY-001

**Title:** Site/docs claim-boundary cleanup — remove misleading SDK/program-owner copy
**Parent Sprint:** HACKATHON-SPRINT-3 (Apr 19-25)
**Status:** OPEN
**Priority:** High — public copy must not imply npm deploys a Solana program or use the wrong npm executable form
**Owner:** Documenter
**Reviewer:** Hub

---

## Problem

Recent SDK/CLI work introduced a risk that the site and docs over-explain or over-promise:

- `npm install verifiable-outcome-sdk` can be read as "this package deploys a new Solana program instance".
- `npx verifiable-outcome-sdk ...` can be wrong or ambiguous because the package binary is `vre`.
- "Full flow without cloning repo" is only true for Verifier/Builder/Operator against an existing deployed program, not for Program Owner.
- The npm package is now published, but the executable is `vre`; docs must not recommend the ambiguous `npx verifiable-outcome-sdk ...` form unless it is separately proven.
- Some internal task docs still contain old shorthand that can mislead future handoffs.

This task is a content and documentation cleanup only. It must not change SDK behavior, Rust/Anchor code, replay semantics, or UI layout beyond necessary copy edits.

---

## Goal

Make every public and handoff-facing statement precise:

```text
SDK/CLI: build artifacts, resolve against an existing deployed program, verify resolved outcomes.
Own program instance: clone repo, deploy programs/outcome with Anchor, then pass --program-id.
Npm publishing: package is live; show install/use commands with the correct `vre` binary.
```

---

## Scope

Audit and update copy in:

- `web/public/index.html`
- `web/public/build.html`
- `web/public/play.html`
- `web/public/verify.html`
- `web/public/spec.html`
- `README.md`
- `RUNBOOK.md`
- `DEMO_RUNBOOK.md`
- `INTEGRATION.md`
- `STATUS.md`
- `agent-instructions/hub-memory/CURRENT_TASK.md`
- Task memories that contain now-misleading SDK/package copy:
  - `agent-instructions/hub-memory/tasks/HACKATHON-SDK-CLI-001.md`
  - `agent-instructions/hub-memory/tasks/HACKATHON-NPM-PUBLISH-001.md`
  - `agent-instructions/hub-memory/tasks/HACKATHON-DEVPAGE-001.md`
  - `agent-instructions/hub-memory/tasks/HACKATHON-CONFIG-ENGINE-001.md`

If grep finds the same issue in another repo-local public doc, include it and note the file in evidence.

---

## Out Of Scope

- No Rust/Anchor changes.
- No SDK API changes.
- No package publish.
- No new npm dependency.
- No new web feature.
- No redesign.
- No changes to evidence JSON unless a documented command or URL is factually wrong.

---

## Required Decisions

### 1. Command style

Use one of these forms consistently:

```bash
npm install -g verifiable-outcome-sdk
vre verify --sig <SIGNATURE>
```

or:

```bash
npx -p verifiable-outcome-sdk vre verify --sig <SIGNATURE>
```

Do not use this form unless Tester proves it works after publish:

```bash
npx verifiable-outcome-sdk verify --sig <SIGNATURE>
```

### 2. Publish state

Real npm publish has happened. Registry evidence from `npm view verifiable-outcome-sdk --json`:

- package: `verifiable-outcome-sdk`
- latest: `0.1.1`
- versions: `0.1.0`, `0.1.1`
- bin: `{ "vre": "dist/sdk/cli.js" }`
- publish times:
  - `0.1.0`: `2026-04-19T15:36:49.927Z`
  - `0.1.1`: `2026-04-19T17:41:58.715Z`

Public site/docs may now show npm install commands. They must pair install with the correct executable:

```bash
npm install -g verifiable-outcome-sdk
vre verify --sig <SIGNATURE>
```

Do not claim the npm package deploys the Solana program.

### 3. Program-owner boundary

Every "deploy your own" flow must state:

```text
The SDK does not deploy the Solana program. To operate your own program instance, clone the repo, deploy programs/outcome with Anchor, then use the SDK/CLI with --program-id.
```

### 4. Role split

Keep these roles separate:

- Verifier: `vre verify`; no wallet.
- Builder: `buildArtifact`; no wallet.
- Operator: `vre resolve`; admin wallet for an existing deployed program.
- Program Owner: clone repo + Anchor deploy + own program id.

---

## Acceptance Criteria

- [ ] `rg -n "npx verifiable-outcome-sdk" README.md RUNBOOK.md DEMO_RUNBOOK.md INTEGRATION.md web agent-instructions/hub-memory/tasks` returns no active recommended command, or every occurrence is explicitly marked as not the recommended form.
- [ ] `rg -n "npm install verifiable-outcome-sdk|npm install -g verifiable-outcome-sdk" web README.md RUNBOOK.md DEMO_RUNBOOK.md INTEGRATION.md` shows only accurate install/use copy paired with `vre` or import examples.
- [ ] No public copy says or implies that npm SDK deploys a Solana program.
- [ ] No public copy says "full flow without clone" without qualifying "against an existing deployed program".
- [ ] `INTEGRATION.md` has a clear Program Owner flow with:
  - clone repo
  - generate new program keypair
  - update `Anchor.toml`
  - update `programs/outcome/src/lib.rs` `declare_id!`
  - `anchor build`
  - `anchor deploy --provider.cluster devnet`
  - use `--program-id <YOUR_PROGRAM_ID>`
- [ ] `web/public/build.html` does not overpromise npm publishing or program deployment.
- [ ] Internal task memories have a short correction note where old wording is retained as historical context.
- [ ] `npx tsc --noEmit` passes.
- [ ] `node --check web/server.mjs` passes.
- [ ] If web HTML changes, run `yarn web` and verify `/`, `/build.html`, `/play.html`, `/verify.html`, `/spec.html` return HTTP 200 locally.

---

## Suggested Grep Audit

Run:

```bash
rg -n "npm install|npx|verifiable-outcome-sdk|deploy your own|program instance|without cloning|without clone|full flow|Build with VRE|SDK|resolveOperator|buildArtifact" \
  README.md RUNBOOK.md DEMO_RUNBOOK.md INTEGRATION.md STATUS.md web agent-instructions/hub-memory/tasks
```

For each hit, classify as:

- OK: accurate and useful.
- Edit: inaccurate, too broad, or assumes npm publish.
- Remove: not needed for reviewer/demo flow.
- Historical note: keep but add correction so future handoffs do not copy it.

---

## Implementation Plan

1. Run the grep audit above and save the important findings into this task memory.
2. Edit public site copy first:
   - `web/public/build.html`
   - any nav/CTA text in other `web/public/*.html` if needed
3. Edit public docs:
   - `README.md`
   - `RUNBOOK.md`
   - `DEMO_RUNBOOK.md`
   - `INTEGRATION.md`
4. Edit status/handoff docs:
   - `STATUS.md`
   - `agent-instructions/hub-memory/CURRENT_TASK.md`
   - affected task memories
5. Run static checks:

```bash
npx tsc --noEmit
node --check web/server.mjs
```

6. If HTML changed, run the local web server and HTTP checks.
7. Update this task with evidence and move to Tester.

---

## Known Starting Findings

- `web/public/build.html` currently shows `npm install verifiable-outcome-sdk`; npm publish is verified for `verifiable-outcome-sdk@0.1.1`, so the install line is allowed if nearby copy makes clear that npm does not deploy a Solana program and users run the `vre` binary.
- `HACKATHON-SDK-CLI-001.md` still contains original goal text with `npx verifiable-outcome-sdk ...`; this needs a correction note or replacement in current handoff sections.
- `HACKATHON-SDK-CLI-001.md` problem statement says "full cycle without cloning repo"; this must be qualified as "against an existing deployed program".
- `HACKATHON-DEVPAGE-001.md` acceptance text preserved the original npm install copy-button requirement; add a correction note so future work does not reintroduce overclaiming.
- `INTEGRATION.md` already has the correct Program Owner boundary, but still needs audit for command style and publish-state wording.

---

## Handoff Prompt

Implement `HACKATHON-COPY-BOUNDARY-001` in `/Users/timurkurmangaliev/verifiable-outcome-engine`.

Scope:

- Content/documentation cleanup only.
- Do not change SDK behavior, Rust/Anchor code, replay semantics, package publish state, or UI layout except necessary copy edits.
- Fix any public or handoff-facing copy that implies:
  - npm SDK deploys a Solana program,
  - registry install uses a binary named `verifiable-outcome-sdk`,
  - `npx verifiable-outcome-sdk ...` is the recommended command,
  - users can operate their own program instance without cloning and Anchor deploy.

Required checks:

```bash
rg -n "npm install|npx|verifiable-outcome-sdk|deploy your own|program instance|without cloning|without clone|full flow|Build with VRE|SDK|resolveOperator|buildArtifact" README.md RUNBOOK.md DEMO_RUNBOOK.md INTEGRATION.md STATUS.md web agent-instructions/hub-memory/tasks
npx tsc --noEmit
node --check web/server.mjs
```

If HTML changes, also start `yarn web` and confirm `/`, `/build.html`, `/play.html`, `/verify.html`, `/spec.html` return HTTP 200.

When done, update this task memory with files changed, grep evidence, verification commands, and remaining risks.

---

## Confidence

high

---

## Update - 2026-04-19 21:41:47 +0300

### Facts

- Hub clarified: do not rewrite historical task history; only update current/public instructions and add correction notes where old history could mislead future handoffs.
- npm package is published:
  - package: `verifiable-outcome-sdk`
  - latest: `0.1.1`
  - npm page: `https://www.npmjs.com/package/verifiable-outcome-sdk?activeTab=readme`
  - registry check: `npm view verifiable-outcome-sdk --json`
  - bin: `{ "vre": "dist/sdk/cli.js" }`

### Decision

- `npm install -g verifiable-outcome-sdk` is allowed in public docs.
- `npx -p verifiable-outcome-sdk vre ...` is allowed as the npx form.
- `npx verifiable-outcome-sdk ...` remains not recommended unless separately proven after publish.
- The main cleanup target is now command accuracy and program-owner boundary, not publish-state caution.

### Scope Guardrail

- Historical sections in task memories should stay intact.
- Add correction notes near active handoff/current sections if old wording like "without cloning repo" or `npx verifiable-outcome-sdk` could be copied into new work.

---

## Documenter Update - 2026-04-19 22:18:00 +0300

### Status

READY FOR TESTER.

### Files Changed

- `web/public/build.html`
- `README.md`
- `DEMO_RUNBOOK.md`
- `INTEGRATION.md`
- `STATUS.md`
- `agent-instructions/hub-memory/CURRENT_TASK.md`
- `agent-instructions/hub-memory/tasks/HACKATHON-SDK-CLI-001.md`
- `agent-instructions/hub-memory/tasks/HACKATHON-NPM-PUBLISH-001.md`
- `agent-instructions/hub-memory/tasks/HACKATHON-DEVPAGE-001.md`
- `agent-instructions/hub-memory/tasks/HACKATHON-CONFIG-ENGINE-001.md`
- `agent-instructions/hub-memory/tasks/HACKATHON-COPY-BOUNDARY-001.md`

### Patch Summary

- Updated build page install command to `npm install -g verifiable-outcome-sdk`.
- Added correct one-off command: `npx -p verifiable-outcome-sdk vre verify --sig <SIGNATURE>`.
- Clarified that the executable is `vre`, not `verifiable-outcome-sdk`.
- Clarified that SDK/CLI builds artifacts, resolves against an existing deployed program, and verifies outcomes.
- Clarified Program Owner boundary: clone repo, deploy `programs/outcome` with Anchor, then use `--program-id`.
- Replaced README non-goal `SDK/package publishing` with the current boundary: no claim that npm SDK deploys the Solana program.
- Qualified demo "full operator cycle" as operating against an existing deployed program.
- Added correction notes to historical task memories without rewriting historical sections.

### Grep Evidence

```bash
rg -n "npm install|npx|verifiable-outcome-sdk|deploy your own|program instance|without cloning|without clone|full flow|Build with VRE|SDK|resolveOperator|buildArtifact" README.md RUNBOOK.md DEMO_RUNBOOK.md INTEGRATION.md STATUS.md web agent-instructions/hub-memory/tasks
rg -n "npx verifiable-outcome-sdk" README.md RUNBOOK.md DEMO_RUNBOOK.md INTEGRATION.md web agent-instructions/hub-memory/tasks
rg -n "npm install verifiable-outcome-sdk|npm install -g verifiable-outcome-sdk" web README.md RUNBOOK.md DEMO_RUNBOOK.md INTEGRATION.md
```

Documenter interpretation:

- `npx verifiable-outcome-sdk` may remain only in explicit "not recommended" / troubleshooting / correction-note context.
- Public docs/site should show install paired with `vre`, or import-only package examples.
- Any own-program copy should require repo clone plus Anchor deploy.
- Public docs/site install grep returned only:
  - `INTEGRATION.md`: `npm install -g verifiable-outcome-sdk`
  - `web/public/build.html`: `npm install -g verifiable-outcome-sdk`
  - `INTEGRATION.md` troubleshooting text pairing install with `vre`
- `npx verifiable-outcome-sdk` grep returned no active public recommended command; remaining public hit is `INTEGRATION.md` troubleshooting for `could not determine executable to run`.

### Verification Commands Run

- `npx tsc --noEmit`: passed.
- `node --check web/server.mjs`: passed.
- `yarn web`: started successfully on `http://127.0.0.1:8787`.
- Initial non-elevated local curl attempts could not connect to `127.0.0.1:8787` from the sandbox.
- Elevated local curl checks returned HTTP `200` for:
  - `/`
  - `/build.html`
  - `/play.html`
  - `/verify.html`
  - `/spec.html`

```bash
npx tsc --noEmit
node --check web/server.mjs
yarn web
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/build.html
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/play.html
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/verify.html
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/spec.html
```

### Remaining Risks

- Existing untracked/generated SDK and artifact files were present before this cleanup and were not removed.
- Historical task sections still contain old wording by design; correction notes now mark the current command and role boundary.
- Tester should independently re-run grep interpretation because historical task memories intentionally preserve old command examples.

### Tester Handoff Prompt

Участник: Tester

Verify `HACKATHON-COPY-BOUNDARY-001` in `/Users/timurkurmangaliev/verifiable-outcome-engine`.

Scope:
- Content/docs verification only.
- Do not change SDK behavior, Rust/Anchor code, replay semantics, npm publish state, or layout.
- Confirm public/current copy does not imply npm SDK deploys the Solana program.
- Confirm own-program operation requires clone repo + Anchor deploy + `--program-id`.
- Confirm recommended commands use executable `vre`.

Run:

```bash
rg -n "npm install|npx|verifiable-outcome-sdk|deploy your own|program instance|without cloning|without clone|full flow|Build with VRE|SDK|resolveOperator|buildArtifact" README.md RUNBOOK.md DEMO_RUNBOOK.md INTEGRATION.md STATUS.md web agent-instructions/hub-memory/tasks
rg -n "npx verifiable-outcome-sdk" README.md RUNBOOK.md DEMO_RUNBOOK.md INTEGRATION.md web agent-instructions/hub-memory/tasks
rg -n "npm install verifiable-outcome-sdk|npm install -g verifiable-outcome-sdk" web README.md RUNBOOK.md DEMO_RUNBOOK.md INTEGRATION.md
npx tsc --noEmit
node --check web/server.mjs
```

Because HTML changed, start `yarn web` and confirm HTTP 200:

```bash
yarn web
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/build.html
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/play.html
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/verify.html
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/spec.html
```

Acceptance:
- Public docs/site show `npm install -g verifiable-outcome-sdk` with `vre`, or `npx -p verifiable-outcome-sdk vre ...`.
- `npx verifiable-outcome-sdk ...` appears only as explicitly not recommended/troubleshooting/historical correction context.
- `INTEGRATION.md` Program Owner path includes clone repo, new program keypair, `Anchor.toml`, `declare_id!`, `anchor build`, `anchor deploy --provider.cluster devnet`, and `--program-id <YOUR_PROGRAM_ID>`.
- Checks pass.

Report:
1. Commands run.
2. Grep interpretation.
3. HTTP evidence.
4. Acceptance pass/fail.
5. Remaining risks.

Confidence target: high after command evidence.
