# Task: HACKATHON-USECASES-UI-001

**Sprint:** Sprint 3 (Apr 19–25)
**Status:** ACCEPTED
**Priority:** Medium — визуально доказывает "Developer Infrastructure, not single-purpose tool"

---

## Goal

Обновить `play.html` и `build.html` чтобы разные use case были визуально и логически разделены. Судья сразу видит: раффл, airdrop и prediction market — три разных сценария на одном primitive.

---

## Depends on

HACKATHON-AIRDROP-DEMO-001 — нужны blessed signatures для airdrop и prediction market в `server.mjs` прежде чем обновлять UI.

---

## Implementation Plan

### 1. Структура данных

`web/server.mjs` читает `artifacts/outcome_devnet_blessed_signatures.json` и отдаёт `entries` как есть. Нет отдельного `BLESSED_SIGNATURES` array.

После HACKATHON-AIRDROP-DEMO-001 каждый entry в JSON будет иметь поля `label` и `description`. UI должен читать эти поля из `/api/health` или нового эндпоинта `/api/signatures`.

Проверить: как сейчас `play.html` получает список подписей — через `/api/health` или отдельный вызов? Использовать тот же источник, добавить `label` и `description` в ответ если их нет.

### 2. `web/public/play.html` — карточки по use case

**Сейчас:** все blessed signatures показываются одинаково.

**Нужно:** сгруппировать карточки по типу или показывать label + description на каждой.

Вариант A — горизонтальные группы:
```
── Raffle ──────────────────
  [карточка подписи]

── Airdrop ─────────────────
  [карточка подписи]

── Prediction ──────────────
  [карточка подписи]
```

Вариант B — badge на каждой карточке:
```
┌─────────────────────────┐
│ 🎟 RAFFLE               │
│ mUXwae...1Lg9Qh         │
│ Select winner from list │
└─────────────────────────┘
```

**Рекомендую Вариант B** — проще, не ломает существующий layout.

Badge цвета по типу:
- `raffle` → teal `#14f195`
- `airdrop` → blue `#6366f1`
- `prediction` → orange `#f59e0b`
- `loot` → purple `#a855f7`

### 3. `web/public/build.html` — Use Cases секция

Сейчас три карточки: Raffle / Loot / Airdrop.

Добавить четвёртую: **Prediction Market**.

```html
<div class="feature">
  <div class="feature-icon">🔮</div>
  <h4>Prediction Market</h4>
  <p>Pre-commit possible outcomes and their weights before the event resolves.
     Anyone can verify the declared result matches the pre-committed spec.</p>
</div>
```

### 4. `web/public/index.html` — feature card "Drop-in for any dApp"

Обновить пример use case:
```
БЫЛО: "Raffle, loot table, airdrop selection"
СТАЛО: "Raffle, airdrop, loot table, prediction market"
```

---

## Acceptance Criteria

- [x] `play.html` показывает label и description для каждой карточки подписи
- [x] Raffle / Airdrop / Prediction карточки визуально различимы (badge или группировка)
- [x] `build.html` содержит 4 use case карточки включая Prediction Market
- [x] `index.html` упоминает prediction market в списке use case
- [x] HTTP 200 для `/play.html`, `/build.html`, `/` после изменений
- [x] `node --check web/server.mjs` — pass

---

## Notes

- Не менять логику `/api/replay` или `/api/health`
- Не менять `web/server.mjs` структуру данных если HACKATHON-AIRDROP-DEMO-001 ещё не завершён — просто подготовить UI к получению `label`, `type`, `description`
- Цвета badge должны работать в текущей CSS схеме (`app.css`)

---

## Engineer Result - 2026-04-21 12:41:21 +0300

### Status

READY FOR TESTER.

### Facts

- `web/server.mjs` already serves `artifacts/outcome_devnet_blessed_signatures.json` as-is via `GET /api/blessed-signatures`.
- `play.html` already fetched `/api/blessed-signatures`; no server change was required.
- Current blessed JSON has explicit `label` and `description` for Airdrop and Prediction. Older entries do not have these fields, so UI fallbacks are used for those cards.

### Files changed

- `web/public/play.html`
- `web/public/app.css`
- `web/public/build.html`
- `web/public/index.html`
- `agent-instructions/hub-memory/tasks/HACKATHON-USECASES-UI-001.md`
- `agent-instructions/hub-memory/CURRENT_TASK.md`
- `STATUS.md`

### Implementation evidence

- `play.html` now renders a use-case badge, label, and description for every active signature card.
- Badge colors:
  - raffle: `#14f195`
  - airdrop: `#6366f1`
  - prediction: `#f59e0b`
  - loot: `#a855f7`
