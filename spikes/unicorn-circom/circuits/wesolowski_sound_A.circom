pragma circom 2.0.0;
include "wesolowski_verify.circom";
include "hash_to_l.circom";
include "small_modexp.circom";
include "prod_n.circom";
include "pock_verify_tpl.circom";
include "../node_modules/circomlib/circuits/sha256/sha256.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

// PHASE3 option A — fully sound production circuit with in-circuit primality.
//   public  : commit            (nonce is now PRIVATE — primality is proven in-circuit)
//   private : nonce, u,y,pi, and the Pocklington certificate (pa,F2,R2,q,e,ediv,sinv)
// Proves: commit=SHA256(u||y); l=forcedBits(SHA256(commit||nonce)); l PRIME (Pocklington);
//         r=2^T mod l; pi^l*u^r==y mod N (N baked). On-chain verify is just Groth16 over a
//         single public input (commit) -> ~79k CU; all primality cost is in the prover.
template WesolowskiSoundA(EXPBITS_L, EXPBITS_T, T) {
    signal input commit;
    signal input nonce;
    signal input u[32];
    signal input y[32];
    signal input pi[32];
    signal input pa;
    signal input F2[2];
    signal input R2[2];
    signal input q[8];
    signal input e[8];
    signal input ediv[8];
    signal input sinv[8][2];

    var Nc[32] = PROD_N();

    // 1. commit == field(SHA256(u||y)), low 253 bits
    component ub[32];
    component yb[32];
    component sha = Sha256(4096);
    var idx = 0;
    for (var i = 0; i < 32; i++) { ub[i] = Num2Bits(64); ub[i].in <== u[i]; for (var b = 0; b < 64; b++) { sha.in[idx] <== ub[i].out[63 - b]; idx++; } }
    for (var i = 0; i < 32; i++) { yb[i] = Num2Bits(64); yb[i].in <== y[i]; for (var b = 0; b < 64; b++) { sha.in[idx] <== yb[i].out[63 - b]; idx++; } }
    component cc = Bits2Num(253);
    for (var i = 0; i < 253; i++) { cc.in[i] <== sha.out[255 - i]; }
    commit === cc.out;

    // 2. l = HashToL(commit, nonce)
    component h = HashToL();
    h.commit <== commit;
    h.nonce <== nonce;

    // 3. prove l is prime (in-circuit Pocklington)
    component pv = PockVerify();
    pv.l2[0] <== h.l2[0]; pv.l2[1] <== h.l2[1];
    pv.a <== pa;
    pv.F2[0] <== F2[0]; pv.F2[1] <== F2[1];
    pv.R2[0] <== R2[0]; pv.R2[1] <== R2[1];
    for (var i = 0; i < 8; i++) {
        pv.q[i] <== q[i];
        pv.e[i] <== e[i];
        pv.ediv[i] <== ediv[i];
        pv.sinv[i][0] <== sinv[i][0];
        pv.sinv[i][1] <== sinv[i][1];
    }

    signal lf;
    lf <== h.l2[0] + h.l2[1] * 18446744073709551616;

    // 4. r = 2^T mod l
    component me = ModExpK(EXPBITS_T, 2);
    me.base[0] <== 2; me.base[1] <== 0;
    me.exp <== T;
    me.modulus[0] <== h.l2[0];
    me.modulus[1] <== h.l2[1];
    signal rf;
    rf <== me.out[0] + me.out[1] * 18446744073709551616;

    // 5. Wesolowski: pi^l * u^r == y mod N
    component wv = WesolowskiVerify(EXPBITS_L);
    for (var i = 0; i < 32; i++) {
        wv.u[i] <== u[i];
        wv.y[i] <== y[i];
        wv.pi[i] <== pi[i];
        wv.N[i] <== Nc[i];
    }
    wv.l <== lf;
    wv.r <== rf;
}

component main {public [commit]} = WesolowskiSoundA(128, 40, 1000);
