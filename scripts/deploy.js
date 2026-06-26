const hre = require("hardhat");
const fs = require("fs");

async function main() {
    console.log("Deploying LogVerifier...");
    const LogVerifier = await hre.ethers.getContractFactory("Groth16Verifier");
    const logVerifier = await LogVerifier.deploy();
    await logVerifier.waitForDeployment();
    const verifierAddress = await logVerifier.getAddress();
    console.log("LogVerifier deployed to:", verifierAddress);

    const addresses = JSON.parse(fs.readFileSync("contract_addresses.json"));
    addresses.logVerifier = verifierAddress;
    fs.writeFileSync("contract_addresses.json", JSON.stringify(addresses, null, 2));
    console.log("Updated contract_addresses.json");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});