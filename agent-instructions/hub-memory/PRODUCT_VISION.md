# Product Vision — Verifiable Outcome Engine

**Confidential — internal only. Not for public repo or hackathon submission.**
**Date:** Apr 22, 2026

---

## Полная архитектура продукта

```
┌─────────────────────────────────────────────────────┐
│  Layer 3: Marketplace                               │
│  Slot/game marketplace: devs publish, casinos buy  │
│  B2B: slot developers ↔ online casino operators    │
│  Status: future, private                           │
└───────────────────────┬─────────────────────────────┘
                        │ built on
┌───────────────────────▼─────────────────────────────┐
│  Layer 2: Slot Template Engine                      │
│  Create slots from templates, configure RTP,        │
│  outcome weights, payout tables via UI/config       │
│  Status: exists, private                           │
└───────────────────────┬─────────────────────────────┘
                        │ built on
┌───────────────────────▼─────────────────────────────┐
│  Layer 1: VRE — Verifiable Outcome Engine           │
│  Trust/verification runtime on Solana               │
│  committed rules → resolved outcome → replay → MATCH│
│  Status: public, hackathon submission               │
└─────────────────────────────────────────────────────┘
```

---

## Почему начали с Layer 1

- Создать доверие к технологии до продукта
- Широкое распространение VRE = foundation для маркетплейса
- "Built on VRE, the open verification standard for Solana" — сильный нарратив для Layer 3
- Hackathon как способ получить external validation и visibility

---

## Конечная цель (Layer 3)

**Marketplace = первая платформа где:**
- Разработчики создают slot/raffle-like игры из шаблонов (Layer 2)
- Онлайн казино покупают/лицензируют проверяемые игры
- Каждый outcome верифицируем по tx signature — не "provably fair" маркетинг, а реальная проверка
- Игрок видит: rules committed at slot X → resolved at slot Y → MATCH / OK

**Почему это сильнее обычного казино:**
- Обычное онлайн-казино: доверяй нам
- Наш marketplace: математически невозможно смошенничать — правила зафиксированы до результата

---

## Технический анализ: VRF vs VRE randomness

**VRE не использует VRF.** Это сознательное архитектурное решение.

### Как работает randomness в VRE
```
SHA256(master_seed || runtime_id || resolve_id || actor)
```
Детерминированный хеш из on-chain данных. Никакого внешнего оракула.

### Почему это лучше VRF для верификации

| | VRF (Chainlink/Switchboard/Orao) | VRE (SHA256) |
|---|---|---|
| Внешняя зависимость | Нужен оракул | Нет зависимостей |
| Независимый replay | Нужен VRF proof | Любой пересчитает SHA256 |
| Верификация без доверия | Доверяй оракулу | Чистая математика |
| Конкурентная позиция | Zeebit, все текущие | Незанятая территория |

**Это ключевое отличие от всех конкурентов:** VRF решения верифицируют только
случайное число, но не правила. VRE верифицирует rules + outcome вместе,
и replay возможен без внешних зависимостей — только публичные on-chain данные.

### Нюанс: master_seed
`master_seed` задаётся оператором → теоретически может предсказать outcomes.
Для raffle/airdrop (участники зафиксированы заранее) — не критично.
Для real-time slot games (игрок делает ставку в момент) — нужен дополнительный
entropy input (например хеш транзакции игрока). Задача Layer 2.

### Конкурентный анализ (исследование Apr 22, 2026)
- **Stake/Rollbit:** верифицируют RNG, не правила. Нет on-chain rules commitment.
- **Zeebit (Solana, backed by Jump Crypto):** VRF-based, только randomness. Нет replay из tx sig. Consumer product, нет B2B.
- **FunFair (Ethereum):** правильная архитектура (rules on-chain), но умер из-за gas costs. На Solana этой проблемы нет.
- **Chainlink/Switchboard/Orao VRF:** только случайное число, не outcome verification.
- **B2B blockchain game marketplace:** не существует нигде.

**Вывод:** комбинация committed rules + deterministic replay + tx sig verification + B2B marketplace — незанятая территория на всех блокчейнах.

---

## Канонический питч (обновлено May 2026, Josip standard)

**One-liner (5 слов):**
> On-chain proof of who won.

