# Task: HACKATHON-COPY-CLAIMS-001

**Sprint:** Sprint 3 (Apr 19–25)
**Status:** READY FOR ENGINEER
**Priority:** High — overclaim риск перед hackathon submission

---

## Goal

Уточнить wording на сайте и в публичных docs без изменения runtime, SDK или Rust/Anchor кода. Устранить overclaim по трём точкам: scope верификации, randomness гарантия, operator boundary.

---

## Problem

Альтернативный хаб провёл аудит live-сайта и выявил четыре wording mismatch:

1. **"any transaction signature"** → слишком широко. Верификатор работает только с VRE-resolved outcome TX.
2. **"No trust required"** → технически слишком сильное. Остаётся доверие к Solana finality, RPC availability, program semantics. Правильнее: `Independently replayable from public RPC data`.
3. **"Randomness is derived from the resolution transaction itself — not controlled by the operator"** → без VRF/commit-reveal это рискованный claim. Оператор может влиять на момент/TX resolve. Безопаснее: `chain-derived resolution input, replayable from the transaction`.
4. **`yarn resolve:operator --config raffle.json`** на Build page → устаревшая команда. Должна быть `vre resolve --config raffle.json --wallet <path>` или явная пометка `repo-local operator command`.
5. **Airdrop "Select N winners"** → явная multi-winner semantics в SDK не подтверждена. Заменить на `weighted eligible-list selection` или пометить `experimental`.

---

## Scope

**Только публичная copy.** Не трогать:
- `sdk/` TypeScript
- `scripts/`
- `programs/outcome/` Rust/Anchor
- `web/server.mjs` логику
- `web/api/` эндпоинты

Файлы для правки:
- `web/public/index.html`
- `web/public/build.html`
- `web/public/play.html` (если есть overclaim)
- `README.md`

---

## Exact Patches

### 1. `web/public/index.html` — hero section

```
БЫЛО:
"Take any transaction signature from a resolved on-chain outcome —
replay it locally from public RPC data and get MATCH / OK."

СТАЛО:
"Take any VRE outcome transaction signature — replay it independently
from public RPC data and get MATCH / OK."
```

```
БЫЛО:
<strong style="color:#14f195">MATCH / OK</strong>.
No trust required.

СТАЛО:
<strong style="color:#14f195">MATCH / OK</strong>.
Independently replayable. No operator trust required.
```

### 2. `web/public/index.html` — feature card "On-chain Randomness"

```
БЫЛО:
"Randomness is derived from the resolution transaction itself — not controlled by the operator."

СТАЛО:
"Resolution input is derived from the transaction itself and is replayable from public chain data."
```

### 3. `web/public/build.html` — operator command

Найти `yarn resolve:operator` и заменить на:

```bash
vre resolve \
  --config raffle.config.json \
  --wallet ~/.config/solana/id.json \
  --rpc https://api.devnet.solana.com \
  --program-id <YOUR_PROGRAM_ID>
```

Добавить рядом пометку:
```
Note: vre resolve requires the admin wallet of the deployed program.
To use the canonical devnet program, contact the VRE team.
To run your own instance, see the Integration Guide.
```

### 4. `web/public/build.html` — airdrop card

```
БЫЛО:
"Airdrop: Select N winners from eligible list"

СТАЛО:
"Airdrop: Weighted eligible-list selection (experimental)"
```

### 5. `README.md`

Проверить и заменить любые `yarn resolve:operator` на `vre resolve ...` в developer-facing секциях.

---

## Acceptance Criteria

- [ ] `rg -n "any transaction signature|No trust required|not controlled by the operator|yarn resolve:operator" web/public README.md` — no matches в non-historical тексте
- [ ] `rg -n "VRE outcome transaction|Independently replayable|chain-derived|vre resolve" web/public README.md` — matches подтверждают замену
- [ ] `npx tsc --noEmit` — pass
- [ ] `node --check web/server.mjs` — pass
- [ ] HTTP 200 для `/`, `/build.html`, `/play.html`, `/verify.html`

---

## Notes

- Не переписывать исторические секции task memory — только append.
- Не менять runtime semantics, replay logic, API responses.
- Airdrop card: пометка `experimental` достаточна — не убирать совсем.
- Сохранить сильную позицию: verifier narrative остаётся, просто bounded.
