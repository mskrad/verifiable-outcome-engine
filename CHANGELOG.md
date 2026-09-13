# Changelog

Protocol version history for the Verifiable Outcome Engine. All entries describe the
canonical **devnet** program `6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B`. Mainnet is a
separate, later effort. Numbers below come from `artifacts/public_evidence_summary.json`.

The format is based on [Keep a Changelog](https://keepachangelog.com/); this project tracks
**protocol/standard versions** (not npm package versions).

## Version model — two independent axes

Versions live on **two orthogonal axes**; don't conflate them:

- **Artifact format (`artifact_format_version`, "fmt") — about SIZE.** How the rules +
  participant list are encoded on-chain.
  - **Compact** (W3O1 v1/v2/v3, fmt 1/2/3): full list inline, capped at ~**103 entries / 8 KB**
    → **small & medium** draws (same format — only the entry count differs).
  - **Scale** (V1.2 / V1.2.1, fmt 6/7): **Merkle snapshot**, only the root on-chain →
    **large** draws (thousands–millions).
- **Randomness (`rng_version`) — about SECURITY.**
  - **rng_v1** — operator `master_seed` (grindable). **Legacy, retained** (still used by scale snapshot draws;
    public compact draws moved to rng_v2 on 2026-09-13).
  - **rng_v2** — future Solana SlotHash (unpredictable). **Current.** Two lifecycles:
    - **v1.2** single-phase `settle_rng_v2` — one settle; unpredictable, not no-abort. Fit for
      casino/game "simple random" (untrusted operator is not the threat).
    - **v1.3.2** two-phase `seal → attest` — adds no-abort (untrusted operator).
  - rng_v2 accepts both compact and scale formats since 2026-09-09.

---

## 2026-09-13 — Public draws on rng_v2, shorter draw window

- **Draw target offsets `[8, 16, 24]`.** `prepare_rng_v2` now fixes its three future target slots
  8, 16 and 24 slots ahead instead of 75, 90 and 105, so a draw's entropy exists about 10 seconds
  after prepare instead of 42. A Solana leader produces four consecutive slots: the first target
  is always at least two leader groups after the slot that included prepare, and the three targets
  sit in three different groups. A skipped target resolves to the next produced slot after the
  previous resolved one. Groups are not validators. Measured over 5,000 slots on 2026-09-13, one mainnet
  validator produced two of the three hashes in 3.1% of draws with 8/16/24 against 2.3% with
  75/90/105, and never all three; on devnet (12 leaders, 22.5% skipped slots) one validator
  produced two or more in about 73% of draws whatever the offsets. The first offset itself buys
  nothing, because the leader schedule is public an epoch ahead. Sortition keeps `[75, 90, 105]`, since its registration window
  must close before the first target. Slot spins keep `[3, 4, 5]`. Verification is unchanged: the
  verifier reads the recorded target slots.
- **Public draw endpoints resolve through rng_v2 single phase.** `POST /api/examples/draw`,
  `POST /api/partner/draw` and `POST /api/live-raffle` commit the rules, prepare, wait for the
  target slots, settle and replay inside the request. Responses keep their fields and add
  `rng_version`, `entropy_source`, `prepare_signature`, `target_slots`, `resolved_slots` and
  `winner_claim_hash`. Draw artifacts are payout-free. Scale snapshot draws stay on rng_v1.
- **Deployed** to `6QtLot…` at slot `497829503` (upgrade `3hPmXzi3…`); the four blessed
  signatures still replay to MATCH.

## 2026-09-09 — Hackathon-era integrations removed

- **Removed:** Squads multisig helpers (`scripts/squads_*`), the Swig smart-wallet operator
  path (server `SWIG_*` config, SDK delegate signing, setup scripts), the Vanish private-payout
  route (`sdk/vanish.ts`, `/api/live-raffle` payout hook, `VANISH_*`), the Metaplex Agent
  Registry integration (script, dependencies, `/agents/*.json`, spec section) and the empty
  Arcium scaffold. None of them sat on a live product path: the canonical `6QtLot…` program is
  upgraded with a single operator key, live draws are signed by the plain `ProgramConfig`
  admin key (`LIVE_RAFFLE_WALLET`), and payouts stay with the integrator. `/api/health` no
  longer reports `swig_*` fields; `operator.mode` is always `raw_keypair`.
- **Kept:** World ID gating on live raffles and Irys publication for scale snapshots.

## 2026-07-04 — VRE-operated conditions endpoints + canon-id fix

- **VRE-operated partner endpoints** for conditions: `POST /api/partner/conditions/commit`
  (anchor the round rules on-chain before the outcome) and `POST /api/partner/conditions/resolve`
  (reveal facts, resolve on-chain, return the tx signature). VRE does all on-chain work with its
  own key (`CONDITIONS_OPERATOR_WALLET`, the program-config admin) — the partner only calls the
  API with an `x-api-key`, no keys/deploy/approve on their side. Commit binds the rules; resolve
  verifies the revealed facts did not change them. Live end-to-end (OddSol in production; replay
  → MATCH). See `INTEGRATION.md` Part 5.
- **Canon program-id fix:** a botched `9tEram → 6QtLot` find-replace had left an invalid id
  (`6QtLot…CimFE1F`) as the default across the Verify page, widget, replay SDK, and scripts —
  replay defaulted to `ERR_PROGRAM_ID_MISMATCH`. Corrected to the real canon everywhere, and the
  stale hero example signature swapped for a blessed one that replays to MATCH.

## 2026-07-03 — Conditions (OddSol) live on-chain + parity hardening

- **Conditions (fc7/fv9) wired end-to-end on `6QtLot`.** `submit_compiled_artifact`,
  `finalize_compiled_artifact`, and `initialize_outcome_config` now accept the fc7 format
  (`format_version = 9`) via additive, format-gated branches (structural fc7 validation;
  attestation-only zero input band). Previously the format was rejected at submit, so the
  deployed `resolve_conditions` was unreachable. A live `resolve_conditions` attestation
  (`15,738` CU) now **replays to MATCH** through the reviewer path (`sdk/verify.ts` fc7 branch):
  it reconstructs the committed fc7 blob from its chunk accounts, recomputes S + ranking, and
  matches the on-chain `ConditionsResolvedV1` (`winners_digest`, `facts_ref_root`,
  `winning_score_sum`). No fund custody — VRE proves the winner ranking; payout is pro-rata over
  winners, executed by the partner.
- **Fixed-point parity hardening (Rust ↔ TS).** The coefficient overflow contract is now
  identical on both sides: a slip whose worst-case coefficient overflows `u128`/`u64` is rejected
  at `validate()` (not silently scored `0`). The TS scorer carries `score_fixed` as an exact
  `bigint` (was a lossy `number` above 2⁵³) so the off-chain `winners_digest` is byte-identical
  to on-chain. Negative overflow vector added to the parity set.

## 2026-07-03 — settle_rng_v2 (v1.2) restored + size pass

- **`settle_rng_v2` (v1.2)** restored from the pre-1.3.2 design (INFRA-003): single-phase
  rng_v2 settle — future SlotHash entropy, one settle, executes payout. Gives operators the
  choice per draw: fast single-phase (v1.2) or no-abort two-phase (v1.3.2). Resolution tagged
  `protocol_revision = 2`, `entropy_source = SlotHash`. **Live on `6QtLot` since 2026-07-03**
  (canonical redeploy, slot 473728377).
- **Size:** ~1.21 MB → ~1.03 MB (light) with no functional loss — SHA-256 via the `sol_sha256`
  syscall (dropped the `sha2` crate, −21 KB), manual `UpgradeableLoaderState` parse (−62 KB),
  `strip = true`. `opt-level` stays **3**: `opt-z/s` were measured to break the public
  "claim sortition < 10k CU" guarantee (z=14,552, s=11,280 vs 8,188 CU on opt-3).
- Unicorn-G moved behind a `unicorn-g` cargo feature (opt-in build; alt_bn128 is a syscall, so
  the size delta is small — the feature keeps the trusted-setup-pending path out of the default).

## 2026-07-02 — Product-surface sync

Aligned the public product surface (docs, npm `sdk/`, `/api/*`, web) with the canonical
protocol after the promotion below. Commits `208d2ef` (product-sync) and `9eb588c`
(conservation-hardening) on branch `protocol-update`.

- Docs: resolution-paths matrix + this changelog; `spec.html` now specifies the new paths.
- SDK: `sdk/sortition.ts` client surface (`createSortitionClient`, create/register/seal/claim).
- API: additive `POST /api/partner/sortition/{draw,register,seal,claim}` (partner-key gated).
- Web: new `/protocol-paths` page; `judges.html` / `pitch.html` removed.
- Hardening: `close_split(rent, skim_bps)` guarantees `refund + skim == rent` by construction
  (`programs/outcome/src/state/sortition.rs`), with boundary tests (program tests 31 → 33).

## 2026-06-25 — Canonical promotion

The full protocol was promoted to the canonical devnet program `6QtLot…`. There is no longer a
separate isolated program for these paths.

- **Default entropy stays SlotHashes.** Unicorn-G is **opt-in**, selected explicitly per draw.
- Sortition-by-Claim (v1.4.0), sortition economics (v1.4.1), and the Unicorn-G entropy source
  became canonical paths on the one program; replay-by-signature remains the **default**.

---

## Protocol paths

### Unicorn-G entropy source (B8) — canonical · opt-in
`PROTOCOL-INFRA-014-B8`

Alternative global-Ω entropy: a VDF output `y` verified on-chain via an embedded Groth16
verifier. Default entropy remains SlotHashes; Unicorn-G is opt-in and relies on a Groth16
trusted setup (devnet RSA modulus) — a multi-party ceremony is the path to a stronger setup
before any mainnet use.

- Seal (integrated, on-chain Groth16 verify + commit binding): **247,476 CU**.
- Attest: **61,466 CU**.
- Wrong-proof rejection: `InvalidUnicornGProof` (error `6035`), simulation `143,069 CU`.
- Localnet full e2e: seal `209,226 CU`, prover wall `37.4 s`, peak RSS `4.3 GB`, tampered `y`
  rejected. Validated end-to-end on devnet.

### Sortition economics (v1.4.1) — canonical
`PROTOCOL-INFRA-013`

Optional fee layer on a sortition draw, byte-compatible with 1.4.0 draws (fee fields `0` =
disabled). `fee_mode` bitflags select a flat `entry_fee_lamports` charged at register and/or a
`close_skim_bps` skim on close; fields are carved from previously reserved bytes. Rent
conservation on close is enforced by `close_split` (`refund + skim == rent`) into a dedicated
treasury.

- Positive path OK; **9/9** negative cases pass; treasury is dedicated.
- CU: register (paid) `18,096`, init economics `5,234`, close `9,643`, sweep(2) `18,459`.

### Sortition-by-Claim (v1.4.0) — canonical
`PROTOCOL-INFRA-011`

Commit-reveal ticket draw. Entrants register a `commitment = sha256(secret ‖ ticket_id ‖
draw_id)` before a deadline; the draw seals against three future SlotHashes-derived slots to fix
`omega`; each entrant self-claims by revealing `secret` and wins iff `sha256(secret ‖ omega) <
threshold`.

- Lifecycle create/register/seal/claim passes; **5/5** negative cases pass; claim CU < `10k`.
- Distribution (200 draws, 100 tickets, expected 10 winners): observed mean `9.7`, variance
  `8.76` vs binomial mean `10`, variance `9`.

### global-Ω resolve / replay-by-signature (v1.3.2) — canonical · default
Two-phase settle global-Ω resolution and standalone replay-by-signature. The default reviewer
entry point: recompute an outcome locally from a transaction signature. Four blessed canonical
devnet signatures replay to MATCH / OK (Raffle, Rewards Selection, Trading Competition,
Prediction Market).

### Baseline (hackathon)
`rng_v1` / `rng_v2` resolve plus the blessed devnet signature set and replay-by-signature —
the accepted execution contract the later paths build on.