**Blurb (~120 слов, Pixar storytelling):**
> Every Solana app that runs competitions, raffles, airdrops, or loot drops announces a winner. Someone wins, someone loses.
>
> Users have to trust the backend. "We picked the winner" — there's no proof it wasn't rigged after the fact. The more money follows, the bigger the trust gap.
>
> VRE is a Solana program that commits the outcome rules on-chain before resolution. One API call. Anyone can replay the result from a transaction signature and confirm: rules match, winner is correct, nothing changed. The backend is no longer the source of truth.
>
> Live on devnet. Partner Draw API live — any app integrates in 30 minutes with one POST request. 10+ projects already building on it: trading competitions, pack breaks, prediction markets, airdrops.

**Источник:** Josip Volarevic framework (3x Colosseum, 2 wins). Полный video script — JUDGE_MEETING_NOTES.md.

---

## Публичный язык (для хакатона, грантов, инвесторов)

**Никогда не использовать:** casino, slots, gambling, spin, RTP, gambler

**Вместо этого:**
- outcome-based games / verifiable game mechanics
- outcome resolution / outcome weights
- participant, player
- verified game distribution platform
- configurable outcome parameters

Причина: Solana Foundation grants и Colosseum не приветствуют прямой gambling нарратив.
VRE корректно описывается через raffle, loot, prediction markets, trading competitions — это легитимные use cases.

---

## Revenue модель — три сценария

### Сценарий A — VRE standalone (fallback если Layer 2/3 не взлетят)
- Protocol fee: `fee_lamports` в ProgramConfig
- **Сейчас:** fee_lamports = 0 (выключен для adoption)
- **Можно включить:** одним изменением конфига, без смены кода
- При 1000 resolve/мес × 0.03 SOL × $130 = ~$3,900/мес
- При 10,000 resolve/мес = ~$39,000/мес
- Судьям/инвесторам: "fee механизм готов, сейчас выключен для роста экосистемы"

### Сценарий B — Layer 2/3 взлетают (основная цель)
- Revenue из marketplace: листинг + % от транзакций
- VRE остаётся бесплатной инфраструктурой (как Ethereum под OpenSea)
- Protocol fee не критичен

### Сценарий C — Гибрид
- VRE canonical: небольшой fee (покрывает инфраструктуру)
- Marketplace: основной revenue
- Partner instances: flat deal для крупных операторов

---

## IP защита

| Компонент | Статус | Обоснование |
|---|---|---|
| VRE runtime (Layer 1) | Открытый (MIT) | Нужно распространение, нет бизнес-логики |
| Solana program (`programs/`) | Закрытый | В GitHub нет, npm удалён |
| Slot template engine (Layer 2) | Приватный | Конкурентное преимущество |
| Marketplace архитектура (Layer 3) | Приватный | Основной продукт, не раскрывать |

---

## Что показывать на хакатоне

✅ Показывать: VRE как verification layer, raffle/airdrop/loot/prediction use cases
✅ Показывать: "fee механизм готов, можно включить"
✅ Показывать: developer infra story, SDK, widget, verify.html
⛔ Не показывать: casino/slots vision, Layer 2, marketplace конкретику
⛔ Не говорить: gambling, RTP, spin

---

## Конкурентный анализ

- **Существующий "provably fair" gambling:** маркетинговый термин, не реальная верификация
- **Chainlink VRF:** только randomness, не верификация outcome + rules
- **никто** не сделал: committed rules → deterministic replay → public verification — удобно и для оператора и для игрока

Execution advantage: Layer 2 уже построен, Layer 1 работает на devnet, понимание проблемы изнутри.

---

## Объём рынка (данные Apr 2026)

| Сегмент | Размер 2025 | Прогноз |
|---|---|---|
| Глобальный онлайн-гемблинг | ~$100B | $150–200B к 2030 |
| **B2B game software (наш прямой рынок)** | **$18.5B** | **$46.2B к 2035 (9.6% CAGR)** |
| Crypto/blockchain gambling | ~$30B | $65B+ к 2026 |
| B2B iGaming платформы | $80B | x1.5 к 2030 |

**Прямой TAM Layer 3 = B2B game content market ($18.5B → $46.2B).**
Pragmatic Play, NetEnt, Evolution — традиционные игроки без on-chain верификации.
Мы не конкурируем с ними напрямую — создаём новую категорию "verified game content".

Ключевой тренд: "provably fair" эволюционирует в industry standard с on-chain верификацией.
Регуляторы начинают рассматривать on-chain verification как compliance tool.

---

## Сценарный анализ

### 🟢 Лучший сценарий (3–5 лет)

