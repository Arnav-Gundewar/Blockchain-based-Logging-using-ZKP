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

    // Real on-chain result (view call — no gas cost to the caller, but we
    // separately measure what this call WOULD cost via estimateGas below)
    const valid = await verifier.verifyProof(pA, pB, pC, pubSignals);

    // Real gas estimate for this exact proof + public signals —
    // this is what verifyProof actually costs if called as a state-changing tx
    let gasUsed = null;
    try {
        const gasEstimate = await verifier.verifyProof.estimateGas(pA, pB, pC, pubSignals);
        gasUsed = Number(gasEstimate);
    } catch (e) {
        // estimateGas can fail on some RPC providers for view functions — non-fatal
        console.log(`    (gas estimate unavailable: ${e.message.slice(0, 60)})`);
    }

    return { valid, gasUsed };
}

async function main() {
    const addresses = JSON.parse(fs.readFileSync("contract_addresses.json"));

    const LogAnchor = await hre.ethers.getContractFactory("LogAnchor");
    const logAnchor = LogAnchor.attach(addresses.logAnchor);

    const LogVerifier = await hre.ethers.getContractFactory("Groth16Verifier");
    const logVerifier = LogVerifier.attach(addresses.logVerifier);

    const SeverityVerifier = await hre.ethers.getContractFactory("SeverityBatchVerifier");
    const severityVerifier = SeverityVerifier.attach(addresses.severityVerifier);

    const anchoredIds = JSON.parse(fs.readFileSync("anchored_ids.json"));

    const batches = fs.readdirSync(".")
        .filter(f => f.match(/^proof_batch_\d+\.json$/))
        .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]))
        .map(f => f.replace("proof_", "").replace(".json", ""));

    console.log(`Verifying ${batches.length} batches on-chain...\n`);

    const results = [];
    const allVerifyGas = [];  // real gas used across both circuits, this run

    for (const batch of batches) {
        process.stdout.write(`Verifying ${batch}... `);

        const countResult = await verifyProof(
            logVerifier,
            `proof_${batch}.json`,
            `public_${batch}.json`
        );
        const sevResult = await verifyProof(
            severityVerifier,
            `proof_sev_${batch}.json`,
            `public_sev_${batch}.json`
        );

        if (countResult.gasUsed) allVerifyGas.push(countResult.gasUsed);
        if (sevResult.gasUsed)   allVerifyGas.push(sevResult.gasUsed);

        // anchoredIds[batch] is now an object {id, txHash, gasUsed}
        // but handle old string format too for backwards compatibility
        const anchoredEntry = anchoredIds[batch];
        const anchoredId = typeof anchoredEntry === 'object' ? anchoredEntry.id    : anchoredEntry;
        const txHash     = typeof anchoredEntry === 'object' ? anchoredEntry.txHash : null;

        const result = await logAnchor.getRoot(anchoredId);
        const storedRoot = result[0];        const merkleOutput = JSON.parse(fs.readFileSync(`merkle_output_${batch}.json`));
        // storedRoot is BigInt from ethers — compare as strings to avoid type mismatch
        const rootMatches = storedRoot.toString() === merkleOutput.root.toString();

        const pub = JSON.parse(fs.readFileSync(`public_${batch}.json`));
        const pubSev = JSON.parse(fs.readFileSync(`public_sev_${batch}.json`));

        results.push({
            batch,
            anchoredId,
            txHash,       // direct Etherscan link — saved by anchor_all.js
            rootMatches,
            countValid: countResult.valid,
            sevValid: sevResult.valid,
            count_predicate: pub[0] === "1" ? "PASS" : "FAIL",
            sev_predicate: pubSev[0] === "1" ? "PASS" : "FAIL",
            countGas: countResult.gasUsed,
            sevGas: sevResult.gasUsed,
        });

        const status = countResult.valid && sevResult.valid && rootMatches ? "✅" : "❌";
        console.log(`${status} count:${pub[0]==="1"?"PASS":"FAIL"} sev:${pubSev[0]==="1"?"PASS":"FAIL"} root:${rootMatches?"✓":"✗"} id:${anchoredId}`);
    }

    console.log("\n=== SUMMARY ===");
    console.table(results);

    fs.writeFileSync("verification_results.json", JSON.stringify(results, null, 2));
    console.log("\nSaved to verification_results.json");

    // Write/merge real verify gas into gas_results.json
    if (allVerifyGas.length > 0) {
        const avgVerifyGas = Math.round(
            allVerifyGas.reduce((a, b) => a + b, 0) / allVerifyGas.length
        );

        let existing = {};
        if (fs.existsSync("gas_results.json")) {
            try { existing = JSON.parse(fs.readFileSync("gas_results.json")); } catch (_) {}
        }

        fs.writeFileSync("gas_results.json", JSON.stringify({
            ...existing,
            verifyProofGas: String(avgVerifyGas),
            verifyProofGasPerCall: allVerifyGas,
            verifyProofGasUpdatedAt: new Date().toISOString(),
        }, null, 2));

        console.log(`\n⛽ Real verification gas (avg of ${allVerifyGas.length} calls): ${avgVerifyGas}`);
        console.log(`   Written to gas_results.json`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
