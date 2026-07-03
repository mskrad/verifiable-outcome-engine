# Changelog

Protocol version history for the Verifiable Outcome Engine. All entries describe the
canonical **devnet** program `6QtLot4uztCfjUuPreoiYPc3e1gH2fg6pq8hKYyvCP6B`. Mainnet is a
separate, later effort. Numbers below come from `artifacts/public_evidence_summary.json`.

The format is based on [Keep a Changelog](https://keepachangelog.com/); this project tracks
**protocol/standard versions** (not npm package versions).

---

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
