const hre = require("hardhat");
const fs = require("fs");

async function main() {
    const addresses = JSON.parse(fs.readFileSync("contract_addresses.json"));
    const LogAnchor = await hre.ethers.getContractFactory("LogAnchor");
    const logAnchor = LogAnchor.attach(addresses.logAnchor);

    const roots = JSON.parse(fs.readFileSync("all_roots.json"));
    const timestamp = Date.now();
    const anchoredIds = {};

    for (const [batchName, root] of Object.entries(roots)) {
        const uniqueId = `${batchName}_${timestamp}`;
        try {
            console.log(`\nAnchoring ${uniqueId}...`);
            const tx = await logAnchor.anchorRoot(uniqueId, root);
            console.log(`  TX sent: ${tx.hash}`);
            await tx.wait();
            const [storedRoot, ts] = await logAnchor.getRoot(uniqueId);
            console.log(`  Stored root: ${storedRoot.toString().substring(0, 20)}...`);
            console.log(`  Timestamp: ${new Date(Number(ts) * 1000).toISOString()}`);
            anchoredIds[batchName] = uniqueId;
        } catch (e) {
            if (e.message.includes("already anchored")) {
                console.log(`  ${uniqueId} already anchored, skipping`);
                anchoredIds[batchName] = uniqueId;
            } else {
                throw e;
            }
        }
    }

    fs.writeFileSync("anchored_ids.json", JSON.stringify(anchoredIds, null, 2));
    console.log("\n✅ All batches anchored");
    console.log("Saved anchored IDs to anchored_ids.json");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});