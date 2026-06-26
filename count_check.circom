pragma circom 2.0.0;

include "node_modules/circomlib/circuits/comparators.circom";

template CountCheck(n) {
    signal input event_codes[n];   // private
    signal input threshold;        // public
    signal output valid;           // only output - 1 or 0

    signal sums[n+1];
    sums[0] <== 0;
    for (var i = 0; i < n; i++) {
        event_codes[i] * (event_codes[i] - 1) === 0;
        sums[i+1] <== sums[i] + event_codes[i];
    }

    // count is now an internal signal, never exposed
    signal count;
    count <== sums[n];

    component lt = LessThan(4);
    lt.in[0] <== count;
    lt.in[1] <== threshold;
    valid <== lt.out;
}

component main {public [threshold]} = CountCheck(8);