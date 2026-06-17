pragma circom 2.0.0;
include "wesolowski_verify.circom";
component main {public [u, y]} = WesolowskiVerify(32);
