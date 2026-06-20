#!/usr/bin/env bash
# =============================================================================
# Unicorn-G PHASE 3 (B3) — Groth16 trusted setup for the PRODUCTION sound circuit
# (wesolowski_sound_prod, ~14.92M constraints, N baked as a constant). Produces the
# deliverables for on-chain integration (B4): the verifying key + proving key.
#
# Prereq on this box: the canonical RSA modulus baked in. Put the modulus decimal in
# prod_modulus.txt BEFORE running (devnet = RSA-2048 Challenge number from RSA Labs):
#     echo "<canonical RSA-2048 decimal>" > prod_modulus.txt
# bake_n.js validates it (2048-bit, odd, no small factors) and prints rsa_modulus_id.
#
# Target box: Ubuntu 22.04/24.04, >=128 GB RAM (setup peaks ~74 GB at 14.9M; 64 GB OOMs),
# NVMe, 16+ cores. Same class as Phase 1b (AMD EPYC 9754 / 128 GB / 16 vCPU). ~3h wall.
# GPU not used. Run as a user with sudo.
#
# Deliverables copied back (then DESTROY the box):
#   build/vk.json            -> on-chain verifier VK (B4)
#   build/circuit.zkey       -> prover proving key (off-chain prover service, B5)
#   RESULTS_phase3.json      -> setup/prove numbers
# =============================================================================
set -euo pipefail
SPIKE_DIR="$(cd "$(dirname "$0")" && pwd)"; cd "$SPIKE_DIR"
mkdir -p build phase3
CIRCUIT=wesolowski_sound_prod
PTAU_POW="${PTAU_POW:-24}"             # 2^24 covers ~14.9M
PTAU="build/pot${PTAU_POW}.ptau"
TIME=/usr/bin/time
HEAP_MB=$(awk '/MemTotal/{printf "%d",$2/1024*0.85}' /proc/meminfo)
export NODE_OPTIONS="--max-old-space-size=${HEAP_MB}"
exec > >(tee -a phase3/run.log) 2>&1
echo "=== PHASE3 setup $(date -u +%FT%TZ) circuit=$CIRCUIT ptau=2^$PTAU_POW ==="

CPU=$(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2- | xargs || echo unknown)
RAM_GB=$(awk '/MemTotal/{printf "%.0f",$2/1024/1024}' /proc/meminfo); CORES=$(nproc)
echo "CPU=$CPU | RAM=${RAM_GB}GB | cores=$CORES"
[ "$RAM_GB" -lt 100 ] && echo "WARNING: <100GB RAM — setup may OOM (needs ~74GB)."
[ -f prod_modulus.txt ] || { echo "ERROR: create prod_modulus.txt with the canonical RSA modulus first"; exit 1; }
run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}
run_as_root_preserve_env() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo -E "$@"; fi
}

# 1. deps (idempotent) — Node 20, build tools, circom 2.2.3, snarkjs, rapidsnark
if ! command -v node >/dev/null; then curl -fsSL https://deb.nodesource.com/setup_20.x | run_as_root_preserve_env bash -; run_as_root apt-get install -y nodejs; fi
run_as_root apt-get update -y && run_as_root apt-get install -y build-essential cmake libgmp-dev libsodium-dev nasm curl m4 git
if ! command -v circom >/dev/null; then
  curl -fL https://github.com/iden3/circom/releases/download/v2.2.3/circom-linux-amd64 -o /tmp/circom && run_as_root install -m 0755 /tmp/circom /usr/local/bin/circom
fi

# 0. bake N from prod_modulus.txt (after node is available)
echo "--- bake N ---"; node bake_n.js
echo "circom: $(circom --version)"
[ -d node_modules/snarkjs ] || npm install
SNARK="node node_modules/.bin/snarkjs"
PROVER="$SPIKE_DIR/rapidsnark/package/bin/prover"
if [ ! -x "$PROVER" ]; then
  rm -rf rapidsnark && git clone https://github.com/iden3/rapidsnark.git
  ( cd rapidsnark && git submodule init && git submodule update && ./build_gmp.sh host && mkdir -p build_prover && cd build_prover && cmake .. -DTARGET_PLATFORM=host -DCMAKE_INSTALL_PREFIX=../package && make -j"$CORES" && make install )
