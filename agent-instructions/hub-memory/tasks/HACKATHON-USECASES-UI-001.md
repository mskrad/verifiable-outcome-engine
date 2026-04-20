# Task: HACKATHON-USECASES-UI-001

**Sprint:** Sprint 3 (Apr 19–25)
**Status:** READY FOR ARCHITECT
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

- [ ] `play.html` показывает label и description для каждой карточки подписи
- [ ] Raffle / Airdrop / Prediction карточки визуально различимы (badge или группировка)
- [ ] `build.html` содержит 4 use case карточки включая Prediction Market
- [ ] `index.html` упоминает prediction market в списке use case
- [ ] HTTP 200 для `/play.html`, `/build.html`, `/` после изменений
- [ ] `node --check web/server.mjs` — pass

---

## Notes

- Не менять логику `/api/replay` или `/api/health`
- Не менять `web/server.mjs` структуру данных если HACKATHON-AIRDROP-DEMO-001 ещё не завершён — просто подготовить UI к получению `label`, `type`, `description`
- Цвета badge должны работать в текущей CSS схеме (`app.css`)
