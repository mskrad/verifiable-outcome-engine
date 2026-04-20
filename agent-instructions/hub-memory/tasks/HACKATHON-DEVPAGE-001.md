# Task: HACKATHON-DEVPAGE-001

**Title:** "Build with VRE" developer page — make SDK and config engine visible to judges

**Parent Sprint:** HACKATHON-SPRINT-2 (Apr 12–18)
**Priority:** High — SDK is invisible without this; judges won't see "Developer Infrastructure"
**Status:** Ready for Tester
**Owner:** Engineer
**Reviewer:** Hub

---

## Problem

The Config Engine (SDK + `--config` flag) is fully implemented but invisible on the site. A judge visiting `verifiableoutcome.online` sees only a verifier UI — nothing about how operators create their own raffles/loot/airdrops. The "Developer Infrastructure" narrative is missing from the live surface.

---

## Goal

Add a `/build.html` page to `web/public/` that shows:
1. What VRE enables for operators (create custom raffle/loot/airdrop)
2. How to do it (JSON config → CLI → TX → verify)
3. The npm SDK as an importable API
4. Links to example configs in the repo

Also: add a "Build with VRE" nav link and CTA on `index.html`.

---

## Deliverables

### 1. `web/public/build.html` — new page

Three sections:

**Section A — "What you can build"**
Three cards side by side (same `.features` grid as index.html):
- 🎟 **Raffle** — "Select a winner from a weighted participant list"
- 🎁 **Loot** — "Roll a weighted outcome table (legendary / rare / common)"
- 🪂 **Airdrop** — "Select N winners from an eligible address list"

**Section B — "How it works" — 3-step flow**

```

## Tester Verification Summary - 2026-04-16 21:24:44 +0300

Status: Returned to Engineer.

### Commands Run

- `npx tsc --noEmit`: passed.
- `node --check web/server.mjs`: passed.
- `yarn web`: failed inside sandbox with `EPERM listen 0.0.0.0:8787`, then passed with elevated local bind permission and served `http://127.0.0.1:8787`.
- `curl -sS -o /tmp/build.html.body -w '%{http_code}' http://127.0.0.1:8787/build.html`: returned `200`.
- Playwright browser check `/tmp/devpage-ui-check.js`: failed one strict mobile overflow criterion.

### Browser/UI Evidence

- `/build.html` returned HTTP `200`.
- Use-case cards present: `Raffle`, `Loot`, `Airdrop`.
- How-it-works stepper present with steps `1`, `2`, `3`: `Define rules`, `Commit on-chain`, `Share and verify`.
- SDK snippet includes `buildArtifact` and `verifyOutcome`.
- Copy button works for install command:
  - source text: `npm install verifiable-outcome-sdk`
  - clipboard text after click: `npm install verifiable-outcome-sdk`
  - button text after click: `Copied`
- Config links are present and exact:
  - `https://raw.githubusercontent.com/mskrad/verifiable-outcome-engine/main/examples/raffle.config.json`
  - `https://raw.githubusercontent.com/mskrad/verifiable-outcome-engine/main/examples/loot.config.json`
- Build nav link appears on `/`, `/play.html`, `/verify.html`, `/spec.html`, and `/build.html`.
- `index.html` CTA present: `Build with VRE →`.
- Build page mobile viewport 375px page-level metrics:
  - `clientWidth: 375`
  - `scrollWidth: 375`
  - `navRight: 359`
- Strict all-touched-page mobile sweep:
  - `/`: `clientWidth=375`, `scrollWidth=375`
  - `/verify.html`: `clientWidth=375`, `scrollWidth=375`
  - `/spec.html`: `clientWidth=375`, `scrollWidth=375`
  - `/build.html`: `clientWidth=375`, `scrollWidth=375`
  - `/play.html`: `clientWidth=375`, `scrollWidth=457`
- `/play.html` overflow offenders are long hash spans in `.sig-meta-row`, including runtime/artifact hash values with `right=457`.

### Pass/Fail By Acceptance Criterion

