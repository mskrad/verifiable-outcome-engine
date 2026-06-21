pragma circom 2.0.0;
include "bigint.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/mux1.circom";

// PHASE3 step 2 building block.
// Modular exponentiation out = base^exp mod modulus over K limbs of 64 bits,
// MSB-first square-and-multiply. Generalises modexp.circom's ModExp (which is
// hard-wired to 32 limbs) to any K. Used for the small (~128-bit, K=2) modulus l:
//   - Pocklington primality:  a^(l-1) mod l  and  a^((l-1)/q) mod l
//   - r = 2^T mod l           (base=2, exp=T)
// Cost per exponent bit (fixed circuit): 2 x BigMultModP(64,K) + K x Mux1.
template ModExpK(EXPBITS, K) {
    signal input base[K];
    signal input exp;            // exponent as one field element, < 2^EXPBITS
    signal input modulus[K];     // leading limb must be non-zero (BigMod requirement)
    signal output out[K];

    component bits = Num2Bits(EXPBITS);
    bits.in <== exp;

    signal acc[EXPBITS + 1][K];
    for (var i = 0; i < K; i++) { acc[0][i] <== (i == 0) ? 1 : 0; }

    component sq[EXPBITS];
    component mul[EXPBITS];
    component mux[EXPBITS][K];

    for (var s = 0; s < EXPBITS; s++) {
        var b = EXPBITS - 1 - s;  // MSB first

        sq[s] = BigMultModP(64, K);
        for (var i = 0; i < K; i++) {
            sq[s].a[i] <== acc[s][i];
            sq[s].b[i] <== acc[s][i];
            sq[s].p[i] <== modulus[i];
        }

        mul[s] = BigMultModP(64, K);
        for (var i = 0; i < K; i++) {
            mul[s].a[i] <== sq[s].out[i];
            mul[s].b[i] <== base[i];
            mul[s].p[i] <== modulus[i];
        }

        for (var i = 0; i < K; i++) {
            mux[s][i] = Mux1();
            mux[s][i].c[0] <== sq[s].out[i];   // bit = 0: keep the square
            mux[s][i].c[1] <== mul[s].out[i];  // bit = 1: multiply by base
            mux[s][i].s <== bits.out[b];
            acc[s + 1][i] <== mux[s][i].out;
        }
    }

    for (var i = 0; i < K; i++) { out[i] <== acc[EXPBITS][i]; }
}
