const hre = require("hardhat");
const fs = require("fs");

async function verifyBatch(logVerifier, logAnchor, batchName) {
    const proof = JSON.parse(fs.readFileSync(`proof_${batchName}.json`));
    const pub = JSON.parse(fs.readFileSync(`public_${batchName}.json`));
    const merkleOutput = JSON.parse(fs.readFileSync(`merkle_output_${batchName}.json`));

    const pA = [proof.pi_a[0], proof.pi_a[1]];
    const pB = [
        [proof.pi_b[0][1], proof.pi_b[0][0]],
        [proof.pi_b[1][1], proof.pi_b[1][0]]
    ];
    const pC = [proof.pi_c[0], proof.pi_c[1]];
    const pubSignals = pub.map(s => BigInt(s));

    // Verify proof on-chain
    const isValid = await logVerifier.verifyProof(pA, pB, pC, pubSignals);

    // Check root matches on-chain anchor
    const [storedRoot] = await logAnchor.getRoot(batchName);
    const proofRoot = BigInt(merkleOutput.root);
    const rootMatches = storedRoot === proofRoot;

    return {
        batch: batchName,
        proofValid: isValid,
        rootMatches,
        verified: isValid && rootMatches,
        valid: pub[0],
        threshold: pub[2]
    };
}

async function main() {
    const addresses = JSON.parse(fs.readFileSync("contract_addresses.json"));

    const LogAnchor = await hre.ethers.getContractFactory("LogAnchor");
    const logAnchor = LogAnchor.attach(addresses.logAnchor);

    const LogVerifier = await hre.ethers.getContractFactory("Groth16Verifier");
    const logVerifier = LogVerifier.attach(addresses.logVerifier);

    // Auto-detect all proof files
    const batches = fs.readdirSync(".")
        .filter(f => f.match(/^proof_batch_\d+\.json$/))
        .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]))
        .map(f => f.replace("proof_", "").replace(".json", ""));

    console.log(`Found ${batches.length} proofs to verify\n`);

    const results = [];

    for (const batch of batches) {
        process.stdout.write(`Verifying ${batch}... `);
        const result = await verifyBatch(logVerifier, logAnchor, batch);
        results.push(result);

        if (result.verified) {
            console.log(`✅ VERIFIED (predicate ${result.valid === "1" ? "PASS" : "FAIL"}, threshold: ${result.threshold})`);
        } else {
            console.log(`❌ FAILED (proof: ${result.proofValid}, root: ${result.rootMatches})`);
        }
    }

    console.log("\n=== SUMMARY ===");
    console.table(results);

    fs.writeFileSync("verification_results.json", JSON.stringify(results, null, 2));
    console.log("\nResults saved to verification_results.json");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});