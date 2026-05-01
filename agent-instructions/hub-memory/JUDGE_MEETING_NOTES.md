# Judge Meeting Notes — Apr 21, 2026

**Source:** Phantom representative, hackathon judge session
**Attendee:** Timur

---

## Critical Takeaways

### 1. Our current description is a category, not a value prop

What was said in the room about VRE:
> "Dev infrastructure for verifiable outcomes."

This is a **category label**, not a value prop. It answers none of:
- Who is it for?
- What breaks without it?
- What do they get?
- Why now / why Solana?

### 2. The formula that works

> "We help [audience] achieve [result] so they can [value], without [pain]."

Current → weak: `"dev infrastructure for verifiable outcomes"`
Target → strong:
```
"We help Solana apps replace backend-trust reward logic
 with replay-verifiable on-chain outcomes."
```

Or even sharper:
```
"If your app resolves rewards on-chain, we make every outcome
 trustless, replayable, and independently verifiable."
```

### 3. Don't pitch two audiences at once

Judge's explicit point: if you're not a marketplace, **pick one customer**.
Mixing B2B (SDK/infra for devs) and B2C (users checking if they won)
breaks the value prop.

Decision needed: **B2B first** (devs integrating VRE) or **B2C first** (end users verifying results)?

### 4. Separate user pitch from investor pitch

- **User pitch:** why use this right now
- **Investor/judge pitch:** why this becomes a big market + why we can win

These are different documents, different language.

### 5. Phantom relevance for VRE

| Phantom product | Relevant for VRE? |
|---|---|
| Connect SDK / embedded wallets | ✅ Yes — "Did I win?" on verify.html |
| MCP server for agent trading | ⚠️ Only if building agent-facing flow |
| Stablecoin payments | ❌ Not our core |

**Key guard:** VRE core value is NOT Phantom. It is:
- Outcome resolved on-chain
- Replay via tx signature
- Backend is NOT source of truth

Don't dilute this with Phantom narrative.

---

## Approved Pitch Variants

### One-liner (5 words, Josip standard — May 2026)
```
On-chain proof of who won.
```
Explicit. Non-ambiguous. Exciting. Truthful. No buzzwords.

### Blurb (Pixar storytelling format, ~120 words)
```
Context:
Every Solana app that runs competitions, raffles, airdrops, or loot drops
announces a winner. Someone wins, someone loses.

Problem:
Users have to trust the backend. "We picked the winner" — there's no proof
it wasn't rigged after the fact. The more money follows, the bigger the
trust gap.

Hero rises:
VRE is a Solana program that commits the outcome rules on-chain before
resolution. One API call. Anyone can replay the result from a transaction
signature and confirm: rules match, winner is correct, nothing changed.
The backend is no longer the source of truth.

Why you:
Live on devnet. Partner Draw API live — any app integrates in 30 minutes
with one POST request. 10+ projects already building on it: trading
competitions, pack breaks, prediction markets, airdrops.
```

### Founder video script (60 sec, no edits)
```
Hey — I'm Timur, building Verifiable Outcome Engine on Solana.

Here's the problem. Every app on Solana that picks a winner —
competition, raffle, airdrop, loot drop — asks users to trust the backend.
"We picked the winner." No proof. No replay. Just trust us.

VRE fixes that. One API call commits the outcome rules on-chain
before resolution. Anyone — users, auditors, anyone — can take the
transaction signature and replay the result themselves.
Rules match. Winner correct. Tamper-proof.

We're live on devnet. Partner API ships today.
30-minute integration. 10+ projects already building on it.

The trust gap is real. We closed it.

verifiableoutcome.online
```
~70 words, ~35 seconds speaking — room for pauses up to 60 sec.

### Dev pitch
```
Build on-chain reward and outcome systems that users can verify locally,
without trusting your backend.
```

### User pitch (end-user, B2C angle)
```
Check if you won — independently, from chain data, without trusting anyone.
```

---

## Open Decisions (need owner + deadline)

1. **B2B vs B2C primary strategy** — pick one before Sprint 4
2. **Commercial model** — protocol fee per resolution (B2B) vs free infra + premium features
3. **Pitch rewrite** — all public surfaces (README, index.html, play.html) need new copy
