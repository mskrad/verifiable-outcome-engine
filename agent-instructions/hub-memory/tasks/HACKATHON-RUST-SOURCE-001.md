# TASK MEMORY: HACKATHON-RUST-SOURCE-001

## Task Card Snapshot

- Problem:
  - The standalone repo exposed the verifier and operator TS runtime surface, but not the Rust on-chain source for the canonical outcome program.
- Parent sprint / coordination frame:
  - `HACKATHON-SPRINT-1`
- Scope:
  - Add the minimal Rust source slice for the canonical `outcome` Anchor program to the standalone repo.
  - Keep the existing verifier-first and operator runtime surfaces unchanged.
- Out of scope:
  - `core/contracts/slot/**`
  - `core/contracts/wheel/**`
  - monorepo tests and TS smoke scripts
  - deploy artifacts, `target/**`, local validator state, and key material
  - docs polish for the hackathon narrative
- Acceptance:
  - Standalone repo contains `Cargo.toml`, `Cargo.lock`, `Anchor.toml`, and `programs/outcome/**` only for the Rust program source.
  - No `slot`, `wheel`, example adapter, `target`, or monorepo-only runtime path is added as public source.
  - Rust tests for `outcome` pass from the standalone repo root.
- Facts:
  - Source candidate came from `core/contracts/outcome/programs/outcome/**` plus the local outcome Cargo/Anchor workspace files.
  - The Rust source has no dependency on `core/contracts/slot`, `wheel`, examples, or monorepo-only helper modules.
- Assumptions:
  - Revealing the canonical `outcome` Rust program source strengthens the public repo more than a verifier-only package, as long as the export remains limited to this source slice.
- Unknowns:
  - Whether the final public README should lead with source availability or keep the demo/replay path first.
- Confidence:
  - high

## Timeline

### 2026-04-12 14:01:11 +0400 - Hub opened bounded Rust source disclosure task

- Decision:
  - Opened `HACKATHON-RUST-SOURCE-001` to reveal the minimal canonical Rust source slice in the standalone repo.
- Status:
  - In progress.
- Notes:
  - This changes the public boundary from TS verifier plus operator to TS verifier plus operator plus canonical Rust program source.
- Confidence:
  - high

### 2026-04-12 14:01:11 +0400 - Hub accepted and closed Rust source disclosure task

- Decision:
  - Accepted and closed `HACKATHON-RUST-SOURCE-001`.
- Status:
  - Closed.
- Notes:
  - Added `Cargo.toml`, `Cargo.lock`, `Anchor.toml`, and `programs/outcome/**`.
  - Did not add `slot`, `wheel`, examples, tests, TS smoke scripts, target outputs, deploy artifacts, or key material.
  - Added Rust/Anchor build outputs to `.gitignore`.
- Confidence:
  - high

## Open Items

- Open a separate bounded docs task to explain the Rust source in the public README and runbooks.

## Final Status

- Accepted and closed.
