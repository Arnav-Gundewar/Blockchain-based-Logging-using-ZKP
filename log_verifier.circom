pragma circom 2.0.0;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/poseidon.circom";

// Verifies a single Merkle path
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

// Swaps two values based on selector bit
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

// Main circuit: proves count of suspicious events < threshold
// AND that all entries belong to the committed Merkle root
template LogVerifier(n, levels) {
    // Private inputs
    signal input event_codes[n];
    signal input severities[n];
    signal input ids[n];
    signal input leaves[n];
    signal input pathElements[n][levels];
    signal input pathIndices[n][levels];

    // Public inputs
    signal input root;
    signal input threshold;

    // Public output
    signal output valid;

    // Step 1: verify each leaf hash and Merkle path
    component hashers[n];
    component merkleProofs[n];

    for (var i = 0; i < n; i++) {
        // Recompute leaf hash from private inputs
        hashers[i] = Poseidon(3);
        hashers[i].inputs[0] <== ids[i];
        hashers[i].inputs[1] <== severities[i];
        hashers[i].inputs[2] <== event_codes[i];

        // Verify computed hash matches claimed leaf
        hashers[i].out === leaves[i];

        // Verify leaf is in the Merkle tree
        merkleProofs[i] = MerkleProof(levels);
        merkleProofs[i].leaf <== leaves[i];
        merkleProofs[i].root <== root;
        for (var j = 0; j < levels; j++) {
            merkleProofs[i].pathElements[j] <== pathElements[i][j];
            merkleProofs[i].pathIndices[j] <== pathIndices[i][j];
        }
    }

    // Step 2: count suspicious events
    signal sums[n + 1];
    sums[0] <== 0;
    for (var i = 0; i < n; i++) {
        event_codes[i] * (event_codes[i] - 1) === 0;
        sums[i + 1] <== sums[i] + event_codes[i];
    }

    signal count;
    count <== sums[n];

    // Step 3: prove count < threshold
    component lt = LessThan(4);
    lt.in[0] <== count;
    lt.in[1] <== threshold;
    valid <== lt.out;
}

// 8 entries, 3 levels (log2 of 8)
component main {public [root, threshold]} = LogVerifier(8, 3);