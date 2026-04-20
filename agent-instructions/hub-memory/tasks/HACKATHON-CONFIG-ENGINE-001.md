# Task: HACKATHON-CONFIG-ENGINE-001

**Title:** Configurable Outcome Engine — JSON-driven artifact builder + npm-compatible SDK

**Parent Sprint:** HACKATHON-SPRINT-2 (Apr 12–18)
**Priority:** High — directly strengthens "Developer Infrastructure" narrative for judges
**Status:** Architect plan complete — ready for Engineer implementation
**Owner:** Engineer
**Reviewer:** Hub

---

## Problem

Currently the artifact format (W3O1) is fully general, but the only way to configure a raffle/loot/airdrop is to edit TypeScript source (`RAFFLE_PARTICIPANTS`, `buildRaffleArtifact`, etc.). This:
- Is not operator-friendly
- Hides that VRE is a *configurable engine*, not a single-purpose raffle tool
- Blocks the "second use case" story (airdrop, loot) needed for Sprint 3
- Makes the "Developer Infrastructure" claim unsubstantiated — no importable API exists

The on-chain program needs no changes — it already treats any W3O1 blob as opaque config.

---

## Goal

Two things, one task:

1. **Operator UX:** configure raffle/loot/airdrop via a JSON file, run one command, get a verifiable TX — without touching TypeScript source.
2. **Developer UX:** `import { buildArtifact, verifyOutcome } from 'verifiable-outcome-sdk'` — clean importable API that any Solana dApp can embed.

CLI scripts become thin wrappers over the SDK. The SDK is the primary deliverable.

---

## Deliverables

### 1. `sdk/` — new directory, primary deliverable

```
sdk/
  index.ts     ← public API re-exports
  artifact.ts  ← buildArtifact(config: ArtifactConfig): Buffer
  verify.ts    ← verifyOutcome(opts): Promise<VerifyResult>
  types.ts     ← ArtifactConfig, VerifyResult, W3O1Config, ...
```

#### `sdk/types.ts` — public types

```typescript
export type RaffleConfig = {
  type: 'raffle';
  input_lamports: bigint | number;
  participants: Array<{ address: string; weight: number }>;
  payout_lamports?: bigint | number;
};

export type LootConfig = {
  type: 'loot';
  input_lamports: bigint | number;
  outcomes: Array<{ id: string; weight: number; payout_lamports: bigint | number }>;
};

export type AirdropConfig = {
  type: 'airdrop';
  input_lamports: bigint | number;
  slots: number;
  eligible: Array<{ address: string; weight: number }>;
  payout_lamports?: bigint | number;
};

export type ArtifactConfig = RaffleConfig | LootConfig | AirdropConfig;

export type VerifyResult = {
  status: 'MATCH' | 'MISMATCH';
  reason: string;
  outcome_id: string;
  resolve_id: string;
  compiled_artifact_hash: string;
  runtime_id: string;
  program_id: string;
};
```

#### `sdk/artifact.ts` — W3O1 builder

```typescript
export function buildArtifact(config: ArtifactConfig): Buffer
```

Dispatches to internal builders by `config.type`. Contains all W3O1 binary serialization logic (extracted from `resolve_operator.ts` — no duplication).

#### `sdk/verify.ts` — replay verifier

```typescript
export async function verifyOutcome(opts: {
  signature: string;
  rpcUrl: string;
  programId?: string;
}): Promise<VerifyResult>
```

Wraps replay logic from `scripts/replay_verify.ts` as a callable function (not CLI-only).

#### `sdk/index.ts` — public re-exports

```typescript
export { buildArtifact } from './artifact.js';
export { verifyOutcome } from './verify.js';
export type { ArtifactConfig, RaffleConfig, LootConfig, AirdropConfig, VerifyResult } from './types.js';
```

---

### 2. `package.json` — npm-compatible fields

Add to existing `package.json`:

```json
{
  "name": "verifiable-outcome-sdk",
  "version": "0.1.0",
  "description": "Configurable on-chain outcome engine for Solana — verifiable raffle, loot, and airdrop selection",
  "main": "dist/sdk/index.js",
  "types": "dist/sdk/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/sdk/index.js",
      "types": "./dist/sdk/index.d.ts"
    }
  },
  "files": ["dist/sdk", "README.md"],
  "publishConfig": { "access": "public" }
}
```

