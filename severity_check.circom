pragma circom 2.0.0;

include "node_modules/circomlib/circuits/comparators.circom";

template SeverityCheck() {
    signal input severity;    // private - the actual log severity value
    signal input threshold;   // public - the max allowed severity
    signal output valid;      // 1 if severity < threshold, 0 if not

    component lt = LessThan(4);  // 4 bits handles values 0-15
    lt.in[0] <== severity;
    lt.in[1] <== threshold;
    valid <== lt.out;
}

component main {public [threshold]} = SeverityCheck();