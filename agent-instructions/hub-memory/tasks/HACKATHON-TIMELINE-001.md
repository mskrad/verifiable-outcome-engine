# Task: HACKATHON-TIMELINE-001

**Title:** Pre-commitment timeline — make the on-chain guarantee visible in UI

**Parent Sprint:** HACKATHON-SPRINT-2 (Apr 12–18)
**Priority:** High — core honesty proof for judges ("rules locked before outcome drawn")
**Status:** Ready for Tester
**Owner:** Engineer
**Reviewer:** Hub

---

## Problem

A judge opens `verify.html`, sees `MATCH / OK`, but doesn't understand *why* that means the outcome was fair. The key guarantee — that artifact was committed **before** resolution — is invisible. It's stated in README but not shown in the UI.

Goal: make the guarantee self-evident from the UI alone.

---

## What to Show

```
Pre-commitment Timeline

  Artifact locked            Outcome drawn
  slot 342,150,821           slot 342,151,044
        │                          │
────────●──────────────────────────●──────────▶
        
        ←────── 223 slots (~89 sec) ──────→

  Rules were committed BEFORE the outcome was drawn.
  Operator could not change the artifact after seeing the result.
```

Both slots are on-chain facts, independently verifiable.

---

## Technical Approach

### How to get `artifact_slot` (PDA creation slot)

The `approved_outcome_artifact` PDA was created by the `SubmitCompiledArtifact` instruction. To find its creation slot:

1. Derive artifact PDA from `compiled_artifact_hash` + `program_id` (already done in SDK)
2. Call `connection.getSignaturesForAddress(artifactPda, { limit: 1000 })` — returns newest-first
3. Take the **last** entry (oldest TX = creation TX)
4. That TX's `slot` is `artifact_slot`

This works reliably on devnet where each artifact PDA has a small number of TXs (< 10).

### How to get `resolution_slot`

Call `connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 })` — the `.slot` field is the resolution slot.

Both calls use the same RPC URL already available in the replay flow.

---

## Deliverables

### 1. `web/server.mjs` — new `/api/timeline` endpoint

```
POST /api/timeline
Body: { signature, rpcUrl, programId, compiledArtifactHash }
Response: { ok: true, artifact_slot, resolution_slot, gap_slots }
         | { ok: false, error: string }
```

Implementation (Node.js, no extra deps — use `@solana/web3.js` already present or raw `fetch` to RPC):

```js
async function fetchTimeline({ signature, rpcUrl, programId, compiledArtifactHash }) {
  // 1. resolution slot from getTransaction
  // 2. derive artifactPda (reuse PDA derivation from outcome_public_sdk)
  // 3. getSignaturesForAddress(artifactPda, {limit:1000}) → last entry → slot
  return { artifact_slot, resolution_slot, gap_slots: resolution_slot - artifact_slot }
}
```

Use raw JSON-RPC `fetch` calls to avoid importing the full Anchor stack in the server. The two RPC methods needed:
- `getTransaction` — for resolution slot
- `getSignaturesForAddress` — for artifact creation slot
- `getProgramAccounts` is NOT needed

Timeout: 8 seconds. If either call fails, return `{ ok: false, error }` — UI degrades gracefully.

### 2. `web/public/verify.html` — add timeline block after MATCH banner

After a successful MATCH result, fetch `/api/timeline` with `compiledArtifactHash` from the replay result, then render:

```html
<div class="timeline-block">
  <h4>Pre-commitment Proof</h4>
  <div class="timeline-track">
    <div class="timeline-point left">
      <div class="tl-label">Artifact locked</div>
      <div class="tl-slot">slot <span>342,150,821</span></div>
    </div>
    <div class="timeline-gap">← 223 slots (~89 sec) →</div>
    <div class="timeline-point right">
      <div class="tl-label">Outcome drawn</div>
      <div class="tl-slot">slot <span>342,151,044</span></div>
    </div>
  </div>
  <p class="timeline-caption">
    Rules were committed on-chain before the outcome was drawn.
    The operator could not change the artifact after seeing the result.
  </p>
</div>
```