Do NOT change `scripts` entries that already exist. Do NOT run `npm publish`. Do NOT add a `build` step that breaks existing `yarn` commands.

---

### 3. `scripts/build_artifact.ts` — CLI wrapper

Thin wrapper over `sdk/artifact.ts`. Reads JSON config → calls `buildArtifact()` → writes `.bin` → prints hash.

```
yarn build:artifact --config examples/raffle.config.json --out artifacts/my-raffle.bin
```

Output:
```
artifact_path : artifacts/my-raffle.bin
artifact_hash : 4a3304a5...
blob_bytes    : 312
```

---

### 4. `scripts/resolve_operator.ts` — add `--config <path>` flag

When `--config` is provided:
- Load JSON, parse as `ArtifactConfig`
- Call `buildArtifact(config)` from SDK
- `--raffle` flag remains as shorthand for default RAFFLE_PARTICIPANTS config (backward compat)
- `buildRaffleArtifact` / `buildDemoCompiledArtifact` in `resolve_operator.ts` become private fallbacks, not primary path

---

### 5. `scripts/replay_verify.ts` — refactor to wrap `sdk/verify.ts`

CLI entry point stays unchanged. Internally delegates to `verifyOutcome()` from SDK. No behavior change, just extraction.

---

### 6. `package.json` — add `build:artifact` script

```json
"build:artifact": "TS_NODE_PROJECT=tsconfig.json ts-node --esm --transpile-only scripts/build_artifact.ts"
```

---

### 7. `examples/` — three config files

- `examples/raffle.config.json` — 7 participant addresses (same as RAFFLE_PARTICIPANTS)
- `examples/loot.config.json` — legendary/rare/common with weights and payouts
- `examples/airdrop.config.json` — 10 eligible addresses, 3 slots

---

## W3O1 Mapping

| Config type | outcome_id field           | weight              | effect                          |
|-------------|---------------------------|---------------------|---------------------------------|
| `raffle`    | participant `address`      | participant `weight`| fixed `payout_lamports`         |
| `loot`      | outcome `id` (string)      | outcome `weight`    | per-outcome `payout_lamports`   |
| `airdrop`   | eligible `address`         | eligible `weight`   | fixed `payout_lamports` per slot|

For `airdrop` with `slots: N`: emit one W3O1 artifact where `n_outcomes = eligible.length` (same as raffle). The operator runs `resolve:operator` N times sequentially, each producing one winner. Duplicate winners allowed (distinct enforcement is deferred).

---

## Validation Rules

- `address`: valid base58 pubkey — length 32–44 chars, base58 charset only
- `weight`: integer > 0
- `id`: max 64 ASCII bytes (MAX_OUTCOME_ID_BYTES from SDK)
- `input_lamports`, `payout_lamports`: positive integer or bigint
- Unknown `type`: throw descriptive error

---

## Usage Example (for INTEGRATION.md, Sprint 3)

```typescript
import { buildArtifact, verifyOutcome } from 'verifiable-outcome-sdk';

// Operator: commit raffle rules on-chain
const blob = buildArtifact({
  type: 'raffle',
  input_lamports: 10n,
  participants: [
    { address: '5RbvSHbSuo9CBjZLtw9RoP775KeqaJyMXkXNsb99AeR4', weight: 1000 },
    { address: 'Aip3wC6UCgE5628ukFW6z3rDGDVTAXKDG4V3j15tPvEU', weight: 1000 },
  ],
});
// → submit blob on-chain, resolve, share TX signature

// Anyone: verify the result
const result = await verifyOutcome({
  signature: 'mUXwae...',
  rpcUrl: 'https://api.devnet.solana.com',
});
// → { status: 'MATCH', outcome_id: '5RbvSH...', ... }
```

---

## Acceptance Criteria

