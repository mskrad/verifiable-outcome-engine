# Task: HACKATHON-SDK-CLI-001

**Sprint:** Sprint 3 (Apr 19–25)
**Status:** IN PROGRESS
**Priority:** High — без этого полный flow требует git clone репо

---

## Goal

Добавить CLI в `verifiable-outcome-sdk` чтобы внешний разработчик мог пройти полный цикл без клонирования репо:

```bash
npx verifiable-outcome-sdk resolve --config raffle.json --wallet ~/.config/solana/id.json
npx verifiable-outcome-sdk verify --sig <signature>
```

---

## Problem

`verifyOutcome()` и `buildArtifact()` в SDK есть. Но оператор (тот кто создаёт раффл) не может задеплоить артефакт на-чейн через пакет — нужно клонировать репо и запускать `yarn resolve:operator`. Это противоречит Build page и сообщению "npm install verifiable-outcome-sdk".

---

## Implementation Plan

### 1. `sdk/operator.ts`

Извлечь из `scripts/resolve_operator.ts` функцию `runResolveOperator()` и всё что она использует. Экспортировать как:

```typescript
export async function resolveOperator(opts: ResolveOperatorOptions): Promise<ResolveOperatorResult>
```

Где `ResolveOperatorOptions`:
```typescript
{
  configPath: string;      // путь к raffle.config.json
  walletPath?: string;     // путь к keypair, default: ANCHOR_WALLET env
  rpcUrl?: string;         // default: ANCHOR_PROVIDER_URL env
  programId?: string;      // default: DEFAULT_PROGRAM_ID
  outputDir?: string;      // куда писать результат, default: ./tmp
}
```

### 2. `sdk/cli.ts`

CLI entry point с двумя командами:

```
vre verify --sig <signature> [--rpc <url>] [--program-id <id>]
vre resolve --config <path> --wallet <path> [--rpc <url>] [--program-id <id>] [--json]
```

Использовать `process.argv` напрямую (без доп. зависимостей).

Shebang строка вверху: `#!/usr/bin/env node`

### 3. Обновить `tsconfig.build.json`

Добавить `sdk/cli.ts` и `sdk/operator.ts` в `include`.

### 4. Обновить `package.json`

```json
"bin": {
  "vre": "./dist/sdk/cli.js"
},
"files": [
  "dist/sdk",
  "README.md"
]
```

### 5. `yarn build` → `npm version patch` → `npm publish`

---

## Acceptance Criteria

- [ ] `yarn build` без ошибок
- [ ] `npx verifiable-outcome-sdk verify --sig mUXwae...` возвращает MATCH
- [ ] `npx verifiable-outcome-sdk resolve --config raffle.json --wallet ~/.config/solana/id.json` создаёт on-chain TX и возвращает signature
- [ ] `npx tsc --noEmit` без ошибок

---

## Notes

- `scripts/resolve_operator.ts` не трогать — оставить как есть для `yarn resolve:operator`
- Логику дублировать в `sdk/operator.ts`, не импортировать из scripts/
- Зависимости уже есть в package.json (@coral-xyz/anchor, @solana/web3.js)
