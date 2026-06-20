pragma circom 2.0.0;
include "hash_to_l.circom";

// Expose l2 as public outputs so the witness can be cross-checked against JS.
template HlTest() {
    signal input commit;
    signal input nonce;
    signal output l0;
    signal output l1;
    component h = HashToL();
    h.commit <== commit;
    h.nonce <== nonce;
    l0 <== h.l2[0];
    l1 <== h.l2[1];
}
component main = HlTest();
