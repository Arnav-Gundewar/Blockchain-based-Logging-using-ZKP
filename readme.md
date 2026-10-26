# ZKLog Integrity — Blockchain-based Log Verification with Zero-Knowledge Proofs

> Capstone project · Ethereum Sepolia Testnet · Circom 2.2.3 · snarkjs 0.7.6

---

## What This Project Does

ZKLog Integrity is a privacy-preserving security log auditing pipeline. It allows an analyst to prove statements about a batch of system logs — such as "fewer than 4 suspicious events occurred" or "total severity score stayed below 5" — without revealing the raw log contents to a verifier.

The pipeline:
1. Ingests real LANL cybersecurity log data (`auth.txt.gz`) and scores each event using a rule-based severity model (0–9 scale)
2. Builds a Poseidon-hashed Merkle tree over each batch of 8 log entries
3. Anchors the Merkle root on-chain via `LogAnchor.sol` (Sepolia testnet)
4. Generates Groth16 zk-SNARK proofs for two independent predicates per batch
5. Verifies proofs on-chain via auto-generated Solidity verifier contracts

---

## What the Proofs Actually Guarantee

**This system proves predicates about committed log values. It does not prove that source logs are genuine, complete, or unmodified before entering the pipeline.**

Concretely, a valid proof establishes:
- Every log entry in the batch hashes to a leaf in the committed Merkle tree (membership proof)
- The claimed predicate (count < threshold, or cumulative severity < threshold) holds over those committed values
- The prover knew the full pre-image of each leaf (ids, severities, event_codes)

The accurate description of this system is a **tamper-evident prototype**: once data is committed and anchored, the on-chain root cannot be altered without detection, and the ZK proofs cannot be forged. It does not guarantee that the log collector itself is trustworthy or that all relevant events were captured.

---

## Trust Boundary

```
[Log Source] → [preprocess_lanl.js] → [Merkle Tree] → [On-Chain Root] → [ZK Proof]
      ↑
 Trust boundary: pipeline trusts the output of preprocessing.
 Authenticity of collection is outside the ZK guarantee.
```

For a forensic deployment, the collection boundary would need independent controls (e.g., signed log shipping, hardware attestation). This is explicitly out of scope for this prototype.

---

## Two Independent Predicates

### Count Predicate (`log_verifier.circom`)
- Private inputs: `event_codes[8]` (0 or 1), `severities[8]`, `ids[8]`, Merkle paths
- Public inputs: `root`, `threshold`
- Proves: `count_of(event_codes == 1) < threshold`
- Note: `event_code` is prover-supplied and binary-constrained in-circuit. It is committed in the leaf hash alongside severity but is not derived from severity by the circuit. The severity predicate provides an independent bound on cumulative severity.

### Severity Predicate (`severity_batch_check.circom`)
- Proves: `sum_of(severities) < threshold`
- Severity values are committed in the same Merkle tree and verified via the same path proofs

Both predicates are proven per batch. PASS/FAIL outcomes are independent — a batch can pass count but fail severity.

---

## Severity Scoring Model

Rule-based, three-component scheme (range 0–9):

| Component | Source | Range |
|---|---|---|
| Outcome/failure indicator | MITRE ATT&CK T1110 | 0–3 |
| Logon type risk tier | Microsoft Privileged Access Reference | 0–4 |
| Auth type (NTLM vs Kerberos vs Negotiate) | Kent 2015 LANL dataset paper | 0–2 |

Null values (`?` in LANL fields) use pessimistic conditional imputation: unknown fields on suspicious-outcome events get worst-case scores; unknown fields on successful events get 0.

---

## Dataset

**LANL Comprehensive Multi-Source Cybersecurity Dataset** — `auth.txt.gz` (~7.2 GB compressed, ~1.05 billion lines), streamed directly without full decompression via Node.js `zlib`.

Source: Imperial College London mirror (`lanl.ma.ic.ac.uk`)

`redteam.txt.gz` is reserved for TP/FP/TN/FN evaluation only and is never used in scoring or proof generation.

