/**
 * evaluate_redteam.js
 *
 * Benchmarking script for ZKLog — computes TP, FP, TN, FN, Precision, Recall,
 * F1, plus system performance metrics (proof time, gas cost).
 *
 * What "positive" means in this system:
 *   Positive = batch flagged (count predicate FAIL OR severity predicate FAIL)
 *   Negative = batch cleared (both predicates PASS)
 *
 * Ground truth: does this batch contain any log entry whose
 *   (time_bucket, src_user, src_computer, dst_computer)
 *   matches a line in redteam.txt.gz?
 *
 * NOTE: LANL timestamps are relative seconds from epoch=1 (1 Jan 2009).
 * We use a ±300s (5-minute) window when matching batch timestamps to
 * redteam events, since batches are sampled, not time-windowed.
 *
 * Usage:
 *   node evaluate_redteam.js [--redteam ./Dataset/redteam.txt.gz]
 *                            [--batchdir ./]
 *                            [--results ./verification_results.json]
 *                            [--benchmark ./benchmark_results.json]
 *                            [--gas ./gas_results.json]
 *                            [--out ./evaluation_report.json]
 */

'use strict';

const fs       = require('fs');
const zlib     = require('zlib');
const readline = require('readline');
const path     = require('path');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
const REDTEAM_PATH  = args['--redteam']   || './Dataset/redteam.txt.gz';
const BATCH_DIR     = args['--batchdir']  || './';
const RESULTS_PATH  = args['--results']   || './verification_results.json';
const BENCHMARK_PATH= args['--benchmark'] || './benchmark_results.json';
const GAS_PATH      = args['--gas']       || './gas_results.json';
const OUT_PATH      = args['--out']       || './evaluation_report.json';

// LANL base date: their timestamps are seconds since 1 Jan 2009 00:00:00 UTC
const LANL_EPOCH_MS = new Date('2009-01-01T00:00:00Z').getTime();
// Our batch JSON timestamps use: new Date('2024-01-01T00:00:00Z').getTime() + lanlTime*1000
const BATCH_EPOCH_MS = new Date('2024-01-01T00:00:00Z').getTime();

