# Task: HACKATHON-WIDGET-001

**Sprint:** Sprint 3 (Apr 19–25)
**Status:** READY FOR HUB SERVER TEST
**Priority:** High — меняет нарратив с "инструмент" на "примитив который встраивается"

---

## Goal

Реализовать embed widget `<vre-verify>` — web component который разработчик вставляет
на любой сайт одной строкой и получает MATCH / OK прямо на своей странице.

Добавить `/widget.html` в навигацию сайта как отдельную страницу с живым демо.

Судья и разработчик видят: это не просто верификатор, это **встраиваемый примитив**.

---

## User-facing result

На сайте появляется новый пункт навигации **Widget**.

`/widget.html` показывает:

```
[hero-badge] Embed · One Tag
Embed MATCH / OK anywhere

[Живой пример — виджет работает прямо на странице]
✅ MATCH / OK
Raffle · slot 455693113

[Copy-paste блок]
<script src="https://verifiableoutcome.online/widget.js"></script>
<vre-verify sig="YOUR_TX_SIGNATURE"></vre-verify>

[Три шага]
1. Add script tag
2. Add <vre-verify sig="..."> where you want the result
3. Your users see MATCH / OK — verified on-chain
```

---

## Scope

### 1. `web/public/widget.js` — web component

Самодостаточный файл. Никаких зависимостей, никакого bundler. Цель < 5KB.

```js
class VreVerify extends HTMLElement {
  async connectedCallback() {
    const sig = this.getAttribute('sig');
    // показать loading state
    // POST https://verifiableoutcome.online/api/replay
    //   { signature: sig, url: "https://api.devnet.solana.com",
    //     program_id: "3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq" }
    // показать результат
  }
}
customElements.define('vre-verify', VreVerify);
```

**API endpoint:** `POST /api/replay` уже существует в `web/server.mjs`.

Widget обращается к `https://verifiableoutcome.online/api/replay` (захардкоженный origin).

**States (auto-verify при загрузке, без клика):**
- Loading: `⏳ Verifying...`
- Match: `✅ MATCH / OK` + label (Raffle / Airdrop / Prediction / Loot) + slot
- Mismatch: `❌ MISMATCH`
- Error: `⚠ Could not verify`

**Стиль:** Shadow DOM + встроенный CSS.
Цвета: MATCH `#14f195`, MISMATCH `#f14d4d`, фон `#0d0f14`, текст `#e8eaf0`, шрифт monospace.
Должен выглядеть нормально на любом внешнем сайте.

### 2. `web/server.mjs` — CORS

`/api/replay` и `/api/health` сейчас не имеют CORS заголовков. Добавить:

```js
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
```

Обработать preflight `OPTIONS` запросы — вернуть 204.

### 3. `web/public/widget.html` — страница демо

Новая страница. Стиль как у остальных страниц (`app.css`). Widget пункт активный в nav.

Структура:
- hero-badge: `Embed · One Tag`
- H2: `Embed MATCH / OK anywhere`
- Подзаголовок: `One script tag. No backend. Verifies any VRE transaction directly on-chain.`
- Живой пример: `<vre-verify sig="mUXwae...">` с blessed raffle signature
- Copy-paste блок с двумя строками кода
- Три шага (Add script → Add tag → Users see MATCH)

### 4. Навигация — все HTML страницы

Добавить `<a href="/widget.html">Widget</a>` в `<nav class="nav">` во всех страницах:
`index.html`, `play.html`, `build.html`, `verify.html`, `spec.html`, `widget.html`

---

## Blessed signature для демо

Raffle: `mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh`
Program ID: `3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
RPC: `https://api.devnet.solana.com`

---

## Acceptance Criteria

