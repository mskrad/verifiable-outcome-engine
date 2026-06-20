pragma circom 2.0.0;
include "bigint.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

// B4c block 1 — algebraic part of the in-circuit Pocklington certificate (no modexp yet):
//   F = prod q[i]^e[i] (field, repeated-mult so no wrap), F = F2 (2 limbs, < 2^128),
//   F2 * R2 == l-1 (2-limb bigint, no field wrap), F >= 2^64 (F2[1] != 0),
//   ediv[i]*q[i] == l-1 for enabled slots. (Primality of q[i] + base/gcd checks: block 2.)

// out = base^exp via gated repeated multiplication; every intermediate = base^k <= result,
// so for base^exp < field there is no field wrap (unlike square-and-multiply, whose
// base^(2^k) intermediates can overflow). exp < EMAX <= 255.
template FieldPowRep(EMAX) {
    signal input base;
    signal input exp;
    signal output out;
    signal acc[EMAX + 1];
    acc[0] <== 1;
    component lt[EMAX];
    signal factor[EMAX];
    for (var k = 0; k < EMAX; k++) {
        lt[k] = LessThan(8);
        lt[k].in[0] <== k;
        lt[k].in[1] <== exp;
        factor[k] <== lt[k].out * (base - 1) + 1; // exp>k -> base, else 1
        acc[k + 1] <== acc[k] * factor[k];
    }
    out <== acc[EMAX];
}

template PockCertArith() {
    signal input l2[2];
    signal input F2[2];
    signal input R2[2];
    signal input q[8];
    signal input e[8];
    signal input ediv[8];

    // l is odd (bit0 forced) => l2[0] >= 1, so l-1 limbs are (l2[0]-1, l2[1]).
    signal lm1_0;
    signal lm1_1;
    lm1_0 <== l2[0] - 1;
    lm1_1 <== l2[1];
    signal lm1_field;
    lm1_field <== lm1_0 + lm1_1 * 18446744073709551616;

    // F = prod q[i]^e[i]  (field, no wrap)
    component fp[8];
    signal Fp[9];
    Fp[0] <== 1;
    for (var i = 0; i < 8; i++) {
        fp[i] = FieldPowRep(128);
        fp[i].base <== q[i];
        fp[i].exp <== e[i];
        Fp[i + 1] <== Fp[i] * fp[i].out;
    }
    component f0b = Num2Bits(64); f0b.in <== F2[0];
    component f1b = Num2Bits(64); f1b.in <== F2[1];
    signal F_field;
    F_field <== F2[0] + F2[1] * 18446744073709551616;
    F_field === Fp[8];

    // F >= 2^64  <=>  high limb nonzero (sufficient since sqrt(l) < 2^64)
    component f1z = IsZero(); f1z.in <== F2[1];
    f1z.out === 0;

    // F2 * R2 == l-1  (2-limb bigint product, no field wrap)
    component r0b = Num2Bits(64); r0b.in <== R2[0];
    component r1b = Num2Bits(64); r1b.in <== R2[1];
    component fr = BigMult(64, 2);
    fr.a[0] <== F2[0]; fr.a[1] <== F2[1];
    fr.b[0] <== R2[0]; fr.b[1] <== R2[1];
    fr.out[0] === lm1_0;
    fr.out[1] === lm1_1;
    fr.out[2] === 0;
    fr.out[3] === 0;

    // per enabled slot: ediv[i]*q[i] == l-1  (ediv < 2^128 so no wrap)
    component ez[8];
    component edb[8];
    signal enable[8];
    signal diff[8];
    for (var i = 0; i < 8; i++) {
        ez[i] = IsZero(); ez[i].in <== e[i];
        enable[i] <== 1 - ez[i].out;
        edb[i] = Num2Bits(128); edb[i].in <== ediv[i];
        diff[i] <== ediv[i] * q[i] - lm1_field;
        diff[i] * enable[i] === 0;
    }
}

component main = PockCertArith();
