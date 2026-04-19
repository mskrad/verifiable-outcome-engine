# Task: HACKATHON-NPM-PUBLISH-001

**Sprint:** Sprint 3 (Apr 19–25)
**Status:** READY FOR TESTER
**Priority:** High — блокирует Build page и Developer flow

---

## Goal

Сделать `npm install verifiable-outcome-sdk` рабочим. После публикации внешний разработчик может импортировать `buildArtifact` и `verifyOutcome` без клонирования репозитория.

---

## Problem

SDK написан, но три вещи блокируют npm publish:

1. **`sdk/verify.ts` импортирует из `../scripts/outcome_public_sdk.ts`** — этот путь не существует в published package, только `dist/sdk/` публикуется.
2. **IDL грузится через `fs.readFileSync(outcomeIdlPath())`** — читает `artifacts/outcome_idl.json` по относительному пути от `scripts/`, который не будет в пакете.
3. **Нет `build` скрипта и `tsconfig.json` имеет `noEmit: true`** — компилировать в `dist/` невозможно.

---

## Implementation Plan

### 1. Создать `sdk/internals.ts`

Скопировать из `scripts/outcome_public_sdk.ts` только то, что нужно SDK:

```typescript
import crypto from "crypto";
import { PublicKey } from "@solana/web3.js";

export const DEFAULT_PROGRAM_ID = "3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq";
export const CHUNK_SIZE = 1024;

export function sha256(bytes: Buffer): Buffer {
  return crypto.createHash("sha256").update(bytes).digest();
}

export function toHex(bytes: number[] | Buffer): string {
  return Buffer.from(bytes).toString("hex");
}

export function deriveProgramConfigPda(programId: PublicKey): PublicKey { ... }
export function deriveApprovedArtifactPda(...): PublicKey { ... }
export function deriveApprovedArtifactChunkPda(...): PublicKey { ... }
export function deriveOutcomeConfigPda(...): PublicKey { ... }
export function deriveOutcomeResolutionPda(...): PublicKey { ... }
```

Функции взять дословно из `scripts/outcome_public_sdk.ts` (строки 15–116). Удалить `REFERENCE_ROOT`, `__filename`, `__dirname`, path-утилиты и функции пути к файлам — они не нужны SDK.

### 2. Создать `sdk/idl.ts`

Сгенерировать файл командой:
```bash
printf 'export const OUTCOME_IDL = ' > sdk/idl.ts
cat artifacts/outcome_idl.json >> sdk/idl.ts
printf ' as const;\n' >> sdk/idl.ts
```

Результат: `sdk/idl.ts` экспортирует IDL как TypeScript-объект. Файл ~43KB, не редактировать вручную.

### 3. Обновить `sdk/verify.ts`

Заменить импорт в начале файла:

```typescript
// БЫЛО:
import {
  CHUNK_SIZE,
  DEFAULT_PROGRAM_ID,
  deriveApprovedArtifactChunkPda,
  deriveApprovedArtifactPda,
  deriveOutcomeConfigPda,
  deriveOutcomeResolutionPda,
  deriveProgramConfigPda,
  outcomeIdlPath,
  sha256,
  toHex,
} from "../scripts/outcome_public_sdk.ts";

// СТАЛО:
import {
  CHUNK_SIZE,
  DEFAULT_PROGRAM_ID,
  deriveApprovedArtifactChunkPda,
  deriveApprovedArtifactPda,
  deriveOutcomeConfigPda,
  deriveOutcomeResolutionPda,
  deriveProgramConfigPda,
  sha256,
  toHex,
} from "./internals.js";
import { OUTCOME_IDL } from "./idl.js";
```

Убрать `import fs from "fs"` и `import path from "path"` если они используются только для IDL и `outcomeIdlPath`.

> **Внимание:** `fs` и `path` нужны ещё для `opts.artifactPath` (строки 716–733 sdk/verify.ts). Оставить их если там используются.

Заменить функцию `loadIdl()`:
```typescript
// БЫЛО:
function loadIdl(): any {
  return JSON.parse(fs.readFileSync(outcomeIdlPath(), "utf8"));
}

// СТАЛО:
function loadIdl(): any {
  return OUTCOME_IDL;
}
```