- [ ] `sdk/index.ts` exports `buildArtifact`, `verifyOutcome`, and all public types
- [ ] `yarn build:artifact --config examples/raffle.config.json` produces `.bin` and prints hash
- [ ] `yarn build:artifact --config examples/loot.config.json` produces a different `.bin`
- [ ] `yarn resolve:operator --config examples/raffle.config.json --url https://api.devnet.solana.com --wallet ~/.config/solana/esjx.json` completes with `MATCH / OK`
- [ ] `--raffle` shorthand still works (backward compat)
- [ ] `package.json` has `name`, `main`, `types`, `exports`, `publishConfig` fields
- [ ] `examples/` has 3 config files
- [ ] `npx tsc --noEmit` passes
- [ ] `yarn install --frozen-lockfile` passes (no new deps required)
- [ ] No logic duplication between `sdk/` and `scripts/` — scripts are wrappers only

---

## Out of Scope

- Actually publishing to npm registry (`npm publish`)
- Adding a `tsc` build step to CI (ts-node already handles runtime)
- On-chain changes (program is already general)
- UI changes (separate WS-2 task)
- Airdrop "distinct winners" enforcement (deferred)

---

## Related Tasks

- HACKATHON-RAFFLE-FIX-001 (closed) — established W3O1 raffle artifact pattern; `buildRaffleArtifact` moves into `sdk/artifact.ts`
- HACKATHON-PUBLISH-001 — public web deploy (parallel, not blocked by this task)
- Sprint 3 INTEGRATION.md — will use `sdk/` API as the primary integration example

---

## Architect Plan — 2026-04-15

### Facts

- Runtime remains `ts-node --esm --transpile-only`; no build step is required for existing commands.
- Existing `scripts/resolve_operator.ts` owns W3O1 serialization and operator-chain flow.
- Existing `scripts/replay_verify.ts` owns replay reconstruction, deterministic selection, and `MATCH` / `MISMATCH` CLI output.
- Existing `scripts/outcome_public_sdk.ts` owns PDA derivation, hashing, path helpers, `CHUNK_SIZE`, and default program/RPC constants.
- On-chain program changes are out of scope.

### Main Decision

Create `sdk/` as the importable API boundary and make `scripts/` wrappers over it:

- `sdk/artifact.ts` owns config validation and W3O1 artifact building.
- `sdk/verify.ts` owns replay verification as a callable `verifyOutcome()` function.
- `sdk/types.ts` owns public config/result types and internal W3O1 domain types needed by artifact/replay code.
- `sdk/index.ts` is the public API surface.

Keep operator account submission, wallet loading, local output paths, and CLI argument parsing in `scripts/`.

### File Layout

Create:

- `sdk/types.ts` — public `ArtifactConfig` union, `VerifyResult`, `VerifyOutcomeOptions`, and internal W3O1 entry types.
- `sdk/artifact.ts` — JSON-compatible validation plus deterministic W3O1 serialization.
- `sdk/verify.ts` — extracted replay verifier with callable `verifyOutcome(opts)`.
- `sdk/index.ts` — public re-exports.
- `scripts/build_artifact.ts` — CLI wrapper: read JSON config, call `buildArtifact`, write `.bin`, print hash/bytes.
- `examples/raffle.config.json` — default 7-wallet raffle config matching the current shorthand participants.
- `examples/loot.config.json` — three loot outcomes with weights and per-outcome payouts.
- `examples/airdrop.config.json` — 10 eligible wallets and `slots: 3`.

Modify:

- `scripts/resolve_operator.ts` — import `buildArtifact`; add `--config <path>`; keep `--raffle` compatibility; remove primary W3O1 builder ownership.
- `scripts/replay_verify.ts` — delegate replay to `verifyOutcome`; keep output format, flags, and exit behavior.
- `scripts/outcome_public_sdk.ts` — either leave as compatibility utility for scripts or re-export moved SDK utilities if Engineer chooses to move constants; no public docs should depend on `scripts/` internals.
- `package.json` — add npm-compatible package fields and `build:artifact` script without breaking existing scripts.
- `tsconfig.json` — include `sdk/**/*.ts` in addition to `scripts/**/*.ts` so `npx tsc --noEmit` checks the SDK.
- `README.md` / `RUNBOOK.md` only if implementation changes commands visible to reviewers.

### Extraction Plan

Move from `scripts/resolve_operator.ts` to `sdk/artifact.ts`:

