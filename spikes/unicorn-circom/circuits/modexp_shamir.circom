pragma circom 2.0.0;
include "bigint.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/mux2.circom";

// Joint (Shamir / Straus) double exponentiation: out = base1^exp1 * base2^exp2 mod N,
// over 2048-bit operands (32 limbs of 64). MSB-first; per exponent bit a single squaring
// and a single multiply by a mux-selected factor from {1, base1, base2, base1*base2}.
// => 2 BigMultModP per bit covering BOTH exponents, ~half of two separate ModExp (the
// dominant cost of the Wesolowski verify).
template MultiExp2(EXPBITS) {
    signal input base1[32];
    signal input base2[32];
    signal input exp1;
    signal input exp2;
    signal input modulus[32];
    signal output out[32];

    // precompute base1*base2 mod N
    component b12 = BigMultModP(64, 32);
    for (var i = 0; i < 32; i++) { b12.a[i] <== base1[i]; b12.b[i] <== base2[i]; b12.p[i] <== modulus[i]; }

    component bits1 = Num2Bits(EXPBITS); bits1.in <== exp1;
    component bits2 = Num2Bits(EXPBITS); bits2.in <== exp2;

    signal acc[EXPBITS + 1][32];
    for (var i = 0; i < 32; i++) { acc[0][i] <== (i == 0) ? 1 : 0; }

    component sq[EXPBITS];
    component mul[EXPBITS];
    component mux[EXPBITS][32];

    for (var s = 0; s < EXPBITS; s++) {
        var b = EXPBITS - 1 - s; // MSB first

        sq[s] = BigMultModP(64, 32);
        for (var i = 0; i < 32; i++) { sq[s].a[i] <== acc[s][i]; sq[s].b[i] <== acc[s][i]; sq[s].p[i] <== modulus[i]; }

        // factor = table[ bit1 + 2*bit2 ];  table = {1, base1, base2, base1*base2}
        mul[s] = BigMultModP(64, 32);
        for (var i = 0; i < 32; i++) {
            mux[s][i] = Mux2();
            mux[s][i].c[0] <== (i == 0) ? 1 : 0;
            mux[s][i].c[1] <== base1[i];
            mux[s][i].c[2] <== base2[i];
            mux[s][i].c[3] <== b12.out[i];
            mux[s][i].s[0] <== bits1.out[b];
            mux[s][i].s[1] <== bits2.out[b];
            mul[s].a[i] <== sq[s].out[i];
            mul[s].b[i] <== mux[s][i].out;
            mul[s].p[i] <== modulus[i];
        }
        for (var i = 0; i < 32; i++) { acc[s + 1][i] <== mul[s].out[i]; }
    }
    for (var i = 0; i < 32; i++) { out[i] <== acc[EXPBITS][i]; }
}

// Wesolowski verify via joint exponentiation: pi^l * u^r == y (mod N).
template WesolowskiVerifyShamir(EXPBITS) {
    signal input u[32];
    signal input y[32];
    signal input pi[32];
    signal input N[32];
    signal input l;
    signal input r;

    component me = MultiExp2(EXPBITS);
    for (var i = 0; i < 32; i++) { me.base1[i] <== pi[i]; me.base2[i] <== u[i]; me.modulus[i] <== N[i]; }
    me.exp1 <== l;
    me.exp2 <== r;

    component eq = BigIsEqual(32);
    for (var i = 0; i < 32; i++) { eq.in[0][i] <== me.out[i]; eq.in[1][i] <== y[i]; }
    eq.out === 1;
}
