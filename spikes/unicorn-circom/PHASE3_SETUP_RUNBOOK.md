# PHASE3 (B3) — Groth16 setup on a rented box → production VK + zkey

Goal: produce the **verifying key** (for on-chain verify, B4) and **proving key / zkey**
(for the off-chain prover, B5) for the production sound circuit `wesolowski_sound_prod`
(~14.92M constraints, N baked). One-time per circuit. Mirrors the proven Phase 1b run.

## 1. Box to rent
- **≥128 GB RAM** (setup peaks ~74 GB at 14.9M; 64 GB OOMs — confirmed in Phase 1b), NVMe,
  16+ cores, Ubuntu 22.04/24.04. Same class as Phase 1b: **AMD EPYC 9754 / 128 GB / 16 vCPU**
  (Selectel-class). GPU not needed (Groth16 prove is CPU).
- Expect **~3 h wall** total (deps + ptau download ~18 GB + setup ~2h47m + prove ~40s).

## 2. Get the code onto the box
```bash
# from the repo, copy just the spike dir (or git clone the branch and cd in):
rsync -az spikes/unicorn-circom/ user@BOX:/root/unicorn-circom/
ssh user@BOX
cd /root/unicorn-circom
```

## 3. Bake the canonical RSA modulus (devnet = RSA-2048 Challenge)
Put the **canonical RSA-2048 Challenge decimal** (from RSA Laboratories' RSA Factoring
Challenge — the 617-digit RSA-2048 number) into `prod_modulus.txt`. Do NOT hand-type it;
copy it from the authoritative source. `bake_n.js` validates it:
```bash
printf '%s' "<paste the 617-digit RSA-2048 decimal here>" > prod_modulus.txt
node bake_n.js     # asserts 2048-bit, odd, no small factors; prints rsa_modulus_id = sha256(N)
```
Record the printed `rsa_modulus_id` — it goes into `UnicornGConfig` on-chain (B4) so anyone
can audit which modulus the VK was built for.

> Mainnet uses a different N (our MPC distributed-RSA ceremony output) → re-run this setup
> with that modulus to get the mainnet VK.

## 4. Run the setup
```bash
bash run_phase3_setup.sh        # idempotent; installs deps, ptau, compiles, setup, prove, verify
```
Watch for `verify=OK` near the end.

## 5. Bring back the deliverables, then destroy the box
```bash
# from your laptop:
scp user@BOX:/root/unicorn-circom/build/vk.json            ./vk_prod.json
scp user@BOX:/root/unicorn-circom/build/circuit.zkey       ./circuit_prod.zkey   # large (GBs)
scp user@BOX:/root/unicorn-circom/RESULTS_phase3.json      spikes/unicorn-circom/
```
- `vk_prod.json` → converter (B4) → on-chain VK in the verifier.
- `circuit_prod.zkey` → the off-chain prover service (B5).
- **Destroy the box** after copying (the zkey is reproducible; nothing secret, but stop paying).

## 6. Expected numbers (from Phase 1b, ~14.9M)
| step | wall | peak RSS |
|---|---|---|
| zkey setup (one-time) | ~2h50m | ~74 GB |
| prove rapidsnark (per-draw) | ~40 s | ~12 GB |
| verify | OK | — |

If RAM < 128 GB the script warns; setup will likely OOM — rent the bigger box.
