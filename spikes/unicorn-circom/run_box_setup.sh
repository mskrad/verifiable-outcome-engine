#!/usr/bin/env bash
# =============================================================================
# Unicorn-G — Groth16 trusted setup on a rented box, for the SOUND option-A circuit
# wesolowski_sound_A (~12.51M constraints, in-circuit Pocklington, 1 public input = commit,
# RSA modulus baked). Produces: vk.json (on-chain verifier key) + circuit.zkey (prover key).
#
# Idempotent: installs deps, downloads ptau, bakes N, compiles, witness, setup, prove, verify.
#
# PREREQ: put the canonical RSA-2048 modulus (decimal) in prod_modulus.txt BEFORE running:
#     printf '%s' "<617-digit RSA-2048 Challenge number>" > prod_modulus.txt
#   bake_n.js validates it (2048-bit, odd, no small factors) and prints rsa_modulus_id.
#
# BOX: Ubuntu 22.04/24.04, >=96 GB RAM (setup peaks ~70 GB; the 126 GB box fits), NVMe,
#      16+ cores (AMD EPYC class). ~3 h wall. GPU not used. root or sudo user.
# =============================================================================
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"
mkdir -p build out
CIRCUIT=wesolowski_sound_A
PTAU_POW="${PTAU_POW:-24}"                       # 2^24 covers 12.51M
PTAU="build/pot${PTAU_POW}.ptau"
TIME=/usr/bin/time
HEAP_MB=$(awk '/MemTotal/{printf "%d",$2/1024*0.85}' /proc/meminfo)
export NODE_OPTIONS="--max-old-space-size=${HEAP_MB}"
SUDO(){ if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }
SUDOE(){ if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo -E "$@"; fi; }
exec > >(tee -a out/run.log) 2>&1
echo "=== Unicorn-G box setup $(date -u +%FT%TZ) circuit=$CIRCUIT ptau=2^$PTAU_POW ==="

RAM_GB=$(awk '/MemTotal/{printf "%.0f",$2/1024/1024}' /proc/meminfo)
CORES=$(nproc); CPU=$(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2- | xargs || echo unknown)
echo "CPU=$CPU | RAM=${RAM_GB}GB | cores=$CORES"
[ "$RAM_GB" -lt 90 ] && echo "WARNING: <90GB RAM — setup may OOM (needs ~70GB)."
[ -f prod_modulus.txt ] || { echo "ERROR: create prod_modulus.txt with the RSA-2048 modulus first"; exit 1; }

# 1. deps
if ! command -v node >/dev/null; then curl -fsSL https://deb.nodesource.com/setup_20.x | SUDOE bash -; SUDO apt-get install -y nodejs; fi
SUDO apt-get update -y && SUDO apt-get install -y build-essential cmake libgmp-dev libsodium-dev nasm curl m4 git
if ! command -v circom >/dev/null; then
  curl -fL https://github.com/iden3/circom/releases/download/v2.2.3/circom-linux-amd64 -o /tmp/circom && SUDO install -m 0755 /tmp/circom /usr/local/bin/circom
fi
[ -d node_modules/snarkjs ] || npm install
SNARK="node node_modules/.bin/snarkjs"
PROVER="$PWD/rapidsnark/package/bin/prover"
if [ ! -x "$PROVER" ]; then
  rm -rf rapidsnark && git clone https://github.com/iden3/rapidsnark.git
  ( cd rapidsnark && git submodule init && git submodule update && ./build_gmp.sh host \
    && mkdir -p build_prover && cd build_prover \
    && cmake .. -DTARGET_PLATFORM=host -DCMAKE_INSTALL_PREFIX=../package && make -j"$CORES" && make install )
fi
echo "node=$(node -v) circom=$(circom --version)"

# 2. bake N (after node is available)
echo "--- bake N ---"; node bake_n.js

