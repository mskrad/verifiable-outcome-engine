#!/usr/bin/env bash
# =============================================================================
# Unicorn-G Phase 1b — live prover measurement on a high-RAM Linux box.
#
# Measures, end-to-end, the cost of the FULL Wesolowski-verify circuit (~14.49M
# constraints) that did not fit on the 18GB dev laptop:
#   - Groth16 trusted setup (zkey)  -> wall + peak RSS   [the RAM-heavy ONE-TIME step]
#   - witness generation             -> wall
#   - prove with snarkjs (baseline)  -> wall + peak RSS
#   - prove with rapidsnark (native) -> wall + peak RSS   [the real per-draw number]
#   - on-chain-style verify (snarkjs)-> pass/fail
# Writes RESULTS_phase1b.json next to this script.
#
# Target box: Ubuntu 22.04/24.04, >=64 GB RAM, NVMe, 8+ cores (e.g. the
# BL27-NVMe class: AMD EPYC, 64 GB). GPU NOT used (Groth16 prove is CPU).
# Run as a user with sudo. Expect ~30-90 min wall total (mostly setup + ptau).
#
# Usage:
#   bash run_phase1b.sh                 # full circuit (wv_n128, 14.49M)
#   CIRCUIT=wv_n32 bash run_phase1b.sh  # smaller, for a quick smoke test first
# =============================================================================
set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SPIKE_DIR"
mkdir -p build phase1b
CIRCUIT="${CIRCUIT:-wv_n128}"          # circuit to measure
PTAU_POW="${PTAU_POW:-24}"             # 2^24 covers 14.49M; wv_n32 fits 2^22
PTAU="build/pot${PTAU_POW}.ptau"
LOG="phase1b/run.log"
TIME=/usr/bin/time                     # GNU time on Linux supports -v (wall + max RSS)
# snarkjs loads large r1cs/zkey into the JS heap; node's ~2GB default OOMs on
# multi-hundred-MB r1cs. Size the heap to ~85% of box RAM (children inherit this) so
# the full-circuit setup (~76GB at 14.5M) fits without GC-OOM on a big box.
HEAP_MB=$(awk '/MemTotal/{printf "%d",$2/1024*0.85}' /proc/meminfo)
export NODE_OPTIONS="--max-old-space-size=${HEAP_MB}"
echo "NODE_OPTIONS=$NODE_OPTIONS"
exec > >(tee -a "$LOG") 2>&1
echo "=== Phase 1b run $(date -u +%FT%TZ)  circuit=$CIRCUIT ptau=2^$PTAU_POW ==="

# ---------------------------------------------------------------------------
# 0. System info (goes into the artifact)
# ---------------------------------------------------------------------------
CPU=$(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2- | xargs || echo unknown)
RAM_GB=$(awk '/MemTotal/{printf "%.0f",$2/1024/1024}' /proc/meminfo)
CORES=$(nproc)
echo "CPU=$CPU | RAM=${RAM_GB}GB | cores=$CORES"

# snarkjs groth16 setup peaks well above RAM for the full circuit (~19GB at 3.6M ->
# ~76GB projected at 14.5M). With no swap that OOM-kills. Add NVMe swap so the working
# set fits (RAM + swap); slower but completes. Only needed on smaller boxes — a
# 128GB box holds the full setup in RAM, so skip swap when RAM is ample (>=100GB).
if [ "$RAM_GB" -lt 100 ] && [ "$(swapon --show --noheadings 2>/dev/null | wc -l)" = "0" ] && [ ! -f /swapfile ]; then
  echo "--- creating 64G swap on NVMe (RAM < 100GB) ---"
  fallocate -l 64G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=65536
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
fi
free -h

# ---------------------------------------------------------------------------
# 1. Dependencies (idempotent)
# ---------------------------------------------------------------------------
if ! command -v node >/dev/null; then
  echo "--- installing Node 20 ---"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "--- apt build deps ---"
sudo apt-get update -y
sudo apt-get install -y build-essential cmake libgmp-dev libsodium-dev nasm curl m4 git