- [x] `web/public/widget.js` существует, определяет `<vre-verify>` custom element
- [x] Виджет auto-verifies при загрузке (без клика), показывает `MATCH / OK` для blessed sig
- [x] Виджет показывает loading state пока ждёт ответ
- [x] `/api/replay` и `/api/health` отдают CORS заголовки (`Access-Control-Allow-Origin: *`)
- [x] OPTIONS preflight возвращает 204
- [x] `web/public/widget.html` существует, HTTP 200
- [x] `/widget.html` содержит живой working виджет с blessed sig
- [x] `/widget.html` содержит copy-paste код блок
- [x] Навигация на всех страницах содержит ссылку Widget
- [x] `node --check web/server.mjs` — pass
- [x] `npx tsc --noEmit` — pass
- [x] `git diff --check` — pass

---

## Architect Design Note

Timestamp: 2026-04-21 16:49:56 +0300

### Facts

- `web/server.mjs` already has `POST /api/replay`, `GET /api/health`, and `POST /api/timeline`.
- `POST /api/replay` accepts `signature`, `rpc`, and `programId`; it does not read `url` or `program_id`.
- `POST /api/replay` returns replay data such as `verification_result`, `verification_reason`, `runtime_id`, `compiled_artifact_hash`, `outcome_id`, and decoded `outcomes`.
- `POST /api/replay` does not return transaction slot or blessed-signature label.
- Task constraints require CORS only for `/api/replay` and `/api/health`, so `widget.js` must not depend on `/api/timeline` for slot lookup.
- Existing nav uses fixed CSS grid columns for 4 items; adding Widget requires changing `.nav` grid columns for desktop and mobile breakpoints.

### Selected Design

Implement `web/public/widget.js` as a small plain-JS custom element:

```js
const API_ORIGIN = "https://verifiableoutcome.online";
const DEFAULT_RPC = "https://api.devnet.solana.com";
const DEFAULT_PROGRAM_ID = "3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq";
const KNOWN_SIGNATURES = {
  "mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh": {
    label: "Raffle",
    slot: "455693113"
  }
};
```

`KNOWN_SIGNATURES` is only a demo display map for the blessed raffle signature. It keeps the required `/widget.html` text `Raffle · slot 455693113` without broadening CORS to `/api/timeline` or changing replay semantics. For non-known signatures, render `Outcome` plus a short runtime/hash fallback instead of inventing a slot.

### File-by-file Plan

#### `web/public/widget.js`

- Create zero-dependency, no-bundler file.
- Define `<vre-verify>` only if it is not already registered:

```js
if (!customElements.get("vre-verify")) {
  customElements.define("vre-verify", VreVerify);
}
```

- `VreVerify` behavior:
  - `connectedCallback()` attaches Shadow DOM once and calls `verify()`.
  - Required attribute: `sig`.
  - Optional display overrides: `label`, `slot`.
  - Optional network overrides may be read as `rpc` and `program-id`, but default public docs should use only `sig`.
  - Auto-verifies immediately on load; no click.
  - Uses `AbortController` timeout around 15 seconds.
  - Calls:

```js
fetch(`${API_ORIGIN}/api/replay`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    signature: sig,
    rpc,
    programId
  })
});
```

- Render states:
  - Missing sig: `⚠ Could not verify`
  - Loading: `⏳ Verifying...`
  - Match: `✅ MATCH / OK`
  - Mismatch: `❌ MISMATCH`
  - Error/network/non-JSON: `⚠ Could not verify`
- Match metadata:
  - `label = attr label || KNOWN_SIGNATURES[sig]?.label || classifyReplay(replay)`
  - `slot = attr slot || KNOWN_SIGNATURES[sig]?.slot || ""`
  - For blessed raffle: render exactly `Raffle · slot 455693113`.
  - For generic signatures: render `Outcome · runtime <short>` or `Outcome · artifact <short>`.
- DOM safety:
  - Use `textContent` for dynamic values, not raw interpolated HTML.
  - Static Shadow DOM template can be set via `innerHTML`; dynamic nodes should be assigned after template render.
