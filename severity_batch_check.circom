pragma circom 2.0.0;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/poseidon.circom";

template Switcher() {
    signal input sel;
    signal input L;
    signal input R;
    signal output outL;
    signal output outR;

    signal aux;
    aux <== (R - L) * sel;
    outL <== L + aux;
    outR <== R - aux;
}

template MerkleProof(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    signal hashes[levels + 1];
    hashes[0] <== leaf;

    component hashers[levels];
    component switchers[levels];

    for (var i = 0; i < levels; i++) {
        switchers[i] = Switcher();
        switchers[i].sel <== pathIndices[i];
        switchers[i].L <== hashes[i];
        switchers[i].R <== pathElements[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== switchers[i].outL;
        hashers[i].inputs[1] <== switchers[i].outR;
        hashes[i + 1] <== hashers[i].out;
    }

    root === hashes[levels];
}

// Proves NO entry in the batch has severity >= threshold
// i.e. all severities are below threshold
template SeverityBatchCheck(n, levels) {
    // Private inputs
    signal input severities[n];
    signal input event_codes[n];
    signal input ids[n];
    signal input leaves[n];
    signal input pathElements[n][levels];
    signal input pathIndices[n][levels];

    // Public inputs
    signal input root;
    signal input threshold;

    // Public output
    signal output valid;  // 1 if ALL entries have severity < threshold

    component hashers[n];
    component merkleProofs[n];
    component comparators[n];

    signal checks[n];

    for (var i = 0; i < n; i++) {
        // Recompute and verify leaf hash
        hashers[i] = Poseidon(3);
        hashers[i].inputs[0] <== ids[i];
        hashers[i].inputs[1] <== severities[i];
        hashers[i].inputs[2] <== event_codes[i];
        hashers[i].out === leaves[i];

        // Verify Merkle path
        merkleProofs[i] = MerkleProof(levels);
        merkleProofs[i].leaf <== leaves[i];
        merkleProofs[i].root <== root;
        for (var j = 0; j < levels; j++) {
            merkleProofs[i].pathElements[j] <== pathElements[i][j];
            merkleProofs[i].pathIndices[j] <== pathIndices[i][j];
        }

        // Check severity < threshold for this entry
        comparators[i] = LessThan(4);
        comparators[i].in[0] <== severities[i];
        comparators[i].in[1] <== threshold;
        checks[i] <== comparators[i].out;
    }

    // All checks must be 1 — multiply them together
    // If any single check is 0, the product is 0
    signal products[n];
    products[0] <== checks[0];
    for (var i = 1; i < n; i++) {
        products[i] <== products[i-1] * checks[i];
    }

    valid <== products[n-1];
}

component main {public [root, threshold]} = SeverityBatchCheck(8, 3);