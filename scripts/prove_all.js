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

        // Generate witness
        const witnessStart = Date.now();
        execSync(`node log_verifier_js/generate_witness.js log_verifier_js/log_verifier.wasm input_merkle_${batch}.json witness_${batch}.wtns`);
        const witnessTime = Date.now() - witnessStart;

        // Generate proof
        const proofStart = Date.now();
        execSync(`snarkjs groth16 prove log_verifier_hez_final.zkey witness_${batch}.wtns proof_${batch}.json public_${batch}.json`);
        const proofTime = Date.now() - proofStart;

        // Verify locally
        const verifyStart = Date.now();
        execSync(`snarkjs groth16 verify verification_key_log_hez.json public_${batch}.json proof_${batch}.json`);
        const verifyTime = Date.now() - verifyStart;

        // Read public output
        const pub = JSON.parse(fs.readFileSync(`public_${batch}.json`));

        results.push({
            batch,
            valid: pub[0],
            root: pub[1].substring(0, 20) + "...",
            threshold: pub[2],
            witnessMs: witnessTime,
            proofMs: proofTime,
            verifyMs: verifyTime
        });

        console.log(`  Witness: ${witnessTime}ms | Proof: ${proofTime}ms | Verify: ${verifyTime}ms | Valid: ${pub[0]}`);
    }

    fs.writeFileSync("benchmark_results.json", JSON.stringify(results, null, 2));

    console.log("\n=== BENCHMARK SUMMARY ===");
    console.table(results.map(r => ({
        batch: r.batch,
        valid: r.valid,
        "witness(ms)": r.witnessMs,
        "proof(ms)": r.proofMs,
        "verify(ms)": r.verifyMs
    })));

    const avgProof = Math.round(results.reduce((a, r) => a + r.proofMs, 0) / results.length);
    const avgVerify = Math.round(results.reduce((a, r) => a + r.verifyMs, 0) / results.length);
    console.log(`\nAverage proof generation: ${avgProof}ms`);
    console.log(`Average local verification: ${avgVerify}ms`);
    console.log("\nResults saved to benchmark_results.json");
}

main().catch(console.error);