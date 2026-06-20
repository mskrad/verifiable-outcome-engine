pragma circom 2.0.0;
include "wesolowski_verify.circom";
include "hash_to_l.circom";
include "small_modexp.circom";
include "../node_modules/circomlib/circuits/sha256/sha256.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

// PHASE3 A' sound circuit.
//   public  : commit, nonce
//   private : u[32], y[32], pi[32], N[32]
//   const   : EXPBITS_L (=128, l/r bit width), EXPBITS_T (T bit width), T (delay)
//
// Proves, with a single SHA-commit + nonce exposed:
//   1. commit == field(SHA256(u||y))                      (binds commit to private u,y)
//   2. l = forcedBits(SHA256(commit||nonce))              (Fiat-Shamir candidate; HashToL)
//   3. r = 2^T mod l                                       (computed in-circuit, ModExpK)
//   4. pi^l * u^r == y (mod N)                             (Wesolowski; WesolowskiVerify)
// Primality of l is NOT proven here — it is checked ON-CHAIN by the Rust Pocklington
// verifier (A' decision, see PHASE3 §DECISION). l/r are no longer free witness.
// (Baking N as a circuit constant is PHASE3 step 3; here N is still a private input.)
template WesolowskiSound(EXPBITS_L, EXPBITS_T, T) {
    signal input commit;
    signal input nonce;
    signal input u[32];
    signal input y[32];
    signal input pi[32];
    signal input N[32];

    // 1. commit binding: commit == field(SHA256(u||y)), low 254 bits.
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
    component cc = Bits2Num(253);  // low 253 bits < r (bn254), no reduction ambiguity
    for (var i = 0; i < 253; i++) { cc.in[i] <== sha.out[255 - i]; }
    commit === cc.out;

    // 2. l = HashToL(commit, nonce). l as a single 128-bit field element.
    component h = HashToL();
    h.commit <== commit;
    h.nonce <== nonce;
    signal lf;
    lf <== h.l2[0] + h.l2[1] * 18446744073709551616;  // 2^64

    // 3. r = 2^T mod l, computed in-circuit (base 2, exponent constant T).
    component me = ModExpK(EXPBITS_T, 2);
    me.base[0] <== 2;
    me.base[1] <== 0;
    me.exp <== T;
    me.modulus[0] <== h.l2[0];
    me.modulus[1] <== h.l2[1];
    signal rf;
    rf <== me.out[0] + me.out[1] * 18446744073709551616;  // 2^64

    // 4. Wesolowski: pi^l * u^r == y mod N.
    component wv = WesolowskiVerify(EXPBITS_L);
    for (var i = 0; i < 32; i++) {
        wv.u[i] <== u[i];
        wv.y[i] <== y[i];
        wv.pi[i] <== pi[i];
        wv.N[i] <== N[i];
    }
    wv.l <== lf;
    wv.r <== rf;
}

// EXPBITS_L=128, EXPBITS_T=40 (production-representative delay bit width), T=1000 (fixture).
component main {public [commit, nonce]} = WesolowskiSound(128, 40, 1000);
