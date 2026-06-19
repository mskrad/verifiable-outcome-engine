pragma circom 2.0.0;
include "wesolowski_verify.circom";
include "../node_modules/circomlib/circuits/sha256/sha256.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

// PHASE2B/PHASE3 step 1: compress public inputs to a SINGLE commitment.
// public  = commit = field(SHA256(u || y))   (one public input instead of u[32]+y[32])
// private = u, y, pi, N, l, r
// Asserts: commit binds (u,y) AND the Wesolowski equation holds (reuses WesolowskiVerify).
//
// NOTE: byte/bit serialization of u,y here must match the on-chain seal's SHA256 in
// production (Phase 4 binding detail). This step measures the compressed circuit size;
// l/r/N are still witness (soundness layers come in PHASE3 step 2-3).
template WesolowskiCommit(EXPBITS) {
    signal input u[32];
    signal input y[32];
    signal input pi[32];
    signal input N[32];
    signal input l;
    signal input r;
    signal output commit;

    // 1. Wesolowski verify on the private (u, y, pi) with (N, l, r).
    component wv = WesolowskiVerify(EXPBITS);
    for (var i = 0; i < 32; i++) {
        wv.u[i] <== u[i];
        wv.y[i] <== y[i];
        wv.pi[i] <== pi[i];
        wv.N[i] <== N[i];
    }
    wv.l <== l;
    wv.r <== r;

    // 2. commit = field(SHA256(u || y)). 64 limbs x 64 bits = 4096 input bits.
    component ub[32];
    component yb[32];
    component sha = Sha256(4096);
    var idx = 0;
    for (var i = 0; i < 32; i++) {
        ub[i] = Num2Bits(64);
        ub[i].in <== u[i];
        for (var b = 0; b < 64; b++) { sha.in[idx] <== ub[i].out[63 - b]; idx++; }
    }
    for (var i = 0; i < 32; i++) {
        yb[i] = Num2Bits(64);
        yb[i].in <== y[i];
        for (var b = 0; b < 64; b++) { sha.in[idx] <== yb[i].out[63 - b]; idx++; }
    }
    // Reduce to a field element via the low 254 bits of the digest (stand-in for mod r).
    component c = Bits2Num(254);
    for (var i = 0; i < 254; i++) { c.in[i] <== sha.out[255 - i]; }
    commit <== c.out;
}

// `commit` is an output ⇒ automatically the single public signal; u,y,pi,N,l,r are private.
component main = WesolowskiCommit(128);