**Layer 1:** VRE = стандарт верификации на Solana. 50–100 проектов интегрировали SDK.
"Built on VRE" — знак доверия как "Powered by Stripe". Solana Foundation grant.

**Layer 2:** Indie game developers создают verified игры без написания смарт-контрактов.
500+ игр в шаблонной системе. Аналог Unity Asset Store для blockchain games.

**Layer 3:** "Pragmatic Play на блокчейне". Онлайн казино лицензируют verified игры.
"VRE Certified" badge = конкурентное преимущество для казино перед игроками.
Регуляторы признают on-chain verification как compliance requirement.

**Revenue потенциал:** $5–50M ARR от marketplace fees.

**Ключевой катализатор:** если регуляторы (Malta MGA, UK GC) начнут требовать
верифицируемость outcomes — VRE становится обязательным, а не опциональным.

### 🔴 Худший сценарий

**Регуляторный удар (главный риск):**
- USA: UIGEA делает online gambling нелегальным без лицензии в каждом штате
- EU: каждая страна — отдельная B2B iGaming software license ($10–30k каждая)
- Регулятор может квалифицировать Layer 3 как gambling operator даже при B2B модели
- Crypto не даёт иммунитета от gambling regulations

**Конкурентный риск:**
- Zeebit (Jump Crypto) может скопировать архитектуру за 3–6 месяцев
- Большие ресурсы, связи с Solana Foundation, уже работающий продукт

**Технический риск:**
- Solana downtime убивает доверие к "verifiable outcomes"
- Если Solana проиграет EVM-цепочкам → нужен multichain

**Marketplace риск:**
- Chicken-and-egg: казино не придут без игр, девелоперы — без казино
- Без якорного партнёра на старте → медленная смерть

### ⚖️ Юридическая стратегия

**Правильное позиционирование:**
```
НЕ gambling operator  → не принимаем ставки
НЕ casino             → не держим средства игроков
ТЫ = B2B technology provider + verification infrastructure
```
Аналог: Stripe — не банк. AWS — не gambling operator.

**Защитные шаги:**
1. **Юрисдикция:** Malta, Estonia, Кипр — есть B2B iGaming software licenses
2. **ToS:** "VRE is a technology tool. We do not operate games, accept bets, or hold player funds"
3. **KYC операторов:** верифицировать что казино имеют лицензии в своих юрисдикциях
4. **Только B2B:** игроки взаимодействуют с казино, не с нами

**Приоритет:** консультация gambling lawyer (Malta/Кипр) до запуска Layer 3.
Стоимость: $2–5k. Экономит $500k+ штрафов.

---

## Ecosystem Partnerships — первые контакты

*Обновлено Apr 26, 2026*

### Tier 1 — прямая интеграция, активный контакт

**Assetux / Bogdan (CEO)**
Real exchange, live since 2020. ASX token on Solana, DAO, Telegram wallet, DEX aggregator.
- Немедленный use case: ASX airdrop/raffle с VRE pre-commitment
- PoH Network (его второй проект) = Sybil-resistance слой поверх VRE
- Потенциал: первый реальный B2B кейс с платящим оператором
- Статус: активная переписка, founder acknowledged, ждём ответа про ASX campaigns

**PoH Network — data partnership**
Богдан хочет использовать наши on-chain данные (participant lists, outcomes) для обучения LLM sybil detection. Дали program ID + /api/replay. Взаимовыгодно: они улучшают модель, мы получаем sybil-filtered participants для своих клиентов.

### Tier 2 — потенциал, ранний контакт

**Zaebis.xyz** — prediction markets на Solана, "provably fair" claim, SDK + CLI. VRE делает этот claim реально верифицируемым.

**Battle Royale (мемкоины)** — loot drops, whitelist raffle. Прямой fit.

**GTA San Andreas Wallet** — Solana wallet в Lua внутри игры + Metaplex agents. Loot drops внутри GTA если добавят рандом.

**Proof of Inference** — тот же commit-verify паттерн для AI inference. Arcium overlap.

**AlphaDex (Aibar)** — trading competitions, skill-based (best PnL). Leaderboard snapshot pre-commitment = прямой fit.

**aignt.fun** — AI trading agent platform, agent competitions. Same leaderboard pre-commitment use case.

**Lowkie Protocol** — confidential payout after VRE select. "VRE proves fairness, Lowkie proves privacy." Devnet integration in progress.

**01 Pilot** — agent bounty system on mobile. Payout verification when task completed.