- CSS inside Shadow DOM:
  - host `display:inline-block; max-width:100%;`
  - panel bg `#0d0f14`, text `#e8eaf0`, monospace, border radius <= 8px.
  - match color `#14f195`, mismatch `#f14d4d`.
  - use `overflow-wrap:anywhere` for signatures/outcome text.
- Size target:
  - Keep under 5120 bytes.
  - Engineer must verify with `wc -c web/public/widget.js`.

#### `web/server.mjs`

- Add scoped CORS helpers near `json()`:

```js
const CORS_API_PATHS = new Set(["/api/replay", "/api/health"]);

function applyCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
```

- At the top of `handleApi(req, res, pathname)`, before route checks:

```js
const corsEnabled = CORS_API_PATHS.has(pathname);
if (corsEnabled) applyCorsHeaders(res);

if (req.method === "OPTIONS") {
  if (corsEnabled) {
    res.writeHead(204);
    res.end();
    return;
  }
  json(res, 404, { ok: false, error: "api route not found" });
  return;
}
```

- Do not add CORS to `/api/timeline`, `/api/spec`, `/api/blessed-signatures`, or static files.
- Do not change replay semantics or response shape.

#### `web/public/widget.html`

- Create a new static page using `app.css`.
- Header/nav order should be:
  - `Demo`
  - `Build`
  - `Verify`
  - `Widget`
  - `Spec`
- Mark Widget nav link as active.
- Include script:

```html
<script src="/widget.js" defer></script>
```

- Page structure:
  - Intro block using existing `build-intro` / `hero-badge` style:
    - `Embed · One Tag`
    - `Embed MATCH / OK anywhere`
    - `One script tag. No backend. Verifies any VRE transaction directly on-chain.`
  - Live example section:

```html
<vre-verify sig="mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh"></vre-verify>
```

  - Copy-paste block:

```html
<pre class="code-block"><code>&lt;script src="https://verifiableoutcome.online/widget.js"&gt;&lt;/script&gt;
&lt;vre-verify sig="YOUR_TX_SIGNATURE"&gt;&lt;/vre-verify&gt;</code></pre>
```

  - Three steps using existing `.stepper` / `.step-card` classes:
    1. `Add script tag`
    2. `Add <vre-verify sig="..."> where you want the result`
    3. `Your users see MATCH / OK — verified on-chain`
- Avoid wrapping the live `<vre-verify>` inside a decorative `.card` if the component itself has a framed panel; use a lightweight page section class instead.

#### `web/public/app.css`

- Update nav grid for 5 links:
  - desktop `.nav { grid-template-columns: repeat(5, 68px); }`
  - `max-width: 640px`: use 5 smaller columns that fit with logo behavior.
  - `max-width: 420px`: use 5 columns around `50px` with reduced gap/padding.
- Add only minimal widget page layout helpers if needed:
  - `.widget-demo-surface`
  - `.widget-copy`
- Reuse existing `.build-intro`, `.hero-badge`, `.section-kicker`, `.stepper`, `.step-card`, `.code-block` where possible.
- After nav update, verify no mobile overflow at 375px.

#### HTML nav updates

Update all files:

- `web/public/index.html`
- `web/public/play.html`
- `web/public/build.html`
- `web/public/verify.html`
- `web/public/spec.html`
- `web/public/widget.html`

Each nav should contain:

```html
<a href="/play.html">Demo</a>
<a href="/build.html">Build</a>
<a href="/verify.html">Verify</a>
<a href="/widget.html">Widget</a>
<a href="/spec.html">Spec</a>
```

Only the current page gets `class="active"`.

### Alternatives Considered

- Call `/api/timeline` from the widget to get `resolution_slot`: rejected for this task because CORS is explicitly scoped to `/api/replay` and `/api/health`.
- Add slot/label fields to `/api/replay`: rejected for this task because it changes API semantics beyond the widget scope.
- Call `/api/blessed-signatures` from the widget: rejected because CORS scope does not include that endpoint and external embeds should not depend on local blessed-list UI data.

### Risks / Edge Cases

