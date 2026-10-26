/**
 * evaluate_targeted.js
 *
 * Evaluates TP/FP/TN/FN using the KNOWN ground truth from targeted_sample.js.
 * Handles both cases:
 *   - Pipeline ran on batch_t1..N directly (prefix batch_t)
 *   - Pipeline ran on batch_1..N after renaming (prefix batch_, mapped to batch_t)
 */
'use strict';
const fs = require('fs');

const args    = parseArgs(process.argv.slice(2));
const GT_PATH = args['--gt']        || './targeted_ground_truth.json';
const RES_PATH= args['--results']   || './verification_results.json';
const BM_PATH = args['--benchmark'] || './benchmark_results.json';
const GAS_PATH= args['--gas']       || './gas_results.json';
const OUT_PATH= args['--out']       || './targeted_evaluation_report.json';

if (!fs.existsSync(GT_PATH))  { console.error(`✗ ${GT_PATH} not found.`);  process.exit(1); }
if (!fs.existsSync(RES_PATH)) { console.error(`✗ ${RES_PATH} not found.`); process.exit(1); }

const gt        = JSON.parse(fs.readFileSync(GT_PATH));
const verResults= JSON.parse(fs.readFileSync(RES_PATH));
const benchmark = fs.existsSync(BM_PATH)  ? JSON.parse(fs.readFileSync(BM_PATH))  : [];
const gasResults= fs.existsSync(GAS_PATH) ? JSON.parse(fs.readFileSync(GAS_PATH)) : {};

// Build ordered list of ground truth labels (batch_t1, batch_t2 ...)
// sorted by numeric index
const gtEntries = Object.entries(gt.labels)
    .sort((a, b) => {
        const na = parseInt(a[0].replace(/\D/g,''));
        const nb = parseInt(b[0].replace(/\D/g,''));
        return na - nb;
    });

// Filter verification results to only the batches that correspond to
// targeted batches — we take the first N results (sorted numerically)
// where N = number of ground truth entries
const allResults = [...verResults].sort((a, b) => {
    const na = parseInt(a.batch.replace(/\D/g,''));
    const nb = parseInt(b.batch.replace(/\D/g,''));
    return na - nb;
});

const nTargeted = gtEntries.length;
if (allResults.length < nTargeted) {
    console.error(`✗ Need ${nTargeted} batch results but only found ${allResults.length}.`);
    process.exit(1);
}
const targetedResults = allResults.slice(0, nTargeted);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(' ZKLog — Targeted Evaluation Results');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log(` Matching ${nTargeted} pipeline results to ${nTargeted} ground truth labels\n`);

let TP=0, FP=0, TN=0, FN=0;
const details = [];

for (let i = 0; i < nTargeted; i++) {
    const result     = targetedResults[i];
    const [gtName, label] = gtEntries[i];

    const systemFlags = result.count_predicate === 'FAIL' || result.sev_predicate === 'FAIL';
    const isPositive  = label === 'POSITIVE';

    let outcome;
    if (systemFlags  && isPositive)  { TP++; outcome = 'TP'; }
    else if (systemFlags  && !isPositive) { FP++; outcome = 'FP'; }
    else if (!systemFlags && isPositive)  { FN++; outcome = 'FN'; }
    else                                   { TN++; outcome = 'TN'; }

    const bm = benchmark.find(b => b.batch === result.batch) || {};
    details.push({
        pipeline_batch:  result.batch,
        gt_label_name:   gtName,
        outcome,
        system_verdict:  systemFlags ? 'FLAGGED' : 'CLEARED',
        ground_truth:    label,
        count_predicate: result.count_predicate,
        sev_predicate:   result.sev_predicate,
        count_proof_ms:  bm.proofMs    || null,
        sev_proof_ms:    bm.sevProofMs || null,
    });

    const rtTag = label === 'POSITIVE' ? ' ← contains confirmed redteam event' : '';
    console.log(`  ${result.batch} (${gtName}): ${outcome} | system=${systemFlags?'FLAGGED':'CLEARED'} | gt=${label}${rtTag}`);
}

