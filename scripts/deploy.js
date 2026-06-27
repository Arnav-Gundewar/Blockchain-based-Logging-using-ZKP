const hre = require("hardhat");
const fs = require("fs");

async function main() {
    console.log("Deploying SeverityBatchVerifier...");
    const SeverityVerifier = await hre.ethers.getContractFactory("SeverityBatchVerifier");
    const sv = await SeverityVerifier.deploy();
    await sv.waitForDeployment();
    const addr = await sv.getAddress();
    console.log("SeverityBatchVerifier deployed to:", addr);

    const addresses = JSON.parse(fs.readFileSync("contract_addresses.json"));
    addresses.severityVerifier = addr;
    fs.writeFileSync("contract_addresses.json", JSON.stringify(addresses, null, 2));
    console.log("Updated contract_addresses.json");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});