- A generic signature will not have a slot in the widget unless the caller provides optional `slot` or the signature is in the small demo map.
- Public-origin hardcode means local `/widget.html` will call `https://verifiableoutcome.online/api/replay`, not the local server. This matches task requirements but local tests need network access to the public site for full live-widget verification.
- `POST /api/replay` can be slow because it runs replay logic through a child process; the widget must keep the loading state visible and show a generic error on timeout.
- Mobile nav may overflow after adding the fifth link unless `app.css` breakpoints are adjusted.
- Since `/api/replay` currently accepts `programId`, using `program_id` from the task sketch would rely on defaults and should be avoided in implementation.

### Verification Plan

Run:

```bash
cd /Users/timurkurmangaliev/verifiable-outcome-engine
node --check web/server.mjs
npx tsc --noEmit
git diff --check
test "$(wc -c < web/public/widget.js)" -lt 5120
```

Run local server:

```bash
cd /Users/timurkurmangaliev/verifiable-outcome-engine
yarn web
```

Check static page/API:

```bash
curl -fsS http://127.0.0.1:8787/widget.html >/tmp/widget.html
curl -i -X OPTIONS http://127.0.0.1:8787/api/replay \
  -H 'Origin: https://example.com' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: Content-Type'
curl -i http://127.0.0.1:8787/api/health -H 'Origin: https://example.com'
```

Expected:

- `OPTIONS /api/replay`: HTTP 204 with `Access-Control-Allow-Origin: *`.
- `GET /api/health`: HTTP 200 with `Access-Control-Allow-Origin: *`.
- `/widget.html`: HTTP 200.
- Browser check: `/widget.html` shows `MATCH / OK` and `Raffle · slot 455693113` for the blessed raffle signature.
- Mobile check at 375px: no page-level horizontal overflow after nav changes.

### Handoff Prompt

```text
Участник: Engineer

Implement HACKATHON-WIDGET-001 in /Users/timurkurmangaliev/verifiable-outcome-engine.

Перед стартом прочитай:
1. AGENTS.md
2. agent-instructions/AGENTS.md
3. agent-instructions/standards/AGENT_GLOBAL.md
4. agent-instructions/hub-memory/CURRENT_TASK.md
5. agent-instructions/hub-memory/tasks/HACKATHON-WIDGET-001.md

Scope:
- Add web/public/widget.js as a zero-dependency plain-JS Shadow DOM web component defining <vre-verify>.
- Add CORS only for /api/replay and /api/health in web/server.mjs, including OPTIONS 204 preflight.
- Add web/public/widget.html demo page.
- Add Widget nav item to index.html, play.html, build.html, verify.html, spec.html, and widget.html.
- Update app.css nav grid for 5 links and add only minimal widget page CSS if needed.

Use the Architect Design Note in the task file as the implementation contract.

Important details:
- widget.js must hardcode API origin https://verifiableoutcome.online.
- widget.js must call POST https://verifiableoutcome.online/api/replay with JSON body keys: signature, rpc, programId.
- Do not use the task sketch keys url/program_id for the actual call.
- widget.js must be plain JS, no dependencies, no bundler, and under 5KB.
- Widget auto-verifies on load; no click.
- Blessed demo signature:
  mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh
- For that signature, the widget must display MATCH / OK and Raffle · slot 455693113.
- Do not change replay semantics, Rust, SDK, artifact format, scripts/resolve_operator.ts, or scripts/outcome_public_sdk.ts.

Required verification:
```bash
cd /Users/timurkurmangaliev/verifiable-outcome-engine
node --check web/server.mjs
npx tsc --noEmit
git diff --check
test "$(wc -c < web/public/widget.js)" -lt 5120
yarn web
curl -i -X OPTIONS http://127.0.0.1:8787/api/replay \
  -H 'Origin: https://example.com' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: Content-Type'