- `GET /build.html` returns HTTP 200: pass.
- `build.html` has raffle, loot, and airdrop use-case cards: pass.
- `build.html` has 3-step how-it-works stepper: pass.
- SDK snippet includes `buildArtifact` and `verifyOutcome`: pass.
- `npm install verifiable-outcome-sdk` line has working copy button: pass.
- `raffle.config.json` and `loot.config.json` links are present and correct: pass.
- Build nav link appears on index, play, verify, spec, and build pages: pass.
- `index.html` has the `Build with VRE →` CTA: pass.
- `build.html` mobile 375px has no page-level horizontal overflow: pass.
- Strict mobile 375px no-overflow across touched public pages: fail on `play.html`.
- `node --check web/server.mjs`: pass.
- `npx tsc --noEmit`: pass.

### Risks / Regressions

- Acceptance ambiguity: if Hub intended the mobile check to apply only to `build.html`, the build page passes. Under a stricter interpretation covering pages touched by the Build nav addition, the task fails because `/play.html` overflows on mobile.
- The overflow is not caused by the header nav; the nav is within viewport at 375px. The cause is long unwrapped hash text in signature metadata rows.
- Minimal likely patch scope: CSS-only wrapping/overflow control for `.sig-meta-row span`, `.sig-hash`, or related mobile metadata text in `web/public/app.css`.
- No Rust, replay semantics, runtime design, or public API changes are implicated.

### Verdict

Rejected for now under strict mobile acceptance. Return to Engineer for a focused CSS-only fix on `/play.html` mobile horizontal overflow, then re-run focused Tester verification.

### Engineer Handoff Prompt

Fix `HACKATHON-DEVPAGE-001` in `/Users/timurkurmangaliev/verifiable-outcome-engine`.

Scope:
- Do not change Rust, replay semantics, runtime design, or public API surface.
- Keep `/build.html` content, SDK snippet, copy behavior, config links, nav links, and CTA behavior unchanged.
- Apply minimal CSS-only fix for mobile horizontal overflow on `/play.html` at 375px.

Evidence:
- All build page checks passed.
- Build nav link appears on `/`, `/play.html`, `/verify.html`, `/spec.html`, and `/build.html`.
- `npx tsc --noEmit` passed.
- `node --check web/server.mjs` passed.
- Build page mobile metrics passed: `clientWidth=375`, `scrollWidth=375`, `navRight=359`.
- Strict mobile sweep failed on `/play.html`: `clientWidth=375`, `scrollWidth=457`.
- Overflow offenders are long hash spans in `.sig-meta-row`, including runtime/artifact hash values with `right=457`.

Expected fix:
- Prevent page-level horizontal overflow on `/play.html` at 375px.
- Preserve copy/replay/demo behavior.
- Re-run:
  - `npx tsc --noEmit`
  - `node --check web/server.mjs`
  - `yarn web`
  - focused browser check for `/build.html` and `/play.html` at 375px.

Confidence: high.

---

## Tester Focused Re-test Summary - 2026-04-16 21:38:36 +0300

Status: Ready for Hub acceptance.

### Commands Run

- `npx tsc --noEmit`: passed.
- `node --check web/server.mjs`: passed.
- `PORT=8877 yarn web`: failed inside sandbox with `EPERM listen 0.0.0.0:8877`, then passed with elevated local bind permission and served `http://127.0.0.1:8877`.
- `node /tmp/vre-mobile-check.mjs`: passed using Brave headless at `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser`. Chrome was not required.

### Browser Measurements at 375px

- `/build.html`:
  - `clientWidth: 375`
  - `scrollWidth: 375`
  - `overflow: false`
  - `navRight: 359`
  - `offenders: []`
- `/play.html`:
  - `clientWidth: 375`
  - `scrollWidth: 375`
  - `overflow: false`
  - `navRight: 359`
  - `offenders: []`

### Wrapping / Containment Evidence

- Runtime id rows, resolve id rows, artifact hash rows, and compact timeline rows on `/play.html` are contained inside their `.sig-card` bounds.
- Long artifact hashes now report `overflowWrap: anywhere` and `wordBreak: break-word`.
- The previously failing blessed raffle card artifact hash is contained: card right `359`, row right `340`.
- The compact timeline row is contained: card right `359`, row right `339`.

### Regression Evidence

