const hre = require("hardhat");
const fs = require("fs");

async function main() {
    const addresses = JSON.parse(fs.readFileSync("contract_addresses.json"));
    const LogAnchor = await hre.ethers.getContractFactory("LogAnchor");
    const logAnchor = LogAnchor.attach(addresses.logAnchor);

    const merkleOutput = JSON.parse(fs.readFileSync("merkle_output.json"));
    const root = merkleOutput.root;

    console.log("Contract address:", addresses.logAnchor);
    console.log("Anchoring Merkle root:", root);

    const tx = await logAnchor.anchorRoot("batch_1", root);
    console.log("Transaction sent:", tx.hash);
    await tx.wait();
    console.log("Transaction confirmed!");

    const [storedRoot, timestamp] = await logAnchor.getRoot("batch_1");
    console.log("Stored root:", storedRoot.toString());
    console.log("Timestamp:", new Date(Number(timestamp) * 1000).toISOString());
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});