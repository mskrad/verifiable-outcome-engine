# Task: HACKATHON-AIRDROP-DEMO-001

**Sprint:** Sprint 3 (Apr 19–25)
**Status:** READY FOR ENGINEER
**Priority:** High — доказывает "Developer Infrastructure", а не single-purpose raffle tool

---

## Goal

Провести resolve на devnet для двух новых use case — **airdrop** и **prediction market** — получить blessed signatures и добавить их в демо. Судья видит три живых сценария в play.html.

---

## New configs to create

### `examples/prediction.config.json`

Prediction market — верифицируемое объявление исхода события. Участники = возможные исходы, weights = их вероятность (задаётся оператором заранее). Тип `loot` — outcome_id и есть объявленный результат.

```json
{
  "type": "loot",
  "input_lamports": 0,
  "outcomes": [
    { "id": "Solana ecosystem wins", "weight": 500, "payout_lamports": 0 },
    { "id": "Ethereum ecosystem wins", "weight": 300, "payout_lamports": 0 },
    { "id": "Bitcoin ecosystem wins", "weight": 200, "payout_lamports": 0 }
  ]
}
```

---

## Implementation Plan

### 1. Resolve airdrop на devnet

Используй существующий `examples/airdrop.config.json` — он уже правильный:
- `slots: 3` — три победителя
- 10 адресов с разными весами

```bash
yarn resolve:operator --config examples/airdrop.config.json
```

Записать signature → это `AIRDROP_SIG`.

### 2. Resolve prediction market на devnet

Создать `examples/prediction.config.json` (см. выше), затем:

```bash
yarn resolve:operator --config examples/prediction.config.json
```

Записать signature → это `PREDICTION_SIG`.

### 3. Добавить в `web/server.mjs`

В массив `BLESSED_SIGNATURES` добавить два объекта:

```js
{
  sig: "<AIRDROP_SIG>",
  label: "Airdrop",
  description: "Weighted selection from eligible address list"
},
{
  sig: "<PREDICTION_SIG>",
  label: "Prediction",
  description: "Verifiable outcome declaration — pre-committed before resolution"
}
```

### 4. Verify обоих signatures

```bash
yarn -s replay --sig <AIRDROP_SIG> --url https://api.devnet.solana.com --json
yarn -s replay --sig <PREDICTION_SIG> --url https://api.devnet.solana.com --json
```

Оба должны вернуть `MATCH / OK`.

---

## Acceptance Criteria

- [ ] `GET /api/health` возвращает `blessed_signatures_count: 5` (было 3, +2)
- [ ] `yarn -s replay --sig <AIRDROP_SIG>` → `MATCH / OK`
- [ ] `yarn -s replay --sig <PREDICTION_SIG>` → `MATCH / OK`
- [ ] `examples/prediction.config.json` добавлен в репо
- [ ] `BLESSED_SIGNATURES` в `server.mjs` содержит оба новых объекта с `label` и `description`

---

## Notes

- Operator wallet должен иметь SOL на devnet: `solana balance`, если мало — `solana airdrop 2`
- `scripts/resolve_operator.ts` — не трогать логику, только запускать
- Визуальное разделение use case на сайте — отдельная задача HACKATHON-USECASES-UI-001
- airdrop config: поле `eligible` (не `participants`), `slots: 3`
