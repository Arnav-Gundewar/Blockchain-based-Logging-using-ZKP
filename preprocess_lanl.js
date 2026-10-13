/**
 * preprocess_lanl.js
 *
 * Reads auth.txt.gz from the LANL Multi-Source Cyber Security Dataset,
 * stratified-samples logs, scores severity, and writes batch JSON files
 * compatible with build_merkle.js.
 *
 * Severity scoring is REDTEAM-BLIND — derived purely from log fields:
 *   Component 1 — Outcome        (0-3)  [MITRE ATT&CK T1110]
 *   Component 2 — Logon Type     (0-4)  [Microsoft Privileged Access Reference]
 *   Component 3 — Auth Type      (0-2)  [NTLM lateral movement research, Kent 2015]
 *   Orientation modifier         (-1 if LogOff, floor 0)
 *
 * Null handling: pessimistic conditional imputation
 *   If known component scores >= SUSPICION_THRESHOLD → unknowns get worst-case
 *   Else → unknowns get 0
 *
 * Usage:
 *   node preprocess_lanl.js [options]
 *
 * Options:
 *   --input    Path to auth.txt.gz   (default: ./auth.txt.gz)
 *   --batches  Number of batches     (default: 5)
 *   --outdir   Output directory      (default: ./)
 *   --seed     Random seed           (default: 42)
 *   --mode     mixed | clean | anomalous  (default: mixed)
 *
 * Modes (thresholds: count=4, severity=5):
 *   mixed     — 60% clean batches (PASS) + 40% anomalous (FAIL) — best for demo
 *   clean     — all batches have 1/8 suspicious → predicates PASS
 *   anomalous — all batches have 5/8 suspicious → predicates FAIL
 *
 * Output:
 *   batch_1.json ... batch_N.json  (matches build_merkle.js naming)
 */

'use strict';

const fs       = require('fs');
const path     = require('path');
const zlib     = require('zlib');
const readline = require('readline');

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args        = parseArgs(process.argv.slice(2));
const INPUT_PATH  = args['--input']   || './auth.txt.gz';
const NUM_BATCHES = parseInt(args['--batches'] || '5', 10);
const OUT_DIR     = args['--outdir']  || './';
const BATCH_SIZE  = 8;
const SEED = parseInt(args['--seed'] || String(Date.now() & 0x7fffffff), 10);
const MODE        = args['--mode']    || 'mixed';

/**
 * Per-batch suspicious ratios.
 * clean     → 1/8  suspicious (severity stays < 5 → PASS both predicates)
 * anomalous → 5/8  suspicious (count >= 4 → FAIL count; max_sev >= 5 → FAIL severity)
 * mixed     → first 60% of batches are clean, rest are anomalous
 */
function getBatchRatios() {
  if (MODE === 'clean')     return Array(NUM_BATCHES).fill(0.125);
  if (MODE === 'anomalous') return Array(NUM_BATCHES).fill(0.625);
  const numClean = Math.ceil(NUM_BATCHES * 0.6);
  return Array(NUM_BATCHES).fill(0).map((_, i) => i < numClean ? 0.125 : 0.625);
}
const BATCH_RATIOS = getBatchRatios();

const SUSPICION_THRESHOLD = 3;

// Pool limits — large enough to avoid duplicates across batches
const MAX_SUSPICIOUS_POOL = NUM_BATCHES * BATCH_SIZE * 50;
const MAX_NORMAL_POOL     = NUM_BATCHES * BATCH_SIZE * 50;

// ─── Severity tables ──────────────────────────────────────────────────────────

const OUTCOME_SCORE = { 'Success': 0, 'Failure': 3 };
const OUTCOME_WORST = 3;

const LOGON_SCORE = {
  'Network':           0,
  'Interactive':       1,
  'Batch':             2,
  'Service':           2,
  'NetworkCleartext':  4,
  'NewCredentials':    4,
  'RemoteInteractive': 4,
};
const LOGON_WORST = 4;

const AUTH_SCORE = {
  'Kerberos':  0,
  'Negotiate': 1,
  'NTLM':      2,
};
const AUTH_WORST = 2;

// ─── Filters ──────────────────────────────────────────────────────────────────

const MACHINE_ACCOUNT_RE = /^C\d+\$@/;
const SYSTEM_USERS = new Set(['SYSTEM', 'LOCAL SERVICE', 'NETWORK SERVICE', 'ANONYMOUS LOGON']);

