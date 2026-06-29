const { buildPoseidon } = require("circomlibjs");
const fs = require("fs");

async function processBatch(poseidon, logs, batchName) {
    const F = poseidon.F;

    const leaves = logs.map(log => {
        const hash = poseidon([log.id, log.severity, log.event_code]);
        return BigInt(F.toString(hash));
    });

    let levels = [leaves];
    let current = leaves;

    while (current.length > 1) {
        const next = [];
        for (let i = 0; i < current.length; i += 2) {
            const hash = poseidon([current[i], current[i+1]]);
            next.push(BigInt(F.toString(hash)));
        }
        levels.push(next);
        current = next;
    }

    const root = current[0].toString();

    const proofs = leaves.map((_, leafIndex) => {
        const pathElements = [];
        const pathIndices = [];
        let idx = leafIndex;

        for (let lvl = 0; lvl < levels.length-1; lvl++) {
            const isRight = idx % 2;
            const siblingIdx = isRight ? idx - 1 : idx + 1;
            pathElements.push(levels[lvl][siblingIdx].toString());
            pathIndices.push(isRight ? 1 : 0);
            idx = Math.floor(idx / 2);
        }

        return { leafIndex, pathElements, pathIndices };
    });

    const circuitInput = {
        event_codes: logs.map(l => l.event_code.toString()),
        severities: logs.map(l => l.severity.toString()),
        ids: logs.map(l => l.id.toString()),
        leaves: leaves.map(l => l.toString()),
        root: root,
        pathElements: proofs.map(p => p.pathElements),
        pathIndices: proofs.map(p => p.pathIndices),
        threshold: "4"
    };

    fs.writeFileSync(`input_merkle_${batchName}.json`, JSON.stringify(circuitInput, null, 2));
    fs.writeFileSync(`merkle_output_${batchName}.json`, JSON.stringify({
        root,
        levels: levels.map(l => l.map(x => x.toString())),
        proofs
    }, null, 2));

    console.log(`${batchName}: root = ${root}`);
    return root;
}

async function main() {
    const poseidon = await buildPoseidon();
    const roots = {};

    // Auto-detect all batch_N.json files in current directory
    const batchFiles = fs.readdirSync(".")
        .filter(f => f.match(/^batch_\d+\.json$/))
        .sort((a, b) => {
            const na = parseInt(a.match(/\d+/)[0]);
            const nb = parseInt(b.match(/\d+/)[0]);
            return na - nb;
        });

    if (batchFiles.length === 0) {
        console.log("No batch files found. Add batch_1.json, batch_2.json etc.");
        return;
    }

    console.log(`Found ${batchFiles.length} batch files: ${batchFiles.join(", ")}`);

    for (const file of batchFiles) {
        const batchName = file.replace(".json", "");
        const logs = JSON.parse(fs.readFileSync(file));
        roots[batchName] = await processBatch(poseidon, logs, batchName);
    }

    fs.writeFileSync("all_roots.json", JSON.stringify(roots, null, 2));
    console.log(`\nAll ${batchFiles.length} roots saved to all_roots.json`);
}

main().catch(console.error);