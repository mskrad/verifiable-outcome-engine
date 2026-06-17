#!/bin/zsh
# Phase 1 prover slope, done right: each reduced circuit gets a RIGHT-SIZED ptau so
# groth16 setup does not grind through an oversized one. Generates pot20/pot21 locally
# (pot22 already present), then setup+contribute+prove+verify per point under
# /usr/bin/time -l. Writes build/slope_<n>.json. Runs to completion, however slow.
set -e
cd /Users/timurkurmangaliev/verifiable-outcome-engine/spikes/unicorn-circom
export NODE_OPTIONS=--max-old-space-size=14336
S="node_modules/.bin/snarkjs"

genptau() {  # $1 = power, $2 = output path
  if [ -f "$2" ]; then echo "[$(date +%T)] $2 already present"; return 0; fi
  echo "[$(date +%T)] generating $2 (2^$1)"
  $S powersoftau new bn128 "$1" build/_p0.ptau > /dev/null
  $S powersoftau contribute build/_p0.ptau build/_p1.ptau --name=spike -e="ptau$1 $(date)" > /dev/null
  $S powersoftau prepare phase2 build/_p1.ptau "$2" > /dev/null
  rm -f build/_p0.ptau build/_p1.ptau
  echo "[$(date +%T)] $2 ready ($(stat -f%z "$2") bytes)"
}

point() {  # $1 = N, $2 = ptau path
  local N="$1" PTAU="$2" d="build/n$1"
  echo "[$(date +%T)] === n$N setup (ptau=$PTAU) ==="
  $S groth16 setup "$d/wv_n$N.r1cs" "$PTAU" "$d/s0.zkey" > /dev/null
  $S zkey contribute "$d/s0.zkey" "$d/s.zkey" --name=spike -e="zkey$N $(date)" > /dev/null
  $S zkey export verificationkey "$d/s.zkey" "$d/vk.json" > /dev/null
  echo "[$(date +%T)] === n$N prove (timed) ==="
  /usr/bin/time -l $S groth16 prove "$d/s.zkey" "$d/w_valid.wtns" "$d/proof.json" "$d/public.json" 2> "build/time_$N.txt"
  local vok; vok=$($S groth16 verify "$d/vk.json" "$d/public.json" "$d/proof.json" 2>&1 | tail -1)
  local wall rss
  wall=$(grep " real" "build/time_$N.txt" | awk '{print $1}')
  rss=$(grep "maximum resident set size" "build/time_$N.txt" | awk '{print $1}')
  echo "{\"n\":$N,\"ptau_pow\":${PTAU:t:r:gs/pot//},\"wall_real_s\":\"$wall\",\"peak_rss_bytes\":$rss,\"verify\":\"$vok\"}" > "build/slope_$N.json"
  rm -f "$d/s0.zkey"
  echo "[$(date +%T)] POINT n$N DONE: wall=${wall}s rss=${rss}B verify=$vok"
}

genptau 20 build/pot20.ptau
genptau 21 build/pot21.ptau
genptau 22 build/pot22.ptau

point 8  build/pot20.ptau
point 16 build/pot21.ptau
point 32 build/pot22.ptau

echo "[$(date +%T)] ALL_SLOPE_DONE"
cat build/slope_8.json build/slope_16.json build/slope_32.json
