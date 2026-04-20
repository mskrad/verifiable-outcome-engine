# Task: HACKATHON-AIRDROP-DEMO-001

**Sprint:** Sprint 3 (Apr 19–25)
**Status:** READY FOR ARCHITECT
**Priority:** High — доказывает "Developer Infrastructure", а не single-purpose raffle tool

---

## Goal

Провести resolve на devnet для двух новых use case — **airdrop** и **prediction market** — получить blessed signatures и добавить их в демо. Судья видит три живых сценария в play.html.

---

## New configs to create

### `examples/prediction.config.json`

Prediction market — верифицируемое объявление исхода события. Тип `loot` — outcome_id и есть объявленный результат.

**Важно:** `buildArtifact()` требует positive safe integer для `input_lamports` и `payout_lamports`. Использовать минимальные ненулевые значения.

```json
{
  "type": "loot",
  "input_lamports": 1,
  "outcomes": [
    { "id": "Solana ecosystem wins", "weight": 500, "payout_lamports": 1 },
    { "id": "Ethereum ecosystem wins", "weight": 300, "payout_lamports": 1 },
    { "id": "Bitcoin ecosystem wins", "weight": 200, "payout_lamports": 1 }
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

### 3. Добавить в `artifacts/outcome_devnet_blessed_signatures.json`

`web/server.mjs` читает этот файл напрямую — `BLESSED_SIGNATURES` array не существует.

Добавить два новых entry в массив `entries`, сохранив схему:

```json
{
  "id": "outcome_core_devnet_sig_4",
  "signature": "<AIRDROP_SIG>",
  "status": "active",
  "program_id": "3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq",
  "verification_result": "MATCH",
  "verification_reason": "OK",
  "runtime_id": "<из replay output>",
  "resolve_id": "0",
  "compiled_artifact_hash": "<из replay output>",
  "label": "Airdrop",
  "description": "Weighted selection from eligible address list",
  "source": "hub_sprint3_2026-04-20",
  "updated_utc": "<дата>"
},
{
  "id": "outcome_core_devnet_sig_5",
  "signature": "<PREDICTION_SIG>",
  "status": "active",
  "program_id": "3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq",
  "verification_result": "MATCH",
  "verification_reason": "OK",
  "runtime_id": "<из replay output>",
  "resolve_id": "0",
  "compiled_artifact_hash": "<из replay output>",
  "label": "Prediction",
  "description": "Verifiable outcome declaration — pre-committed before resolution",
  "source": "hub_sprint3_2026-04-20",
  "updated_utc": "<дата>"
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
