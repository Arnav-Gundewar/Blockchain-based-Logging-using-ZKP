// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract LogAnchor {
    
    struct Batch {
        uint256 merkleRoot;
        uint256 timestamp;
        string batchId;
        bool exists;
    }

    mapping(string => Batch) public batches;
    string[] public batchIds;
    address public owner;

    event RootAnchored(string batchId, uint256 merkleRoot, uint256 timestamp);

    constructor() {
        owner = msg.sender;
    }

    function anchorRoot(string memory batchId, uint256 merkleRoot) public {
        require(!batches[batchId].exists, "Batch already anchored");
        
        batches[batchId] = Batch({
            merkleRoot: merkleRoot,
            timestamp: block.timestamp,
            batchId: batchId,
            exists: true
        });

        batchIds.push(batchId);
        emit RootAnchored(batchId, merkleRoot, block.timestamp);
    }

    function getRoot(string memory batchId) public view returns (uint256, uint256) {
        require(batches[batchId].exists, "Batch not found");
        return (batches[batchId].merkleRoot, batches[batchId].timestamp);
    }

    function getBatchCount() public view returns (uint256) {
        return batchIds.length;
    }
}