Three preprocessing modes control suspicious-event ratios per batch:

| Mode | Composition | Expected result |
|---|---|---|
| `mixed` | 60% clean + 40% anomalous | Mixed PASS/FAIL |
| `clean` | ~1/8 events suspicious | Count: PASS |
| `anomalous` | ~5/8 events suspicious | Count: FAIL |

---

## Gas Benchmarks (Sepolia)

| Operation | Gas Used |
|---|---|
| `anchorRoot` (LogAnchor.sol) | ~240,000 |
| `verifyProof` (Groth16Verifier) | ~225,000 |
| `verifyProof` (SeverityBatchVerifier) | ~225,000 |

Verification cost is fixed — it reflects the BN254 pairing precompile and cannot be reduced without changing the proving system. Anchor gas was reduced 59% (from ~586K) by removing redundant string storage and replacing a string array with indexed events.

---

## ZK Stack

| Component | Version / Detail |
|---|---|
| Circuit language | Circom 2.2.3 |
| Proving system | Groth16 |
| Proving library | snarkjs 0.7.6 |
| Hash function | Poseidon (circomlib) |
| Elliptic curve | BN254 (for proving/verification) |
| Trusted setup | Hermez ceremony — `powersOfTau28_hez_final_16.ptau` |
| Ethereum signing | secp256k1 (separate from ZK curve) |

**Critical**: The Hermez ceremony ptau file must be used. Locally generated ptau files produce degenerate verification keys (`alphax=1, alphay=2`) and cause on-chain verification to always return false.

---

## Contracts (Sepolia Testnet)

| Contract | Purpose |
|---|---|
| `LogAnchor.sol` | Stores Merkle roots with batch IDs and timestamps |
| `Groth16Verifier.sol` | On-chain count predicate verifier (auto-generated by snarkjs) |
| `SeverityBatchVerifier.sol` | On-chain severity predicate verifier |

Contract addresses and deployment transaction hashes are recorded in `anchored_ids.json` and viewable via `etherscan.html` in the project dashboard.

---

## Project Structure

```
├── circuits/
│   ├── log_verifier.circom          # Count predicate circuit
│   └── severity_batch_check.circom  # Severity predicate circuit
├── contracts/
│   ├── LogAnchor.sol
│   ├── Groth16Verifier.sol
│   └── SeverityBatchVerifier.sol
├── scripts/
│   ├── preprocess_lanl.js           # LANL streaming preprocessor
│   ├── build_merkle.js              # Merkle tree builder
│   ├── prove_all.js                 # Proof generation (all batches)
│   ├── anchor_all.js                # On-chain anchoring
│   ├── verify_onchain.js            # On-chain verification
│   └── deploy_anchor.js             # LogAnchor redeployment
├── server.js                        # Express API + orchestration
├── dashboard.html                   # Main demo dashboard
├── etherscan.html                   # On-chain evidence viewer
├── Review1_Demo/                    # Preserved Review 1 pipeline (NSL-KDD synthetic logs)
└── data/
    └── batches/                     # Generated batch JSON files
```

---

## Known Limitations

- **Source authenticity**: The ZK proofs guarantee properties of committed data, not that the log collection process is trustworthy or complete
- **Event classification**: `event_code` is prover-supplied and binary-constrained; the circuit does not enforce that classification matches severity. The severity predicate provides an independent check.
- **Testnet only**: Deployed on Sepolia. Test ETH has no value; testnet availability and behaviour differ from mainnet.
- **Batch size**: Fixed at 8 events per batch (circuit compiled for n=8, levels=3)
- **Timestamp**: On-chain block timestamp is a chain-recorded timestamp, not a certified time authority
- **No formal audit**: This is an academic prototype. Circuits and contracts have not been independently audited.

---

## Review History

| Review | Pipeline | Dataset |
|---|---|---|
| Review 1 | Preserved in `Review1_Demo/` | NSL-KDD-style synthetic logs |
| Review 2/3 | Current `main` pipeline | LANL `auth.txt.gz` (real data) |