fi

# 2. ptau
if [ ! -f "$PTAU" ]; then
  for url in \
    "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_${PTAU_POW}.ptau" \
    "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_${PTAU_POW}.ptau"; do
    curl -fL --retry 3 -o "$PTAU" "$url" && break
  done
fi
echo "ptau: $(du -h "$PTAU" | cut -f1)"

# 3. compile + fixture + witness
echo "--- compile $CIRCUIT ---"
$TIME -v circom "circuits/$CIRCUIT.circom" --r1cs --wasm --O2 -o build -l circuits -l node_modules > phase3/compile_out.txt 2> phase3/time_compile.txt
NC=$(grep -m1 'non-linear constraints' phase3/compile_out.txt | grep -oE '[0-9]+'); echo "constraints=$NC"
echo "--- fixture (PROD) + witness ---"
PROD=1 node gen_sound_fixture.js
node "build/${CIRCUIT}_js/generate_witness.js" "build/${CIRCUIT}_js/$CIRCUIT.wasm" build/ws_input.json build/witness.wtns

# 4. groth16 setup -> zkey + VK (the deliverables), measured
echo "--- groth16 setup (timed; ~3h, ~74GB) ---"
$TIME -v $SNARK groth16 setup "build/$CIRCUIT.r1cs" "$PTAU" build/circuit_0.zkey 2> phase3/time_setup.txt
$SNARK zkey contribute build/circuit_0.zkey build/circuit.zkey --name="phase3-$(date -u +%FT%TZ)" -e="$(head -c64 /dev/urandom | base64)" >/dev/null
$SNARK zkey export verificationkey build/circuit.zkey build/vk.json >/dev/null
rm -f build/circuit_0.zkey
echo "zkey: $(du -h build/circuit.zkey | cut -f1) | vk: build/vk.json"

# 5. prove (rapidsnark = per-draw) + verify, measured
$TIME -v "$PROVER" build/circuit.zkey build/witness.wtns build/proof.json build/public.json 2> phase3/time_prove.txt
VR=$($SNARK groth16 verify build/vk.json build/public.json build/proof.json 2>&1 | tail -1)
echo "verify=$VR"

# 6. collect -> RESULTS_phase3.json
RID=$(node -e 'const c=require("crypto"),fs=require("fs");const N=BigInt(fs.readFileSync("prod_modulus.txt","utf8").trim());const b=Buffer.alloc(256);let v=N;for(let i=255;i>=0;i--){b[i]=Number(v&0xffn);v>>=8n;}console.log(c.createHash("sha256").update(b).digest("hex"));')
CPU="$CPU" RAM_GB="$RAM_GB" CORES="$CORES" NC="$NC" VR="$VR" RID="$RID" PTAU_POW="$PTAU_POW" node -e '
const fs=require("fs");const f=p=>{try{return fs.readFileSync(p,"utf8")}catch(e){return""}};
const wall=s=>{const m=f(s).match(/wall clock\)[^\n]*?:\s*([0-9.:]+)\s*$/m);return m?m[1]:null};
const rss=s=>{const m=f(s).match(/Maximum resident set size[^:]*:\s*(\d+)/i);return m?+(+m[1]/1024/1024).toFixed(2):null};
const out={phase:"Unicorn-G PHASE3 (B3) — production setup",date:new Date().toISOString(),
 machine:{cpu:process.env.CPU,ram_gb:+process.env.RAM_GB,cores:+process.env.CORES},
 circuit:"wesolowski_sound_prod",constraints:+process.env.NC,public_inputs:2,ptau_pow:+process.env.PTAU_POW,
 rsa_modulus_id:process.env.RID,
 zkey_setup:{wall:wall("phase3/time_setup.txt"),peak_rss_gb:rss("phase3/time_setup.txt"),note:"ONE-TIME per circuit"},
 prove_rapidsnark:{wall:wall("phase3/time_prove.txt"),peak_rss_gb:rss("phase3/time_prove.txt"),note:"per-draw"},
 verify:process.env.VR};
fs.writeFileSync("RESULTS_phase3.json",JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));'
echo "=== DONE. Copy back build/vk.json + build/circuit.zkey + RESULTS_phase3.json, then DESTROY the box. ==="
