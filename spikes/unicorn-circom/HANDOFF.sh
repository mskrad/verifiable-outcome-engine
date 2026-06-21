#!/usr/bin/env bash
# Unicorn-G box-setup handoff commands (option-A circuit wesolowski_sound_A, 12.51M, 1 pub).
# NOT auto-run — copy/paste the blocks. Fill in <BOX_IP> and the RSA-2048 number.
# Full notes: BOX_SETUP.md. The box-side build uses the proven run_phase3_setup.sh.

SSH='ssh -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519_selectel'
SCP='scp -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519_selectel'
BOX=root@<BOX_IP>
REPO=/Users/timurkurmangaliev/verifiable-outcome-engine

# ── 1. LAPTOP: copy the spike source to the box (artifacts rebuilt there) ──────────────
cd "$REPO"
rsync -az \
  --exclude build --exclude node_modules --exclude rapidsnark --exclude phase3 \
  --exclude '*.zkey' --exclude '*.wtns' --exclude '*.ptau' --exclude '*.r1cs' \
  -e "$SSH" spikes/unicorn-circom/ "$BOX":/root/unicorn-circom/

# ── 2. BOX: bake the canonical RSA-2048 modulus, then run the proven setup ─────────────
$SSH "$BOX"
#   cd /root/unicorn-circom
#   printf '%s' "<617-digit RSA-2048 Challenge decimal>" > prod_modulus.txt
#   bash run_phase3_setup.sh                # ~3h, peaks ~70GB; wait for verify=...OK

# ── 3. BOX (2nd SSH): watch progress ──────────────────────────────────────────────────
#   $SSH "$BOX"
#   cd /root/unicorn-circom && tail -f phase3/run.log

# ── 4. LAPTOP: fetch deliverables ─────────────────────────────────────────────────────
cd "$REPO"/spikes/unicorn-circom
$SCP "$BOX":/root/unicorn-circom/build/vk.json        ./vk_prod.json
$SCP "$BOX":/root/unicorn-circom/RESULTS_phase3.json  ./RESULTS_phase3.json
$SCP "$BOX":/root/unicorn-circom/build/circuit.zkey   ./circuit_prod.zkey   # large (GBs)

# ── 5. LAPTOP: sanity-check, then DESTROY the box ─────────────────────────────────────
cat RESULTS_phase3.json     # expect constraints 12,506,368, public_inputs 1, verify OK
node -e 'const v=require("./vk_prod.json");console.log(v.protocol,v.curve,v.nPublic)'   # groth16 bn128 1
