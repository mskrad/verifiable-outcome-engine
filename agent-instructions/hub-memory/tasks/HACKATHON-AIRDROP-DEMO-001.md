# Task: HACKATHON-AIRDROP-DEMO-001

**Sprint:** Sprint 3 (Apr 19–25)
**Status:** READY FOR ENGINEER
**Priority:** High — доказывает "Developer Infrastructure", а не single-purpose raffle tool

---

## Goal

Провести airdrop resolve на devnet, добавить blessed signature в `play.html` рядом с raffle. Судья видит два живых use case — raffle и airdrop — в одном демо.

---

## Implementation Plan

### 1. Resolve airdrop на devnet

Используй существующий `examples/airdrop.config.json` (или создай если нет):

```json
{
  "type": "airdrop",
  "input_lamports": 0,
  "payout_lamports": 0,
  "participants": [
    { "address": "5RbvSHbSuo9CBjZLtw9RoP775KeqaJyMXkXNsb99AeR4", "weight": 1000 },
    { "address": "Aip3wC6UCgE5628ukFW6z3rDGDVTAXKDG4V3j15tPvEU", "weight": 1000 },
    { "address": "3nafSu5GVq9bDLAxCg2gPucT4Jzhi2Ybyy2QbhzTMFR9", "weight": 1000 },
    { "address": "ABKKERBB9i7MvSbB5s9h6EphiCvXa4FvNDmxWFSdHZqY", "weight": 1000 },
    { "address": "5a38vhRuQhKPQwRQFcgDAw3SYNQcGo7XKuWyvFDK5xjP", "weight": 1000 }
  ]
}
```

```bash
yarn resolve:operator --config examples/airdrop.config.json
```

Записать полученный signature.

### 2. Добавить в `web/server.mjs`

В массив `BLESSED_SIGNATURES` добавить новый объект:

```js
{
  sig: "<AIRDROP_TX_SIG>",
  label: "Airdrop",
  description: "Weighted address selection from eligible list"
}
```

### 3. Обновить `play.html`

Карточки use case должны показывать тип (`Raffle` / `Airdrop`) и краткое описание. Если уже есть label из server.mjs — использовать его.

### 4. Если есть время — добавить loot blessed signature

Третий сценарий: `examples/loot.config.json` → resolve → добавить в blessed.

---

## Acceptance Criteria

- [ ] `GET /api/health` возвращает `blessed_signatures_count: 4` (или больше)
- [ ] `play.html` показывает airdrop карточку с лейблом
- [ ] `POST /api/replay` для airdrop signature возвращает `MATCH / OK`
- [ ] `yarn -s replay --sig <AIRDROP_SIG>` возвращает `MATCH / OK`

---

## Notes

- Operator wallet должен иметь достаточно SOL на devnet
- `scripts/resolve_operator.ts` — не трогать логику, только запускать
- Airdrop config отличается от raffle: нет winner selection, есть eligible list
