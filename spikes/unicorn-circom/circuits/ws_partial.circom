pragma circom 2.0.0;
include "hash_to_l.circom";
include "small_modexp.circom";
include "../node_modules/circomlib/circuits/sha256/sha256.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

// Fast validation of the NEW A' logic only (steps 1-3 of wesolowski_sound), WITHOUT the
// expensive 2048-bit Wesolowski modexp. Asserts commit==SHA256(u||y) and exposes r=2^T mod l
// so it can be cross-checked against the JS fixture.
template WsPartial(EXPBITS_T, T) {
    signal input commit;
    signal input nonce;
    signal input u[32];
    signal input y[32];
    signal output r0;
    signal output r1;
    signal output lo0;
    signal output lo1;

    component ub[32];
    component yb[32];
    component sha = Sha256(4096);
    var idx = 0;
    for (var i = 0; i < 32; i++) { ub[i] = Num2Bits(64); ub[i].in <== u[i]; for (var b = 0; b < 64; b++) { sha.in[idx] <== ub[i].out[63 - b]; idx++; } }
    for (var i = 0; i < 32; i++) { yb[i] = Num2Bits(64); yb[i].in <== y[i]; for (var b = 0; b < 64; b++) { sha.in[idx] <== yb[i].out[63 - b]; idx++; } }
    component cc = Bits2Num(253);
    for (var i = 0; i < 253; i++) { cc.in[i] <== sha.out[255 - i]; }
    commit === cc.out;

    component h = HashToL();
    h.commit <== commit;
    h.nonce <== nonce;

    component me = ModExpK(EXPBITS_T, 2);
    me.base[0] <== 2; me.base[1] <== 0;
    me.exp <== T;
    me.modulus[0] <== h.l2[0];
    me.modulus[1] <== h.l2[1];
    r0 <== me.out[0];
    r1 <== me.out[1];
    lo0 <== h.l2[0];
    lo1 <== h.l2[1];
}
component main {public [commit, nonce]} = WsPartial(40, 1000);
