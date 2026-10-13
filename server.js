const express = require("express");
const { execSync } = require("child_process");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(express.static("."));

const LANL_AUTH_PATH = "./Dataset/auth.txt.gz";

// ── Generate logs from LANL dataset ──────────────────────────────────────────
app.post("/api/generate", (req, res) => {
    const { batches = 5, mode = "mixed" } = req.body;
    const seed = Math.floor(Math.random() * 2147483647);

    if (!["mixed", "clean", "anomalous"].includes(mode)) {
        return res.status(400).json({ success: false, error: `Invalid mode: ${mode}` });
    }
    if (!fs.existsSync(LANL_AUTH_PATH)) {
        return res.status(400).json({ success: false, error: `auth.txt.gz not found at ${LANL_AUTH_PATH}` });
    }

    try {
        console.log(`[generate] mode=${mode} batches=${batches} seed=${seed}`);
        execSync(
            `node preprocess_lanl.js --input ${LANL_AUTH_PATH} --batches ${batches} --mode ${mode} --seed ${seed}`,
            { timeout: 300000 }
        );
        const result = {};
        for (let b = 1; b <= batches; b++) {
            const p = `batch_${b}.json`;
            if (fs.existsSync(p)) result[`batch_${b}`] = JSON.parse(fs.readFileSync(p));
        }
        let summary = null;
        if (fs.existsSync("lanl_preprocess_summary.json"))
            summary = JSON.parse(fs.readFileSync("lanl_preprocess_summary.json"));

        res.json({ success: true, batches: result, summary, source: "LANL" });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ── Build Merkle trees ────────────────────────────────────────────────────────
app.post("/api/merkle", (req, res) => {
    try {
        execSync("node build_merkle.js");
        const roots = JSON.parse(fs.readFileSync("all_roots.json"));
        res.json({ success: true, roots });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ── Anchor all roots on-chain ─────────────────────────────────────────────────
app.post("/api/anchor", (req, res) => {
    try {
        const output = execSync(
            "npx hardhat run scripts/anchor_all.js --network sepolia",
            { timeout: 180000 }
        ).toString();
        const roots = JSON.parse(fs.readFileSync("all_roots.json"));
        res.json({ success: true, output, roots });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ── Generate ZK proofs ────────────────────────────────────────────────────────
app.post("/api/prove", (req, res) => {
    try {
        const { countThreshold = 4, sevThreshold = 5 } = req.body;
        fs.writeFileSync("thresholds.json", JSON.stringify({ countThreshold, sevThreshold }));
        execSync("node scripts/prove_all.js", { timeout: 300000 });
        const benchmark = JSON.parse(fs.readFileSync("benchmark_results.json"));
        res.json({ success: true, benchmark });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ── Verify on-chain ───────────────────────────────────────────────────────────
app.post("/api/verify", (req, res) => {
    try {
        execSync("npx hardhat run scripts/verify_onchain.js --network sepolia", { timeout: 180000 });
        const results = JSON.parse(fs.readFileSync("verification_results.json"));
        let gasResults = { verifyProofGas: "225000", anchorRootGas: "240000" };
        if (fs.existsSync("gas_results.json"))
            gasResults = JSON.parse(fs.readFileSync("gas_results.json"));
        res.json({ success: true, results, gasResults });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ── HITL Re-certification ─────────────────────────────────────────────────────
// Analyst overrides severity scores on a failed batch, triggers fresh ZK proof
// re-anchored on-chain with a HITL_batch_N_timestamp ID
app.post("/api/hitl-recertify", (req, res) => {
    const { batchName, overriddenScores, analystNote = "" } = req.body;

    if (!batchName || !Array.isArray(overriddenScores) || overriddenScores.length !== 8) {
        return res.status(400).json({ success: false, error: "Need batchName and 8 overriddenScores" });
    }

    const batchPath = `${batchName}.json`;
    if (!fs.existsSync(batchPath)) {
        return res.status(400).json({ success: false, error: `${batchPath} not found` });
    }

    try {
        const thresholds = fs.existsSync("thresholds.json")
            ? JSON.parse(fs.readFileSync("thresholds.json"))
            : { countThreshold: 4, sevThreshold: 5 };

        // 1. Read original batch, apply analyst overrides
        const original = JSON.parse(fs.readFileSync(batchPath));
        const overridden = original.map((log, i) => ({
            ...log,
            severity:   overriddenScores[i],
            event_code: overriddenScores[i] >= 3 ? 1 : 0,
            meta: {
                ...log.meta,
                analyst_override:   true,
                original_severity:  log.severity,
                analyst_note:       analystNote,
                override_timestamp: new Date().toISOString(),
            }
        }));

        // 2. Backup original, write overridden in place so build_merkle.js picks it up
        fs.writeFileSync(`${batchName}_original_backup.json`, JSON.stringify(original, null, 2));
        fs.writeFileSync(batchPath, JSON.stringify(overridden, null, 2));

        // 3. Re-run Merkle (reads all batch_N.json — only the overridden one changed)
        execSync("node build_merkle.js", { timeout: 60000 });
        const newRoots = JSON.parse(fs.readFileSync("all_roots.json"));

        // 4. Re-anchor (anchor_all.js uses timestamp-based IDs, so this is a fresh anchor)
        const anchorOut = execSync(
            "npx hardhat run scripts/anchor_all.js --network sepolia",
            { timeout: 180000 }
        ).toString();

        // 5. Re-prove with same thresholds
        fs.writeFileSync("thresholds.json", JSON.stringify(thresholds));
        execSync("node scripts/prove_all.js", { timeout: 300000 });
        const newBenchmark = JSON.parse(fs.readFileSync("benchmark_results.json"));

        // 6. Re-verify on-chain
        execSync("npx hardhat run scripts/verify_onchain.js --network sepolia", { timeout: 180000 });
        const newResults = JSON.parse(fs.readFileSync("verification_results.json"));

        // 7. Restore original batch file (keep system state clean)
        fs.writeFileSync(batchPath, JSON.stringify(original, null, 2));

        // 8. Find this batch's new result
        const batchNum   = batchName.replace("batch_", "");
        const batchResult = newResults.find(r => r.batch === batchName) || {};
        const benchResult = newBenchmark.find(r => r.batch === batchName) || {};

        // 9. Save HITL record for auditing
        const hitlRecord = {
            timestamp:        new Date().toISOString(),
            batchName,
            analystNote,
            originalScores:   original.map(l => l.severity),
            overriddenScores,
            newRoot:          newRoots[batchName],
            countPredicate:   batchResult.count_predicate,
            sevPredicate:     batchResult.sev_predicate,
            txHash:           batchResult.txHash,
        };

        const hitlLog = fs.existsSync("hitl_log.json")
            ? JSON.parse(fs.readFileSync("hitl_log.json"))
            : [];
        hitlLog.push(hitlRecord);
        fs.writeFileSync("hitl_log.json", JSON.stringify(hitlLog, null, 2));

        res.json({
            success:         true,
            batchResult,
            benchResult,
            newRoot:         newRoots[batchName],
            analystNote,
            overriddenScores,
        });

    } catch (e) {
        // Restore original if something went wrong
        const backupPath = `${batchName}_original_backup.json`;
        if (fs.existsSync(backupPath)) {
            fs.writeFileSync(`${batchName}.json`, fs.readFileSync(backupPath));
        }
        console.error("[hitl-recertify] error:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ── Status endpoint ───────────────────────────────────────────────────────────
app.get("/api/status", (req, res) => {
    res.json({
        dataset: {
            auth:    fs.existsSync(LANL_AUTH_PATH),
            redteam: fs.existsSync("./Dataset/redteam.txt.gz"),
        },
        pipeline: {
            batches_ready:  fs.existsSync("batch_1.json"),
            merkle_ready:   fs.existsSync("all_roots.json"),
            anchored:       fs.existsSync("anchored_ids.json"),
            proofs_ready:   fs.existsSync("benchmark_results.json"),
            verified:       fs.existsSync("verification_results.json"),
        }
    });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`ZKLog server running at http://localhost:${PORT}`);
    console.log(`Open http://localhost:${PORT}/dashboard.html`);
    console.log(`Dataset: ${fs.existsSync(LANL_AUTH_PATH) ? "✓ auth.txt.gz found" : "✗ NOT found at " + LANL_AUTH_PATH}`);
});
