# Task: HACKATHON-README-QS-001

**Sprint:** Sprint 3 (Apr 19–25)
**Status:** READY FOR ARCHITECT
**Priority:** Medium — первое что видит разработчик на GitHub

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