- Type is derived from `label`, `description`, `source`, `notes`, and `id`. This keeps the UI compatible with entries that do not yet have an explicit `type` field.
- `build.html` now has 4 use case cards: Raffle, Loot, Airdrop, Prediction Market.
- `index.html` now includes `prediction market` in the Drop-in feature card.
- No changes were made to `web/server.mjs`, SDK, Rust, replay semantics, or JSON artifacts.

### Command evidence

- `npx tsc --noEmit`: passed.
- `node --check web/server.mjs`: passed.
- `git diff --check`: passed.
- `yarn web`: started successfully on `http://127.0.0.1:8787`.
- Local `GET /`: HTTP `200`.
- Local `GET /play.html`: HTTP `200`.
- Local `GET /build.html`: HTTP `200`.
- Static content check: `build.html` contains `Prediction Market` and required prediction copy; `index.html` contains `prediction market`; `play.html` contains use-case badge code and `/api/blessed-signatures`.
- Brave headless `/play.html` at 375px:
  - `clientWidth=375`
  - `scrollWidth=375`
  - labels rendered: `Loot`, `Loot`, `Raffle`, `Airdrop`, `Prediction`
  - descriptions rendered for all 5 active cards
  - classes rendered: `sig-card-loot`, `sig-card-raffle`, `sig-card-airdrop`, `sig-card-prediction`
- Brave headless `/build.html`: use case cards rendered as `Raffle`, `Loot`, `Airdrop`, `Prediction Market`; required prediction copy present.

### Risks / edge cases

- The blessed JSON does not include explicit `type` fields, so `play.html` classifies entries from existing metadata. If future labels/source strings become ambiguous, adding an explicit `type` field to the JSON would be safer.
- Older generic blessed entries do not have `label` or `description`; the UI falls back to Loot copy so every card still has visible label/description.
- `label` and `description` are display metadata only and do not affect replay or verification.

### Tester Handoff Prompt

```text
Участник: Tester

Verify HACKATHON-USECASES-UI-001 in /Users/timurkurmangaliev/verifiable-outcome-engine.

Перед стартом прочитай:
1. AGENTS.md
2. agent-instructions/AGENTS.md
3. agent-instructions/standards/AGENT_GLOBAL.md
4. agent-instructions/hub-memory/CURRENT_TASK.md
5. agent-instructions/hub-memory/tasks/HACKATHON-USECASES-UI-001.md

Scope:
- Verification only unless a blocking UI issue requires a minimal fix.
- Do not modify Rust/Anchor code.
- Do not change replay semantics.
- Do not change SDK or web/server.mjs.
- Verify only frontend behavior and static content for play/build/index pages.

Expected checks:
- npx tsc --noEmit
- node --check web/server.mjs
- yarn web
- GET / returns HTTP 200.
- GET /play.html returns HTTP 200.
- GET /build.html returns HTTP 200.
- /play.html renders label and description on every active signature card.
- /play.html visually distinguishes Raffle, Airdrop, Prediction, and Loot with badges:
  - raffle #14f195
  - airdrop #6366f1
  - prediction #f59e0b
  - loot #a855f7
- /build.html renders 4 use case cards: Raffle, Loot, Airdrop, Prediction Market.
- /build.html includes the Prediction Market copy from the task.
- / index page Drop-in feature card mentions prediction market.
- Mobile 375px sweep should not introduce horizontal overflow on /play.html.

Important edge cases:
- The blessed JSON has label/description for Airdrop and Prediction but older entries may not have them. The UI uses safe fallback labels/descriptions for those older cards.
- No server changes are expected; /api/blessed-signatures remains the source-of-truth.

When done:
- update agent-instructions/hub-memory/tasks/HACKATHON-USECASES-UI-001.md with verdict, command evidence, and risks;
- update agent-instructions/hub-memory/CURRENT_TASK.md to READY FOR HUB ACCEPTANCE if all checks pass, or BLOCKED with evidence if not;
- update STATUS.md if project-visible state changes;
- provide Hub handoff prompt in the same response.
```

### Confidence

high

## Tester Result - 2026-04-21 12:46:13 +0300

### Status

READY FOR HUB ACCEPTANCE.

### Commands run

- `npx tsc --noEmit`: passed.
- `node --check web/server.mjs`: passed.
- `yarn web`: started on `http://127.0.0.1:8787`.
- `curl -sS -o /tmp/vre-usecases-index.html -w '%{http_code}' http://127.0.0.1:8787/`: returned `200`.
- `curl -sS -o /tmp/vre-usecases-play.html -w '%{http_code}' http://127.0.0.1:8787/play.html`: returned `200`.
- `curl -sS -o /tmp/vre-usecases-build.html -w '%{http_code}' http://127.0.0.1:8787/build.html`: returned `200`.
- `node /tmp/vre-usecases-ui-check.mjs`: passed in headless Brave after fixing a temporary validator selector bug in `/tmp`.
- `git diff --name-only -- web/server.mjs sdk programs scripts/resolve_operator.ts`: no output.
- `git diff --check`: passed.