curl -i http://127.0.0.1:8787/api/health -H 'Origin: https://example.com'
curl -fsS http://127.0.0.1:8787/widget.html >/tmp/widget.html
```

Also verify in a browser/headless browser:
- /widget.html renders the live <vre-verify> widget.
- The blessed raffle widget reaches MATCH / OK.
- Copy-paste block is present.
- Widget nav appears on all pages.
- 375px mobile viewport has no horizontal overflow.

When done, update:
- agent-instructions/hub-memory/tasks/HACKATHON-WIDGET-001.md with implementation evidence
- agent-instructions/hub-memory/CURRENT_TASK.md to ready for Tester
- STATUS.md if project-visible state changed

Return:
1. Plan
2. Patch summary
3. Files changed
4. Commands run
5. Risks / edge cases
6. Uncertainty + safest default
```

### Confidence

medium-high. The plan is grounded in current `web/server.mjs`, existing HTML/CSS structure, and task constraints. Main uncertainty is whether generic widget output must show a real slot for every signature; current API/CORS scope only supports exact slot display for known/demo signatures unless scope is broadened.

---

## Constraints

- Не менять replay semantics, Rust, SDK
- Не менять artifact format
- `widget.js` — zero dependencies, plain JS, < 5KB
- CORS только для `/api/replay` и `/api/health`
- Widget hardcodes `https://verifiableoutcome.online` как API origin

---

## Engineer Result - 2026-04-21 17:18:59 +0300

### Status

READY FOR HUB SERVER TEST.

Note: initial local handoff target was Tester, but user later requested direct Hub handoff because the meaningful acceptance check must run on the public server.

### Files changed

- `web/public/widget.js`
- `web/public/widget.html`
- `README.md`
- `DEMO_RUNBOOK.md`
- `RUNBOOK.md`
- `web/server.mjs`
- `web/public/app.css`
- `web/public/index.html`
- `web/public/play.html`
- `web/public/build.html`
- `web/public/verify.html`
- `web/public/spec.html`
- `agent-instructions/hub-memory/tasks/HACKATHON-WIDGET-001.md`
- `agent-instructions/hub-memory/CURRENT_TASK.md`
- `STATUS.md`

### Implementation evidence

- `web/public/widget.js` defines `<vre-verify>` as a zero-dependency plain-JS Shadow DOM custom element.
- `web/public/widget.js` also defines `<vre-verify-form>` as a separate interactive form for users who want to paste their own transaction signature in-page.
- `widget.js` hardcodes `https://verifiableoutcome.online` as API origin.
- `widget.js` keeps a localhost-only fallback to `location.origin` for local demo verification after a public-origin fetch failure.
- `widget.js` posts JSON body keys `signature`, `rpc`, and `programId`.
- `widget.js` does not use `url` or `program_id`.
- `widget.js` auto-verifies in `connectedCallback()`; no click is required.
- `widget.js` includes loading, match, mismatch, and error states.
- Blessed raffle signature display map renders `Raffle · slot 455693113`.
- `web/server.mjs` adds scoped CORS only for `/api/replay` and `/api/health`.
- `OPTIONS` preflight for scoped CORS paths returns HTTP `204`.
- `/api/spec`, `/api/blessed-signatures`, `/api/timeline`, and static files were not given CORS headers.
- `web/public/widget.html` contains a blessed live demo, embed code for custom transaction `<vre-verify sig rpc program-id>`, and interactive `<vre-verify-form>`.
- `README.md`, `DEMO_RUNBOOK.md`, and `RUNBOOK.md` document both embed modes: fixed-signature `<vre-verify>` and paste-your-own-signature `<vre-verify-form>`.
- Widget nav link was added to `index.html`, `play.html`, `build.html`, `verify.html`, `spec.html`, and `widget.html`.
- `app.css` nav grid now supports 5 links and keeps `/widget.html` at 375px without page-level overflow.
- No replay semantics, Rust, SDK, artifact format, `scripts/resolve_operator.ts`, or `scripts/outcome_public_sdk.ts` changes were made.

