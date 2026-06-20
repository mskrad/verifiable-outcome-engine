pragma circom 2.0.0;
include "small_modexp.circom";   // ModExpK + bigint (BigMult, BigMultModP, BigSub) + bitify + mux1
include "../node_modules/circomlib/circuits/comparators.circom";

// B4c block 2 — in-circuit Pocklington primality of l (~128-bit), option A core.
// Proves l prime given a certificate (witness): l-1 = F*R, F = prod q[i]^e[i] > sqrt(l),
// base a with a^(l-1) == 1 (mod l) and gcd(a^((l-1)/q[i]) - 1, l) == 1 for each prime q[i].
// (Factor primality of q[i] is a small separable trial-division layer, added next.)
//
// gated repeated-mult field power (no field wrap; exp < EMAX <= 255).
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
        factor[k] <== lt[k].out * (base - 1) + 1;
        acc[k + 1] <== acc[k] * factor[k];
    }
    out <== acc[EMAX];
}

template PockVerify() {
    signal input l2[2];
    signal input a;          // base (small, < 2^64)
    signal input F2[2];
    signal input R2[2];
    signal input q[8];
    signal input e[8];
    signal input ediv[8];    // (l-1)/q[i]
    signal input sinv[8][2]; // (a^ediv[i] - 1)^{-1} mod l, as 2 limbs

    // ---- l-1 ----
    signal lm1_0; signal lm1_1; signal lm1_field;
    lm1_0 <== l2[0] - 1;
    lm1_1 <== l2[1];
    lm1_field <== lm1_0 + lm1_1 * 18446744073709551616;

    // ---- F = prod q[i]^e[i] == F2, F2*R2 == l-1, F >= 2^64 ----
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
    component f1z = IsZero(); f1z.in <== F2[1];
    f1z.out === 0;
    component r0b = Num2Bits(64); r0b.in <== R2[0];
    component r1b = Num2Bits(64); r1b.in <== R2[1];
    component fr = BigMult(64, 2);
    fr.a[0] <== F2[0]; fr.a[1] <== F2[1];
    fr.b[0] <== R2[0]; fr.b[1] <== R2[1];
    fr.out[0] === lm1_0;
    fr.out[1] === lm1_1;
    fr.out[2] === 0;
    fr.out[3] === 0;

    // ---- Fermat: a^(l-1) == 1 (mod l) ----
    signal a2[2];
    a2[0] <== a;
    a2[1] <== 0;
    component fermat = ModExpK(128, 2);
    fermat.base[0] <== a2[0]; fermat.base[1] <== a2[1];
    fermat.exp <== lm1_field;
    fermat.modulus[0] <== l2[0]; fermat.modulus[1] <== l2[1];
    fermat.out[0] === 1;
    fermat.out[1] === 0;

    // ---- per enabled slot: ediv*q == l-1 and gcd(a^ediv - 1, l) == 1 ----
    component ez[8];
    component edb[8];
    signal enable[8];
    signal diff[8];
    component me[8];
    component gm1[8];
    component prod[8];
    for (var i = 0; i < 8; i++) {
        ez[i] = IsZero(); ez[i].in <== e[i];
        enable[i] <== 1 - ez[i].out;
        edb[i] = Num2Bits(128); edb[i].in <== ediv[i];
        diff[i] <== ediv[i] * q[i] - lm1_field;
        diff[i] * enable[i] === 0;

        // g = a^ediv[i] mod l
        me[i] = ModExpK(128, 2);
        me[i].base[0] <== a2[0]; me[i].base[1] <== a2[1];
        me[i].exp <== ediv[i];
        me[i].modulus[0] <== l2[0]; me[i].modulus[1] <== l2[1];
        // gm1 = g - 1   (g >= 1 for a valid cert)
        gm1[i] = BigSub(64, 2);
        gm1[i].a[0] <== me[i].out[0]; gm1[i].a[1] <== me[i].out[1];
        gm1[i].b[0] <== 1; gm1[i].b[1] <== 0;
        // gcd==1 via inverse hint: gm1 * sinv == 1 (mod l), enforced when enabled
        prod[i] = BigMultModP(64, 2);
        prod[i].a[0] <== gm1[i].out[0]; prod[i].a[1] <== gm1[i].out[1];
        prod[i].b[0] <== sinv[i][0]; prod[i].b[1] <== sinv[i][1];
        prod[i].p[0] <== l2[0]; prod[i].p[1] <== l2[1];
        (prod[i].out[0] - 1) * enable[i] === 0;
        prod[i].out[1] * enable[i] === 0;
    }
}

