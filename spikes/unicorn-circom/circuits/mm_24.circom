pragma circom 2.0.0;
include "bigint.circom";
template MM() { signal input a[24]; signal input b[24]; signal input p[24]; signal output out[24];
 component m=BigMultModP(64,24); for(var i=0;i<24;i++){m.a[i]<==a[i];m.b[i]<==b[i];m.p[i]<==p[i];} for(var i=0;i<24;i++){out[i]<==m.out[i];} }
component main = MM();
