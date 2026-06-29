const { execSync } = require("child_process");
const fs = require("fs");

async function main() {
    // Read thresholds
    let countThreshold = 4;
    let sevThreshold = 5;
    if (fs.existsSync("thresholds.json")) {
        const t = JSON.parse(fs.readFileSync("thresholds.json"));
        countThreshold = t.countThreshold || 4;
        sevThreshold = t.sevThreshold || 5;
    }

    console.log(`Thresholds — Count: ${countThreshold}, Severity: ${sevThreshold}`);

    const results = [];
    const batches = fs.readdirSync(".")
        .filter(f => f.match(/^batch_\d+\.json$/))
        .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]))
        .map(f => f.replace(".json", ""));

    console.log(`Generating proofs for ${batches.length} batches...\n`);

    for (const batch of batches) {
        console.log(`Processing ${batch}...`);

        // Build merkle input with correct count threshold
        const merkleInput = JSON.parse(fs.readFileSync(`input_merkle_${batch}.json`));
        merkleInput.threshold = countThreshold.toString();
        fs.writeFileSync(`input_merkle_${batch}.json`, JSON.stringify(merkleInput, null, 2));

        // Log verifier (count predicate)
        const w1Start = Date.now();
        execSync(`node log_verifier_js/generate_witness.js log_verifier_js/log_verifier.wasm input_merkle_${batch}.json witness_${batch}.wtns`);
        const witnessMs = Date.now() - w1Start;

        const p1Start = Date.now();
        execSync(`snarkjs groth16 prove log_verifier_hez_final.zkey witness_${batch}.wtns proof_${batch}.json public_${batch}.json`);
        const proofMs = Date.now() - p1Start;

        execSync(`snarkjs groth16 verify verification_key_log_hez.json public_${batch}.json proof_${batch}.json`);
        const pub = JSON.parse(fs.readFileSync(`public_${batch}.json`));

        // Severity batch check
        const merkleInputSev = JSON.parse(fs.readFileSync(`input_merkle_${batch}.json`));
        const sevInput = {
            severities: merkleInputSev.severities,
            event_codes: merkleInputSev.event_codes,
            ids: merkleInputSev.ids,
            leaves: merkleInputSev.leaves,
            root: merkleInputSev.root,
            pathElements: merkleInputSev.pathElements,
            pathIndices: merkleInputSev.pathIndices,
            threshold: sevThreshold.toString()
        };
        fs.writeFileSync(`input_severity_${batch}.json`, JSON.stringify(sevInput, null, 2));

        const w2Start = Date.now();
        execSync(`node severity_batch_check_js/generate_witness.js severity_batch_check_js/severity_batch_check.wasm input_severity_${batch}.json witness_sev_${batch}.wtns`);
        const sevWitnessMs = Date.now() - w2Start;

        const p2Start = Date.now();
        execSync(`snarkjs groth16 prove severity_batch_hez_final.zkey witness_sev_${batch}.wtns proof_sev_${batch}.json public_sev_${batch}.json`);
        const sevProofMs = Date.now() - p2Start;

        execSync(`snarkjs groth16 verify verification_key_severity_hez.json public_sev_${batch}.json proof_sev_${batch}.json`);
        const pubSev = JSON.parse(fs.readFileSync(`public_sev_${batch}.json`));

        results.push({
            batch,
            count_valid: pub[0],
            sev_valid: pubSev[0],
            countThreshold,
            sevThreshold,
            witnessMs,
            proofMs,
            sevWitnessMs,
            sevProofMs
        });

        console.log(`  [Count]    Proof: ${proofMs}ms | Valid: ${pub[0]}`);
        console.log(`  [Severity] Proof: ${sevProofMs}ms | Valid: ${pubSev[0]}`);
    }

    fs.writeFileSync("benchmark_results.json", JSON.stringify(results, null, 2));

    console.log("\n=== BENCHMARK SUMMARY ===");
    console.table(results.map(r => ({
        batch: r.batch,
        count_valid: r.count_valid,
        sev_valid: r.sev_valid,
        "count_proof(ms)": r.proofMs,
        "sev_proof(ms)": r.sevProofMs,
    })));
}

main().catch(console.error);