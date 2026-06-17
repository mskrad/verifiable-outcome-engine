pragma circom 2.0.0;
include "modexp.circom";

// Wesolowski VDF verification over an RSA group (2048-bit modulus N, 32x64-bit limbs).
//
// Checks the Wesolowski equation:   pi^l * u^r == y  (mod N)
//   where l = H_to_prime(u, y)  (~128-bit Fiat-Shamir prime)
//         r = 2^T mod l
//
// GATE-MEASUREMENT SIMPLIFICATION (sanctioned by the spike brief, <= few %):
//   - l is supplied as a witness input (we do NOT prove primality of l, nor that
//     l = H(u,y)). Binding l to SHA256(u,y) (~30k c/block) and a Pocklington
//     primality certificate (modexp over ~128-bit l, cheap vs the 2048-bit modexp)
//     are minor additive increments measured separately; they do not move the gate.
//   - r is likewise supplied as a witness (= 2^T mod l, computed off-chain). The
//     in-circuit 2^T mod l reduction is negligible vs the two 2048-bit modexp.
//   - N is supplied as a witness (in the production circuit it is a baked constant).
//
// The dominant, honestly-measured cost is the two 2048-bit modexp with ~128-bit
// exponents plus one final 2048-bit modmul and the equality check.
template WesolowskiVerify(EXPBITS) {
    signal input u[32];    // public: VDF input
    signal input y[32];    // public: VDF output
    signal input pi[32];   // private: Wesolowski proof element
    signal input N[32];    // RSA modulus (const in production)
    signal input l;        // Fiat-Shamir prime (simplified: supplied)
    signal input r;        // 2^T mod l (supplied)

    component A = ModExp(EXPBITS);   // pi^l mod N
    for (var i = 0; i < 32; i++) { A.base[i] <== pi[i]; A.modulus[i] <== N[i]; }
    A.exp <== l;

    component B = ModExp(EXPBITS);   // u^r mod N
    for (var i = 0; i < 32; i++) { B.base[i] <== u[i]; B.modulus[i] <== N[i]; }
    B.exp <== r;

    component P = BigMultModP(64, 32);   // (pi^l * u^r) mod N
    for (var i = 0; i < 32; i++) {
        P.a[i] <== A.out[i];
        P.b[i] <== B.out[i];
        P.p[i] <== N[i];
    }

    component eq = BigIsEqual(32);
    for (var i = 0; i < 32; i++) {
        eq.in[0][i] <== P.out[i];
        eq.in[1][i] <== y[i];
    }
    eq.out === 1;
}

// main lives in the wv_n{N}.circom wrappers (N = exponent bit-width) so this file can be
// included by the reduced slope/validation circuits without a duplicate main. Full circuit
// = wv_n128.circom.