### 4. Создать `tsconfig.build.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "allowImportingTsExtensions": false,
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true
  },
  "include": ["sdk/**/*.ts"]
}
```

### 5. Обновить `package.json`

Добавить `build` скрипт:
```json
"build": "tsc -p tsconfig.build.json"
```

---

## Acceptance Criteria

- [ ] `yarn build` завершается без ошибок, создаётся `dist/sdk/`
- [ ] `npx tsc --noEmit` (основной tsconfig) завершается без ошибок
- [ ] `dist/sdk/index.js`, `dist/sdk/index.d.ts` существуют
- [ ] `node -e "import('./dist/sdk/index.js').then(m => console.log(typeof m.verifyOutcome))"` выводит `function`
- [ ] `sdk/verify.ts` не содержит импортов из `../scripts/`
- [ ] `sdk/idl.ts` существует и содержит `export const OUTCOME_IDL`

---

## Notes

- `scripts/outcome_public_sdk.ts` **не трогать** — он используется в `scripts/resolve_operator.ts`, `scripts/replay_verify.ts` и других. Только копируем нужное в `sdk/internals.ts`.
- После завершения задачи: запустить `npm publish --dry-run` и убедиться что в списке файлов только `dist/sdk/` и `README.md`.
- npm publish сам (с реальным токеном) — отдельный шаг после проверки dry-run.

---

## Implementation Summary — 2026-04-19

### Facts

- `sdk/internals.ts` added with SDK-local `DEFAULT_PROGRAM_ID`, `CHUNK_SIZE`, `sha256`, `toHex`, and PDA derivation helpers copied from the script utility surface.
- `sdk/idl.ts` generated from `artifacts/outcome_idl.json` and exports `OUTCOME_IDL`.
- `sdk/verify.ts` no longer imports from `../scripts/outcome_public_sdk.ts`; it imports SDK-local internals and embedded IDL.
- `tsconfig.build.json` added for SDK build with declarations into `dist/sdk/`.
- `package.json` now has `"build": "tsc -p tsconfig.build.json"`.
- `scripts/outcome_public_sdk.ts` was not changed.

### Verification Evidence

- RED baseline:
  - `yarn build` failed before changes with `error Command "build" not found`.
  - `rg "../scripts|outcomeIdlPath" sdk/verify.ts` found the blocking script import and file-path IDL load.
- Green checks:
  - `yarn build`: passed and created `dist/sdk/`.
  - `npx tsc --noEmit`: passed.
  - `yarn install --frozen-lockfile`: passed.
  - `test -f dist/sdk/index.js && test -f dist/sdk/index.d.ts && find dist/sdk -maxdepth 1 -type f | sort`: passed and listed SDK JS/DTS outputs.
  - `node -e "import('./dist/sdk/index.js').then(m => console.log(typeof m.verifyOutcome))"`: printed `function`.
  - `rg "../scripts|outcome_public_sdk|outcomeIdlPath" sdk dist/sdk`: no matches.
  - `npm publish --dry-run --cache /tmp/npm-cache-vre`: passed.

### Notes

- Plain `npm publish --dry-run` first failed because the local user npm cache contains root-owned files under `/Users/timurkurmangaliev/.npm`. Re-running with `--cache /tmp/npm-cache-vre` passed and did not require mutating the user cache.
- npm dry-run tarball includes `package.json` in addition to `dist/sdk/*` and `README.md`; npm always includes `package.json`.
- Real `npm publish` remains out of scope and was not run.

### Tester Handoff Prompt

Verify `HACKATHON-NPM-PUBLISH-001` in `/Users/timurkurmangaliev/verifiable-outcome-engine`.

Scope to verify:

1. `yarn build` creates `dist/sdk/`.
2. `npx tsc --noEmit` passes.
3. `dist/sdk/index.js` and `dist/sdk/index.d.ts` exist.
4. `node -e "import('./dist/sdk/index.js').then(m => console.log(typeof m.verifyOutcome))"` prints `function`.
5. `sdk/verify.ts` and `dist/sdk/verify.js` do not import from `../scripts/` and do not reference `outcome_public_sdk` or `outcomeIdlPath`.
6. `sdk/idl.ts` exists and contains `export const OUTCOME_IDL`.
7. `npm publish --dry-run --cache /tmp/npm-cache-vre` passes and tarball contents are limited to package-required metadata plus `dist/sdk/*` and `README.md`.

Do not run real `npm publish`.

Facts:

- Plain `npm publish --dry-run` may fail on this machine due to root-owned files in `/Users/timurkurmangaliev/.npm`; use `--cache /tmp/npm-cache-vre` for package verification.
- `scripts/outcome_public_sdk.ts` intentionally remains for local scripts.

Confidence: high.

---

## Tester Verification Summary — 2026-04-19 18:24:40 +0300

Status: READY FOR HUB ACCEPTANCE.

### Commands Run

- `yarn build`: passed.
- `npx tsc --noEmit`: passed.
- `test -d dist/sdk && find dist/sdk -maxdepth 1 -type f | sort`: passed and listed SDK JS/DTS outputs.
- `test -f dist/sdk/index.js && test -f dist/sdk/index.d.ts && printf 'index files exist\n'`: passed.
- `test -f sdk/idl.ts && rg -n "export const OUTCOME_IDL" sdk/idl.ts`: passed.
- `node -e "import('./dist/sdk/index.js').then(m => console.log(typeof m.verifyOutcome))"`: printed `function`.
- `rg -n "\.\./scripts|outcome_public_sdk|outcomeIdlPath" sdk/verify.ts dist/sdk/verify.js || true`: no matches.
- `npm publish --dry-run --cache /tmp/npm-cache-vre`: passed.

### Evidence

- `yarn build` ran `tsc -p tsconfig.build.json` and completed successfully.
- `dist/sdk/` exists and contains:
  - `artifact.js`, `artifact.d.ts`
  - `idl.js`, `idl.d.ts`
  - `index.js`, `index.d.ts`
  - `internals.js`, `internals.d.ts`
  - `types.js`, `types.d.ts`
  - `verify.js`, `verify.d.ts`
- `dist/sdk/index.js` and `dist/sdk/index.d.ts` exist.
- Dynamic import from `./dist/sdk/index.js` reported `typeof verifyOutcome === "function"`.
- `sdk/verify.ts` imports SDK-local `./internals.js` and `./idl.js`.
- `dist/sdk/verify.js` imports SDK-local `./internals.js` and `./idl.js`.
- `sdk/verify.ts` and `dist/sdk/verify.js` do not reference `../scripts`, `outcome_public_sdk`, or `outcomeIdlPath`.
- `sdk/idl.ts` exists and starts with `export const OUTCOME_IDL = {`.
- `npm publish --dry-run --cache /tmp/npm-cache-vre` produced package `verifiable-outcome-sdk@0.1.0`.
- Dry-run tarball includes `dist/sdk/*`, `README.md`, and npm-required `package.json`.
- Real `npm publish` was not run.

### Acceptance Pass/Fail

- `yarn build` creates `dist/sdk/`: pass.
- `npx tsc --noEmit` passes: pass.
- `dist/sdk/index.js` and `dist/sdk/index.d.ts` exist: pass.
- Runtime import check prints `function`: pass.
- `sdk/verify.ts` and `dist/sdk/verify.js` do not import from `../scripts` and do not reference `outcome_public_sdk` or `outcomeIdlPath`: pass.
- `sdk/idl.ts` exists and contains `export const OUTCOME_IDL`: pass.
- `npm publish --dry-run --cache /tmp/npm-cache-vre` passes: pass.
- Real `npm publish` not run: pass.

### Risks / Notes

- `npm publish --dry-run` emits a login warning, but exits `0` and completes dry-run package generation.
- The tarball includes `package.json`; this is npm-required metadata and expected.
- Generated `dist/` is currently present in the working tree after `yarn build`.
- Existing untracked config artifacts remain present and were not part of this verification.

### Verdict

Accepted by Tester. Send to Hub for final acceptance.

### Hub Handoff Prompt

Review `HACKATHON-NPM-PUBLISH-001` in `/Users/timurkurmangaliev/verifiable-outcome-engine` for final acceptance.

Scope:
- Accept or reject based on Tester evidence.
- Do not run real `npm publish`.
- Do not expand scope into runtime design, replay semantics, or ecosystem monorepo work.

Tester verdict:
- Accepted by Tester.
- `yarn build` creates `dist/sdk/`.
- `npx tsc --noEmit` passes.
- `dist/sdk/index.js` and `dist/sdk/index.d.ts` exist.
- Dynamic import reports `typeof verifyOutcome === "function"`.
- `sdk/verify.ts` and `dist/sdk/verify.js` have no `../scripts`, `outcome_public_sdk`, or `outcomeIdlPath` references.
- `sdk/idl.ts` exists and exports `OUTCOME_IDL`.
- `npm publish --dry-run --cache /tmp/npm-cache-vre` passes.
- Real `npm publish` was not run.

Decision requested:
- Mark `HACKATHON-NPM-PUBLISH-001` accepted if no Hub-level concern exists.

Confidence: high.