- W3O1 constants: `MAX_OUTCOME_ID_BYTES`, `MAGIC`, `FORMAT_VERSION_V1`, effect type constants.
- Binary helpers: `u16le`, `u32le`, `u64le`, `fixedAscii`.
- Artifact domain builder logic currently represented by `buildRaffleArtifact()` and `buildDemoCompiledArtifact()`.
- Canonical sorting and duplicate detection for outcome IDs.
- Lamports/weight/id validation.

Keep in `scripts/resolve_operator.ts`:

- CLI parser, help text, `--json`, `--raffle`, `--url`, `--wallet`, `--program-id`, `--out-dir`, `--label`.
- `BN` import from `bn.js`.
- Wallet loading, Anchor provider/program loading, funding helper.
- Program config initialization/review logic.
- Artifact upload/chunking/account submission.
- Runtime initialization, master seed refresh, resolve call, result manifest printing.
- `RAFFLE_PARTICIPANTS` only as shorthand data for `--raffle`, converted into `ArtifactConfig` before calling `buildArtifact`.

Do not keep duplicate W3O1 serialization in scripts after extraction.

### Refactor Plan For Replay

Move from `scripts/replay_verify.ts` to `sdk/verify.ts`:

- IDL loading and Borsh coder setup.
- Event discriminator/decode logic.
- Transaction log lookup and event selection.
- Account fetch/decode helpers.
- Artifact chunk reconstruction.
- W3O1 parser and deterministic weighted selection.
- Randomness/input/output/outcome/effects digest comparison.
- `ReplayMismatchError` equivalent as an internal implementation detail.

Keep in `scripts/replay_verify.ts`:

- CLI parser and help text.
- Mapping CLI args to `verifyOutcome({ signature, rpcUrl, programId, artifactPath })`.
- Existing text/JSON output keys:
  - `verification_result`
  - `verification_reason`
  - `signature`
  - `program_id`
  - `runtime_id`
  - `resolve_id`
  - `compiled_artifact_hash`
- Existing non-zero exit behavior on `MISMATCH`.

`verifyOutcome()` should return `VerifyResult` for replay mismatches rather than exiting. Programmer errors such as missing signature or missing RPC URL should throw `TypeError` / `Error`.

### `sdk/types.ts`

```ts
export type LamportsValue = bigint | number;

export type RaffleConfig = {
  type: "raffle";
  input_lamports: LamportsValue;
  participants: Array<{ address: string; weight: number }>;
  payout_lamports?: LamportsValue;
};

export type LootConfig = {
  type: "loot";
  input_lamports: LamportsValue;
  outcomes: Array<{
    id: string;
    weight: number;
    payout_lamports: LamportsValue;
  }>;
};

export type AirdropConfig = {
  type: "airdrop";
  input_lamports: LamportsValue;
  slots: number;
  eligible: Array<{ address: string; weight: number }>;
  payout_lamports?: LamportsValue;
};

export type ArtifactConfig = RaffleConfig | LootConfig | AirdropConfig;

export type VerifyOutcomeOptions = {
  signature: string;
  rpcUrl: string;
  programId?: string;
  artifactPath?: string;
};

export type VerifyResult = {
  status: "MATCH" | "MISMATCH";
  reason: string;
  outcome_id: string;
  resolve_id: string;
  compiled_artifact_hash: string;
  runtime_id: string;
  program_id: string;
};

export type W3O1Effect = {
  type: "transfer_sol";
  amount_lamports: bigint;
};

export type W3O1Outcome = {
  id: string;
  weight: number;
  first_effect_index: number;
  effect_count: number;
};

export type W3O1Config = {
  format_version: 1;
  min_input_lamports: bigint;
  max_input_lamports: bigint;
  outcomes: W3O1Outcome[];
  effects: W3O1Effect[];
};
```

Note: JSON cannot encode `bigint`; for this task, example JSON should use small safe integers. If Hub wants production-scale lamports in JSON, add `string` to `LamportsValue` before implementation.

### `sdk/index.ts`

```ts
export { buildArtifact } from "./artifact.js";
export { verifyOutcome } from "./verify.js";
export type {
  AirdropConfig,
  ArtifactConfig,
  LootConfig,
  RaffleConfig,
  VerifyResult,
} from "./types.js";
```

### Config Validation

Validation lives in `sdk/artifact.ts`, before any binary serialization.

Errors:

