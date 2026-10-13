// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * LogAnchor.sol — ZKLog Integrity
 *
 * Stores Poseidon-hashed Merkle roots for batches of security log entries.
 * Batch IDs are human-readable strings (e.g. "batch_1_1788606839744") kept
 * for auditability. The root is stored as uint256 (Poseidon output fits
 * within BN254 scalar field — always < 2^254).
 *
 * Gas optimisations vs original:
 *   - Removed redundant `batchId` string field from Batch struct
 *     (it was duplicating the mapping key, costing ~20K extra gas per anchor)
 *   - Removed `string[]` batchIds array — replaced with indexed event log
 *     (on-chain array of strings is expensive; off-chain indexing via events
 *      is the standard pattern used by OpenZeppelin, Uniswap etc.)
 *   - Packed timestamp into uint64 (saves one storage slot vs uint256)
 *
 * Auditor verification flow:
 *   1. Call getRoot(batchId) → returns (merkleRoot, timestamp)
 *   2. Compare merkleRoot against locally recomputed Poseidon-Merkle root
 *   3. Verify ZK proof off-chain or via verifier contract
 */
contract LogAnchor {

    struct Batch {
        uint256 merkleRoot;  // Poseidon Merkle root — BN254 scalar field element
        uint64  timestamp;   // block.timestamp at anchor time (uint64 safe until year 2554)
        bool    exists;
    }

    mapping(string => Batch) private batches;

    address public owner;

    // Indexed event replaces the string[] batchIds array.
    // Cheaper to write (~750 gas per topic vs ~20K+ for string storage).
    // Off-chain: query all RootAnchored events to get the full batch list.
    event RootAnchored(
        string  indexed batchId,
        uint256         merkleRoot,
        uint64          timestamp
    );

    constructor() {
        owner = msg.sender;
    }

    /**
     * Anchor a Merkle root for a batch.
     * @param batchId   Human-readable batch identifier (e.g. "batch_1_1788606839744")
     * @param merkleRoot Poseidon Merkle root of the 8-leaf log batch
     */
    function anchorRoot(string calldata batchId, uint256 merkleRoot) external {
        require(!batches[batchId].exists, "Batch already anchored");
        require(merkleRoot != 0, "Root cannot be zero");

        uint64 ts = uint64(block.timestamp);

        batches[batchId] = Batch({
            merkleRoot: merkleRoot,
            timestamp:  ts,
            exists:     true
        });

        emit RootAnchored(batchId, merkleRoot, ts);
    }

    /**
     * Retrieve an anchored root.
     * @param batchId   The batch identifier used when anchoring
     * @return merkleRoot The stored Poseidon Merkle root
     * @return timestamp  The block timestamp at anchor time
     */
    function getRoot(string calldata batchId)
        external
        view
        returns (uint256 merkleRoot, uint256 timestamp)
    {
        require(batches[batchId].exists, "Batch not found");
        Batch storage b = batches[batchId];
        return (b.merkleRoot, uint256(b.timestamp));
    }

    /**
     * Check if a batch has been anchored without reverting.
     */
    function isAnchored(string calldata batchId) external view returns (bool) {
        return batches[batchId].exists;
    }
}