const precision = TP+FP>0 ? TP/(TP+FP) : null;
const recall    = TP+FN>0 ? TP/(TP+FN) : null;
const f1        = precision!==null && recall!==null && precision+recall>0
    ? 2*precision*recall/(precision+recall) : null;
const accuracy  = (TP+TN+FP+FN)>0 ? (TP+TN)/(TP+TN+FP+FN) : null;
const fpr       = TN+FP>0 ? FP/(TN+FP) : null;

const allTimes  = details.flatMap(b=>[b.count_proof_ms,b.sev_proof_ms]).filter(Boolean);
const avgProof  = allTimes.length ? Math.round(allTimes.reduce((a,b)=>a+b,0)/allTimes.length) : null;
const minProof  = allTimes.length ? Math.min(...allTimes) : null;
const maxProof  = allTimes.length ? Math.max(...allTimes) : null;

const report = {
    generated_at: new Date().toISOString(),
    evaluation_type: 'targeted — batches built with confirmed redteam events',
    redteam_per_batch: gt.rt_per_batch,
    total_batches: nTargeted,
    positive_batches: gtEntries.filter(([,v])=>v==='POSITIVE').length,
    negative_batches: gtEntries.filter(([,v])=>v==='NEGATIVE').length,
    confusion_matrix: { TP, FP, TN, FN },
    detection_metrics: {
        precision:  precision!==null ? parseFloat(precision.toFixed(4)) : 'N/A',
        recall:     recall!==null    ? parseFloat(recall.toFixed(4))    : 'N/A',
        f1_score:   f1!==null        ? parseFloat(f1.toFixed(4))        : 'N/A',
        accuracy:   accuracy!==null  ? parseFloat(accuracy.toFixed(4))  : 'N/A',
        fpr:        fpr!==null       ? parseFloat(fpr.toFixed(4))       : 'N/A',
    },
    system_performance: {
        avg_proof_ms:         avgProof,
        min_proof_ms:         minProof,
        max_proof_ms:         maxProof,
        anchor_gas:           gasResults.anchorRootGas   ? parseInt(gasResults.anchorRootGas)   : null,
        verify_gas_per_proof: gasResults.verifyProofGas  ? parseInt(gasResults.verifyProofGas)  : null,
        verify_gas_per_batch: gasResults.verifyProofGas  ? parseInt(gasResults.verifyProofGas)*2: null,
    },
    batch_details: details,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(' CONFUSION MATRIX (targeted evaluation)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  TP (caught real attack)    : ${TP}`);
console.log(`  FP (false alarm)           : ${FP}`);
console.log(`  TN (correctly cleared)     : ${TN}`);
console.log(`  FN (missed attack)         : ${FN}`);
console.log('\n DETECTION METRICS');
console.log(`  Precision                  : ${precision!==null?(precision*100).toFixed(1)+'%':'N/A'}`);
console.log(`  Recall                     : ${recall!==null?(recall*100).toFixed(1)+'%':'N/A'}`);
console.log(`  F1 Score                   : ${f1!==null?f1.toFixed(4):'N/A'}`);
console.log(`  Accuracy                   : ${accuracy!==null?(accuracy*100).toFixed(1)+'%':'N/A'}`);
console.log(`  False Positive Rate        : ${fpr!==null?(fpr*100).toFixed(1)+'%':'N/A'}`);
console.log('\n SYSTEM PERFORMANCE');
console.log(`  Avg proof time (per circuit): ${avgProof!==null?avgProof+'ms':'N/A'}`);
console.log(`  Min / Max                   : ${minProof}ms / ${maxProof}ms`);
console.log(`  Gas per anchor              : ${gasResults.anchorRootGas||'N/A'}`);
console.log(`  Gas per proof               : ${gasResults.verifyProofGas||'N/A'}`);
console.log(`  Gas per batch (2 proofs)    : ${gasResults.verifyProofGas?parseInt(gasResults.verifyProofGas)*2:'N/A'}`);
console.log(`\n Full report → ${OUT_PATH}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

function parseArgs(argv) {
    const result = {};
    for (let i=0;i<argv.length;i++) {
        if (argv[i].startsWith('--')&&i+1<argv.length){result[argv[i]]=argv[i+1];i++;}
    }
    return result;
}