// ── Load redteam.txt.gz into a set of events ──────────────────────────────────
// Format: time,user@domain,src_computer,dst_computer
async function loadRedteam(filePath) {
    const events = [];
    const seen   = new Set();

    if (!fs.existsSync(filePath)) {
        console.warn(`⚠ redteam.txt.gz not found at ${filePath} — all batches will be TN/FP`);
        return events;
    }

    const rl = readline.createInterface({
        input: fs.createReadStream(filePath).pipe(zlib.createGunzip()),
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        if (!line.trim()) continue;
        const parts = line.trim().split(',');
        if (parts.length < 4) continue;
        const [timeStr, user, srcComputer, dstComputer] = parts;
        const lanlTime = parseInt(timeStr, 10);
        if (isNaN(lanlTime)) continue;

        // Convert to the same timestamp space used in batch JSONs
        const batchMs = BATCH_EPOCH_MS + lanlTime * 1000;

        const key = `${user}|${srcComputer}|${dstComputer}`;
        events.push({ lanlTime, batchMs, user, srcComputer, dstComputer, key });
        seen.add(key);
    }

    console.log(`✓ Loaded ${events.length} redteam events (${seen.size} unique user+src+dst combos)`);
    return events;
}

// ── Check if a batch contains any redteam event ───────────────────────────────
// Match strategy: user (src_user in batch) + src_computer (ip field) +
// time within ±WINDOW_SEC of any redteam event for that user+computer pair.
const WINDOW_SEC = 300; // 5-minute window

function batchContainsRedteamEvent(logs, redteamEvents) {
    // Build a quick lookup: user+srcComputer -> list of lanlTimes
    const rtByUserSrc = {};
    for (const ev of redteamEvents) {
        const k = `${ev.user}|${ev.srcComputer}`;
        if (!rtByUserSrc[k]) rtByUserSrc[k] = [];
        rtByUserSrc[k].push(ev.lanlTime);
    }

    for (const log of logs) {
        const logUser = log.user; // e.g. U748@DOM1
        const logSrc  = log.ip;  // e.g. C17693 (src_computer in LANL)

        const k = `${logUser}|${logSrc}`;
        const rtTimes = rtByUserSrc[k];
        if (!rtTimes) continue;

        // Recover the approximate LANL timestamp from the batch ISO timestamp
        // batch ISO was built as: BATCH_EPOCH_MS + lanlTime*1000
        const batchMs = new Date(log.timestamp).getTime();
        const approxLanlTime = (batchMs - BATCH_EPOCH_MS) / 1000;

        for (const rtTime of rtTimes) {
            if (Math.abs(approxLanlTime - rtTime) <= WINDOW_SEC) {
                return { matched: true, matchedUser: logUser, matchedSrc: logSrc, rtTime };
            }
        }
    }
    return { matched: false };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(' ZKLog — Benchmarking & Redteam Evaluation');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // 1. Load redteam ground truth
    const redteamEvents = await loadRedteam(REDTEAM_PATH);

    // 2. Load verification results
    if (!fs.existsSync(RESULTS_PATH)) {
        console.error(`✗ ${RESULTS_PATH} not found. Run verify_onchain.js first.`);
        process.exit(1);
    }
    const verResults = JSON.parse(fs.readFileSync(RESULTS_PATH));

    // 3. Load benchmark and gas results
    const benchmark = fs.existsSync(BENCHMARK_PATH)
        ? JSON.parse(fs.readFileSync(BENCHMARK_PATH))
        : [];
    const gasResults = fs.existsSync(GAS_PATH)
        ? JSON.parse(fs.readFileSync(GAS_PATH))
        : {};

    // 4. Per-batch evaluation
    let TP = 0, FP = 0, TN = 0, FN = 0;
    const batchDetails = [];

    for (const result of verResults) {
        const batchName = result.batch; // e.g. "batch_1"
        const batchFile = path.join(BATCH_DIR, `${batchName}.json`);

        if (!fs.existsSync(batchFile)) {
            console.warn(`  ⚠ ${batchFile} not found — skipping`);
            continue;
        }

        const logs = JSON.parse(fs.readFileSync(batchFile));

        // System prediction: positive = FAIL on any predicate
        const systemFlags =
            result.count_predicate === 'FAIL' || result.sev_predicate === 'FAIL';

        // Ground truth: does this batch contain a confirmed redteam event?
        const { matched, matchedUser, matchedSrc, rtTime } =
            batchContainsRedteamEvent(logs, redteamEvents);

        let outcome;
        if (systemFlags && matched)   { TP++; outcome = 'TP'; }
        else if (systemFlags && !matched) { FP++; outcome = 'FP'; }
        else if (!systemFlags && matched) { FN++; outcome = 'FN'; }
        else                              { TN++; outcome = 'TN'; }

        // Attach benchmark data for this batch
        const bm = benchmark.find(b => b.batch === batchName) || {};

        batchDetails.push({
            batch:           batchName,
            system_verdict:  systemFlags ? 'FLAGGED' : 'CLEARED',
            count_predicate: result.count_predicate,
            sev_predicate:   result.sev_predicate,
            ground_truth:    matched ? 'CONTAINS_REDTEAM' : 'NO_REDTEAM',
            outcome,
            redteam_match:   matched ? { matchedUser, matchedSrc, rtTime } : null,
            suspicious_logs: logs.filter(l => l.event_code === 1).length,
            max_severity:    Math.max(...logs.map(l => l.severity)),
            avg_severity:    parseFloat((logs.reduce((s,l)=>s+l.severity,0)/logs.length).toFixed(2)),
            count_proof_ms:  bm.proofMs   || null,
            sev_proof_ms:    bm.sevProofMs || null,
        });

        const rtTag = matched ? ` ← contains redteam event (${matchedUser} @ ${matchedSrc})` : '';
        console.log(`  ${batchName}: ${outcome} | system=${systemFlags?'FLAGGED':'CLEARED'} | gt=${matched?'REDTEAM':'CLEAN'}${rtTag}`);
    }

    // 5. Detection metrics
    const precision = TP + FP > 0 ? TP / (TP + FP) : null;
    const recall    = TP + FN > 0 ? TP / (TP + FN) : null;
    const f1        = precision !== null && recall !== null && precision + recall > 0
        ? 2 * precision * recall / (precision + recall) : null;
    const accuracy  = (TP + TN + FP + FN) > 0
        ? (TP + TN) / (TP + TN + FP + FN) : null;
    const fpr       = TN + FP > 0 ? FP / (TN + FP) : null; // false positive rate

    // 6. System performance metrics
    const allProofTimes = batchDetails
        .flatMap(b => [b.count_proof_ms, b.sev_proof_ms])
        .filter(Boolean);
    const avgProofMs = allProofTimes.length
        ? Math.round(allProofTimes.reduce((a,b)=>a+b,0)/allProofTimes.length)
        : null;
    const minProofMs = allProofTimes.length ? Math.min(...allProofTimes) : null;
    const maxProofMs = allProofTimes.length ? Math.max(...allProofTimes) : null;

    // 7. Build and write report
    const report = {
        generated_at:       new Date().toISOString(),
        dataset:            'LANL Comprehensive Multi-Source Cyber Security Dataset (auth.txt.gz)',
        redteam_events:     redteamEvents.length,
        batches_evaluated:  batchDetails.length,

        confusion_matrix:   { TP, FP, TN, FN },

        detection_metrics: {
            precision:  precision  !== null ? parseFloat(precision.toFixed(4))  : 'N/A (no flagged batches)',
            recall:     recall     !== null ? parseFloat(recall.toFixed(4))     : 'N/A (no redteam batches)',
            f1_score:   f1         !== null ? parseFloat(f1.toFixed(4))         : 'N/A',
            accuracy:   accuracy   !== null ? parseFloat(accuracy.toFixed(4))   : 'N/A',
            fpr:        fpr        !== null ? parseFloat(fpr.toFixed(4))        : 'N/A',
        },

        interpretation: {
            TP: 'System flagged batch AND it contained a confirmed redteam event',
            FP: 'System flagged batch BUT no redteam event found (may still be suspicious — redteam is sparse)',
            TN: 'System cleared batch AND no redteam event found',
            FN: 'System cleared batch BUT it contained a redteam event (missed attack)',
        },

        system_performance: {
            avg_proof_ms:        avgProofMs,
            min_proof_ms:        minProofMs,
            max_proof_ms:        maxProofMs,
            proof_circuits:      2,
            anchor_gas:          gasResults.anchorRootGas      ? parseInt(gasResults.anchorRootGas)      : null,
            verify_gas_per_proof:gasResults.verifyProofGas     ? parseInt(gasResults.verifyProofGas)     : null,
            verify_gas_per_batch:gasResults.verifyProofGas     ? parseInt(gasResults.verifyProofGas) * 2 : null,
        },

        note_on_low_tp: redteamEvents.length > 0
            ? 'LANL redteam events cover ~0.00007% of all auth events. Low TP count is expected — not a system failure. Precision and FPR are the meaningful metrics here.'
            : 'redteam.txt.gz not found — ground truth unavailable. Only system performance metrics are valid.',

        batch_details: batchDetails,
    };

    fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));

    // 8. Print summary table
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(' CONFUSION MATRIX');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  TP (caught real attack)    : ${TP}`);
    console.log(`  FP (false alarm)           : ${FP}`);
    console.log(`  TN (correctly cleared)     : ${TN}`);
    console.log(`  FN (missed attack)         : ${FN}`);
    console.log('\n DETECTION METRICS');
    console.log(`  Precision                  : ${precision !== null ? (precision*100).toFixed(1)+'%' : 'N/A'}`);
    console.log(`  Recall                     : ${recall !== null ? (recall*100).toFixed(1)+'%' : 'N/A'}`);
    console.log(`  F1 Score                   : ${f1 !== null ? f1.toFixed(4) : 'N/A'}`);
    console.log(`  Accuracy                   : ${accuracy !== null ? (accuracy*100).toFixed(1)+'%' : 'N/A'}`);
    console.log(`  False Positive Rate        : ${fpr !== null ? (fpr*100).toFixed(1)+'%' : 'N/A'}`);
    console.log('\n SYSTEM PERFORMANCE');
    console.log(`  Avg proof time (per circuit): ${avgProofMs !== null ? avgProofMs+'ms' : 'N/A'}`);
    console.log(`  Min / Max proof time        : ${minProofMs}ms / ${maxProofMs}ms`);
    console.log(`  Circuits per batch          : 2 (count predicate + severity predicate)`);
    console.log(`  Gas per anchor              : ${gasResults.anchorRootGas || 'N/A'}`);
    console.log(`  Gas per proof verification  : ${gasResults.verifyProofGas || 'N/A'}`);
    console.log(`  Gas per batch (2 proofs)    : ${gasResults.verifyProofGas ? parseInt(gasResults.verifyProofGas)*2 : 'N/A'}`);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(` Full report → ${OUT_PATH}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (redteamEvents.length > 0 && TP === 0 && FN === 0) {
        console.log('ℹ  No redteam events found in any sampled batch.');
        console.log('   This is statistically expected — redteam events are ~0.00007% of all events.');
        console.log('   Try running with --mode anomalous to increase suspicious-event density.');
        console.log('   Precision and FPR are still valid and reportable metrics.\n');
    }
}

function parseArgs(argv) {
    const result = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--') && i + 1 < argv.length) {
            result[argv[i]] = argv[i + 1];
            i++;
        }
    }
    return result;
}

main().catch(err => {
    console.error('✗ Fatal:', err.message || err);
    process.exit(1);
});