function shouldFilter(fields) {
  if (MACHINE_ACCOUNT_RE.test(fields.src_user)) return true;
  const dstName = fields.dst_user.split('@')[0];
  if (SYSTEM_USERS.has(dstName)) return true;
  if (fields.src_computer === fields.dst_computer &&
      (fields.logon_type === 'Service' || fields.logon_type === 'Batch')) return true;
  return false;
}

// ─── Suspicious classifier (for pool bucketing only) ──────────────────────────

/**
 * Identifies events that will reliably score severity >= 3 after scoring.
 * Minimum paths to severity >= 3:
 *   Failure alone (3), RemoteInteractive alone (4), NetworkCleartext alone (4),
 *   NTLM + Batch/Service/Interactive/unknown (2+2, 2+2, 2+1, 2+worst)
 */
function isSuspicious(fields) {
  if (fields.outcome === 'Failure') return true;
  if (fields.logon_type === 'RemoteInteractive') return true;
  if (fields.logon_type === 'NetworkCleartext')  return true;
  if (fields.auth_type === 'NTLM' &&
      (fields.logon_type === 'Batch'       ||
       fields.logon_type === 'Service'     ||
       fields.logon_type === 'Interactive' ||
       fields.logon_type === '?')) return true;
  return false;
}

// ─── Severity scoring ─────────────────────────────────────────────────────────

function scoreSeverity(fields) {
  const { outcome, logon_type, auth_type, orientation } = fields;
  const nullFields    = [];
  const imputedFields = {};

  const outcomeKnown = outcome    !== '?' && outcome    in OUTCOME_SCORE;
  const logonKnown   = logon_type !== '?' && logon_type in LOGON_SCORE;
  const authKnown    = auth_type  !== '?' && auth_type  in AUTH_SCORE;

  const knownSum =
    (outcomeKnown ? OUTCOME_SCORE[outcome]   : 0) +
    (logonKnown   ? LOGON_SCORE[logon_type]  : 0) +
    (authKnown    ? AUTH_SCORE[auth_type]    : 0);

  const pessimistic = knownSum >= SUSPICION_THRESHOLD;

  let outcomeScore, logonScore, authScore;

  if (outcomeKnown) {
    outcomeScore = OUTCOME_SCORE[outcome];
  } else {
    nullFields.push('outcome');
    outcomeScore = pessimistic ? OUTCOME_WORST : 0;
    imputedFields.outcome = pessimistic ? 'worst-case' : 'benign';
  }

  if (logonKnown) {
    logonScore = LOGON_SCORE[logon_type];
  } else {
    nullFields.push('logon_type');
    logonScore = pessimistic ? LOGON_WORST : 0;
    imputedFields.logon_type = pessimistic ? 'worst-case' : 'benign';
  }

  if (authKnown) {
    authScore = AUTH_SCORE[auth_type];
  } else {
    nullFields.push('auth_type');
    authScore = pessimistic ? AUTH_WORST : 0;
    imputedFields.auth_type = pessimistic ? 'worst-case' : 'benign';
  }

  const logoffPenalty = orientation === 'LogOff' ? -1 : 0;
  const severity      = Math.max(0, Math.min(9, outcomeScore + logonScore + authScore + logoffPenalty));
  const event_code    = severity >= 3 ? 1 : 0;

  return {
    severity,
    event_code,
    meta: {
      dst_user:     fields.dst_user,
      dst_computer: fields.dst_computer,
      auth_type:    auth_type  === '?' ? null : auth_type,
      logon_type:   logon_type === '?' ? null : logon_type,
      orientation,
      outcome:      outcome    === '?' ? null : outcome,
      score_breakdown: {
        outcome_score:  outcomeScore,
        logon_score:    logonScore,
        auth_score:     authScore,
        logoff_penalty: logoffPenalty,
      },
      null_fields: nullFields,
      imputation:  nullFields.length > 0
                     ? (pessimistic ? 'pessimistic' : 'benign')
                     : 'none',
    }
  };
}

// ─── Event label ──────────────────────────────────────────────────────────────

