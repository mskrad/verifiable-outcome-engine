pragma circom 2.0.0;
include "bigint.circom";
// Representative class-group composition + reduction at 1024-bit coefficients.
// Dominant op multiset (generic case, hint-based gcd/inverse): 4 BigModInv + 10 BigMultModP.
// Chained so --O2 cannot drop ops. Values are irrelevant; we measure CONSTRAINTS.
template CGComp() {
    signal input a[16];
    signal input p[16];
    signal output out[16];
    var K = 16;
    component inv[4];
    component mul[10];
    signal acc[15][16];
    for (var i=0;i<16;i++){ acc[0][i] <== a[i]; }
    // 10 modmuls chained
    for (var j=0;j<10;j++){
        mul[j]=BigMultModP(64,K);
        for (var i=0;i<16;i++){ mul[j].a[i]<==acc[j][i]; mul[j].b[i]<==a[i]; mul[j].p[i]<==p[i]; }
        for (var i=0;i<16;i++){ acc[j+1][i]<==mul[j].out[i]; }
    }
    // 4 modinvs chained
    for (var j=0;j<4;j++){
        inv[j]=BigModInv(64,K);
        for (var i=0;i<16;i++){ inv[j].in[i]<==acc[10+j][i]; inv[j].p[i]<==p[i]; }
        for (var i=0;i<16;i++){ acc[11+j][i]<==inv[j].out[i]; }
    }
    for (var i=0;i<16;i++){ out[i]<==acc[14][i]; }
}
component main = CGComp();
