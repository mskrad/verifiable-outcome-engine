# Hackathon Roadmap — Verifiable Outcome Engine

**Hackathon:** Colosseum Frontier, Apr 6 – May 11, 2026
**Category:** Developer Infrastructure
**Repo:** https://github.com/mskrad/verifiable-outcome-engine

---

## North Star

> Any developer building a Solana dApp that involves outcome selection (raffle, airdrop, generative mint, loot) can integrate VRE to make that outcome independently verifiable — without trusting the operator.

The end state for judges:
1. Понятно зачем это нужно (problem statement, не только demo)
2. Понятно как это встроить в свой dApp (developer guide)
3. Видно что гарантия реальна (pre-commitment timeline на chain)
4. Есть более одного use case (не one-trick pony)

---

## Sprint Map

### ✅ Sprint 1 — Demo Surface (Apr 6–11)

**Goal:** судья открывает репо и за 30 секунд видит MATCH.

Done:
- README rewrite (outcome-first)
- Web UI: play.html → verify.html → MATCH
- Blessed devnet signatures (2 active, MATCH/OK)
- resolve:operator helper
- Docs sync, gitignore internal files

---

### Sprint 2 — Make the Guarantee Visible (Apr 12–18)

**Goal:** судья видит не просто MATCH, а *почему MATCH означает честность*.

Workstreams:

**WS-1: Real raffle artifact**
- Заменить `common/rare` артефакт на список Solana-адресов (участники раффла)
- Replay возвращает `winner: <address>` вместо outcome label
- Новые blessed sigs с real-participant artifact

**WS-2: Pre-commitment timeline**
- В `play.html` / `verify.html`: показать `artifact_slot < resolution_slot`
- Fetch из RPC: слот публикации артефакта и слот резолюции
- Визуально: "Rules committed at slot X → Resolved at slot Y (Y > X) → MATCH"
- Это делает неизменяемость видимой, а не просто заявленной

**WS-3: Explorer links**
- В `play.html`: ссылка на Solana Explorer для каждой blessed sig
- Судья одним кликом видит TX on-chain

**WS-4: Public web deploy**
- Задеплоить `yarn web` на Railway / Render / любой VPS
- Shareable URL в README: "Click to verify"
- Нулевой барьер для судьи

Acceptance:
- Судья понимает pre-commitment без чтения кода
- "Click to verify" ссылка работает без yarn install

---

### Sprint 3 — Developer Story (Apr 19–25)

**Goal:** разработчик понимает как встроить VRE в свой dApp.

Done:
- Static `keeper.webp` replaced the keeper video on the current design branch.
- Static MIME handling now covers `svg` as `image/svg+xml` and `webp` as `image/webp`.

Workstreams:

**WS-1: Integration guide**
- `INTEGRATION.md`: пошаговый guide для оператора
- Шаги: compile spec → submit artifact → initialize runtime → resolve → verify
- resolve:operator переподан как tutorial, не internal tool
- Примеры для raffle и airdrop сценария

**WS-2: Second use case**
- ✅ INTEGRATION.md покрывает raffle
- ✅ npm publish + CLI готов

**WS-3: Open smart contract**
- Выложить исходник Anchor program (или ссылку на verified program)
- Минимум: добавить ссылку на Solana Explorer program page

**WS-5: npm publish**
- ✅ verifiable-outcome-sdk@0.1.1 опубликован

**WS-6: Airdrop blessed signature + use cases** ← HACKATHON-AIRDROP-DEMO-001
- Провести airdrop resolve на devnet → получить blessed signature
- Добавить в play.html рядом с raffle
- Показать что это не single-purpose raffle tool
- По возможности добавить третий сценарий (loot или prediction)

**WS-7: Embed widget** ← HACKATHON-WIDGET-001
- `web/public/widget.js` — web component `<vre-verify sig="..."></vre-verify>`
- Хостится на verifiableoutcome.online/widget.js
- Показывает MATCH/MISMATCH инлайн на любом сайте
- Меняет нарратив с "инструмент" на "примитив который встраивается"

**WS-8: Quick-start в README** ← HACKATHON-README-QS-001
- Блок в самом верху README: 3 команды → MATCH
- Before/After таблица: без VRE vs с VRE
- Визуально объясняет проблему за 5 секунд

**WS-9: Week 3 видео** — конец недели (Apr 25)
- Screen recording: конфиг → vre resolve → TX → сайт → MATCH + committed rules
- 2 минуты, голос за кадром
- Показывает developer flow, не только результат

**WS-10: Phantom wallet integration** ← HACKATHON-PHANTOM-001 — READY FOR ARCHITECT
- Connect Phantom на verify.html (read-only)
- "Did I win?" — сравнение адреса кошелька с outcome_id после MATCH
- Показывает user-facing ценность продукта, не только developer infra

**WS-11: New design adaptation** ← HACKATHON-DESIGN-ADAPT-001 ✅
- Адаптация Claude Design в ветке design/claude-design-v1
- Wire up реальные API эндпоинты в новых JS файлах
- ACCEPTED; merged в main ✅

**WS-12: Positioning rewrite** ← HACKATHON-POSITIONING-001
- Переписать всю публичную копию по формуле: кто / что ломается / что получают
- Убрать "dev infrastructure for verifiable outcomes" со всех публичных поверхностей
- Новый хедлайн: "Trustless outcome infrastructure for Solana apps"
- Затрагивает: index.html, play.html, verify.html, build.html, README.md