- `build.html` use-case cards remain present: `Raffle`, `Loot`, `Airdrop`.
- Stepper remains present with three steps.
- SDK snippet still includes `buildArtifact` and `verifyOutcome`.
- Install copy behavior still writes `npm install verifiable-outcome-sdk` to clipboard.
- Config links remain exact raw GitHub URLs for `raffle.config.json` and `loot.config.json`.
- Build nav link remains present on `/`, `/play.html`, `/verify.html`, `/spec.html`, and `/build.html`.
- Index CTA remains present: `Build with VRE`.
- No Rust, replay semantics, runtime design, or public API surface change was needed for this re-test.

### Acceptance Pass/Fail

- `/build.html` at 375px still has no horizontal overflow: pass.
- `/play.html` at 375px now has no horizontal overflow: pass.
- Long runtime id, resolve id, artifact hash, and compact timeline rows wrap inside signature cards: pass.
- Devpage content, SDK snippet, copy behavior, config links, nav links, and CTA behavior preserved: pass.
- `npx tsc --noEmit`: pass.
- `node --check web/server.mjs`: pass.
- `yarn web` for focused browser checks: pass after local bind permission.

### Risks / Regressions

- No acceptance-blocking regression found.
- The build page code block still contains internally scrollable code text, but page-level metrics are clean and filtered page-level offenders are empty.
- Local sandbox blocks binding to `0.0.0.0:8877`; elevated local bind was required in this environment.

### Verdict

Accepted by Tester. Send to Hub for final acceptance.

### Hub Handoff Prompt

Review `HACKATHON-DEVPAGE-001` in `/Users/timurkurmangaliev/verifiable-outcome-engine` for final acceptance.

Scope:
- Accept or reject based on focused Tester evidence.
- Do not expand scope into Rust, replay semantics, runtime design, public API surface, or ecosystem monorepo work.

Tester verdict:
- Accepted by Tester after focused mobile overflow re-test.
- `/build.html` at 375px: `clientWidth=375`, `scrollWidth=375`, `overflow=false`, `offenders=[]`.
- `/play.html` at 375px: `clientWidth=375`, `scrollWidth=375`, `overflow=false`, `offenders=[]`.
- Long runtime id, resolve id, artifact hash, and compact timeline rows are contained inside signature cards.
- Devpage content, SDK snippet, copy behavior, config links, nav links, and index CTA remain intact.
- `npx tsc --noEmit` passed.
- `node --check web/server.mjs` passed.
- `yarn web` served local checks on port `8877`.

Decision requested:
- Mark `HACKATHON-DEVPAGE-001` accepted if no additional Hub-level concern exists.

Confidence: high.
Step 1: Define rules          Step 2: Commit on-chain       Step 3: Share & verify
─────────────────────         ──────────────────────        ───────────────────────
Create a JSON config          yarn resolve:operator         Anyone pastes the TX at
with participants,            --config raffle.json          verifiableoutcome.online
weights, payouts.             --url https://api...          and gets MATCH / OK
                              → TX signature                + pre-commitment proof
```

Show as horizontal stepper cards with step numbers.

**Section C — "SDK" — code snippet**

```
npm install verifiable-outcome-sdk
```

Then a code block:

```typescript
import { buildArtifact, verifyOutcome } from 'verifiable-outcome-sdk';

// Define your raffle
const blob = buildArtifact({
  type: 'raffle',
  input_lamports: 10,
  participants: [
    { address: '5RbvSHb...', weight: 1000 },
    { address: 'Aip3wC6...', weight: 1000 },
  ],
});

