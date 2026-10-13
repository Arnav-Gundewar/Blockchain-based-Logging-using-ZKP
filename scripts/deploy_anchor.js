const hre = require("hardhat");
const fs = require("fs");

async function main() {
    console.log("Deploying optimised LogAnchor...");
    const LogAnchor = await hre.ethers.getContractFactory("LogAnchor");
    const logAnchor = await LogAnchor.deploy();
    await logAnchor.waitForDeployment();
    const addr = await logAnchor.getAddress();
    console.log("LogAnchor deployed to:", addr);

    const addresses = JSON.parse(fs.readFileSync("contract_addresses.json"));
    addresses.logAnchor = addr;
    fs.writeFileSync("contract_addresses.json", JSON.stringify(addresses, null, 2));
    console.log("Updated contract_addresses.json");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});