- Throw `TypeError` for wrong shape/type, e.g. non-object config, unknown `type`, non-array participants/outcomes/eligible.
- Throw `RangeError` for invalid bounds, e.g. empty outcome list, non-positive weight, too many outcomes/effects, invalid lamports.
- Throw `Error` for semantic collisions, e.g. duplicate outcome id after canonical sorting.

Rules:

- `type` must be exactly `raffle`, `loot`, or `airdrop`.
- `address` must pass base58 charset/length check and `new PublicKey(address)`.
- `id` must be printable ASCII and at most 64 bytes.
- `weight` must be integer `> 0` and `<= 0xffffffff`.
- `input_lamports` and `payout_lamports` must be positive safe integers or bigint.
- `participants`, `outcomes`, and `eligible` must be non-empty and at most `0xffff`.
- `slots` for airdrop must be integer `> 0`; it is metadata for operator workflow, not encoded as distinct outcomes.
- All emitted W3O1 outcomes are sorted by ASCII outcome id and must be strictly unique.
- Default `payout_lamports` for `raffle` and `airdrop` is `3n` to preserve current shorthand behavior.

### Airdrop Decision

Use one W3O1 artifact and run N resolves for `slots: N`.

Justification:

- Matches existing opaque artifact model: one artifact defines the eligible set and weighted selection.
- Requires no on-chain state redesign and no new replay semantics.
- Keeps every slot independently replayable by signature.
- Aligns with task scope: duplicate winners are allowed; distinct-winner enforcement is deferred.

Rejected alternative:

- Encode N outcomes or N artifacts up front. This would either duplicate the same eligible set N times or require off-chain state mutation between slots, which weakens replay clarity and expands scope.

### Risks And Mitigations

- Artifact byte drift: compare `buildArtifact(raffle config)` hash against current `--raffle` artifact behavior before changing CLI defaults.
- Sorting mismatch: centralize sorting in `sdk/artifact.ts`; keep verifier parser enforcing strict sorted IDs.
- CLI regression: keep `scripts/replay_verify.ts` output keys unchanged and add wrapper-only mapping.
- BigInt JSON ambiguity: examples use safe integers; production-scale JSON string support needs Hub decision.
- Package metadata mismatch: `main/types/exports` point to `dist/`, but this task has no build step. Treat this as npm-compatible metadata only unless Hub approves adding build artifacts.
- SDK importing from `scripts/`: avoid this for `sdk/artifact.ts`; if `sdk/verify.ts` needs PDA/hash helpers, either move helpers into SDK and re-export for scripts or keep a consciously documented compatibility import.
- IDL packaging gap: `verifyOutcome()` needs `artifacts/outcome_idl.json` locally. If future npm packaging is real, include the IDL file or embed the required account/event layout.
- On-chain RPC flakiness: before devnet acceptance, check RPC health and retry only at command level, not inside deterministic replay logic.

### Ordered Engineer Steps

1. Update `tsconfig.json` include list to cover `sdk/**/*.ts`.
2. Create `sdk/types.ts` exactly from the approved type shape.
3. Create `sdk/artifact.ts` with validation, W3O1 serialization, and `buildArtifact(config)`.
4. Convert current `RAFFLE_PARTICIPANTS` shorthand into a `RaffleConfig` and verify artifact hash parity with the current sorted raffle builder.
5. Create `scripts/build_artifact.ts` wrapper and add `build:artifact` to `package.json`.
6. Add `examples/raffle.config.json`, `examples/loot.config.json`, and `examples/airdrop.config.json`.
7. Refactor `scripts/resolve_operator.ts` so `--config` loads JSON and calls `buildArtifact`; keep `--raffle` and default demo behavior.
8. Create `sdk/verify.ts` by extracting replay logic from `scripts/replay_verify.ts`; preserve mismatch codes.
9. Refactor `scripts/replay_verify.ts` into a wrapper over `verifyOutcome`; preserve CLI text/JSON behavior and exit codes.
10. Create `sdk/index.ts` with the approved export list.
11. Update `package.json` npm-compatible fields without changing existing scripts.
12. Run:
    - `yarn install --frozen-lockfile`
    - `npx tsc --noEmit`
    - `yarn build:artifact --config examples/raffle.config.json --out artifacts/raffle.config.bin`
    - `yarn build:artifact --config examples/loot.config.json --out artifacts/loot.config.bin`
    - `yarn -s replay --sig 3iC7i15CakPWD47DZ72WgYYuKQdPW8qwu2Usy77rm8RjKkvocvELHqN1yMqM4MiXLcpiAb52u6z2btMKCAZsmDW1 --url https://api.devnet.solana.com --program-id 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq`
