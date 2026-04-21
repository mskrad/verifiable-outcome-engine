# Task: HACKATHON-README-QS-001

**Sprint:** Sprint 3 (Apr 19–25)
**Status:** READY FOR TESTER
**Priority:** High — первое что видит судья

---

## Goal

Добавить Quick-start блок в самый верх README и Before/After таблицу. Разработчик понимает что это и зачем за 10 секунд — до того как читает дальше.

---

## Implementation Plan

### 1. Quick-start блок — после заголовка и описания

```markdown
## Quick start

```bash
npm install -g verifiable-outcome-sdk
vre verify --sig mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh
# verification_result : MATCH
# verification_reason : OK
```

[→ Full integration guide](INTEGRATION.md)
```

### 2. Before/After таблица — после quick-start

```markdown
## The problem

| | Without VRE | With VRE |
|---|---|---|
| **Rules** | Set by operator, not auditable | Locked on-chain before the draw |
| **Winner selection** | Trust the operator's word | Replay independently from public RPC |
| **Verification** | Impossible after the fact | Anyone, anytime: `vre verify --sig <TX>` |
```

### 3. Структура README после правок

```
# Verifiable Outcome Engine
<краткое описание>

## Quick start
<3 команды>

## The problem
<before/after таблица>

<остальное содержимое README>
```

---

## Acceptance Criteria

- [ ] README открывается на GitHub и первый экран содержит quick-start блок
- [ ] Quick-start: три строки — install, verify, результат
- [ ] Before/After таблица присутствует и читается без прокрутки на десктопе
- [ ] Ссылка на INTEGRATION.md рядом с quick-start

---

## Notes

- Не переписывать весь README — только добавить блоки в начало
- Существующее содержимое сдвигается вниз
- Проверить что код-блоки рендерятся корректно на github.com

---

## Documenter Update — 2026-04-21 16:23:53 +0300

### Facts

- User supplied updated scope for `HACKATHON-README-QS-001`.
- Current scope is narrower and more judge-facing than the older task plan:
  - add `Quick Verify` immediately after `# Verifiable Outcome Engine`
  - add Before/After table after the existing `## Problem` section
  - do not touch code, `web/server.mjs`, SDK, or Rust

### Patch Summary

- Added `## Quick Verify` at the top of `README.md`.
- Added npm global install command:
  - `npm install -g verifiable-outcome-sdk`
- Added one verification command:
  - `vre verify --sig mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh`
- Added expected output comment:
  - `# -> MATCH / OK`
- Added live verifier URL for `https://verifiableoutcome.online/verify.html?sig=...`.
- Added Before/After table after the Problem section.

### Verification

- `sed -n '1,80p' README.md`: confirmed `Quick Verify` immediately follows the title and the Before/After table follows `## Problem`.
- `git diff --check`: passed.

### Risks / Unknowns

- The Quick Verify command depends on npm/global install and devnet RPC availability.
- No live RPC verification was requested for this documentation-only task.
- `STATUS.md` was updated on disk but is ignored in this worktree; tracked state changes are in `CURRENT_TASK.md` and this task memory.

### Tester Handoff Prompt

Участник: Tester

Verify `HACKATHON-README-QS-001` in `/Users/timurkurmangaliev/verifiable-outcome-engine`.

Scope:
- README documentation only.
- Do not change code, `web/server.mjs`, SDK, Rust/Anchor, or other docs unless a verification blocker is found.

Acceptance:
- `README.md` starts with `## Quick Verify` immediately after `# Verifiable Outcome Engine`.
- Quick Verify includes:
  - `npm install -g verifiable-outcome-sdk`
  - `vre verify --sig mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh`
  - expected output `MATCH / OK`
- Live verifier URL is present.
- Before/After table exists after `## Problem`.
- Existing README structure after those additions is otherwise preserved.
- `git diff --check` passes.

Run:

```bash
sed -n '1,80p' README.md
git diff --check
```

Report:
1. Commands run.
2. Acceptance pass/fail.
3. Any README rendering or scope risks.

Confidence target: high after command evidence.
