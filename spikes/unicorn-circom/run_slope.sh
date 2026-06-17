#!/bin/zsh
# Clean Groth16 prover-slope anchors for the Wesolowski-verify circuit family.
# Waits for build/pot22.ptau, then for each reduced circuit (n8/n16/n32) runs
# groth16 setup + prove under /usr/bin/time -l, capturing wall-time and peak RSS.
# Emits build/slope_<n>.json per point.
set -e
cd /Users/timurkurmangaliev/verifiable-outcome-engine/spikes/unicorn-circom
export NODE_OPTIONS=--max-old-space-size=14336
SNARK=node_modules/.bin/snarkjs
PTAU=build/pot22.ptau

# wait until pot22 is TRULY done: prepare phase2 removes both temp files only after it
# completes, so their absence (plus pot22.ptau present) is the reliable readiness signal.
# (A size-stable check races against snarkjs pre-sizing the output file.)
while [ ! -f "$PTAU" ] || [ -f build/pot22_0.ptau ] || [ -f build/pot22_1.ptau ]; do sleep 5; done
echo "pot22 ready ($(stat -f%z "$PTAU") bytes) $(date +%T)"

for N in 8 16 32; do
  d=build/n$N
  echo "=== n$N setup $(date +%T) ==="
  $SNARK groth16 setup $d/wv_n$N.r1cs $PTAU $d/wv_n${N}_0.zkey 2>&1 | tail -1
  $SNARK zkey contribute $d/wv_n${N}_0.zkey $d/wv_n$N.zkey --name=spike -e="slope $N" 2>&1 | tail -1
  $SNARK zkey export verificationkey $d/wv_n$N.zkey $d/vk_$N.json 2>&1 | tail -1
  echo "=== n$N prove (timed) $(date +%T) ==="
  /usr/bin/time -l $SNARK groth16 prove $d/wv_n$N.zkey $d/w_valid.wtns $d/proof_$N.json $d/public_$N.json 2> build/time_$N.txt
  $SNARK groth16 verify $d/vk_$N.json $d/public_$N.json $d/proof_$N.json 2>&1 | tail -1
  # extract wall (real) and peak RSS (maximum resident set size, bytes)
  wall=$(grep " real" build/time_$N.txt | awk '{print $1}')
  rss=$(grep "maximum resident set size" build/time_$N.txt | awk '{print $1}')
  node -e "const fs=require('fs');const c=require('./$d/wv_n$N.r1cs.json'==='x'?{}:{});" 2>/dev/null || true
  echo "{\"n\":$N,\"wall_real_s\":\"$wall\",\"peak_rss_bytes\":$rss}" > build/slope_$N.json
  rm -f $d/wv_n${N}_0.zkey
  echo "n$N done: wall=${wall}s rss=${rss}B"
done
echo "SLOPE COMPLETE $(date +%T)"