### Что это значит для продукта

Первые инбаунд контакты появились органически через Colosseum Discord за 3 недели.
Все они — операторы с реальной потребностью в verifiable outcomes.
Это подтверждает product-market fit гипотезу: проблема реальная, люди приходят сами.

Приоритет после хакатона: конвертировать Assetux в первый платный B2B кейс.

---

## Post-Hackathon Technical Backlog

Архитектурные улучшения, сознательно отложенные после May 11. Не scope guard — это planned work.

### On-chain Formula Schema (Option A2)

**Что это:** новый `OutcomeResolutionV3` Anchor account и `OutcomeResolvedV3` event с нативным хранением `formula_code` + `target` прямо в on-chain account.

**Почему не сейчас:** для хакатона достаточно W3O1 v3 артефакта + replay (Option A1). Разница невидима снаружи, +300-400 строк Rust churn без практической пользы до May 11.

**Почему важно потом:** другие dApp смогут читать `formula` с chain напрямую, без артефакта. Нужно для Layer 2 (slot template engine) — шаблоны будут читать formula из account, не из JSON.

**Файлы к изменению:** `programs/outcome/src/state/`, новые event structs, новый Anchor discriminator, migration strategy для v1/v2 accounts.

---

## Mainnet Checklist — перед запуском на mainnet

*Источник: SolGov (CSK) audit feedback — Apr 28, 2026*

Текущее состояние devnet Squads multisig:
- Threshold: 1/1 (acceptable для devnet demo)
- Timelock: нет
- Executed proposals: 0
- configAuthority: autonomous (хорошо — не может быть сброшен)

**Что сделать перед mainnet:**

1. **Поднять threshold** — минимум 2/3 или 3/5. 1/1 = фактически single signer, нет реального governance.
2. **Добавить timelock** на upgrade proposals — стандарт для серьёзных протоколов (Squads best practices).
3. **Выполнить хотя бы один proposal** через Squads — показать что governance реально работает, не только настроено.
4. **Написать CSK (SolGov)** после mainnet деплоя — он обещал добавить VRE в dashboard. Контакт: Discord TC channel.
5. **SolGov listing** = независимая внешняя валидация governance для аудиторов и инвесторов.

Squads best practices docs: https://docs.squads.so/main/squads-protocol/security-best-practices

---

## Дедлайны и план — держись его всегда

### 2026

| Дата | Дедлайн | Что должно быть готово |
|---|---|---|
| **May 11, 2026** | Colosseum Frontier submission | VRE Layer 1 полностью готов, pitch video, Colosseum form |
| **Jun 2026** | Post-hackathon | VRE на mainnet (если выиграем/получим grant), npm v0.2.0, первые интеграции |
| **Jul–Aug 2026** | Layer 2 alpha | Slot template engine → первые внешние тесты с 2–3 разработчиками |
| **Sep 2026** | Solana Foundation Grant | Подать заявку с working Layer 1 + Layer 2 prototype |
| **Oct–Dec 2026** | Layer 2 beta | 10+ разработчиков создали игры, feedback loop, итерации |

### 2027

| Дата | Дедлайн | Что должно быть готово |
|---|---|---|
| **Q1 2027** | Layer 3 private beta | Маркетплейс с первыми 5–10 играми, 1–2 якорных казино-партнёра |
| **Q2 2027** | Legal setup | B2B iGaming software license (Malta/Кипр), ToS, gambling lawyer консультация |
| **Q3 2027** | Layer 3 public launch | Открытый маркетплейс, PR в iGaming медиа |
| **Q4 2027** | Revenue | Первые $10–50k MRR от marketplace fees |

### 2028+

| Период | Цель |
|---|---|
| 2028 | $500k–$1M ARR, 50+ игр, 10+ казино-партнёров |
| 2029 | Seed/Series A раунд на основе traction |
| 2030 | $5–10M ARR, рассмотреть multichain |

---

### Правила для поддержания темпа

1. **Каждую неделю** — минимум один коммит или задача закрыта
2. **Каждый месяц** — один внешний контакт: разработчик, казино, инвестор
3. **Каждый квартал** — пересмотр этого документа и обновление дедлайнов
4. **Если застрял** — вернись к Layer 1. Он работает. Это якорь.
5. **Если потерял мотивацию** — вспомни: FunFair умер из-за Ethereum gas costs. На Solana этой проблемы нет. Территория свободна.
