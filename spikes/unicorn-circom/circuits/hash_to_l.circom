pragma circom 2.0.0;
include "../node_modules/circomlib/circuits/sha256/sha256.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

// PHASE3 A': derive the Fiat-Shamir prime candidate l from (commit, nonce).
//   l = low128( SHA256( commit_be256 || nonce_be64 ) )  with bit127 and bit0 forced to 1.
// The circuit only DERIVES l deterministically (binding); primality of l is checked
// ON-CHAIN by the Rust Pocklington verifier (A' decision). nonce is a public input;
// the prover grinds nonce until the derived l is prime.
//
// Serialization (must match on-chain seal in B4): commit as 32-byte big-endian (top 2
// bits zero, since commit < 2^254), nonce as 8-byte big-endian, concatenated, SHA256.
// l = low 128 bits of the digest (big-endian), bit127 and bit0 set => odd, full-length.
template HashToL() {
    signal input commit;     // field < 2^254
    signal input nonce;      // field < 2^64
    signal output l2[2];     // 128-bit candidate as 2 limbs of 64 bits

    // commit < 2^253 < r (bn254 scalar field) so no field reduction ambiguity.
    component cb = Num2Bits(253);
    cb.in <== commit;
    component nb = Num2Bits(64);
    nb.in <== nonce;

    component sha = Sha256(320);   // 256 (commit, padded) + 64 (nonce)
    // commit, MSB-first (big-endian 256 bits; positions 255..253 are zero pad).
    for (var i = 0; i < 256; i++) {
        if (255 - i < 253) { sha.in[i] <== cb.out[255 - i]; }
        else               { sha.in[i] <== 0; }
    }
    // nonce, MSB-first (big-endian 64 bits).
    for (var i = 0; i < 64; i++) { sha.in[256 + i] <== nb.out[63 - i]; }

    // l = low 128 bits of digest. sha.out[0]=MSB(bit255) .. sha.out[255]=LSB(bit0).
    // l_bit[j] (j=0 is LSB) = sha.out[255 - j]; force bit0 and bit127 to 1.
    signal lbit[128];
    for (var j = 0; j < 128; j++) {
        if (j == 0 || j == 127) { lbit[j] <== 1; }
        else                    { lbit[j] <== sha.out[255 - j]; }
    }
    component lb0 = Bits2Num(64);
    component lb1 = Bits2Num(64);
    for (var j = 0; j < 64; j++) { lb0.in[j] <== lbit[j]; }
    for (var j = 0; j < 64; j++) { lb1.in[j] <== lbit[64 + j]; }
    l2[0] <== lb0.out;
    l2[1] <== lb1.out;
}
