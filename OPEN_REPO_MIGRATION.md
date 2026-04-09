# Open Repo Packaging Note

This document freezes the bounded public export shape for `reference-slot/`.

## 1) Exact public export set

Move only:

- `reference-slot/README.md`
- `reference-slot/RUNBOOK.md`
- `reference-slot/REVIEWER_RUNBOOK.md`
- `reference-slot/OPEN_REPO_MIGRATION.md`
- `reference-slot/.env.example`
- `reference-slot/.gitignore`
- `reference-slot/package.json`
- `reference-slot/tsconfig.json`
- `reference-slot/scripts/outcome_public_sdk.ts`
- `reference-slot/scripts/replay_verify.ts`
- `reference-slot/web/server.mjs`
- `reference-slot/web/public/index.html`
- `reference-slot/web/public/play.html`
- `reference-slot/web/public/verify.html`
- `reference-slot/web/public/spec.html`
- `reference-slot/web/public/app.css`
- `reference-slot/artifacts/EXPECTED_TX_EXAMPLES.md`
- `reference-slot/artifacts/outcome_devnet_blessed_signatures.json`
- `reference-slot/artifacts/outcome_idl.json`
- `reference-slot/artifacts/public_evidence_summary.json`
- `reference-slot/artifacts/compiled_spec_v2.json`
- `reference-slot/artifacts/compiled_spec_v2.bin`
- `reference-slot/artifacts/metrics.json`
- `reference-slot/yarn.lock`

## 2) Explicitly excluded

- `examples/**`
- `core/contracts/**`
- `agent-instructions/**`
- `reference-slot/node_modules/**`
- local coverage outputs
- legacy manual blessed signatures files outside the accepted outcome-core source
- historical localnet signatures as public acceptance fixtures
- `.DS_Store`

## 3) Standalone rule

The exported package must assume:

- local dependencies are installed inside the package itself,
- replay runs from local `scripts/replay_verify.ts`,
- no script or doc points to monorepo-only paths,
- public evidence is derived only from accepted source-of-truth.

## 4) Reviewer goal

Public reviewer should be able to:

1. open the packaged web UI,
2. inspect accepted evidence and active blessed signatures,
3. replay any blessed devnet signature,
4. see `MATCH / OK` without monorepo internals.
