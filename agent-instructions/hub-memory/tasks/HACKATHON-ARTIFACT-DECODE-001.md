# Task: HACKATHON-ARTIFACT-DECODE-001

**Sprint:** Sprint 3 (Apr 19–25)
**Status:** READY FOR TESTER
**Priority:** High — needed for Week 2 video and judge UX

---

## Goal

Show the actual raffle rules on verify.html after MATCH — who participated, what weights, who won. This makes "commit rules, then verify" tangible and visual, not just a claim.

---

## Problem

Currently verify.html shows:
- MATCH / OK banner
- Selected Outcome (outcome_id = winner address)
- Raw JSON
- Timeline

Missing: the artifact contents — participants list, weights, winner highlighted. Without this, judges see MATCH but can't see *what* was matched against.

---

## Expected Result

After MATCH, verify.html shows a new section:

```
Committed Rules  (artifact hash: 4a3304...)

Participants — 7 addresses, equal weight

  7xKXabc1...  weight: 1
  9mPQdef2...  weight: 1
  3nRTghi3...  weight: 1  ← Selected ✓
  Bm4Sjkl4...  weight: 1
  Cn5Tmno5...  weight: 1
  Dp6Upqr6...  weight: 1
  Eq7Vstu7...  weight: 1
```

Winner row highlighted in teal. Hash links to artifact on-chain.

---

## Implementation Plan

### 1. `sdk/types.ts`
Add `outcomes` to `VerifyResult`:
```typescript
outcomes?: Array<{
  id: string;
  weight: number;
}>;
```

### 2. `sdk/verify.ts`
In `verifyOutcomeStrict`, after `parseCompiledArtifact(blob)`:
- Map `parsed.outcomes` → `{ id, weight }` array
- Include in return value

### 3. `scripts/replay_verify.ts`
- Add `outcomes` to `ReplayOutput` type
- Pass through from `result.outcomes`
- Include in JSON output

### 4. `web/server.mjs`
- `outcomes` already flows through `replay` object, no change needed

### 5. `web/public/verify.html`
After MATCH banner, render "Committed Rules" card:
- Table of participants (id truncated, full on hover)
- Weight column
- Winner row: teal highlight + "← Selected" badge
- Card title includes artifact hash (truncated)

### 6. `web/public/app.css`
Add styles:
- `.artifact-rules` card
- `.outcome-row`, `.outcome-row.winner`
- Truncated address with monospace font

---

## Acceptance Criteria

- [x] Signature #3 (raffle) → verify.html shows 7 participant addresses
- [x] Winner address matches `outcome_id`, highlighted in teal
- [x] Weights visible for each participant
- [x] Works for loot artifact too (outcome labels instead of addresses)
- [x] No layout break on mobile
- [x] Raw JSON also includes `outcomes` array

---

## Notes

- `parsed.outcomes` already exists in `verifyOutcomeStrict` — just not returned
- `outcomeIdString(o.outcomeId, o.outcomeIdLen)` converts Buffer → string
- For loot artifacts, id is a label like "legendary" — same UI works

---

## Implementation Evidence

Updated: 2026-04-17 17:11:48 +0300

- `sdk/types.ts`: `VerifyResult` now exposes optional `outcomes?: Array<{ id: string; weight: number }>`.
- `sdk/verify.ts`: `verifyOutcomeStrict` maps `parsed.outcomes` through `outcomeIdString(...)` and returns decoded ids plus weights on `MATCH`.
- `scripts/replay_verify.ts`: replay JSON now includes `outcomes`; mismatch/error output includes `outcomes: []`.
- `web/server.mjs`: unchanged; replay object pass-through already carries `outcomes`.
- `web/public/verify.html`: renders a hidden-by-default `artifactRulesSection`; after `MATCH`, it shows `Committed Rules`, truncated artifact hash, participant/outcome rows, weights, and a teal `Selected` winner row.
- `web/public/app.css`: added `.artifact-rules`, `.outcome-row`, `.outcome-row.winner`, monospace truncation, and mobile wrapping rules.

Verification run:

- `npx tsc --noEmit`: passed.
- `node --check web/server.mjs`: passed.
- Raffle replay command returned `MATCH / OK`, `outcomes.length=7`, and winner `3nafSu5GVq9bDLAxCg2gPucT4Jzhi2Ybyy2QbhzTMFR9`.
- Loot replay command returned `MATCH / OK` with labels `common` and `rare`.
- Local `yarn web` started on `http://127.0.0.1:8787`.
- Local `POST /api/replay` returned `ok:true` with `replay.outcomes`.
- Brave headless at 375px for raffle: `clientWidth=375`, `scrollWidth=375`, rules card visible, 7 rows, one winner row, raw JSON contains `outcomes`.
- Brave headless at 375px for loot: `clientWidth=375`, `scrollWidth=375`, labels `common` and `rare`, winner `common`.

## Handoff

Next owner: Tester.

Required checks:

- Re-run `npx tsc --noEmit`.
- Re-run `node --check web/server.mjs`.
- Start `yarn web`.
- Verify `verify.html?sig=mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh` shows 7 participant rows, weights, and winner `3nafSu5GVq9bDLAxCg2gPucT4Jzhi2Ybyy2QbhzTMFR9` highlighted.
- Verify `verify.html?sig=3iC7i15CakPWD47DZ72WgYYuKQdPW8qwu2Usy77rm8RjKkvocvELHqN1yMqM4MiXLcpiAb52u6z2btMKCAZsmDW1` shows loot labels `common` and `rare`.
- Verify raw JSON contains `outcomes`.
- Verify 375px mobile layout has no horizontal overflow.