if ! command -v circom >/dev/null; then
  echo "--- installing circom 2.2.3 (release binary, cargo fallback) ---"
  if curl -fL https://github.com/iden3/circom/releases/download/v2.2.3/circom-linux-amd64 -o /tmp/circom; then
    sudo install -m 0755 /tmp/circom /usr/local/bin/circom
  else
    curl -fsSL https://sh.rustup.rs | sh -s -- -y && source "$HOME/.cargo/env"
    git clone https://github.com/iden3/circom.git /tmp/circomsrc && cd /tmp/circomsrc
    git checkout v2.2.3 && cargo build --release && sudo install -m 0755 target/release/circom /usr/local/bin/circom
    cd "$SPIKE_DIR"
  fi
fi
echo "circom: $(circom --version)"

echo "--- snarkjs (local node_modules) ---"
[ -d node_modules/snarkjs ] || npm install
SNARK="node node_modules/.bin/snarkjs"

# rapidsnark (native prover) — built once into ./rapidsnark/package/bin/prover
PROVER="$SPIKE_DIR/rapidsnark/package/bin/prover"
if [ ! -x "$PROVER" ]; then
  echo "--- building rapidsnark ---"
  rm -rf rapidsnark && git clone https://github.com/iden3/rapidsnark.git
  ( cd rapidsnark
    git submodule init && git submodule update
    ./build_gmp.sh host
    mkdir -p build_prover && cd build_prover
    cmake .. -DTARGET_PLATFORM=host -DCMAKE_INSTALL_PREFIX=../package
    make -j"$CORES" && make install )
fi
echo "rapidsnark: $PROVER"

# ---------------------------------------------------------------------------
# 2. Powers of tau (download; local-gen fallback is slow but works on 64GB)
# ---------------------------------------------------------------------------
if [ ! -f "$PTAU" ]; then
  echo "--- fetching ptau 2^$PTAU_POW ---"
  ok=0
  for url in \
    "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_${PTAU_POW}.ptau" \
    "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_${PTAU_POW}.ptau" \
    "https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/powersOfTau28_hez_final_${PTAU_POW}.ptau"; do
    echo "trying $url"
    if curl -fL --retry 3 -o "$PTAU" "$url"; then ok=1; break; fi
  done
  if [ "$ok" != 1 ]; then
    echo "download failed; generating locally (slow)"
    $SNARK powersoftau new bn128 "$PTAU_POW" build/_p0.ptau
    $SNARK powersoftau contribute build/_p0.ptau build/_p1.ptau --name=p1b -e="$(date)"
    $SNARK powersoftau prepare phase2 build/_p1.ptau "$PTAU"
    rm -f build/_p0.ptau build/_p1.ptau
  fi
fi
echo "ptau: $(du -h "$PTAU" | cut -f1)"

# ---------------------------------------------------------------------------
# 3. Compile circuit + fixture + witness
# ---------------------------------------------------------------------------
echo "--- compile $CIRCUIT (r1cs + wasm) ---"
$TIME -v circom "circuits/$CIRCUIT.circom" --r1cs --wasm --O2 -o build -l circuits -l node_modules \
  > phase1b/compile_out.txt 2> phase1b/time_compile.txt
cat phase1b/compile_out.txt
# Take the constraint count straight from circom's own output (cheap). Do NOT use
# `snarkjs r1cs info`: it loads the entire r1cs into the JS heap and OOMs on large ones.
NC=$(grep -m1 'non-linear constraints' phase1b/compile_out.txt | grep -oE '[0-9]+')
echo "constraints=$NC"

echo "--- fixture + witness ---"
# gen_fixture.js with no arg = full EXPBITS=128; for wv_n32 etc pass the bit width.
case "$CIRCUIT" in
  wv_n128) node gen_fixture.js;        IN=build/wv_input.json ;;
  wv_n*)   B="${CIRCUIT#wv_n}"; node gen_fixture.js "$B"; IN="build/wv_input_n${B}.json" ;;
esac
node "build/${CIRCUIT}_js/generate_witness.js" "build/${CIRCUIT}_js/$CIRCUIT.wasm" "$IN" build/witness.wtns