13. If a funded wallet is available, run the devnet acceptance command with `--config examples/raffle.config.json`.

### Handoff Prompt

Implement `HACKATHON-CONFIG-ENGINE-001` in `/Users/timurkurmangaliev/verifiable-outcome-engine`.

Use the task memory plan in `agent-instructions/hub-memory/tasks/HACKATHON-CONFIG-ENGINE-001.md` as the source of truth. Stay within scope: SDK extraction, JSON artifact config builder, `build:artifact` CLI, `--config` support in `resolve:operator`, replay wrapper extraction, examples, package metadata, and verification. Do not change on-chain Rust code or web UI.

Acceptance checks:

- `sdk/index.ts` exports `buildArtifact`, `verifyOutcome`, and public config/result types.
- `yarn build:artifact --config examples/raffle.config.json --out artifacts/raffle.config.bin` works.
- `yarn build:artifact --config examples/loot.config.json --out artifacts/loot.config.bin` works and produces a different hash.
- `--raffle` shorthand still works.
- Existing `yarn -s replay ...` behavior and output format are unchanged.
- `npx tsc --noEmit` passes.
- `yarn install --frozen-lockfile` passes.
- No new dependencies unless Hub approves.

Facts: the program is already opaque over W3O1 blobs; BN must be imported from `bn.js`; runtime remains `ts-node --esm --transpile-only`.

Assumptions: example JSON uses safe integer lamports; airdrop duplicate winners are allowed; package metadata is added without publishing.

Unknowns requiring Hub input only if they block implementation: whether JSON lamports should also allow strings; whether future npm packaging must include or embed the IDL.

Confidence: high.

---

## Copy Boundary Correction Note - 2026-04-19 22:18:00 +0300

Historical SDK/config-engine text remains useful for the importable API
(`buildArtifact`, `verifyOutcome`, `resolveOperator`). Future public copy must
keep the role boundary explicit:

- Verifier: `vre verify`; no wallet.
- Builder: `buildArtifact`; no wallet.
- Operator: `vre resolve`; admin wallet for an existing deployed program.
- Program Owner: clone repo, deploy `programs/outcome` with Anchor, then pass
  `--program-id`.

The npm package is `verifiable-outcome-sdk`, but the executable is `vre`.
Use `npm install -g verifiable-outcome-sdk` plus `vre ...`, or
`npx -p verifiable-outcome-sdk vre ...`.

---

## Tester Verification Summary — 2026-04-15 15:51:08 +0300

### Facts

- Scope was respected: no Rust or web UI files were changed during tester verification.
- `sdk/index.ts` exports `buildArtifact`, `verifyOutcome`, and public types:
  - `AirdropConfig`
  - `ArtifactConfig`
  - `LootConfig`
  - `RaffleConfig`
  - `VerifyOutcomeOptions`
  - `VerifyResult`
- `package.json` includes npm-compatible `name`, `main`, `types`, `exports`, `files`, and `publishConfig`.
- `examples/` includes `raffle.config.json`, `loot.config.json`, and `airdrop.config.json`.

### Verification

- `yarn install --frozen-lockfile`: passed.
- `npx tsc --noEmit`: passed.
- `yarn build:artifact --config examples/raffle.config.json --out artifacts/raffle.config.bin`: passed.
- `yarn build:artifact --config examples/loot.config.json --out artifacts/loot.config.bin`: passed.
- Raffle artifact hash: `4a3304a5cb2804331078c6e09b687fdbce1545e2cda5d77ef0c1eb3ab7688ed7`, bytes `657`.
- Loot artifact hash: `c7a19da303433427976b43fa87aeccdfa49f30fe307b183eecfb31d310484f94`, bytes `301`.
- Hashes differ: yes.
- `solana cluster-version --url https://api.devnet.solana.com`: returned `4.0.0-beta.6`.
- Positive replay command for `4dne2ZC6AmkF3TufDSZS9SCgCWSSfnMacHqg1wiVGnStEGAFoDuEyecysFqj3rsJDKWJzKpfdTzfKF7gq3PgcYVn`: `MATCH / OK`.
- Replay output keys preserved:
  - `verification_result`
  - `verification_reason`
  - `signature`
  - `program_id`
  - `runtime_id`
  - `resolve_id`
  - `compiled_artifact_hash`
