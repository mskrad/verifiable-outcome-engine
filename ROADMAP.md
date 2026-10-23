# Roadmap — Verifiable Outcome Engine

VRE lets any Solana app that picks winners commit its rules on-chain before the draw and let anyone
check the result from the transaction signature.

## Done

- **Replay by signature.** `/verify`, the `vre verify` CLI, `verifyOutcome()` in the SDK and an
  embeddable widget; documented reason codes.
- **Randomness from future slots.** Draws take their randomness from three Solana slots that did not
  exist when the rules were committed (rng_v2, single phase by default, two phase optional).
- **Draw API.** `POST /api/partner/draw` with five formulas and a keyless demo endpoint; results come
  back in one request with the slots used.
- **Sortition-by-Claim** with an optional fee layer, and **Conditions** for scoring prediction slips.
- **Showcase draws** on the canonical devnet program, all replaying to `MATCH`.
- **npm package** `verifiable-outcome-sdk`.
- Colosseum Frontier hackathon submission (April–May 2026).

## Now

- Hackathon participants try the partner API; feedback in Telegram [t.me/maskradiator](https://t.me/maskradiator).
- Readable 4xx errors with program error names across partner endpoints.

## Next

- Mainnet this year, after a release gate: key custody and upgrade governance, an external review
  of rng_v2, sortition and conditions, production RPC.
- Unicorn-G entropy (implemented, not deployed): circuit soundness fix and a trusted-setup ceremony
  before it can be deployed.

## What VRE proves

> The winners follow from rules committed on-chain before the randomness existed, and the rules and
> the recorded result could not be changed after commit.

It does not prove that the participant list was fair or complete, only that it did not change after
commit, and it does not pay prizes. What each resolution path does and does not prove:
[spec · Overview](https://verifiableoutcome.online/spec#overview).
