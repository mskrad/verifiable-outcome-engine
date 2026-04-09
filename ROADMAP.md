# Roadmap — Verifiable Outcome Engine

**Hackathon:** Colosseum Frontier, Apr 6 – May 11, 2026

---

## Vision

Any developer building a Solana dApp that involves outcome selection — raffle, airdrop, generative mint, loot — can integrate VRE to make that outcome independently verifiable, without trusting the operator.

---

## Sprint 1 — Demo Surface ✅ (Apr 6–11)

- Standalone replay verifier by transaction signature
- Reviewer-facing web UI (play → verify → MATCH)
- Two active devnet blessed signatures
- Operator resolve helper (`resolve:operator`)
- Clean public repo, docs aligned

---

## Sprint 2 — Make the Guarantee Visible (Apr 12–18)

- **Real raffle artifact:** replace demo outcomes with actual Solana wallet addresses as participants; replay returns `winner: <address>`
- **Pre-commitment timeline:** show `artifact committed at slot X < resolved at slot Y` — makes tamper-resistance visible, not just claimed
- **Explorer links:** one-click TX view on Solana Explorer for each blessed signature
- **Public web deploy:** hosted verify URL, no `yarn install` required

---

## Sprint 3 — Developer Story (Apr 19–25)

- **Integration guide:** step-by-step for operators building on VRE (compile spec → submit artifact → resolve → verify)
- **Second use case:** airdrop / whitelist selection — same protocol, different narrative
- **Open smart contract:** source or verified program link so judges can inspect the on-chain engine

---

## Sprint 4 — Production Signal (Apr 26 – May 4)

- **SDK interface:** importable `verifyOutcome()` — not just a CLI
- **Error taxonomy:** documented mismatch codes and failure modes
- **Submission prep:** Colosseum form, project description finalized

---

## Sprint 5 — Final Submission (May 5–11)

- Pitch video (≤3 min): problem → solution → live demo → developer story
- Final docs pass
- Colosseum submission

---

## What VRE Guarantees

VRE proves a specific, bounded property:

> The outcome was selected by applying a fixed algorithm to a pre-committed artifact, using on-chain randomness from the resolution transaction. The operator could not have changed the rules or the result after the artifact was committed.

It does not claim the participant list was fair — only that the selection step was not manipulated after commitment.