// Verify any resolved TX
const result = await verifyOutcome({
  signature: 'mUXwae...',
  rpcUrl: 'https://api.devnet.solana.com',
});
// → { status: 'MATCH', outcome_id: '5RbvSHb...', ... }
```

Below the snippet: two links:
- `[View raffle.config.json ↗]` → links to GitHub raw examples/raffle.config.json
- `[View loot.config.json ↗]` → links to GitHub raw examples/loot.config.json

### 2. `web/public/index.html` — two additions

**A. Nav link:** add `<a href="/build.html">Build</a>` to the header nav (between Demo and Verify, or after Verify).

**B. CTA button:** below the existing two CTA buttons, add:
```html
<a class="btn btn-ghost" href="/build.html">Build with VRE →</a>
```

### 3. All other HTML pages — add "Build" nav link

Add `<a href="/build.html">Build</a>` to the header nav on:
- `play.html`
- `verify.html`
- `spec.html`

### 4. `web/public/app.css` — stepper styles

New classes:
- `.stepper` — flex row, gap 16px, flex-wrap wrap
- `.step-card` — flex:1, min-width:200px, card style (same border/radius as existing `.card`)
- `.step-num` — circle badge, gradient purple→green, 28px, bold
- `.step-title` — font-weight 600, margin-top 8px
- `.step-desc` — font-size 13px, color var(--text2)
- `.code-block` — `background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; font-family: var(--mono); font-size: 13px; overflow-x: auto; white-space: pre`
- `.npm-install` — single-line code block with copy button (same pattern as Copy JSON in verify.html)

---

## GitHub links for example configs

Use raw GitHub URLs:
```
https://raw.githubusercontent.com/mskrad/verifiable-outcome-engine/main/examples/raffle.config.json
https://raw.githubusercontent.com/mskrad/verifiable-outcome-engine/main/examples/loot.config.json
```

If repo is private, link to the file path in the repo instead:
```
https://github.com/mskrad/verifiable-outcome-engine/blob/main/examples/raffle.config.json
```

---

## Page structure (build.html)

```html
<header>  <!-- same as other pages, with Build as active link -->
<main>
  <div class="card">
    <h2>Build with VRE</h2>
    <p>Configure verifiable raffles, loot tables, and airdrops — 
       commit the rules on-chain before the outcome is drawn.</p>
  </div>

  <!-- Section A: What you can build -->
  <h3>Use Cases</h3>
  <div class="features"> <!-- 3 cards --> </div>

  <!-- Section B: How it works -->
  <h3>How It Works</h3>
  <div class="stepper"> <!-- 3 step cards --> </div>

  <!-- Section C: SDK -->
  <h3>SDK</h3>
  <div class="card">
    <div class="npm-install">npm install verifiable-outcome-sdk</div>
    <pre class="code-block">...</pre>
    <div style="display:flex;gap:12px;margin-top:12px">
      <a class="btn btn-ghost ext" href="...">raffle.config.json ↗</a>
      <a class="btn btn-ghost ext" href="...">loot.config.json ↗</a>
    </div>
  </div>
</main>
```

---

## Acceptance Criteria

- [ ] `GET /build.html` returns HTTP 200
- [ ] Page has three use-case cards (raffle, loot, airdrop)
- [ ] Page has 3-step how-it-works stepper
- [ ] Page has SDK code snippet with `buildArtifact` + `verifyOutcome`
- [ ] `npm install verifiable-outcome-sdk` line has copy button
- [ ] Links to raffle.config.json and loot.config.json work
- [ ] Nav "Build" link appears on index.html, play.html, verify.html, spec.html, build.html
- [ ] index.html has "Build with VRE →" CTA button
- [ ] Mobile: no horizontal overflow at 375px
- [ ] Dark theme consistent with other pages (same CSS variables)
- [ ] `node --check web/server.mjs` passes (no server changes needed)
- [ ] `npx tsc --noEmit` passes

---

## Out of Scope

- Backend changes (no new API endpoints)
- Actual npm publish
- Interactive config builder (deferred)
- Authentication or user accounts

---

## Related Tasks

- HACKATHON-CONFIG-ENGINE-001 (closed) — SDK and examples already exist
- HACKATHON-TIMELINE-001 (closed) — mobile CSS patterns to follow
- HACKATHON-DEPLOY-001 (closed) — deploy pipeline ready, `git pull + pm2 restart` sufficient

---

## Engineer Implementation Summary - 2026-04-16 21:20:22 +0300

Status: Ready for Tester.

Implemented:
- Added `web/public/build.html` with the developer-facing Build with VRE page.
- Added three use-case cards: raffle, loot, airdrop.
- Added a 3-step how-it-works stepper.
- Added SDK section with `npm install verifiable-outcome-sdk`, copy button, and `buildArtifact` plus `verifyOutcome` snippet.
- Added raw GitHub links to `examples/raffle.config.json` and `examples/loot.config.json`.
- Added `Build` nav link to `index.html`, `play.html`, `verify.html`, `spec.html`, and `build.html`.
- Added `Build with VRE` CTA on `index.html`.
- Added build page CSS: `.stepper`, `.step-card`, `.step-num`, `.step-title`, `.step-desc`, `.code-block`, `.npm-install`, plus supporting build-page styles.
- Added mobile header collapse at narrow widths to protect 375px layouts with the extra nav link.

Verification:
- `node --check web/server.mjs` passed.
- `npx tsc --noEmit` passed.
- `git diff --check` passed.
- Local `GET /build.html` returned HTTP `200`.
- Local `GET /app.css` returned HTTP `200`.
- Static content checks found required SDK snippet, config links, npm install line, stepper classes, and Build nav links across all five pages.

Known Gap:
- Browser-based mobile overflow verification was blocked because the local Playwright browser lookup could not find Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.

Tester Handoff Prompt:

```

