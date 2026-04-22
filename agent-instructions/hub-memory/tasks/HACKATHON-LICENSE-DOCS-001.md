# Task: HACKATHON-LICENSE-DOCS-001

**Sprint:** Sprint 3 (Apr 19–25)
**Status:** READY FOR TESTER
**Priority:** High — текущие docs противоречат принятой бизнес-модели
**Owner:** Documentator

---

## Context

Принятая бизнес-модель (HACKATHON-BIZMODEL-001):
- **Tier 1 (Self-serve):** canonical program → protocol fee 0.03 SOL/resolve
- **Tier 2 (Partner):** свой инстанс по партнёрскому соглашению — fee не платят

Текущие docs обещают открытый исходник и свободный self-deploy — это противоречит
revenue модели. Нужно привести в соответствие.

---

## Бизнес-модель для документирования

### Tier 1 — Self-serve (canonical program)
- Используют `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
- Платят protocol fee 0.03 SOL за каждый `resolveOutcome`
- Доступно любому разработчику без согласования

### Tier 2 — Partner instance
- Деплоят собственный инстанс программы
- Исходник программы предоставляется **по партнёрскому соглашению**
- Protocol fee не применяется (flat deal или стратегически бесплатно)
- Целевая аудитория: GameFi платформы, NFT маркетплейсы, крупные операторы

### Верификация — всегда бесплатна
- SDK (TypeScript verify) — бесплатный
- `/api/replay`, verify.html — бесплатные
- "Did I win?" — бесплатный

---

## Что менять

### 1. `LICENSE` — заменить MIT на проприетарную

Заменить содержимое на:

```
Copyright (c) 2026 Timur Kurmangaliev. All rights reserved.

The Verifiable Outcome Engine SDK (TypeScript, located in sdk/) is
available under the MIT License for integration and verification use.

The Solana program source (located in programs/) is proprietary and
confidential. Use of the canonical deployed program
(3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq) is subject to the
protocol fee described in INTEGRATION.md.

Partner deployments of the program source are available under a
separate commercial agreement. Contact: [contact info]
```

### 2. `INTEGRATION.md` — убрать open-source обещания

Строки для удаления/замены:

**Строка 15:**
```
❌ "The Solana program itself is open-source and lives in programs/outcome/"
✅ "The canonical Solana program (3b7T...) is operated by the VRE team."
```

**Строки 17-20 (инструкция по self-deploy):**
```
❌ "To operate your own program ID, clone this repo, deploy programs/outcome with Anchor..."
✅ "To deploy your own instance under a partner agreement, contact the VRE team."
```

**Part 4 — Program Owner секция:**
- Убрать инструкции по `anchor build`, `anchor deploy`, keypair generation
- Заменить на: описание Partner Program (что даёт, как получить)

**Таблица ролей (строки 11-12):**
```
❌ Program Owner | Deploy their own instance... | clone repo, anchor deploy
✅ Partner       | Own instance via partnership | Contact VRE team
```

### 3. `web/public/index.html` — убрать "MIT-licensed SDK"

Найти:
```html
<strong>MIT-licensed SDK</strong>
```
Заменить на:
```html
<strong>Open verification SDK</strong>
```

### 4. `web/public/build.html` — добавить Partner Program CTA

В секцию с use cases или в footer добавить блок:

```html
<div class="partner-block">
  <h3>Need your own instance?</h3>
  <p>Large platforms can deploy VRE under a partner agreement —
     no per-resolution fee, full control over your program ID.</p>
  <a href="mailto:contact@verifiableoutcome.online" class="btn btn-ghost">
    Become a Partner →
  </a>
</div>
```

### 5. `README.md` — добавить секцию Licensing + Partner Program

После Quick Verify блока добавить:

```markdown
## Licensing

The **verification SDK** is open for integration — use it to build artifacts,
verify outcomes, and replay results from chain data.

The **Solana program** (`3b7T...`) runs on a protocol fee model:
each `resolveOutcome` call pays a small fee to the VRE treasury.

