const hre = require("hardhat");
const fs = require("fs");

async function main() {
    const addresses = JSON.parse(fs.readFileSync("contract_addresses.json"));
    const LogVerifier = await hre.ethers.getContractFactory("Groth16Verifier");
    const logVerifier = LogVerifier.attach(addresses.logVerifier);
    const LogAnchor = await hre.ethers.getContractFactory("LogAnchor");
    const logAnchor = LogAnchor.attach(addresses.logAnchor);

    const results = [];

    // Measure gas for proof verification (batch_1 — valid proof)
    const proof = JSON.parse(fs.readFileSync("proof_batch_1.json"));
    const pub = JSON.parse(fs.readFileSync("public_batch_1.json"));

    const calldata = await hre.ethers.provider.call({
        to: addresses.logVerifier,
        data: logVerifier.interface.encodeFunctionData("verifyProof", [
            [proof.pi_a[0], proof.pi_a[1]],
            [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]],
            [proof.pi_c[0], proof.pi_c[1]],
            pub.map(s => BigInt(s))
        ])
    });

    // Estimate gas for verifyProof
    const verifyGas = await logVerifier.verifyProof.estimateGas(
        [proof.pi_a[0], proof.pi_a[1]],
        [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]],
        [proof.pi_c[0], proof.pi_c[1]],
        pub.map(s => BigInt(s))
    );

    // Estimate gas for anchorRoot (new batch)
    const anchorGas = await logAnchor.anchorRoot.estimateGas("benchmark_test", "12345678901234567890");

    console.log("\n=== GAS BENCHMARK ===");
    console.log(`Proof verification gas:  ${verifyGas.toString()}`);
    console.log(`Root anchoring gas:      ${anchorGas.toString()}`);
    console.log(`\nFor reference:`);
    console.log(`Plain Merkle anchor gas: ${anchorGas.toString()} (same — no ZK needed for anchoring)`);
    console.log(`ZK verification overhead: ${verifyGas.toString()} gas per batch`);

    fs.writeFileSync("gas_results.json", JSON.stringify({
        verifyProofGas: verifyGas.toString(),
        anchorRootGas: anchorGas.toString()
    }, null, 2));
}

main().catch(console.error);