---

## Engineer Fix Summary - 2026-04-16 21:32:27 +0300

Status: Ready for Tester.

Issue:
- Strict mobile sweep found `/play.html` overflow at 375px: `clientWidth=375`, `scrollWidth=457`.
- Offenders were long hash values in `.sig-meta-row span`.

Fix:
- Applied CSS-only containment in `web/public/app.css`.
- Changed `.sig-meta` grid columns to `repeat(auto-fill, minmax(min(200px, 100%), 1fr))`.
- Added `display:inline-block`, `max-width:100%`, `overflow-wrap:anywhere`, and `word-break:break-word` to `.sig-meta-row span`.

Verification:
- `npx tsc --noEmit` passed.
- `node --check web/server.mjs` passed.
- `git diff --check` passed.
- `yarn web` started successfully on local port `8877`.
- `GET /build.html` returned HTTP `200`.
- `GET /play.html` returned HTTP `200`.

Known Gap:
- Focused browser check for `/build.html` and `/play.html` at 375px could not be run in this environment because Playwright could not find Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.

Tester Handoff Prompt:

```
You are the Tester for Verifiable Outcome Engine. Re-test HACKATHON-DEVPAGE-001 mobile overflow fix.

Scope:
- Verify /build.html at 375px still has no horizontal overflow.
- Verify /play.html at 375px now has no horizontal overflow.
- Confirm long runtime_id, resolve_id, artifact_hash, and compact timeline rows wrap inside the signature card.
- Confirm no content, SDK snippet, copy behavior, config links, nav links, CTA behavior, Rust, replay semantics, runtime design, or public API surface changed.
- Run npx tsc --noEmit.
- Run node --check web/server.mjs.
- Run yarn web for focused browser checks.

Report:
1. Commands run
2. Browser measurements for /build.html and /play.html at 375px
3. Acceptance pass/fail
4. Regressions or risks
5. Verdict for Hub
```

---

## Copy Boundary Correction Note - 2026-04-19 22:18:00 +0300

Historical acceptance text above required `npm install verifiable-outcome-sdk`
as the build-page copy line. Current public copy must use:

```bash
npm install -g verifiable-outcome-sdk
vre verify --sig <SIGNATURE>
```

or:

```bash
npx -p verifiable-outcome-sdk vre verify --sig <SIGNATURE>
```

The executable is `vre`, not `verifiable-outcome-sdk`. The SDK does not deploy
the Solana program; Program Owners clone the repo, deploy `programs/outcome`
with Anchor, then use the SDK/CLI with `--program-id`.
You are the Tester for Verifiable Outcome Engine. Verify HACKATHON-DEVPAGE-001 in /Users/timurkurmangaliev/verifiable-outcome-engine.

Scope:
- Confirm /build.html returns HTTP 200.
- Confirm build.html has raffle, loot, and airdrop use-case cards.
- Confirm build.html has a 3-step how-it-works stepper.
- Confirm SDK snippet includes buildArtifact and verifyOutcome.
- Confirm npm install line has a working copy button.
- Confirm raffle.config.json and loot.config.json links are present and correct.
- Confirm Build nav link appears on index.html, play.html, verify.html, spec.html, and build.html.
- Confirm index.html has the Build with VRE CTA.
- Confirm mobile 375px has no horizontal overflow.
- Run npx tsc --noEmit and node --check web/server.mjs.

Report:
1. Commands run
2. Browser/UI evidence
3. Acceptance criteria pass/fail
4. Risks or regressions
5. Verdict for Hub
```