**Partners** (large platforms, GameFi, NFT marketplaces) can deploy
their own instance under a commercial agreement — no per-tx fee.
[Contact us](mailto:contact@verifiableoutcome.online)
```

---

## Acceptance Criteria

- [ ] `LICENSE` — не MIT, чётко разделяет SDK (открыт для интеграции) и программу (проприетарная)
- [ ] `INTEGRATION.md` — нет фразы "open-source" рядом с программой
- [ ] `INTEGRATION.md` — Part 4 заменён на Partner Program описание
- [ ] `index.html` — нет "MIT-licensed SDK"
- [ ] `README.md` — есть секция Licensing с двух-тировой моделью
- [ ] `build.html` — есть Partner CTA
- [ ] `git diff --check` — pass
- [ ] `node --check web/server.mjs` — pass

---

## Constraints

- Не менять API логику, SDK код, Rust
- Не удалять INTEGRATION.md целиком — только убрать противоречащие части
- Тон: деловой, не агрессивный. "Partner agreement" звучит лучше чем "proprietary closed"
- Сохранить все anchor IDs и ссылки на spec.html

---

## Documentator Result — 2026-04-22 13:27:02 +0300

### Files changed

- `LICENSE`
- `README.md`
- `INTEGRATION.md`
- `web/public/index.html`
- `web/public/build.html`
- `STATUS.md`
- `agent-instructions/hub-memory/CURRENT_TASK.md`
- `agent-instructions/hub-memory/tasks/HACKATHON-LICENSE-DOCS-001.md`

### Patch summary

- Replaced root `LICENSE` with the accepted split-license model:
  - TypeScript SDK in `sdk/` is MIT for integration and verification use.
  - Solana program source in `programs/` is proprietary and confidential.
  - Canonical program usage is subject to protocol fee terms in `INTEGRATION.md`.
  - Partner deployments require a separate commercial agreement.
- Added README `Licensing` section after Quick Verify.
- Updated `INTEGRATION.md` role split:
  - Verifier, Builder, Operator, Partner.
  - Canonical program is operated by the VRE team.
  - Partner instance path replaces public self-deploy instructions.
  - Verification remains free.
- Replaced `MIT-licensed SDK` with `Open verification SDK` on the homepage.
- Added Partner CTA to `web/public/build.html`.
- Updated `STATUS.md` and `CURRENT_TASK.md` for the task transition.

### Verification commands

- `git diff --check`: passed.
- `node --check web/server.mjs`: passed.
- Forbidden public-doc grep returned no matches:
  - `open-source`
  - `clone this repo`
  - `deploy programs/outcome`
  - `Program Owner`
  - `anchor build`
  - `anchor deploy`
  - `MIT-licensed SDK`
  - `self-deploy`
- Positive grep confirmed partner/licensing copy in `LICENSE`, `README.md`,
  `INTEGRATION.md`, `web/public/index.html`, and `web/public/build.html`.

### Tester Handoff Prompt

```text
Участник: Tester

Verify HACKATHON-LICENSE-DOCS-001 in /Users/timurkurmangaliev/verifiable-outcome-engine.

Branch: main

Перед стартом прочитай:
1. AGENTS.md
2. agent-instructions/AGENTS.md
3. agent-instructions/standards/AGENT_GLOBAL.md
4. agent-instructions/hub-memory/CURRENT_TASK.md
5. agent-instructions/hub-memory/tasks/HACKATHON-LICENSE-DOCS-001.md

Scope:
- Documentation/licensing copy only.
- Do not change SDK behavior, Rust/Anchor code, server logic, replay semantics, or API behavior.

Acceptance:
- `LICENSE` separates SDK MIT integration/verification use from proprietary Solana program source.
- `INTEGRATION.md` no longer says the Solana program is open-source or freely self-deployable.
- `INTEGRATION.md` Part 4 is Partner Program, not Anchor self-deploy instructions.
- `web/public/index.html` no longer contains `MIT-licensed SDK`.
- `README.md` contains `## Licensing` after Quick Verify and documents canonical program protocol fee plus partner instance path.
- `web/public/build.html` contains the Partner CTA with `mailto:hello@verifiableoutcome.online`.
- `git diff --check` passes.
- `node --check web/server.mjs` passes.

Report:
1. Commands run.
2. Grep evidence for removed forbidden copy and added partner/licensing copy.
3. PASS/FAIL with risks.

Confidence target: high after command evidence.
```