- Negative replay with wrong artifact `artifacts/loot.config.bin` returned exit code `1` with:
  - `verification_result : MISMATCH`
  - `verification_reason : ERR_ARTIFACT_HASH_MISMATCH`
- `yarn resolve:operator --config examples/raffle.config.json --url https://api.devnet.solana.com --wallet /Users/timurkurmangaliev/.config/solana/esjx.json`: passed.
- Replay for config signature `5pEb9MWfFoeaohctsDQ5yKS9oAKCvyY3SCNmPubGnak73hS98AkhN1kSzxru3mAhP9LuKi1iSom6YosBDFfkzwjP`: `MATCH / OK`.
- Config runtime ID: `25f615a7b4d515d835053db9b4f637e5`.
- `yarn resolve:operator --url https://api.devnet.solana.com --wallet /Users/timurkurmangaliev/.config/solana/esjx.json --raffle`: passed.
- Replay for shorthand signature `61K8rjNeQsTC8xjxeLd22RdoJ5Nv9pQ9V4GN8t8GiRbJxF2puKmMgVfzqvV2AJ5xMEn3JCqCPe6ojr6wbWV7QMRK`: `MATCH / OK`.
- Shorthand runtime ID: `4cb3f34519cc3450f7ca34bcf917b003`.

### Risks / Unknowns

- `sdk/verify.ts` still depends on repo-local IDL/helper paths; real external npm packaging remains a separate decision.
- Devnet evidence depends on current RPC availability and funded wallet state.
- `artifacts/raffle.config.bin` and `artifacts/loot.config.bin` were regenerated during verification.

### Verdict

Tester verification accepted. `HACKATHON-CONFIG-ENGINE-001` is ready for Hub acceptance.

### Hub Handoff Prompt

Review and accept or reject `HACKATHON-CONFIG-ENGINE-001`.

Evidence:
- SDK export surface is present in `sdk/index.ts`.
- `yarn install --frozen-lockfile` passed.
- `npx tsc --noEmit` passed.
- Raffle and loot artifact builds passed and produced different hashes.
- Replay output keys are preserved.
- Mismatch path exits non-zero with `MISMATCH / ERR_ARTIFACT_HASH_MISMATCH`.
- Devnet `--config examples/raffle.config.json` replayed as `MATCH / OK`.
- Devnet `--raffle` shorthand replayed as `MATCH / OK`.

Decision needed:
- Accept and commit current implementation, or request additional packaging/browser verification.

Confidence: high.

---

## Engineer Implementation Summary — 2026-04-15 15:45:06 +0300

### Facts

- Added `sdk/types.ts`, `sdk/artifact.ts`, `sdk/verify.ts`, and `sdk/index.ts`.
- Added JSON config support for `raffle`, `loot`, and `airdrop`.
- Added `scripts/build_artifact.ts`.
- Added `examples/raffle.config.json`, `examples/loot.config.json`, and `examples/airdrop.config.json`.
- Refactored `scripts/resolve_operator.ts` so W3O1 serialization is owned by `sdk/artifact.ts`; `--config` and `--raffle` both call `buildArtifact`.
- Refactored `scripts/replay_verify.ts` into a wrapper over `verifyOutcome` while preserving text/JSON output keys and non-zero exit on `MISMATCH`.
- Updated `package.json` with npm-compatible metadata and `build:artifact`.
- Updated `tsconfig.json` to include `sdk/**/*.ts`.
- Did not change Rust/Anchor code.
- Did not change web UI.
- Did not add new npm dependencies.

### Acceptance Evidence

