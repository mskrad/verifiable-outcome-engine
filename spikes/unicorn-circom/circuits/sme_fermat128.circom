pragma circom 2.0.0;
include "small_modexp.circom";

// Test/measure main for the SmallModExp building block: Fermat check
// a^(l-1) mod l, asserting the result is 1 (holds iff l is prime, base a coprime).
// l ~128-bit => K=2 limbs of 64 bits, EXPBITS=128.
template SmeFermat128() {
    signal input a[2];       // base
    signal input l[2];       // modulus (the candidate prime)
    signal input lm1;        // l-1 as a single field element (< 2^128)

    component me = ModExpK(128, 2);
    me.base[0] <== a[0];
    me.base[1] <== a[1];
    me.exp <== lm1;
    me.modulus[0] <== l[0];
    me.modulus[1] <== l[1];

    me.out[0] === 1;
    me.out[1] === 0;
}

component main = SmeFermat128();