# ---------------------------------------------------------------------------
# 4. Groth16 setup (RAM-heavy ONE-TIME step) — measured
# ---------------------------------------------------------------------------
echo "--- groth16 setup (timed) ---"
$TIME -v $SNARK groth16 setup "build/$CIRCUIT.r1cs" "$PTAU" build/circuit_0.zkey 2> phase1b/time_setup.txt
$SNARK zkey contribute build/circuit_0.zkey build/circuit.zkey --name=p1b -e="$(date)" >/dev/null
$SNARK zkey export verificationkey build/circuit.zkey build/vk.json >/dev/null
rm -f build/circuit_0.zkey
echo "zkey: $(du -h build/circuit.zkey | cut -f1)"

# ---------------------------------------------------------------------------
# 5. Prove — snarkjs (baseline) and rapidsnark (real per-draw number) — measured
# ---------------------------------------------------------------------------
echo "--- prove: snarkjs (timed) ---"
$TIME -v $SNARK groth16 prove build/circuit.zkey build/witness.wtns build/proof_sjs.json build/public.json \
  2> phase1b/time_prove_snarkjs.txt

echo "--- prove: rapidsnark (timed) ---"
$TIME -v "$PROVER" build/circuit.zkey build/witness.wtns build/proof_rs.json build/public_rs.json \
  2> phase1b/time_prove_rapidsnark.txt

echo "--- verify both ---"
V1=$($SNARK groth16 verify build/vk.json build/public.json build/proof_sjs.json 2>&1 | tail -1)
V2=$($SNARK groth16 verify build/vk.json build/public_rs.json build/proof_rs.json 2>&1 | tail -1)
echo "verify snarkjs=$V1 | rapidsnark=$V2"

# ---------------------------------------------------------------------------
# 6. Collect numbers -> RESULTS_phase1b.json
# ---------------------------------------------------------------------------
wall(){ grep -i "wall clock" "$1" | sed 's/.*: //'; }
rssgb(){ awk '/Maximum resident/{printf "%.2f",$NF/1024/1024}' "$1"; }   # kbytes -> GB

CPU="$CPU" RAM_GB="$RAM_GB" CORES="$CORES" CIRCUIT="$CIRCUIT" PTAU_POW="$PTAU_POW" NC="$NC" V1="$V1" V2="$V2" node -e '
const fs=require("fs");
const f=(p)=>{try{return fs.readFileSync(p,"utf8")}catch(e){return ""}};
// GNU time -v line: "Elapsed (wall clock) time (h:mm:ss or m:ss): M:SS.ss" — grab the
// trailing time token (greedy lazy to the value anchored at end of line).
const wall=s=>{const m=f(s).match(/wall clock\)[^\n]*?:\s*([0-9.:]+)\s*$/m);return m?m[1]:null};
const rss=s=>{const m=f(s).match(/Maximum resident set size[^:]*:\s*(\d+)/i);return m?+(+m[1]/1024/1024).toFixed(2):null};
const out={
  phase:"Unicorn-G Phase 1b — live prover measurement",
  date:new Date().toISOString(),
  machine:{cpu:process.env.CPU||null,ram_gb:+process.env.RAM_GB||null,cores:+process.env.CORES||null},
  circuit:process.env.CIRCUIT, ptau_pow:+process.env.PTAU_POW, constraints:+(process.env.NC||0),
  zkey_setup:{wall:wall("phase1b/time_setup.txt"), peak_rss_gb:rss("phase1b/time_setup.txt"), note:"ONE-TIME per circuit, not per draw"},
  compile:{wall:wall("phase1b/time_compile.txt"), peak_rss_gb:rss("phase1b/time_compile.txt")},
  prove_snarkjs:{wall:wall("phase1b/time_prove_snarkjs.txt"), peak_rss_gb:rss("phase1b/time_prove_snarkjs.txt")},
  prove_rapidsnark:{wall:wall("phase1b/time_prove_rapidsnark.txt"), peak_rss_gb:rss("phase1b/time_prove_rapidsnark.txt"), note:"the real PER-DRAW number"},
  verify:{snarkjs:process.env.V1||null, rapidsnark:process.env.V2||null}
};
fs.writeFileSync("RESULTS_phase1b.json", JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
'

echo "=== DONE -> RESULTS_phase1b.json ==="
echo "Reminder: destroy the rented box after copying RESULTS_phase1b.json."