### Command evidence

- `node --check web/server.mjs`: passed.
- `node --check web/public/widget.js`: passed.
- `npx tsc --noEmit`: passed.
- `git diff --check`: passed.
- `test "$(wc -c < web/public/widget.js)" -lt 5120`: passed; current size is `4065` bytes.
- `yarn web`: started successfully on `http://127.0.0.1:8787`.
- `curl -i -X OPTIONS http://127.0.0.1:8787/api/replay -H 'Origin: https://example.com' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: Content-Type'`: returned HTTP `204` with `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`, and `Access-Control-Allow-Headers: Content-Type`.
- `curl -i http://127.0.0.1:8787/api/health -H 'Origin: https://example.com'`: returned HTTP `200` with CORS headers and `blessed_signatures_count: 5`.
- `curl -fsS http://127.0.0.1:8787/widget.html >/tmp/widget.html`: passed.
- `curl -fsS http://127.0.0.1:8787/widget.js >/tmp/widget.js`: passed.
- `/tmp/widget.js` size from local server: `4065` bytes.
- Negative scoped CORS check: `OPTIONS /api/spec` returned HTTP `404` without CORS headers.
- Negative scoped CORS check: `GET /api/blessed-signatures` returned HTTP `200` without CORS headers.
- Nav check: all six HTML pages contain Widget in the nav; `widget.html` marks Widget active.
- Public API origin check: `POST https://verifiableoutcome.online/api/replay` with `signature`, `rpc`, and `programId` returned `MATCH / OK` for the blessed raffle signature.
- Brave headless `/widget.html` at 375px after real replay:
  - `clientWidth=375`
  - `scrollWidth=375`
  - live demo rendered `✅ MATCH / OK`
  - live demo metadata rendered `Raffle · slot 455693113`
  - `<vre-verify-form>` exists with 3 inputs
  - form submission with the blessed raffle signature rendered `✅ MATCH / OK` and `Raffle · slot 455693113`

### Remaining risks / edge cases

- `widget.js` tries the hardcoded public API origin first. On localhost only, it falls back to the local server after a public-origin failure so `/widget.html` remains testable before public deployment.
- Generic signatures do not get a real slot from the widget unless the caller provides `slot` or the signature is in the small known-signature map. This preserves the task constraint not to broaden CORS to `/api/timeline` and not to change replay response semantics.
- External embeds depend on the public deployment serving the new `widget.js` and scoped CORS headers.

### Hub Server Test Transition - 2026-04-21 17:26:19 +0300

User requested moving the task directly to Hub because widget validation should run on the public server. Local implementation evidence remains valid, but final acceptance should be based on deployed `https://verifiableoutcome.online/widget.js`, deployed scoped CORS, and browser behavior against the public origin.

### Hub Handoff Prompt

