# Task: HACKATHON-NPM-PUBLISH-001

**Sprint:** Sprint 3 (Apr 19–25)
**Status:** READY FOR CODEX
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