Show a loading skeleton while fetching. If timeline fetch fails, hide the block silently (don't break main verify flow).

### 3. `web/public/play.html` — add slot info to each sig card

After loading blessed signatures, fetch `/api/timeline` for each entry. Add to each card:

```
artifact slot → resolution slot  (+N slots)
```

Keep it compact — single line below the artifact hash, no full timeline visualization (that's for verify.html).

### 4. `web/public/app.css` — timeline styles

New classes:
- `.timeline-block` — card-style container, subtle border
- `.timeline-track` — flexbox row with left/right points and center gap
- `.timeline-point` — label + slot number, color-coded (artifact=purple, resolution=green)
- `.timeline-gap` — center text, muted color, arrow notation
- `.timeline-caption` — small muted text below track
- `.tl-slot` — monospace slot number, highlighted

Timeline should work on mobile (stack vertically if narrow).

---

## Slot-to-time Conversion

Solana devnet: ~400ms per slot. Display as:
- `gap_slots` slots
- `(gap_slots * 0.4).toFixed(0)` seconds approximate

Label: `~N sec` in parentheses. Do not claim precision — use `~`.

---

## Acceptance Criteria

- [ ] `POST /api/timeline` returns `{ ok: true, artifact_slot, resolution_slot, gap_slots }` for blessed sig `mUXwae...`
- [ ] `verify.html` shows timeline block after MATCH (artifact_slot < resolution_slot)
- [ ] `play.html` shows `artifact_slot → resolution_slot (+N slots)` per card
- [ ] Timeline block is hidden (not broken) if `/api/timeline` returns error
- [ ] Timeline only shown on MATCH, not on MISMATCH or ERROR
- [ ] Mobile: timeline degrades gracefully (no horizontal overflow)
- [ ] No new npm dependencies

---

## Out of Scope

- Mainnet support (devnet only for now)
- Historical timeline for non-blessed sigs (verify.html already handles arbitrary sigs — timeline works there too)
- Caching timeline results (out of scope, devnet is fast enough)
- Showing full TX history for artifact PDA

---

## Related Tasks

- HACKATHON-CONFIG-ENGINE-001 (closed) — `compiled_artifact_hash` now comes from SDK VerifyResult
- HACKATHON-PUBLISH-001 — timeline must work after public deploy (no localhost assumptions)
- WS-3 Explorer links — already implemented, timeline is additive

---

## Engineer Implementation Summary - 2026-04-15 16:51:06 +0300

Status: Ready for Tester.

Implementation:
- Added `POST /api/timeline` in `web/server.mjs` with raw JSON-RPC calls for `getTransaction` and `getSignaturesForAddress`, 8s request timeout, inline approved artifact PDA derivation via `PublicKey.findProgramAddressSync`, and `{ ok:false, error }` fallback.
- Added MATCH-only full pre-commitment proof rendering to `web/public/verify.html`.
- Added fire-and-forget compact timeline slot rows to blessed signature cards in `web/public/play.html`.
- Added timeline CSS classes to `web/public/app.css`, including wrapped flex layout for mobile and existing dark theme variables.

Test Evidence:
- `node --check web/server.mjs` passed.
- `npx tsc --noEmit` passed.
- `yarn install --frozen-lockfile` passed.
- `yarn -s replay --help` passed.
- `yarn -s resolve:operator --help` passed.
- `yarn web` started successfully on `http://127.0.0.1:8787`.
- `GET /api/health` returned `ok:true`.
- `POST /api/timeline` for blessed signature `mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh` returned `artifact_slot: 455663125`, `resolution_slot: 455693113`, `gap_slots: 29988`.
- `POST /api/timeline` with invalid artifact hash returned `{ ok:false, error:"compiledArtifactHash must be 32-byte hex" }`.
- `GET /verify.html` returned HTTP 200.
- `GET /play.html` returned HTTP 200.
- `git diff --check` passed.
- No package or lockfile diff was produced.

Known Verification Gap:
- Browser visual automation was not completed because the local Playwright browser lookup failed: Chrome was not installed at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. HTTP/API/static checks passed instead.

Tester Handoff Prompt:

```

---

## Tester Verification Summary - 2026-04-15 17:04:53 +0300

Status: Returned to Engineer.

### Commands Run

- `npx tsc --noEmit`: passed.
- `yarn -s replay --help`: passed.
- `yarn -s resolve:operator --help`: passed.
- `yarn web`: failed inside sandbox with `EPERM listen 0.0.0.0:8787`, then passed with elevated local bind permission and served `http://127.0.0.1:8787`.
- `curl -sS http://127.0.0.1:8787/api/health`: passed.
- `curl -sS http://127.0.0.1:8787/api/timeline ...`: passed for blessed signature.
- `curl -sS http://127.0.0.1:8787/api/timeline ... compiledArtifactHash=bad`: returned expected graceful `{ ok:false, error }`.
- Playwright browser matrix `/tmp/timeline-ui-soft-check.js`: failed only on mobile page horizontal overflow.

### Browser/API Evidence

- `/api/timeline` response for blessed signature:
  - `ok: true`
  - `artifact_slot: 455663125`
  - `resolution_slot: 455693113`
  - `gap_slots: 29988`
- `GET /verify.html`: HTTP 200.
- `GET /play.html`: HTTP 200.
- Browser MATCH flow on `verify.html` rendered:
  - `PRE-COMMITMENT PROOF`
  - `ARTIFACT LOCKED`
  - `slot 455,663,125`
  - `← 29,988 slots (~11,995 sec) →`
  - `OUTCOME DRAWN`
  - `slot 455,693,113`
  - caption explaining rules were committed before the outcome was drawn.
- Browser mocked `MISMATCH`: timeline hidden and `/api/timeline` was not called.
- Browser mocked replay `ERROR`: timeline hidden.
- Browser mocked `/api/timeline` failure after `MATCH`: main `MATCH` result stayed visible and timeline block was hidden.
- `play.html` with delayed `/api/timeline` calls rendered `.sig-card` before timeline calls completed (`1043ms` while timeline calls were delayed `1500ms`).
- `play.html` compact rows appeared:
  - `slot 455,663,125 → 455,693,113 (+29,988 slots)`
- Mobile viewport metrics:
  - `clientWidth: 375`
  - `scrollWidth: 466`
  - `.timeline-track width: 301`
  - `.timeline-block width: 343`
  - `.timeline-track flex-wrap: wrap`
- Mobile overflow offenders:
  - `NAV.nav`: `left=269`, `right=466`, `width=197`
  - active `Verify` link: `left=337`, `right=402`, `width=65`
  - `Spec` link: `left=406`, `right=466`, `width=60`

### Pass/Fail By Acceptance Criterion

- `POST /api/timeline` returns expected slots for blessed signature: pass.
- `verify.html` shows full timeline only after `MATCH`: pass.
- `verify.html` hides timeline on `MISMATCH`: pass.
- `verify.html` hides timeline on `ERROR`: pass.
- `verify.html` hides timeline on `/api/timeline` failure: pass.
- `play.html` shows compact timeline slot line per blessed signature card: pass.
- `play.html` does not block card rendering on timeline fetch: pass.
- Mobile timeline track wraps: pass.
- No horizontal overflow on mobile: fail.
- Existing commands remain intact: pass for `yarn web`, `yarn -s replay --help`, `yarn -s resolve:operator --help`, `npx tsc --noEmit`.

### Regressions / Risks

- Blocker: mobile page horizontal overflow exists at 375px viewport. The timeline itself wraps correctly; the overflow is caused by the header navigation, so a small responsive nav CSS fix should be sufficient.
- Playwright had to be installed in the local skill directory because Chrome was not installed at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
- Existing untracked config artifacts are still present from prior config-engine verification and were not part of this timeline test.

### Verdict

Rejected for now. Return to Engineer for the mobile horizontal overflow fix, then re-run Tester verification.

### Engineer Handoff Prompt

Fix `HACKATHON-TIMELINE-001` in `/Users/timurkurmangaliev/verifiable-outcome-engine`.

Scope:
- Do not change Rust or replay semantics.
- Keep `/api/timeline` behavior unchanged.
- Fix the mobile horizontal overflow found on `verify.html` at 375px viewport.

Evidence:
- All API/MATCH/MISMATCH/ERROR/timeline-failure/play compact timeline criteria passed.
- `.timeline-track` wraps correctly and stays inside `.timeline-block`.
- Page overflow remains: `documentElement.clientWidth=375`, `scrollWidth=466`.
- Overflow offenders are header nav elements:
  - `NAV.nav right=466`
  - active `Verify` link right `402`
  - `Spec` link right `466`

Expected fix:
- Responsive header/nav CSS adjustment so mobile viewport has no horizontal overflow.
- Re-run:
  - `npx tsc --noEmit`
  - `yarn -s replay --help`
  - `yarn -s resolve:operator --help`
  - `yarn web`
  - `/api/timeline` blessed check
  - browser mobile overflow check

Confidence: high.
You are the Tester for Verifiable Outcome Engine. Verify HACKATHON-TIMELINE-001 in /Users/timurkurmangaliev/verifiable-outcome-engine.

Scope:
- Validate /api/timeline for the blessed devnet signature.
- Validate verify.html shows the full pre-commitment timeline only after MATCH.
- Validate verify.html hides the timeline on MISMATCH, ERROR, or /api/timeline failure.
- Validate play.html shows one compact timeline slot line per blessed signature card without blocking card rendering.
- Validate mobile wrapping for the timeline track and no horizontal overflow.
- Confirm existing commands remain intact: yarn web, yarn -s replay --help, yarn -s resolve:operator --help, npx tsc --noEmit.

Acceptance input:
- rpcUrl: https://api.devnet.solana.com
- programId: 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq
- signature: mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh
- compiledArtifactHash: 4a3304a5cb2804331078c6e09b687fdbce1545e2cda5d77ef0c1eb3ab7688ed7

Expected /api/timeline result:
- ok: true
- artifact_slot: 455663125
- resolution_slot: 455693113
- gap_slots: 29988

Report:
1. Commands run
2. Browser/API evidence
3. Pass/fail by acceptance criterion
4. Regressions or risks
5. Verdict for Hub
```

---

## Tester Re-verification Summary - 2026-04-15 17:14:58 +0300

Status: Ready for Hub acceptance.

### Commands Run

- `npx tsc --noEmit`: passed.
- `yarn -s replay --help`: passed.
- `yarn -s resolve:operator --help`: passed.
- `yarn web`: failed inside sandbox with `EPERM listen 0.0.0.0:8787`, then passed with elevated local bind permission and served `http://127.0.0.1:8787`.
- `curl -sS http://127.0.0.1:8787/api/timeline ...`: passed for blessed signature.
- Playwright browser matrix `/tmp/timeline-ui-soft-check.js`: passed.
- Playwright focused recheck `/tmp/timeline-mobile-recheck.js`: passed.

### Browser/API Evidence

- `/api/timeline` response for blessed signature:
  - `ok: true`
  - `artifact_slot: 455663125`
  - `resolution_slot: 455693113`
  - `gap_slots: 29988`
- `verify.html` MATCH flow rendered full timeline:
  - `slot 455,663,125`
  - `← 29,988 slots (~11,995 sec) →`
  - `slot 455,693,113`
- `verify.html` mocked `MISMATCH`: timeline hidden and `/api/timeline` not called.
- `verify.html` mocked replay `ERROR`: timeline hidden.
- `verify.html` mocked `/api/timeline` failure after `MATCH`: timeline hidden without breaking main `MATCH` result.
- `play.html` rendered cards before delayed timeline calls completed and then showed compact rows:
  - `slot 455,663,125 → 455,693,113 (+29,988 slots)`
- Mobile viewport 375px:
  - `clientWidth: 375`
  - `scrollWidth: 375`
  - `NAV.nav right: 359`
  - `.timeline-track flex-wrap: wrap`
  - `.timeline-track width: 301`
  - no overflow offenders.
- Desktop viewport 1280px:
  - `clientWidth: 1280`
  - `scrollWidth: 1280`
  - `NAV.nav right: 1252`
  - timeline visible.

### Pass/Fail By Acceptance Criterion

- `POST /api/timeline` returns expected slots for blessed signature: pass.
- `verify.html` shows full timeline only after `MATCH`: pass.
- `verify.html` hides timeline on `MISMATCH`: pass.
- `verify.html` hides timeline on `ERROR`: pass.
- `verify.html` hides timeline on `/api/timeline` failure: pass.
- `play.html` shows compact timeline slot line per blessed signature card: pass.
- `play.html` does not block card rendering on timeline fetch: pass.
- Mobile timeline track wraps: pass.
- No horizontal overflow on mobile 375px: pass.
- Header nav stays inside 375px viewport: pass.
- No new desktop visual overflow at 1280px: pass.
- Existing commands remain intact: pass for `yarn web`, `yarn -s replay --help`, `yarn -s resolve:operator --help`, `npx tsc --noEmit`.

### Regressions / Risks

- No acceptance-blocking regression found.
- `yarn web` still requires local bind permission outside the sandbox in this environment; this is an environment permission issue, not a repo behavior issue.
- Existing untracked generated config artifacts remain present and were not modified by this verification.

### Verdict

Accepted by Tester. Send to Hub for final acceptance.

### Hub Handoff Prompt

Review `HACKATHON-TIMELINE-001` in `/Users/timurkurmangaliev/verifiable-outcome-engine` for final acceptance.

Scope:
- Accept or reject the completed timeline work based on Tester evidence.
- Do not expand scope into Rust, replay semantics, runtime design, or monorepo-only paths.

Tester verdict:
- Accepted by Tester after re-verifying the CSS-only mobile overflow fix.
- `/api/timeline` returns expected blessed devnet slots.
- `verify.html` shows full timeline only after `MATCH`.
- `verify.html` hides timeline on `MISMATCH`, replay `ERROR`, and `/api/timeline` failure.
- `play.html` shows compact timeline slot rows without blocking card rendering.
- Mobile 375px overflow blocker is resolved: `clientWidth=375`, `scrollWidth=375`, `NAV.nav right=359`.
- Desktop 1280px regression check passed: `clientWidth=1280`, `scrollWidth=1280`.
- Existing commands passed: `npx tsc --noEmit`, `yarn -s replay --help`, `yarn -s resolve:operator --help`, `yarn web`.

Decision requested:
- Mark `HACKATHON-TIMELINE-001` accepted if no additional Hub-level concern exists.

Confidence: high.