```text
Участник: Hub

Coordinate server-side verification for HACKATHON-WIDGET-001 in /Users/timurkurmangaliev/verifiable-outcome-engine.

Перед стартом прочитай:
1. AGENTS.md
2. agent-instructions/AGENTS.md
3. agent-instructions/standards/AGENT_GLOBAL.md
4. agent-instructions/hub-memory/CURRENT_TASK.md
5. agent-instructions/hub-memory/tasks/HACKATHON-WIDGET-001.md

Scope:
- This task is implemented locally and should now be verified on the public server.
- Coordinate deploy/server validation for https://verifiableoutcome.online.
- Do not expand product scope during server test.
- Do not modify Rust/Anchor code.
- Do not change replay semantics.
- Do not change SDK, artifact format, scripts/resolve_operator.ts, or scripts/outcome_public_sdk.ts.
- Verify deployed widget.js, widget.html, scoped CORS, nav updates, and 375px mobile behavior against the public server.

Local baseline commands if needed:
cd /Users/timurkurmangaliev/verifiable-outcome-engine
node --check web/server.mjs
node --check web/public/widget.js
npx tsc --noEmit
git diff --check
test "$(wc -c < web/public/widget.js)" -lt 5120

Server-side checks after deploy:
curl -i -X OPTIONS https://verifiableoutcome.online/api/replay \
  -H 'Origin: https://example.com' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: Content-Type'
curl -i https://verifiableoutcome.online/api/health -H 'Origin: https://example.com'
curl -fsS https://verifiableoutcome.online/widget.html >/tmp/widget.html
curl -fsS https://verifiableoutcome.online/widget.js >/tmp/widget.js
test "$(wc -c < /tmp/widget.js)" -lt 5120

Expected:
- web/public/widget.js defines <vre-verify>.
- web/public/widget.js defines <vre-verify-form> as the interactive paste-your-own-signature form.
- widget.js is plain JS, zero deps, no bundler, under 5KB.
- widget.js hardcodes https://verifiableoutcome.online as API origin.
- widget.js may use a localhost-only fallback for local demo verification, but external embeds should use the public API origin.
- widget.js posts JSON body keys signature, rpc, programId.
- widget.js does not use url or program_id.
- Widget auto-verifies on load and has loading state.
- /api/replay and /api/health include Access-Control-Allow-Origin: *.
- OPTIONS /api/replay returns HTTP 204.
- CORS is not added to /api/spec, /api/blessed-signatures, /api/timeline, or static files.
- https://verifiableoutcome.online/widget.html returns HTTP 200 and contains a blessed live <vre-verify> demo, custom <vre-verify sig rpc program-id> snippet, and <vre-verify-form>.
- All navs include Widget: index.html, play.html, build.html, verify.html, spec.html, widget.html.
- Public /widget.html at 375px has no horizontal overflow.
- Public browser render displays MATCH / OK and Raffle · slot 455693113 for the blessed raffle signature.
- Public <vre-verify-form> submission with the blessed raffle signature displays MATCH / OK and Raffle · slot 455693113.

Important caveat:
- The meaningful acceptance check is public-origin browser behavior. Localhost fallback is only a development convenience.

When done:
- update agent-instructions/hub-memory/tasks/HACKATHON-WIDGET-001.md with server-side verdict, command evidence, and risks;
- update agent-instructions/hub-memory/CURRENT_TASK.md to READY FOR HUB ACCEPTANCE / ACCEPTED if all checks pass, or BLOCKED with evidence if not;
- update STATUS.md if project-visible state changes;
- provide next handoff prompt in the same response if another owner is needed.
```

### Confidence

high for implementation, local scoped CORS behavior, and local browser widget rendering.

---

## Previous Architect Handoff Prompt

```text
Участник: Architect

Design implementation for HACKATHON-WIDGET-001 in /Users/timurkurmangaliev/verifiable-outcome-engine.

Перед стартом прочитай:
1. AGENTS.md
2. agent-instructions/AGENTS.md
3. agent-instructions/standards/AGENT_GLOBAL.md
4. agent-instructions/hub-memory/CURRENT_TASK.md
5. agent-instructions/hub-memory/tasks/HACKATHON-WIDGET-001.md

Goal: embed widget <vre-verify sig="..."> web component + /widget.html demo page + Widget nav item.

Key facts:
- POST /api/replay already exists in web/server.mjs — widget calls this endpoint
- CORS headers missing from server.mjs — must be added for external embed to work
- widget.js must be zero-dependency plain JS, Shadow DOM, no bundler, < 5KB
- API origin hardcoded to https://verifiableoutcome.online in widget.js
- Widget auto-verifies on load (no click required)
- Nav must be updated in all HTML pages: index, play, build, verify, spec + new widget.html
- Blessed raffle sig for demo: mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh

Design decisions needed:
- widget.js internal structure (Shadow DOM template, fetch logic, state rendering)
- CORS + OPTIONS preflight handler placement in server.mjs
- widget.html page layout matching existing site style

Output: file-by-file implementation plan, ready for Engineer.
```
