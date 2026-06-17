pragma circom 2.0.0;
include "bigint.circom";

// One 2048-bit modular multiplication: out = (a * b) mod p
template ModMul2048() {
    signal input a[32];
    signal input b[32];
    signal input p[32];
    signal output out[32];
    component m = BigMultModP(64, 32);
    for (var i = 0; i < 32; i++) { m.a[i] <== a[i]; m.b[i] <== b[i]; m.p[i] <== p[i]; }
    for (var i = 0; i < 32; i++) { out[i] <== m.out[i]; }
}
component main = ModMul2048();