# 3. ptau
if [ ! -f "$PTAU" ]; then
  for url in \
    "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_${PTAU_POW}.ptau" \
    "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_${PTAU_POW}.ptau"; do
    curl -fL --retry 3 -o "$PTAU" "$url" && break
  done
fi
echo "ptau: $(du -h "$PTAU" | cut -f1)"

# 4. compile + fixture + witness
echo "--- compile $CIRCUIT ---"
$TIME -v circom "circuits/$CIRCUIT.circom" --r1cs --wasm --O2 -o build -l circuits -l node_modules \
  > out/compile.txt 2> out/time_compile.txt
NC=$(grep -m1 'non-linear constraints' out/compile.txt | grep -oE '[0-9]+'); echo "constraints=$NC"
echo "--- fixture + witness ---"
node gen_sound_a_fixture.js
node "build/${CIRCUIT}_js/generate_witness.js" "build/${CIRCUIT}_js/$CIRCUIT.wasm" build/wa_input.json build/witness.wtns

# 5. groth16 setup -> zkey + VK (deliverables), measured
echo "--- groth16 setup (timed; ~3h, ~70GB) ---"
$TIME -v $SNARK groth16 setup "build/$CIRCUIT.r1cs" "$PTAU" build/circuit_0.zkey 2> out/time_setup.txt
$SNARK zkey contribute build/circuit_0.zkey out/circuit.zkey --name="unicorn-g-$(date -u +%FT%TZ)" -e="$(head -c64 /dev/urandom | base64)" >/dev/null
$SNARK zkey export verificationkey out/circuit.zkey out/vk.json >/dev/null
rm -f build/circuit_0.zkey
echo "zkey: $(du -h out/circuit.zkey | cut -f1) | vk: out/vk.json"

# 6. prove (per-draw) + verify, measured
$TIME -v "$PROVER" out/circuit.zkey build/witness.wtns out/proof.json out/public.json 2> out/time_prove.txt
VR=$($SNARK groth16 verify out/vk.json out/public.json out/proof.json 2>&1 | tail -1)
echo "verify=$VR"

# 7. results
RID=$(node -e 'const c=require("crypto"),fs=require("fs");const N=BigInt(fs.readFileSync("prod_modulus.txt","utf8").trim());const b=Buffer.alloc(256);let v=N;for(let i=255;i>=0;i--){b[i]=Number(v&0xffn);v>>=8n;}console.log(c.createHash("sha256").update(b).digest("hex"));')
CPU="$CPU" RAM_GB="$RAM_GB" CORES="$CORES" NC="$NC" VR="$VR" RID="$RID" PTAU_POW="$PTAU_POW" node -e '
const fs=require("fs");const f=p=>{try{return fs.readFileSync(p,"utf8")}catch(e){return""}};
const wall=s=>{const m=f(s).match(/wall clock\)[^\n]*?:\s*([0-9.:]+)\s*$/m);return m?m[1]:null};
const rss=s=>{const m=f(s).match(/Maximum resident set size[^:]*:\s*(\d+)/i);return m?+(+m[1]/1024/1024).toFixed(2):null};
fs.writeFileSync("out/RESULTS.json",JSON.stringify({circuit:"wesolowski_sound_A",constraints:+process.env.NC,public_inputs:1,
 ptau_pow:+process.env.PTAU_POW,rsa_modulus_id:process.env.RID,
 machine:{cpu:process.env.CPU,ram_gb:+process.env.RAM_GB,cores:+process.env.CORES},
 zkey_setup:{wall:wall("out/time_setup.txt"),peak_rss_gb:rss("out/time_setup.txt"),note:"one-time per circuit"},
 prove_rapidsnark:{wall:wall("out/time_prove.txt"),peak_rss_gb:rss("out/time_prove.txt"),note:"per-draw"},
 verify:process.env.VR,date:new Date().toISOString()},null,2));
console.log(fs.readFileSync("out/RESULTS.json","utf8"));'
echo "=== DONE. Deliverables in out/: vk.json, circuit.zkey, RESULTS.json. Copy back, then DESTROY the box. ==="
