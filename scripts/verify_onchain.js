const hre = require("hardhat");
const fs = require("fs");

async function verifyProof(verifier, proofFile, publicFile) {
    const proof = JSON.parse(fs.readFileSync(proofFile));
    const pub = JSON.parse(fs.readFileSync(publicFile));

    const pA = [proof.pi_a[0], proof.pi_a[1]];
    const pB = [
        [proof.pi_b[0][1], proof.pi_b[0][0]],
        [proof.pi_b[1][1], proof.pi_b[1][0]]
    ];
    const pC = [proof.pi_c[0], proof.pi_c[1]];
    const pubSignals = pub.map(s => BigInt(s));

    return await verifier.verifyProof(pA, pB, pC, pubSignals);
}

async function main() {
    const addresses = JSON.parse(fs.readFileSync("contract_addresses.json"));

    const LogAnchor = await hre.ethers.getContractFactory("LogAnchor");
    const logAnchor = LogAnchor.attach(addresses.logAnchor);

    const LogVerifier = await hre.ethers.getContractFactory("Groth16Verifier");
    const logVerifier = LogVerifier.attach(addresses.logVerifier);

    const SeverityVerifier = await hre.ethers.getContractFactory("SeverityBatchVerifier");
    const severityVerifier = SeverityVerifier.attach(addresses.severityVerifier);

    const batches = fs.readdirSync(".")
        .filter(f => f.match(/^proof_batch_\d+\.json$/))
        .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]))
        .map(f => f.replace("proof_", "").replace(".json", ""));

    console.log(`Verifying ${batches.length} batches on-chain...\n`);

    const results = [];

    for (const batch of batches) {
        process.stdout.write(`Verifying ${batch}... `);

        // Verify count predicate
        const countValid = await verifyProof(
            logVerifier,
            `proof_${batch}.json`,
            `public_${batch}.json`
        );

        // Verify severity predicate
        const sevValid = await verifyProof(
            severityVerifier,
            `proof_sev_${batch}.json`,
            `public_sev_${batch}.json`
        );

        // Check root matches on-chain anchor
        const [storedRoot] = await logAnchor.getRoot(batch);
        const merkleOutput = JSON.parse(fs.readFileSync(`merkle_output_${batch}.json`));
        const rootMatches = storedRoot === BigInt(merkleOutput.root);

        const pub = JSON.parse(fs.readFileSync(`public_${batch}.json`));
        const pubSev = JSON.parse(fs.readFileSync(`public_sev_${batch}.json`));

        results.push({
            batch,
            rootMatches,
            countValid,
            sevValid,
            count_predicate: pub[0] === "1" ? "PASS" : "FAIL",
            sev_predicate: pubSev[0] === "1" ? "PASS" : "FAIL",
        });

        const status = countValid && sevValid && rootMatches ? "✅" : "❌";
        console.log(`${status} count:${pub[0]==="1"?"PASS":"FAIL"} sev:${pubSev[0]==="1"?"PASS":"FAIL"} root:${rootMatches?"✓":"✗"}`);
    }

    console.log("\n=== SUMMARY ===");
    console.table(results);

    fs.writeFileSync("verification_results.json", JSON.stringify(results, null, 2));
    console.log("\nSaved to verification_results.json");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});