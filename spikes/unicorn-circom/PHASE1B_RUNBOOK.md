# Unicorn-G Phase 1b — Runbook (live prover measurement on a rented box)

**Goal:** get the live numbers the 18 GB dev laptop couldn't produce — Groth16
**setup** wall+RAM (one-time), and **prove** wall+RAM with snarkjs and rapidsnark
(per-draw) — for the full Wesolowski-verify circuit (~14.49M constraints).

**What we already have (no box needed):** the hard constraint count 14,487,811,
correctness validation, and the circuit/fixture sources (committed). Phase 1b only
fills in the prover constants.

---

## 1. Pick the box

- **BL27-NVMe class or similar: AMD EPYC, 64 GB RAM, NVMe, 8+ cores.** GPU NOT
  needed (Groth16 prove is CPU-only — don't pay for a T4).
- OS: Ubuntu 22.04 / 24.04.
- Billing: per-hour/day, **delete when done** (this is a one-shot run).
- Payment with a Russian card: Timeweb Cloud / Selectel / VK Cloud / Cloud.ru.
- 64 GB is comfortable for setup; if snarkjs setup at 2^24 still presses RAM,
  NVMe swap cushions it. (A future Shamir-multi-exp circuit ~7.3M would halve this.)

## 2. Provision + run

```bash
# on the box
sudo apt-get update -y && sudo apt-get install -y git
git clone <THIS_REPO_URL> vre && cd vre
git checkout unicorn-g
cd spikes/unicorn-circom

# optional smoke test first (small, ~minutes, proves the pipeline end-to-end):
CIRCUIT=wv_n32 PTAU_POW=22 bash run_phase1b.sh

# the real run (full circuit, ~14.49M, 2^24 ptau):
CIRCUIT=wv_n128 PTAU_POW=24 bash run_phase1b.sh
```

`run_phase1b.sh` is idempotent and does everything:
1. installs Node 20, build deps, **circom 2.2.3**, **snarkjs**, builds **rapidsnark**;
2. downloads the 2^24 ptau (tries 3 mirrors; falls back to local generation);
3. compiles the circuit, builds a valid RSA-VDF fixture + witness;
4. runs **groth16 setup** under `/usr/bin/time -v` (wall + peak RSS);
5. **proves** with snarkjs AND rapidsnark, each timed;
6. verifies both;
7. writes **`RESULTS_phase1b.json`** + per-step timings in `phase1b/`.

## 3. Collect + tear down

```bash
cat RESULTS_phase1b.json          # the numbers
# copy it off the box, e.g.:
#   scp user@box:vre/spikes/unicorn-circom/RESULTS_phase1b.json .
```
Then **destroy the server** (billing stops on delete).

## 4. What the numbers mean

- **`zkey_setup`** = the heavy step. **ONE-TIME per circuit**, never per draw.
  This is what needs the RAM. Expect this to dominate wall + RSS.
- **`prove_rapidsnark`** = the **real per-draw cost**. Expect seconds + a few GB
  (it loads the zkey). This is the number that decides enterprise prover sizing.
- **`prove_snarkjs`** = baseline for comparison (slower, more RAM than rapidsnark).
- `verify` must be `OK` for both — confirms the proof is valid end-to-end.

## 5. Expected outcome / acceptance

- Setup completes (no OOM) on 64 GB → confirms the one-time cost is tractable.
- rapidsnark prove in **seconds–low minutes**, **single-digit GB RAM** → confirms
  per-draw cost is cheap → enterprise prover = a modest 16–32 GB box, scaled
  horizontally for throughput (proofs are independent per draw).
- Paste the resulting numbers back; we fold them into `RESULTS_phase1.json`,
  `UNICORN_G_DOSSIER.md` (§U2), and the INFRA-014 sizing note.

> Note: the measured circuit keeps the Phase-1 simplifications (l, r, N as witness).
> The prover **cost** is representative; the production circuit additionally bakes N
> + binds l=H(u,y) + proves l prime + computes r — small relative to the two modexp.