**WS-13: B2B/B2C стратегия + коммерческое предложение** ← HACKATHON-BIZMODEL-001
- Решение: B2B первичная стратегия (Developer Infrastructure) vs B2C
- Решение: protocol fee per resolution vs subscription
- Итог: pitch документ для Colosseum submission

Acceptance:
- Airdrop blessed signature в play.html рядом с raffle ✅
- widget.js работает на любом внешнем сайте ✅
- README quick-start: 3 команды до MATCH ✅
- Before/After секция на главной или в README ✅
- Phantom "Did I win?" работает на verify.html (HACKATHON-PHANTOM-001 — в работе)
- Новый value prop на всех публичных страницах (HACKATHON-POSITIONING-001)

---

### Sprint 4 — Polish + Ecosystem Signal (Apr 26 – May 4)

**Goal:** проект выглядит как production-grade infra reference, не как хакатон прототип.

Workstreams:

**WS-1: SDK polish**
- ✅ SDK interface готов (Sprint 2): `buildArtifact`, `verifyOutcome`, типы
- ✅ npm publish запланирован в Sprint 3 WS-5
- Этот слот: error taxonomy docs + README раздел "SDK Reference"

**WS-2: Error taxonomy**
- Задокументировать все error/mismatch коды (уже есть в коде, нет в docs)
- Судья видит что failure modes продуманы

**WS-3: Week 3 video + social**
- Показать integration flow end-to-end
- Twitter/X: build-in-public пост с pre-commitment timeline screenshot

**WS-4: Revenue model — Protocol fee (два варианта)**

Вариант A — Shared program с комиссией per-resolution (рекомендуется):
- Все используют канонический задеплоенный program (`3b7T...`)
- Каждый `resolveOutcome` платит комиссию (0.01–0.05 SOL) в treasury wallet
- Изменение в Rust: одна инструкция в `programs/outcome/src/lib.rs`
- Плюсы: проще для разработчика (не нужен anchor deploy), прозрачный revenue stream

Вариант B — Pay-to-deploy registry:
- Перед `initializeProgramConfig` на новом program id — обязательный fee через наш registry contract
- Плюсы: операторы изолированы, больше enterprise-friendly
- Минусы: сложнее архитектурно, выше барьер входа

Решение: принять в начале Sprint 4 после оценки сложности Rust-изменений.

**WS-6: Multi-winner selection (Вариант C)** ← HACKATHON-MULTI-WINNER-001
- Один resolve TX даёт seed (хеш транзакции)
- Победители выводятся детерминированно: `winner[i] = select(shuffle(participants, seed + i))`
- Artifact format: добавить `winners_count: N`
- Изменения только в SDK/artifact — программа на Rust не меняется
- Открывает: крупные airdrop'ы, NFT reveal коллекций, multi-prize raffle, tournament brackets
- Оценка сложности: низкая-средняя (~2 дня инженера)
- Это сильный дифференциатор: на Solana нет верифицируемой multi-winner выборки в одной TX

**WS-5: Site redesign — исследование**
- Оценить редизайн в terminal/hacker стиле (референс: charm.sh)
- Моноспейс шрифт, зелёный на чёрном, ASCII элементы, CLI-ощущение
- Оценить объём токенов и усилий перед реализацией
- Решение: делать или нет — принять в начале Sprint 4

**WS-4: Submission form**
- Заполнить Colosseum submission fields
- Project description, links, category confirmation

Acceptance:
- Репо выглядит как reference infra, не demo
- Submission form готова

---

### Sprint 5 — Final Submission (May 5–11)

**Goal:** финальная подача, pitch video.

Workstreams:

**WS-1: Pitch video (≤3 мин)**
- Problem → Solution → Demo (click to verify) → Developer story → Pre-commitment guarantee
- Снять и загрузить на YouTube/Loom

**WS-2: Final docs pass**
- README финальный review
- Убедиться что нет slot/gambling language
- Colosseum project page актуальна

**WS-3: Week 4 video**
- Last weekly update перед финалом

**WS-4: Submission**
- Финальная подача через Colosseum form

---

## Priority Stack (если времени не хватает)

Если придётся резать — в этом порядке:

| Must have | Nice to have | Can skip |
|---|---|---|
| Real raffle artifact (addresses) | SDK interface | Error taxonomy docs |
| Pre-commitment timeline visible | Second use case (airdrop) | Week 3-4 social posts |
| Public web deploy | Open smart contract | Polish pass |
| Pitch video | INTEGRATION.md | |

---

## Риски

| Риск | Вероятность | Митигация |
|---|---|---|
| Devnet RPC unstable для новых TX | низкая | blessed sigs как fallback |
| Public deploy имеет latency/timeout на replay | средняя | таймаут на server.mjs, документировать |
| Sprint 3 scope слишком большой | средняя | WS-1 (integration guide) приоритет, остальное cut |
| Pitch video не успеть к May 5 | низкая | начать скрипт в Sprint 4 |

---

## Facts / Assumptions / Unknowns

**Facts:**
- Core runtime frozen, working on devnet
- 2 blessed sigs MATCH/OK
- Hackathon category: Developer Infrastructure
- Weekly video window: last 3 days of each week

**Assumptions:**
- Public deploy (Railway/Render) feasible без монорепо зависимостей
- Open-sourcing smart contract не нарушает никаких внутренних ограничений
- Airdrop use case покрывается существующим artifact format

**Unknowns:**
- Требует ли Colosseum финальный submission до May 11 или в конкретный день
- Есть ли ограничения на open-sourcing program source

**Confidence:** medium (Sprint 2 high, Sprint 3+ medium — зависит от решений по open source и deploy)
