pragma circom 2.0.0;
include "bigint.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/mux1.circom";

// Modular exponentiation out = base^exp mod modulus, over 2048-bit operands
// (32 limbs of 64 bits). MSB-first square-and-multiply.
//
// Per exponent bit (fixed circuit, regardless of witness):
//   - 1 squaring   : BigMultModP(64,32)
//   - 1 multiply   : BigMultModP(64,32)   (acc_squared * base)
//   - 32 Mux1      : select acc_squared (bit=0) vs multiplied (bit=1)
// => ~2 BigMultModP per bit. exp supplied as a single field element (< 2^EXPBITS).
template ModExp(EXPBITS) {
    signal input base[32];
    signal input exp;          // exponent as one field element, < 2^EXPBITS
    signal input modulus[32];
    signal output out[32];

    component bits = Num2Bits(EXPBITS);
    bits.in <== exp;

    // acc[s] = running accumulator after s processed bits; acc[0] = 1.
    signal acc[EXPBITS + 1][32];
    for (var i = 0; i < 32; i++) { acc[0][i] <== (i == 0) ? 1 : 0; }

    component sq[EXPBITS];
    component mul[EXPBITS];
    component mux[EXPBITS][32];

    for (var s = 0; s < EXPBITS; s++) {
        var b = EXPBITS - 1 - s;   // MSB first

        sq[s] = BigMultModP(64, 32);
        for (var i = 0; i < 32; i++) {
            sq[s].a[i] <== acc[s][i];
            sq[s].b[i] <== acc[s][i];
            sq[s].p[i] <== modulus[i];
        }

        mul[s] = BigMultModP(64, 32);
        for (var i = 0; i < 32; i++) {
            mul[s].a[i] <== sq[s].out[i];
            mul[s].b[i] <== base[i];
            mul[s].p[i] <== modulus[i];
        }

        for (var i = 0; i < 32; i++) {
            mux[s][i] = Mux1();
            mux[s][i].c[0] <== sq[s].out[i];   // bit = 0: keep the square
            mux[s][i].c[1] <== mul[s].out[i];  // bit = 1: multiply by base
            mux[s][i].s <== bits.out[b];
            acc[s + 1][i] <== mux[s][i].out;
        }
    }

    for (var i = 0; i < 32; i++) { out[i] <== acc[EXPBITS][i]; }
}