- `yarn build:artifact --config examples/raffle.config.json --out artifacts/raffle.config.bin`: passed, hash `4a3304a5cb2804331078c6e09b687fdbce1545e2cda5d77ef0c1eb3ab7688ed7`, bytes `657`.
- `yarn build:artifact --config examples/loot.config.json --out artifacts/loot.config.bin`: passed, hash `c7a19da303433427976b43fa87aeccdfa49f30fe307b183eecfb31d310484f94`, bytes `301`.
- `yarn build:artifact --config examples/airdrop.config.json --out artifacts/airdrop.config.bin`: passed, hash `dc5e40691ec9b536ac35e6e47a24d657a7c31a2788535d6371a8d858c55f0b73`, bytes `924`.
- `yarn resolve:operator --config examples/raffle.config.json --url https://api.devnet.solana.com --wallet /Users/timurkurmangaliev/.config/solana/esjx.json`: passed, signature `4dne2ZC6AmkF3TufDSZS9SCgCWSSfnMacHqg1wiVGnStEGAFoDuEyecysFqj3rsJDKWJzKpfdTzfKF7gq3PgcYVn`.
- Replay for config signature: `MATCH / OK`, runtime `7dc2f64041e66fdd4edfd79a48914ccf`.
- `yarn resolve:operator --url https://api.devnet.solana.com --wallet /Users/timurkurmangaliev/.config/solana/esjx.json --raffle`: passed, signature `3DZFaYviyqmwwDaBZzgjxzEFsHaNYNkuaT7sXcsZzd3QfMCtvoojxHCoLNxnDfQeuc1nkLkELU4gWg9tLaaQZ351`.
- Replay for shorthand signature: `MATCH / OK`, runtime `6677eebadd242ec3869f23697582d820`.
- `yarn resolve:operator --url https://api.devnet.solana.com --wallet /Users/timurkurmangaliev/.config/solana/esjx.json`: passed, signature `2nGY3iRwEF8Qx9TXuPX1wuS4xuCnKqLinbPJA4pav7axySSd7YPH1kbXRiK1vLfb6e7H6PBEghYmHwMG9FcEqxGo`.
- Replay for default operator signature: `MATCH / OK`, runtime `bb73b4f796515618a0ba087d288100d7`.
- Existing latest raffle replay for `mUXwaeNZoDuyjPxiPo1hFtCDMEAHKcKfjaQX694khNTxFxG8bMMwLhumPusVDv53r9QwC5uPvxPYErmrx1Lg9Qh`: `MATCH / OK`.
- Existing replay JSON output preserved expected keys.
- `npx tsc --noEmit`: passed.
- `yarn install --frozen-lockfile`: passed.
- `cargo test -p outcome`: passed, 9 tests.
- `git diff -- programs/outcome web`: empty.

### Risks / Edge Cases

- `sdk/verify.ts` currently uses shared local helpers and IDL path from `scripts/outcome_public_sdk.ts`; this is acceptable for metadata-only packaging, but real package publishing needs IDL/helper packaging.
- Generated acceptance artifacts are present at `artifacts/raffle.config.bin`, `artifacts/loot.config.bin`, and `artifacts/airdrop.config.bin`.
- JSON lamports intentionally support only safe integer numbers, not strings.
- Airdrop `slots` is validated but not encoded; operator must run N resolves, and duplicate winners remain allowed.

### Tester Handoff Prompt

Verify `HACKATHON-CONFIG-ENGINE-001` in `/Users/timurkurmangaliev/verifiable-outcome-engine`.

Scope:
- Do not change Rust or web UI.
- Confirm SDK exports, config artifact builder, replay wrapper compatibility, and operator `--config` / `--raffle` behavior.

Suggested checks:

```bash
cd /Users/timurkurmangaliev/verifiable-outcome-engine
yarn install --frozen-lockfile
npx tsc --noEmit
yarn build:artifact --config examples/raffle.config.json --out artifacts/raffle.config.bin
yarn build:artifact --config examples/loot.config.json --out artifacts/loot.config.bin
yarn -s replay --sig 4dne2ZC6AmkF3TufDSZS9SCgCWSSfnMacHqg1wiVGnStEGAFoDuEyecysFqj3rsJDKWJzKpfdTzfKF7gq3PgcYVn --url https://api.devnet.solana.com --program-id 3b7TFKQWUhPqWBieLHop4Mj2e41vwvnvjEosbsdmXkBq
```

Expected replay result: `MATCH / OK`.

Confidence: high.
