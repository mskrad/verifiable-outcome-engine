# LUCA Theory → VRE Integration Guide

## The Problem VRE Solves for You

When users copy an agent or tail a prediction, they have to trust:
> "Agent A had a 70% ETH position *before* the market moved."

There's no proof. Weights could have been adjusted retroactively. That's a trust gap — especially once real capital follows.

VRE closes it: agent commits allocation on-chain at slot X. Immutable. Anyone can replay it later and verify MATCH.

---

## What VRE Does (and Doesn't Do)

| VRE handles | You handle |
|-------------|-----------|
| Commitment at slot X | Agent strategy + routing |
| Tamper-proof audit trail | Copy execution |
| Verifiable agent ranking | User interaction / UX |
| Independent replay by anyone | Capital allocation |

VRE sits one layer below your stack — purely as a timestamped, cryptographic record of who had what weight when.

---

## 1. Allocation Snapshot Commit

Agent publishes its portfolio allocation before market close:

```bash
curl -X POST https://verifiableoutcome.online/api/partner/draw \
  -H "Content-Type: application/json" \
  -H "x-api-key: vresk_YOUR_KEY" \
  -d '{
    "formula": "rank_desc",
    "label": "Agent A — ETH/SOL allocation 2026-04-30 slot 460000000",
    "winners_count": 1,
    "participants": [
      { "id": "ETH",  "score": 70 },
      { "id": "SOL",  "score": 20 },
      { "id": "BTC",  "score": 10 }
    ]
  }'
```

Result:

```json
{
  "ok": true,
  "signature": "5xYz...",
  "outcome_id": "ETH",
  "outcome_ids": ["ETH", "SOL", "BTC"],
  "replay_url": "https://verifiableoutcome.online/verify?sig=5xYz..."
}
```

- `signature` = on-chain anchor. Slot is immutable.
- Anyone can replay: "at slot X, Agent A held 70% ETH" → **MATCH / OK**

---

## 2. Verifiable Agent Ranking (for copy trading)

At the end of a competition period, rank agents by PnL from pre-committed snapshots:

```json
{
  "formula": "rank_desc",
  "label": "LUCA Theory Season 3 — top agents by PnL",
  "winners_count": 3,
  "participants": [
    { "id": "agent_alpha",  "score": 34.2 },
    { "id": "agent_beta",   "score": 28.7 },
    { "id": "agent_gamma",  "score": 21.1 },
    { "id": "human_oracle", "score": 19.5 }
  ]
}
```

Users see: "Agent Alpha won Season 3. Here's the tx signature. Verify independently."

Not "we say so" — on-chain proof.

---

## 3. Prediction Market: `closest_to`

For venues where the question is "who called the price most accurately":

```bash
curl -X POST https://verifiableoutcome.online/api/partner/draw \
  -H "Content-Type: application/json" \
  -H "x-api-key: vresk_YOUR_KEY" \
  -d '{
    "formula": "closest_to",
    "label": "LUCA Theory ETH price prediction 2026-04-30",
    "winners_count": 1,
    "target": 1796,
    "participants": [
      { "id": "hive_mind",       "score": 1812 },
      { "id": "digital_twin_A",  "score": 1779 },
      { "id": "agent_quant_7",   "score": 1801 },
      { "id": "superforecaster", "score": 1823 }
    ]
  }'
```

Result:

```json
{
  "ok": true,
  "signature": "2bgJ1QrjdKYpsovJyVJQk3KEPc6tKUSrt18RLoFLAhpH11amJWnEinbhPekwqyoCYS2HNduLq4q8fPWDxGGkXbQ9",
  "outcome_id": "agent_quant_7",
  "outcome_ids": ["agent_quant_7"],
  "replay_url": "https://verifiableoutcome.online/verify?sig=2bgJ1QrjdKYpsovJyVJQk3KEPc6tKUSrt18RLoFLAhpH11amJWnEinbhPekwqyoCYS2HNduLq4q8fPWDxGGkXbQ9"
}
```

Winner = `agent_quant_7` (predicted 1801, delta 5 — closest to actual 1796).  
Fully replayable. No dispute.

**Live example:**  
https://verifiableoutcome.online/verify?sig=2bgJ1QrjdKYpsovJyVJQk3KEPc6tKUSrt18RLoFLAhpH11amJWnEinbhPekwqyoCYS2HNduLq4q8fPWDxGGkXbQ9

---

## 4. Verification

Every committed draw gets a shareable link:

```
https://verifiableoutcome.online/verify?sig=<TX_SIGNATURE>
```

What it shows:
- Committed participants and weights at slot X
- Formula applied (rank_desc / closest_to)
- Outcome — deterministic, no way to change after commit

---

## 5. Trust Model

**LUCA Theory is responsible for:**
- Agent strategy quality
- PnL calculation
- Execution routing for copy trades

**VRE guarantees:**
- Allocation snapshot is frozen at commit slot
- Outcome is deterministic from committed data
- Result cannot be changed after resolve
- Anyone — including users, regulators, auditors — can independently verify

---

## 6. Integration Points

| Use case | VRE formula | What gets committed |
|----------|------------|---------------------|
| Portfolio allocation snapshot | `rank_desc` | asset → weight% |
| Season leaderboard | `rank_desc` | agent → PnL |
| Price prediction winner | `closest_to` | agent → predicted price, target = actual |
| Random agent spotlight | `weighted_random` | agent → weight by Sharpe/PnL |

---

## 7. Constraints (current)

- `winners_count`: 1–10
- Up to ~15–20 participants with short IDs
- For full agent pools (50+): chunked snapshot commit coming post-hackathon

---

## 8. Minimal Integration

1. At start of competition period: commit agent allocations → store tx signatures
2. After close: commit PnL leaderboard → `rank_desc` → announce winners with replay URL
3. Users can verify any claim independently — no trust in operator required
