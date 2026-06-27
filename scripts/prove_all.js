const { execSync } = require("child_process");
const fs = require("fs");

async function main() {
    const results = [];
    const batches = fs.readdirSync(".")
        .filter(f => f.match(/^batch_\d+\.json$/))
        .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]))
        .map(f => f.replace(".json", ""));

    console.log(`Generating proofs for ${batches.length} batches...\n`);

    for (const batch of batches) {
        console.log(`Processing ${batch}...`);

        // --- LOG VERIFIER (count predicate) ---
        const w1Start = Date.now();
        execSync(`node log_verifier_js/generate_witness.js log_verifier_js/log_verifier.wasm input_merkle_${batch}.json witness_${batch}.wtns`);
        const witnessMs = Date.now() - w1Start;

        const p1Start = Date.now();
        execSync(`snarkjs groth16 prove log_verifier_hez_final.zkey witness_${batch}.wtns proof_${batch}.json public_${batch}.json`);
        const proofMs = Date.now() - p1Start;

        const v1Start = Date.now();
        execSync(`snarkjs groth16 verify verification_key_log_hez.json public_${batch}.json proof_${batch}.json`);
        const verifyMs = Date.now() - v1Start;

        const pub = JSON.parse(fs.readFileSync(`public_${batch}.json`));

        // --- SEVERITY BATCH CHECK ---
        // Build severity input from merkle input
        const merkleInput = JSON.parse(fs.readFileSync(`input_merkle_${batch}.json`));
        const sevInput = {
            severities: merkleInput.severities,
            event_codes: merkleInput.event_codes,
            ids: merkleInput.ids,
            leaves: merkleInput.leaves,
            root: merkleInput.root,
            pathElements: merkleInput.pathElements,
            pathIndices: merkleInput.pathIndices,
            threshold: "5"
        };
        fs.writeFileSync(`input_severity_${batch}.json`, JSON.stringify(sevInput, null, 2));

        const w2Start = Date.now();
        execSync(`node severity_batch_check_js/generate_witness.js severity_batch_check_js/severity_batch_check.wasm input_severity_${batch}.json witness_sev_${batch}.wtns`);
        const sevWitnessMs = Date.now() - w2Start;

        const p2Start = Date.now();
        execSync(`snarkjs groth16 prove severity_batch_hez_final.zkey witness_sev_${batch}.wtns proof_sev_${batch}.json public_sev_${batch}.json`);
        const sevProofMs = Date.now() - p2Start;

        const v2Start = Date.now();
        execSync(`snarkjs groth16 verify verification_key_severity_hez.json public_sev_${batch}.json proof_sev_${batch}.json`);
        const sevVerifyMs = Date.now() - v2Start;

        const pubSev = JSON.parse(fs.readFileSync(`public_sev_${batch}.json`));

        results.push({
            batch,
            count_valid: pub[0],
            sev_valid: pubSev[0],
            witnessMs,
            proofMs,
            verifyMs,
            sevWitnessMs,
            sevProofMs,
            sevVerifyMs
        });

        console.log(`  [Count]    Witness: ${witnessMs}ms | Proof: ${proofMs}ms | Verify: ${verifyMs}ms | Valid: ${pub[0]}`);
        console.log(`  [Severity] Witness: ${sevWitnessMs}ms | Proof: ${sevProofMs}ms | Verify: ${sevVerifyMs}ms | Valid: ${pubSev[0]}`);
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

    const avgCount = Math.round(results.reduce((a, r) => a + r.proofMs, 0) / results.length);
    const avgSev = Math.round(results.reduce((a, r) => a + r.sevProofMs, 0) / results.length);
    console.log(`\nAverage count proof: ${avgCount}ms`);
    console.log(`Average severity proof: ${avgSev}ms`);
    console.log("\nResults saved to benchmark_results.json");
}

main().catch(console.error);