pragma circom 2.0.0;
include "small_modexp.circom";   // ModExpK + bigint (BigMult, BigMultModP, BigSub) + bitify + mux1
include "../node_modules/circomlib/circuits/comparators.circom";

// B4c — in-circuit Pocklington primality of l (~128-bit), option A. SOUNDNESS-FIXED 2026-06-21.
// Audit (unicorn-g-audit-A) found two holes, both closed here:
//   (1) factor primality of q[i] was NOT enforced -> composite l=2^64+1 was accepted.
//       Fix: range-check q[i] < 2^16 AND trial-divide by every prime <= 251 (a composite <= 2^16
//       has a prime factor <= 251), so each enabled q[i] is a genuine small prime.
//   (2) F = prod q[i]^e[i] computed in the field could wrap.
//       Fix: a single running product range-checked < 2^128 at EVERY step (P<2^128 * q<2^16 =
//       <2^144 < r => exact, no wrap). EMAX=64: e[i] is capped; a partial factored F > sqrt(l)
//       is all Pocklington needs.
template PockVerify() {
    signal input l2[2];
    signal input a;
    signal input F2[2];
    signal input R2[2];
    signal input q[8];
    signal input e[8];         // 0..64
    signal input ediv[8];      // (l-1)/q[i]
    signal input sinv[8][2];   // (a^ediv[i]-1)^{-1} mod l, 2 limbs
    signal input quo[8][54];   // q[i] div p_j (trial-division quotients)

    var EMAX = 64;
    var NP = 54;
    var P[54] = [2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97,
                 101,103,107,109,113,127,131,137,139,149,151,157,163,167,173,179,181,191,
                 193,197,199,211,223,227,229,233,239,241,251];

    // ---- l-1 ----
    signal lm1_0; signal lm1_1; signal lm1_field;
    lm1_0 <== l2[0] - 1;
    lm1_1 <== l2[1];
    lm1_field <== lm1_0 + lm1_1 * 18446744073709551616;

    // ---- enable + q range-check + factor primality (trial division) ----
    component ez[8];
    signal enable[8];
    component qb[8];
    component qge2[8];
    component rlt[8][54];
    component rz[8][54];
    component qeq[8][54];
    signal rem[8][54];
    signal t1[8][54];
    for (var i = 0; i < 8; i++) {
        ez[i] = IsZero(); ez[i].in <== e[i];
        enable[i] <== 1 - ez[i].out;
        qb[i] = Num2Bits(16); qb[i].in <== q[i];           // q < 2^16
        qge2[i] = GreaterEqThan(16); qge2[i].in[0] <== q[i]; qge2[i].in[1] <== 2;
        enable[i] * (1 - qge2[i].out) === 0;               // enabled => q >= 2
        for (var j = 0; j < NP; j++) {
            rem[i][j] <== q[i] - P[j] * quo[i][j];          // q = p_j*quo + rem
            rlt[i][j] = LessThan(9); rlt[i][j].in[0] <== rem[i][j]; rlt[i][j].in[1] <== P[j];
            rlt[i][j].out === 1;                            // 0 <= rem < p_j (forces true remainder)
            rz[i][j] = IsZero(); rz[i][j].in <== rem[i][j];
            qeq[i][j] = IsEqual(); qeq[i][j].in[0] <== q[i]; qeq[i][j].in[1] <== P[j];
            t1[i][j] <== rz[i][j].out * (1 - qeq[i][j].out);
            enable[i] * t1[i][j] === 0;                     // p_j | q & p_j != q => reject (q composite)
        }
    }

    // ---- F = prod q[i]^e[i], running product range-checked < 2^128 each step (no wrap) ----
    var STEPS = 8 * EMAX;
    signal Pacc[STEPS + 1];
    Pacc[0] <== 1;
    component lt[8][EMAX];
    signal fct[8][EMAX];
    component rc[STEPS];
    var step = 0;
    for (var i = 0; i < 8; i++) {
        for (var k = 0; k < EMAX; k++) {
            lt[i][k] = LessThan(8); lt[i][k].in[0] <== k; lt[i][k].in[1] <== e[i];
            fct[i][k] <== lt[i][k].out * (q[i] - 1) + 1;    // k<e ? q : 1
            Pacc[step + 1] <== Pacc[step] * fct[i][k];
            rc[step] = Num2Bits(128); rc[step].in <== Pacc[step + 1]; // < 2^128 => no field wrap
            step += 1;
        }
    }
    component f0b = Num2Bits(64); f0b.in <== F2[0];
    component f1b = Num2Bits(64); f1b.in <== F2[1];
    signal F_field;
    F_field <== F2[0] + F2[1] * 18446744073709551616;
    F_field === Pacc[STEPS];

    // F >= 2^64  (sufficient since sqrt(l) < 2^64)
    component f1z = IsZero(); f1z.in <== F2[1];
    f1z.out === 0;

    // F2 * R2 == l-1  (2-limb bigint, no wrap)
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
    a2[0] <== a; a2[1] <== 0;
    component fermat = ModExpK(128, 2);
    fermat.base[0] <== a2[0]; fermat.base[1] <== a2[1];
    fermat.exp <== lm1_field;
    fermat.modulus[0] <== l2[0]; fermat.modulus[1] <== l2[1];
    fermat.out[0] === 1;
    fermat.out[1] === 0;

    // ---- per enabled slot: ediv*q == l-1 and gcd(a^ediv - 1, l) == 1 ----
    component edb[8];
    signal diff[8];
    component me[8];
    component gm1[8];
    component prod[8];
    for (var i = 0; i < 8; i++) {
        edb[i] = Num2Bits(128); edb[i].in <== ediv[i];
        diff[i] <== ediv[i] * q[i] - lm1_field;             // ediv*q < 2^144 < r (q<2^16): wrap-safe
        diff[i] * enable[i] === 0;

        me[i] = ModExpK(128, 2);
        me[i].base[0] <== a2[0]; me[i].base[1] <== a2[1];
        me[i].exp <== ediv[i];
        me[i].modulus[0] <== l2[0]; me[i].modulus[1] <== l2[1];
        gm1[i] = BigSub(64, 2);
        gm1[i].a[0] <== me[i].out[0]; gm1[i].a[1] <== me[i].out[1];
        gm1[i].b[0] <== 1; gm1[i].b[1] <== 0;
        prod[i] = BigMultModP(64, 2);
        prod[i].a[0] <== gm1[i].out[0]; prod[i].a[1] <== gm1[i].out[1];
        prod[i].b[0] <== sinv[i][0]; prod[i].b[1] <== sinv[i][1];
        prod[i].p[0] <== l2[0]; prod[i].p[1] <== l2[1];
        (prod[i].out[0] - 1) * enable[i] === 0;
        prod[i].out[1] * enable[i] === 0;
    }
}