### Browser / UI evidence

- `/play.html` rendered 5 active signature cards with labels: `Loot`, `Loot`, `Raffle`, `Airdrop`, `Prediction`.
- `/play.html` rendered a non-empty description for every active signature card.
- Badge colors matched expected computed colors:
  - `raffle`: `rgb(20, 241, 149)` / `#14f195`
  - `airdrop`: `rgb(99, 102, 241)` / `#6366f1`
  - `prediction`: `rgb(245, 158, 11)` / `#f59e0b`
  - `loot`: `rgb(168, 85, 247)` / `#a855f7`
- `/build.html` rendered 4 use-case cards: `Raffle`, `Loot`, `Airdrop`, `Prediction Market`.
- `/build.html` included required Prediction Market copy: pre-commit possible outcomes and weights before event resolution; verify declared result against the pre-committed spec.
- `/` Drop-in feature card included `prediction market`.
- `/play.html` at 375px: `clientWidth=375`, `scrollWidth=375`, `overflow=false`, `offenders=[]`.

### Acceptance criteria

- [x] Verification-only scope respected.
- [x] Rust/Anchor code was not modified.
- [x] Replay semantics were not modified.
- [x] SDK and `web/server.mjs` were not modified.
- [x] `npx tsc --noEmit` passed.
- [x] `node --check web/server.mjs` passed.
- [x] `GET /` returned HTTP `200`.
- [x] `GET /play.html` returned HTTP `200`.
- [x] `GET /build.html` returned HTTP `200`.
- [x] `/play.html` rendered label and description on every active signature card.
- [x] `/play.html` visually distinguished Raffle, Airdrop, Prediction, and Loot with the expected badge colors.
- [x] `/build.html` rendered 4 use-case cards: Raffle, Loot, Airdrop, Prediction Market.
- [x] `/build.html` included the Prediction Market copy from the task.
- [x] `/` index Drop-in feature card mentioned prediction market.
- [x] Mobile 375px `/play.html` had no horizontal overflow.

### Regressions / risks

- No regressions found in the checked frontend scope.
- The first browser script run failed because the temporary validator parsed `usecase-badge` as the badge type. DOM evidence in that run already showed correct labels/colors; the temporary script was corrected and rerun successfully.
- The UI still infers use-case type from metadata because blessed entries do not have explicit `type`. This is acceptable for current scope, but future ambiguous metadata could require an explicit type field.
- Older blessed entries still rely on fallback Loot labels/descriptions; the fallback behavior was verified.

### Verdict

PASS. Ready for Hub acceptance.

### Hub Handoff Prompt

```text
Участник: Hub

Review and accept HACKATHON-USECASES-UI-001 in /Users/timurkurmangaliev/verifiable-outcome-engine.

Перед стартом прочитай:
1. AGENTS.md
2. agent-instructions/AGENTS.md
3. agent-instructions/standards/AGENT_GLOBAL.md
4. agent-instructions/hub-memory/CURRENT_TASK.md
5. agent-instructions/hub-memory/tasks/HACKATHON-USECASES-UI-001.md

Tester verdict: PASS, ready for Hub acceptance.

Evidence summary:
- `npx tsc --noEmit`: passed.
- `node --check web/server.mjs`: passed.
- `GET /`, `GET /play.html`, and `GET /build.html`: HTTP `200`.
- `/play.html` rendered 5 active signature cards with labels `Loot`, `Loot`, `Raffle`, `Airdrop`, `Prediction`.
- Every active signature card rendered a non-empty description.
- Badge computed colors matched expected values: raffle `#14f195`, airdrop `#6366f1`, prediction `#f59e0b`, loot `#a855f7`.
- `/build.html` rendered 4 use-case cards: `Raffle`, `Loot`, `Airdrop`, `Prediction Market`.
- `/build.html` included required Prediction Market copy.
- `/` Drop-in feature card mentioned `prediction market`.
- `/play.html` at 375px had no horizontal overflow: `clientWidth=375`, `scrollWidth=375`, `offenders=[]`.
- Scope guard passed: no diff in `web/server.mjs`, SDK, Rust/Anchor code, or `scripts/resolve_operator.ts`.

Known risks:
- Use-case type is inferred from metadata because blessed entries do not have explicit `type`.
- Older blessed entries use fallback Loot labels/descriptions; this was verified.

If accepted:
- mark HACKATHON-USECASES-UI-001 accepted/closed in task memory;
- update CURRENT_TASK.md and STATUS.md;
- choose the next sprint owner/task.
```

### Confidence

high
