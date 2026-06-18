# Unicorn-G circuit spike — Phase 1 + 1b (gate measurement)

Single entry point for the Unicorn-G prover-cost spike. Goal: **decide whether
Unicorn-G is buildable at acceptable prover cost** before investing in it — by
building the real circuit and measuring it, not estimating.

**Verdict: FEASIBLE (with live numbers).** Per-draw proof ≈ 39 s / 11 GB; one-time
setup ≈ 2h47m / 72 GB per circuit. Biggest technical risk retired.

Context: `agent-instructions/hub-memory/UNICORN_G_DOSSIER.md` (§U2) and
`agent-instructions/hub-memory/tasks/PROTOCOL-INFRA-014-ARCH.md` (§10 build order).

---

## What the circuit proves

Wesolowski VDF verification over an RSA-2048 group — for public `u`, `y` and
private proof `π`, checks `π^l · u^r == y (mod N)`, where `l = H_to_prime(u,y)`
(~128-bit Fiat-Shamir prime) and `r = 2^T mod l`. N, T are circuit constants;
**circuit size is independent of the delay T** (we prove the verify equation, not
T squarings).

Two 2048-bit modexp (square-and-multiply over `BigMultModP(64,32)`) + a final
modmul + equality. Built from 0xPARC `bigint.circom` + circomlib (`Num2Bits`,
`Mux1`).

> **Soundness scope:** this is a COST-MEASUREMENT circuit, not a sound verifier —
> `l, r, N` are free witness, so the measured constraint count is a *lower bound*.
> A production circuit must additionally: bake N as a constant, bind `l=H(u,y)`
> (SHA256), prove `l` prime (Pocklington), and compute `r=2^T mod l` in-circuit.
> Those are small relative to the two 2048-bit modexp.

## Results

### Phase 1 — constraint count (hard, machine-independent)
| circuit | constraints |
|---|---|
| one 2048-bit modmul | 28,225 |
| wv_n8 / wv_n16 / wv_n32 | 931,891 / 1,835,619 / 3,643,075 |
| **wv_n128 (full)** | **14,487,811** |

- Linear: `≈ (4·EXPBITS+1) · 28,225` (≈28,240 per modmul-unit across all four).
- **Corrects the desk estimate +34%** (10.8M → 14.49M): naive square-and-multiply
  does a conditional-multiply *every* bit ⇒ ~512 modmul, not ~384.
- Reproduced identically on an 18 GB laptop and a 128 GB box.
- **Correctness:** valid fixture → witness OK; tampered `y` → `Assert Failed`
  (the circuit genuinely enforces the equation). Independent BigInt re-derivation of
  the exact square-and-multiply matches `modpow`.
- Lever: **Shamir multi-exp** (joint `π^l·u^r`) ≈ halves it (~7.3M).

### Phase 1b — live prover (AMD EPYC 9754, 128 GB, 16 vCPU, ptau 2^24)
| step | wall | peak RSS | kind |
|---|---|---|---|
| zkey setup | **2:46:54** | **71.9 GB** | one-time / circuit |
| compile | 7:25 | 9.9 GB | one-time |
| prove snarkjs | 6:17 | 45.9 GB | baseline |
| **prove rapidsnark** | **0:38.8** | **11.3 GB** | **per-draw** |
| verify | — | — | OK / OK |

- **Per-draw (rapidsnark): 39 s, 11 GB** → a modest 16 GB box proves one draw in <1 min.
- rapidsnark ≈ 10× faster, 4× lighter than snarkjs → use it for proving.
- Setup needs ≥128 GB (64 GB OOMs: 72 > 64) but is **one-time per circuit**.
- Full data: `RESULTS_phase1.json`, `RESULTS_phase1b.json`.

## Files
- `circuits/modexp.circom` — `ModExp(nbits)` square-and-multiply.
- `circuits/wesolowski_verify.circom` — verify equation (template).
- `circuits/wv_n{8,16,32,64,128}.circom` — mains at exponent bit-width N.
- `circuits/bigint*.circom`, `modmul.circom`, `cgcomp/mm_/inv16` — 0xPARC deps + prior probes.
- `gen_fixture.js` — valid RSA-VDF witness (self-checks `π^l·u^r==y` before emit).
- `run_phase1b.sh` — one-shot box runner (deps → ptau → compile → setup → prove → verify → JSON).
- `PHASE1B_RUNBOOK.md` — how to rent/run/teardown the box.
- `run_slope.sh`, `run_phase1_slope.sh` — laptop slope probes (superseded by 1b).

## Reproduce
- **Count only (any machine):** `circom circuits/wv_n128.circom --r1cs --O2 -o build -l circuits -l node_modules` → read `non-linear constraints`.
- **Full prover (≥128 GB Linux box):** see `PHASE1B_RUNBOOK.md`; `CIRCUIT=wv_n128 PTAU_POW=24 bash run_phase1b.sh`.
- Build artifacts (r1cs, ptau, zkey, witness, rapidsnark, `phase1b/` logs) are gitignored.

## Next (PROTOCOL-INFRA-014 §10)
Phase 1 (U2-circuit) ✅ done. Remaining: (2) on-chain Groth16 verify via raw
`alt_bn128` syscalls + live CU on devnet; (3) harden circuit to sound (bake N,
l=H(u,y), primality, r) and re-measure; (4) program integration
(`seal_randomness_unicorn`, `entropy_source`, `UnicornGConfig`); (5) off-chain
permissionless prover service; (6) RSA + Groth16 ceremonies; (7) global-Ω first,
then sortition.
