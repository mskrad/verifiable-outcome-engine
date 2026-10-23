# Security Policy

## Scope

Verifiable Outcome Engine runs on Solana devnet. Mainnet is planned for this year and will get its
own release gate.

In scope:

- Anchor program `programs/outcome/src/` deployed as `6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B`:
  artifact lifecycle (submit, chunk init and write, finalize, review), runtime binding,
  `prepare_rng_v2` / `settle_rng_v2`, `seal_randomness` / `attest_winners`, `resolve_outcome*` (rng_v1),
  sortition instructions, `resolve_conditions`, admin and fee instructions
- Verifier and SDK: `sdk/` (`verifiable-outcome-sdk` on npm)
- Web server and public API: `web/server.mjs`

## Responsible disclosure

Report security issues privately to
[hello@verifiableoutcome.online](mailto:hello@verifiableoutcome.online) or in Telegram
[t.me/maskradiator](https://t.me/maskradiator).

Include the affected component, reproduction steps, transaction signatures or logs, expected and
actual impact, and a suggested mitigation if you have one.

## Known limitations

- **rng_v1** (operator seed, legacy): the seed and all other inputs are public, so the operator and
  anyone else can compute the result before it is sent. Draw endpoints no longer use it.
- **rng_v2** (future slot hashes): the operator cannot predict the winners, but a validator that
  produces one of the target slots has limited influence over its hash. In single phase the operator
  can decline to settle; two phase removes that option. The spec lists measured numbers.
- **Partner API**: draws, sortition and conditions on the public host are signed by the VRE operator
  key. A rejected program instruction returns 409, 422 or 404 with `error_code`; server failures
  return 500.
- The verifier does not replay sortition transactions; the claim instruction enforces the predicate.
- Devnet results are demonstration evidence, not a production financial guarantee.
- The devnet upgrade authority is a single key. Mainnet governance (multisig, timelock or immutable)
  is decided before launch.

## Current hardening

- `ProgramConfig` bootstrap is guarded by the upgrade authority; artifact approval by the
  `ProgramConfig` admin, which is a separate key.
- Public replay and timeline APIs validate signature, program id, JSON body size and RPC URL.
- Custom replay RPC and artifact overrides are disabled on the public host
  (`VRE_ALLOW_REPLAY_OVERRIDES`, `VRE_ALLOWED_RPC_URLS`).
- Replay runs with a timeout; static file serving enforces path containment.
- Rate limits: general API, replay, demo draws per IP; partner draws per key.
- `/api/health` reports the operator mode and program id, not key locations.

## Review history

- 2026-04-23: static review of the rng_v1 program, artifact lifecycle and web server; no critical
  findings.
- rng_v2, sortition, conditions and the partner API were built after that review and have not had an
  external audit.
