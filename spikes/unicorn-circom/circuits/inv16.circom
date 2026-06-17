pragma circom 2.0.0;
include "bigint.circom";
template INV() { signal input a[16]; signal input p[16]; signal output out[16];
 component m=BigModInv(64,16); for(var i=0;i<16;i++){m.in[i]<==a[i];m.p[i]<==p[i];} for(var i=0;i<16;i++){out[i]<==m.out[i];} }
component main = INV();
