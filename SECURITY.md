# Security Policy

## Scope

This repository is a hackathon-facing public reference for Verifiable Outcome Engine.
The current canonical deployment is Solana devnet only. Mainnet deployment is not
yet in scope.

Security review scope for `HACKATHON-SECURITY-AUDIT-001`:

- Anchor program source under `programs/outcome/src/`
- Critical instructions: `resolve_outcome`, `admin_withdraw`, `refresh_master_seed`
- Artifact lifecycle instructions: submit, chunk init/write, finalize, review
- Math modules: `math/rng_v1.rs` and `math/compiled_outcome_v1.rs`
- Web server: `web/server.mjs`

## Responsible Disclosure

Please report security issues privately to
[hello@verifiableoutcome.online](mailto:hello@verifiableoutcome.online).

Include the affected component, reproduction steps, transaction signatures or logs
when applicable, expected impact, actual impact, and any suggested mitigation.

## Known Limitations

- Randomness v1 is deterministic and publicly verifiable. It is not suitable for
  adversarial economic payouts without an external randomness design such as VRF,
  commit-reveal, or another anti-grinding mechanism.
- `master_seed`, `runtime_id`, `next_resolve_id`, artifact data, and actor pubkeys
  are public or inferable from chain state. A participant can precompute outcomes
  for candidate actor pubkeys.
- Devnet examples are demonstration evidence, not a production financial guarantee.
- Mainnet deployment requires a final release gate after the current hardening
  work, including production RPC allowlist and operator-key custody review.

## Current Hardening

- Fresh `ProgramConfig` bootstrap is guarded by the current upgrade authority.
- Public replay and timeline APIs validate signature, program id, JSON body size,
  RPC URL, and artifact path inputs.
- Custom replay RPC and artifact overrides are disabled by default. Operators can
  enable them explicitly with `VRE_ALLOW_REPLAY_OVERRIDES=1` and
  `VRE_ALLOWED_RPC_URLS`.
- Replay subprocess execution has a timeout.
- Static file serving enforces resolved path containment.
- Public API rate limiting uses the socket remote address by default. Set
  `TRUST_PROXY=1` only behind a trusted proxy that owns `X-Forwarded-For`.

## Review Summary

Review date: 2026-04-23

Critical findings: none identified in static source review.

High and Medium findings were either mitigated in code or documented as current
limitations. RNG v1 remains a documented limitation and must be replaced or wrapped
with an anti-grinding design before adversarial mainnet economic use.
