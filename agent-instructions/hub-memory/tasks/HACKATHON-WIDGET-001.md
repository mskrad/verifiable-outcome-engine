# Task: HACKATHON-WIDGET-001

**Sprint:** Sprint 3 (Apr 19–25)
**Status:** READY FOR ARCHITECT
**Priority:** High — меняет нарратив с "инструмент" на "примитив который встраивается"

---

## Goal

Создать embed widget — web component `<vre-verify>` который любой проект может вставить на свой сайт одной строкой и показать пользователям результат верификации инлайн.

---

## Problem

Сейчас чтобы проверить раффл пользователь должен идти на verifiableoutcome.online. Это барьер. С виджетом — оператор добавляет одну строку на свой сайт и кнопка "Verify" появляется прямо там.

---

## Implementation Plan

### 1. `web/public/widget.js`

Standalone ES module, никаких зависимостей. Определяет custom element `<vre-verify>`.

**API:**
```html
<script src="https://verifiableoutcome.online/widget.js"></script>
<vre-verify sig="mUXwae..." rpc="https://api.devnet.solana.com"></vre-verify>
```

**Поведение:**
- При загрузке показывает кнопку "Verify outcome"
- При клике делает `POST https://verifiableoutcome.online/api/replay` с `{ signature, url }`
- Показывает результат инлайн: `✓ MATCH` зелёным или `✗ MISMATCH` красным
- Показывает `outcome_id` (winner) если MATCH

**Минимальный HTML вывод:**
```
[ Verify outcome ]
→ ✓ MATCH — winner: 3nafSu5G...
```

### 2. Стили

Inline CSS внутри shadow DOM — не конфликтует со стилями хоста. Тёмный фон `#0d0f14`, teal акцент `#14f195`, шрифт monospace.

### 3. `web/server.mjs`

Добавить route для `widget.js` если не покрывается static:
```js
// already serves web/public/* — widget.js будет доступен автоматически
```

Убедиться что CORS headers позволяют cross-origin запросы к `/api/replay`:
```js
res.setHeader('Access-Control-Allow-Origin', '*');
```

### 4. Demo на `build.html`

Добавить секцию "Embed on your site":
```html
<h3>Embed on your site</h3>
<pre><code>&lt;script src="https://verifiableoutcome.online/widget.js"&gt;&lt;/script&gt;
&lt;vre-verify sig="mUXwae..."&gt;&lt;/vre-verify&gt;</code></pre>
<!-- живой пример виджета прямо на странице -->
<vre-verify sig="mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh"></vre-verify>
```

---

## Acceptance Criteria

- [ ] `https://verifiableoutcome.online/widget.js` отдаёт файл (HTTP 200)
- [ ] `<vre-verify sig="mUXwae...">` рендерится и показывает кнопку
- [ ] Клик → POST `/api/replay` → показывает `MATCH` или `MISMATCH`
- [ ] Работает на чистой HTML странице без других зависимостей
- [ ] `build.html` содержит живой пример виджета
- [ ] CORS: виджет работает с внешнего домена

---

## Notes

- Никаких npm зависимостей в widget.js — должен грузиться как один файл
- Shadow DOM обязателен — стили не должны ломать хост-сайт
- Размер файла: цель < 5KB minified
