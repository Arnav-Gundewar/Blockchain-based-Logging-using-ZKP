# zklog-integrity

A privacy-preserving blockchain-based log integrity and anomaly verification system using zero-knowledge proofs.

## What it does

System logs are hashed into Merkle trees and anchored on Ethereum (Sepolia testnet). Zero-knowledge proofs (zk-SNARKs) allow an auditor to verify properties of log batches — such as suspicious event counts or severity thresholds — without ever seeing the underlying log contents.

**The verifier learns only:** ✅ or ❌ + the Merkle root + the threshold.
**The verifier never sees:** log entries, IPs, users, event types, or counts.

## Real-World Applications

This system is useful whenever a verifier needs assurance about logs they are **not allowed to read**:

- **Regulatory audits** — prove to a regulator that an incident was detected and contained within the required timeframe, without handing over your full internal security log
- **Cloud SLA verification** — a cloud provider proves to a customer that no unauthorized access occurred against their tenant, without exposing shared infrastructure logs containing other customers' data
- **Cross-organization security audits** — prove your security posture to a partner or vendor without revealing internal operational details
- **Cyber-insurance claims** — prove to an insurer that a claimed incident matches policy terms, without disclosing the full log archive
- **Healthcare & financial compliance** — prove access-control policies were followed without exposing the underlying patient or transaction records

## Project Structure

```
├── circuits/
│   ├── severity_check.circom       # Single entry threshold check
│   ├── count_check.circom          # Batch suspicious event count
│   ├── log_verifier.circom         # Merkle integrity + count predicate (main)
│   └── severity_batch_check.circom # All entries severity threshold + Merkle
├── contracts/
│   ├── LogAnchor.sol               # Stores Merkle roots on-chain
│   ├── LogVerifier.sol             # Verifies count predicate proofs on-chain
│   └── SeverityVerifier.sol        # Verifies severity predicate proofs on-chain
├── scripts/
│   ├── deploy.js                   # Deploy contracts to Sepolia
│   ├── anchor.js                   # Anchor a single batch root
│   ├── anchor_all.js               # Anchor all batch roots (timestamp-based unique IDs)
│   ├── prove_all.js                # Generate proofs for all batches + benchmark
│   ├── verify_onchain.js           # Verify all proofs against on-chain roots
│   └── gas_benchmark.js            # Measure gas costs
├── generate_logs.js                # Generate synthetic log batches
├── build_merkle.js                 # Build Merkle trees from log batches (auto-detects all batch files)
├── server.js                       # Express server for the dashboard
├── dashboard.html                  # Journey-style demo UI
└── hardhat.config.js               # Hardhat configuration
```

## Tech Stack

- **ZK circuits:** Circom 2.2.3 + snarkjs 0.7.6 (Groth16)
- **Blockchain:** Solidity + Hardhat + Ethereum Sepolia testnet
- **Merkle hashing:** Poseidon hash (circomlib)
- **Trusted setup:** Hermez ceremony ptau (powersOfTau28_hez_final_16)
- **Dashboard backend:** Express.js

## Setup

### 1. Install dependencies
```bash
npm install
npm install -g circom snarkjs
```

### 2. Environment variables
Create a `.env` file:
```
SEPOLIA_URL=your_alchemy_sepolia_url
PRIVATE_KEY=your_wallet_private_key
```

### 3. Download trusted setup file
The ptau file is too large for GitHub (700MB). Download it:

**Windows (PowerShell):**
```bash
Invoke-WebRequest -Uri "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_16.ptau" -OutFile "pot16_hez.ptau"
```

**Mac/Linux:**
```bash
curl -L "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_16.ptau" -o pot16_hez.ptau
```

### 4. Run the dashboard
```bash
node server.js
```
Then open **http://localhost:3000/dashboard.html** in your browser.

The dashboard walks through the full pipeline interactively:
1. Set number of batches and thresholds, then generate logs
2. Build Merkle trees
3. Anchor roots on Sepolia blockchain
4. Generate ZK proofs (two per batch — count predicate + severity predicate)
5. Verify proofs on-chain

### 5. Run pipeline manually (without dashboard)
```bash
node generate_logs.js
node build_merkle.js
npx hardhat run scripts/anchor_all.js --network sepolia
node scripts/prove_all.js
npx hardhat run scripts/verify_onchain.js --network sepolia
```

## Dashboard — Threshold Inputs

On the first screen, you can configure:

- **Count Threshold** — maximum allowed suspicious events per batch (default: 4). A batch fails the count predicate if it contains 4 or more suspicious events.
- **Severity Threshold** — maximum allowed severity level (default: 5). A batch fails the severity predicate if any entry has severity ≥ this value.

Both thresholds are public inputs to the ZK proof — the verifier sees the threshold but never the actual count or individual severity values.

## Benchmark Results (batch size = 8 entries)

| Metric | Value |
|--------|-------|
| Witness generation | ~120ms |
| Proof generation (count) | ~1131ms avg |
| Proof generation (severity) | ~1113ms avg |
| Local verification | ~540ms avg |
| Root anchoring gas | 145,191 |
| ZK proof verification gas | 231,374 |
| Privacy overhead | ~60% extra gas vs plain anchoring |

## Deployed Contracts (Sepolia)

| Contract | Address |
|----------|---------|
| LogAnchor | `0xd2fBd6579f069481CF43ecdB1a91CC74D1aE60f8` |
| LogVerifier (count) | `0xfB0B444EEe2d6C83AE957C6EAfC8b62a4F232934` |
| SeverityBatchVerifier | `0xc521b1604d03c06ef8e08255936f0DB4423Fcd1c` |

## Team

- **Arnav** — ZK circuits, smart contracts, blockchain pipeline, Express server, dashboard
- **[Teammate]** — Log generation, report, presentation
