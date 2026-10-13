const hre = require("hardhat");
const fs = require("fs");

async function main() {
    const addresses = JSON.parse(fs.readFileSync("contract_addresses.json"));
    const LogAnchor = await hre.ethers.getContractFactory("LogAnchor");
    const logAnchor = LogAnchor.attach(addresses.logAnchor);

    const roots = JSON.parse(fs.readFileSync("all_roots.json"));
    const timestamp = Date.now();
    const anchoredIds = {};
    const anchorGasUsed = [];  // real gas used per anchorRoot tx, this run

    for (const [batchName, root] of Object.entries(roots)) {
        const uniqueId = `${batchName}_${timestamp}`;
        try {
            console.log(`\nAnchoring ${uniqueId}...`);
            const tx = await logAnchor.anchorRoot(uniqueId, root);
            console.log(`  TX sent: ${tx.hash}`);
            const receipt = await tx.wait();

            // Capture REAL gas used from the transaction receipt
            const gasUsed = Number(receipt.gasUsed);
            anchorGasUsed.push(gasUsed);
            console.log(`  Gas used: ${gasUsed}`);

            // Store as object so etherscan.html can use direct TX hash link
            // No getRoot call here — verify_onchain.js handles root verification
            anchoredIds[batchName] = { id: uniqueId, txHash: tx.hash, gasUsed };
            console.log(`  ✓ Anchored successfully`);
        } catch (e) {
            if (e.message.includes("already anchored")) {
                console.log(`  ${uniqueId} already anchored, skipping`);
                anchoredIds[batchName] = { id: uniqueId, txHash: null, gasUsed: null };
            } else {
                throw e;
            }
        }
    }

    fs.writeFileSync("anchored_ids.json", JSON.stringify(anchoredIds, null, 2));
    console.log("\n✅ All batches anchored");
    console.log("Saved anchored IDs to anchored_ids.json");

    // Write/merge real anchor gas into gas_results.json
    // (verify_onchain.js will add verifyProofGas on top of this in the same run)
    if (anchorGasUsed.length > 0) {
        const avgAnchorGas = Math.round(
            anchorGasUsed.reduce((a, b) => a + b, 0) / anchorGasUsed.length
        );

        let existing = {};
        if (fs.existsSync("gas_results.json")) {
            try { existing = JSON.parse(fs.readFileSync("gas_results.json")); } catch (_) {}
        }

        fs.writeFileSync("gas_results.json", JSON.stringify({
            ...existing,
            anchorRootGas: String(avgAnchorGas),
            anchorRootGasPerBatch: anchorGasUsed,
            anchorRootGasUpdatedAt: new Date().toISOString(),
        }, null, 2));

        console.log(`\n⛽ Real anchor gas (avg of ${anchorGasUsed.length}): ${avgAnchorGas}`);
        console.log(`   Written to gas_results.json`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
