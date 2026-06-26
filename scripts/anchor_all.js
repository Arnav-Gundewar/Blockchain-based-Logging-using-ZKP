const hre = require("hardhat");
const fs = require("fs");

async function main() {
    const addresses = JSON.parse(fs.readFileSync("contract_addresses.json"));
    const LogAnchor = await hre.ethers.getContractFactory("LogAnchor");
    const logAnchor = LogAnchor.attach(addresses.logAnchor);

    const roots = JSON.parse(fs.readFileSync("all_roots.json"));

    for (const [batchName, root] of Object.entries(roots)) {
        try {
            console.log(`\nAnchoring ${batchName}...`);
            const tx = await logAnchor.anchorRoot(batchName, root);
            console.log(`  TX sent: ${tx.hash}`);
            await tx.wait();
            const [storedRoot, timestamp] = await logAnchor.getRoot(batchName);
            console.log(`  Stored root: ${storedRoot.toString().substring(0, 20)}...`);
            console.log(`  Timestamp: ${new Date(Number(timestamp) * 1000).toISOString()}`);
        } catch (e) {
            if (e.message.includes("Batch already anchored")) {
                console.log(`  ${batchName} already anchored, skipping`);
            } else {
                throw e;
            }
        }
    }

    console.log("\n✅ All batches anchored");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});