function eventLabel(fields) {
  const { outcome, logon_type, orientation, auth_type } = fields;
  if (orientation === 'LogOff')  return 'session_logoff';
  if (orientation === 'TGT')     return 'kerberos_tgt_request';
  if (orientation === 'AuthMap') return 'kerberos_service_ticket';
  if (outcome === 'Failure') {
    if (logon_type === 'RemoteInteractive') return 'rdp_auth_failure';
    if (logon_type === 'Network')           return 'network_auth_failure';
    if (auth_type  === 'NTLM')             return 'ntlm_auth_failure';
    return 'auth_failure';
  }
  if (outcome === 'Success') {
    if (logon_type === 'RemoteInteractive') return 'rdp_logon';
    if (logon_type === 'Network')           return 'network_logon';
    if (logon_type === 'Batch')             return 'scheduled_task_logon';
    if (logon_type === 'Service')           return 'service_logon';
    return 'successful_logon';
  }
  if (auth_type === 'NTLM') return 'ntlm_auth_event';
  return 'auth_event';
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseLine(line) {
  const parts = line.trim().split(',');
  if (parts.length !== 9) return null;
  const [time, src_user, dst_user, src_computer, dst_computer,
         auth_type, logon_type, orientation, outcome] = parts;
  if (!time || !src_user || !dst_user) return null;
  return {
    time:         parseInt(time, 10),
    src_user,     dst_user,
    src_computer, dst_computer,
    auth_type:    auth_type   || '?',
    logon_type:   logon_type  || '?',
    orientation:  orientation || '?',
    outcome:      outcome     || '?',
  };
}

// ─── RNG + reservoir sampler ──────────────────────────────────────────────────

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function reservoirSample(arr, k, rng) {
  if (k >= arr.length) return [...arr];
  const result = arr.slice(0, k);
  for (let i = k; i < arr.length; i++) {
    const j = Math.floor(rng() * (i + 1));
    if (j < k) result[j] = arr[i];
  }
  return result;
}

function fisherYates(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' ZKLog — LANL auth.txt.gz Preprocessor');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(` Input   : ${INPUT_PATH}`);
  console.log(` Batches : ${NUM_BATCHES} × ${BATCH_SIZE} logs`);
  console.log(` Mode    : ${MODE}`);
  console.log(` Ratios  : ${BATCH_RATIOS.map((r,i) => `batch_${i+1}=${Math.round(r*BATCH_SIZE)}/8 suspicious`).join(', ')}`);
  console.log(` Output  : ${OUT_DIR}`);
  console.log(` Seed    : ${SEED}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`✗ File not found: ${INPUT_PATH}`);
    process.exit(1);
  }

  const suspiciousPool = [];
  const normalPool     = [];
  let totalLines = 0, filteredOut = 0;

  console.log('⟳ Streaming auth.txt.gz (stops early once pools are full)...\n');

  const fileStream = fs.createReadStream(INPUT_PATH);
  const gunzip     = zlib.createGunzip();
  const rl         = readline.createInterface({ input: fileStream.pipe(gunzip), crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    totalLines++;

    if (suspiciousPool.length >= MAX_SUSPICIOUS_POOL &&
        normalPool.length     >= MAX_NORMAL_POOL) {
      rl.close(); break;
    }

    const fields = parseLine(line);
    if (!fields) continue;
    if (shouldFilter(fields)) { filteredOut++; continue; }

    if (isSuspicious(fields)) {
      if (suspiciousPool.length < MAX_SUSPICIOUS_POOL) suspiciousPool.push(fields);
    } else {
      if (normalPool.length < MAX_NORMAL_POOL) normalPool.push(fields);
    }

    if (totalLines % 1_000_000 === 0) {
      process.stdout.write(
        `  ↳ ${(totalLines/1_000_000).toFixed(0)}M lines | ` +
        `susp: ${suspiciousPool.length}/${MAX_SUSPICIOUS_POOL} | ` +
        `normal: ${normalPool.length}/${MAX_NORMAL_POOL}    \r`
      );
    }
  }

  console.log(`\n✓ Stream complete.`);
  console.log(`  Lines scanned   : ${totalLines.toLocaleString()}`);
  console.log(`  Filtered out    : ${filteredOut.toLocaleString()}`);
  console.log(`  Suspicious pool : ${suspiciousPool.length.toLocaleString()}`);
  console.log(`  Normal pool     : ${normalPool.length.toLocaleString()}\n`);

  if (suspiciousPool.length === 0) {
    console.error('✗ Suspicious pool empty — no failure/NTLM/RDP events found.');
    process.exit(1);
  }

  // Figure out max susp/normal needed across all batches
  const maxSuspPerBatch = Math.max(...BATCH_RATIOS.map(r => Math.round(BATCH_SIZE * r)));
  const maxNormPerBatch = BATCH_SIZE - Math.min(...BATCH_RATIOS.map(r => Math.round(BATCH_SIZE * r)));
  const totalSuspNeeded = BATCH_RATIOS.reduce((s, r) => s + Math.round(BATCH_SIZE * r), 0);
  const totalNormNeeded = BATCH_RATIOS.reduce((s, r) => s + (BATCH_SIZE - Math.round(BATCH_SIZE * r)), 0);

  // Sample unique entries from each pool
  const sampledSusp = reservoirSample(suspiciousPool, Math.min(totalSuspNeeded, suspiciousPool.length), makeRng(SEED ^ 0xabc));
  const sampledNorm = reservoirSample(normalPool,     Math.min(totalNormNeeded, normalPool.length),     makeRng(SEED ^ 0xdef));

  console.log(`⟳ Building ${NUM_BATCHES} batches...\n`);

  const BASE_MS      = new Date('2024-01-01T00:00:00Z').getTime();
  const batchSummary = [];
  let suspOffset = 0, normOffset = 0;

  for (let b = 0; b < NUM_BATCHES; b++) {
    const ratio       = BATCH_RATIOS[b];
    const suspCount   = Math.round(BATCH_SIZE * ratio);
    const normCount   = BATCH_SIZE - suspCount;
    const expectedMode = suspCount >= 4 ? 'ANOMALOUS → FAIL' : 'CLEAN → PASS';

    const suspSlice = sampledSusp.slice(suspOffset, suspOffset + suspCount);
    const normSlice = sampledNorm.slice(normOffset, normOffset + normCount);
    suspOffset += suspCount;
    normOffset += normCount;

    let combined = [...suspSlice, ...normSlice];

    // Pad if short (shouldn't happen with correct pool sizes)
    while (combined.length < BATCH_SIZE && combined.length > 0) {
      combined.push(combined[combined.length - 1]);
    }

    // Shuffle so suspicious events aren't always first
    fisherYates(combined, makeRng(SEED ^ b ^ 0xff));

    const batch = combined.map((fields, idx) => {
      const { severity, event_code, meta } = scoreSeverity(fields);
      return {
        id:        idx,
        timestamp: new Date(BASE_MS + fields.time * 1000).toISOString(),
        severity,
        event:     eventLabel(fields),
        event_code,
        user:      fields.src_user,
        ip:        fields.src_computer,
        meta,
      };
    });

    const filename        = path.join(OUT_DIR, `batch_${b + 1}.json`);
    const suspiciousCount = batch.filter(e => e.event_code === 1).length;
    const maxSeverity     = Math.max(...batch.map(e => e.severity));
    const avgSeverity     = (batch.reduce((s, e) => s + e.severity, 0) / batch.length).toFixed(1);
    const nullCount       = batch.filter(e => e.meta.null_fields.length > 0).length;

    fs.writeFileSync(filename, JSON.stringify(batch, null, 2));
    batchSummary.push({ batch: b + 1, filename, suspiciousCount, maxSeverity, avgSeverity, nullCount, expectedMode });

    console.log(
      `  ✓ batch_${b+1}.json` +
      `  suspicious=${suspiciousCount}/${BATCH_SIZE}` +
      `  max_sev=${maxSeverity}` +
      `  avg_sev=${avgSeverity}` +
      `  nulls=${nullCount}` +
      `  [${expectedMode}]`
    );
  }

  // Summary JSON
  const summaryPath = path.join(OUT_DIR, 'lanl_preprocess_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    generated_at:     new Date().toISOString(),
    input:            INPUT_PATH,
    mode:             MODE,
    lines_scanned:    totalLines,
    filtered_out:     filteredOut,
    suspicious_pool:  suspiciousPool.length,
    normal_pool:      normalPool.length,
    seed:             SEED,
    batch_size:       BATCH_SIZE,
    num_batches:      NUM_BATCHES,
    batches:          batchSummary,
    severity_scheme: {
      basis: [
        'MITRE ATT&CK T1110 (outcome/failure scoring)',
        'Microsoft Privileged Access Reference (logon type risk tiers)',
        'Kent 2015 LANL + NTLM lateral movement research (auth type scoring)',
      ],
      null_handling: 'pessimistic conditional imputation',
      range: '0–9',
    }
  }, null, 2));

  console.log(`\n✓ Summary → ${summaryPath}`);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Done. Next step: node build_merkle.js');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

// ─── Arg parser ───────────────────────────────────────────────────────────────
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

main().catch(err => { console.error('✗ Fatal:', err); process.exit(1); });
