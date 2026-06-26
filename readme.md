# zklog-integrity

A privacy-preserving blockchain-based log integrity and anomaly verification system.

## What it does

System logs are hashed into Merkle trees and anchored on Ethereum (Sepolia testnet). Zero-knowledge proofs (zk-SNARKs) allow an auditor to verify properties of log batches — such as suspicious event counts or severity thresholds — without ever seeing the underlying log contents.

**The verifier learns only:** ✅ or ❌ + the Merkle root + the threshold.  
**The verifier never sees:** log entries, IPs, users, event types, or counts.
## Project Structure

```
├── circuits/
│   ├── severity_check.circom       # Single entry threshold check
│   ├── count_check.circom          # Batch suspicious event count
│   ├── log_verifier.circom         # Merkle integrity + count predicate (main)
│   └── severity_batch_check.circom # All entries severity threshold + Merkle
├── contracts/
│   ├── LogAnchor.sol               # Stores Merkle roots on-chain
│   └── LogVerifier.sol             # Verifies ZK proofs on-chain (auto-generated)
├── scripts/
│   ├── deploy.js                   # Deploy contracts to Sepolia
│   ├── anchor.js                   # Anchor a single batch root
│   ├── anchor_all.js               # Anchor all batch roots
│   ├── prove_all.js                # Generate proofs for all batches + benchmark
│   ├── verify_onchain.js           # Verify all proofs against on-chain roots
│   └── gas_benchmark.js            # Measure gas costs
├── generate_logs.js                # Generate synthetic log batches
├── build_merkle.js                 # Build Merkle trees from log batches
├── dashboard.html                  # Journey-style demo UI
└── hardhat.config.js               # Hardhat configuration
```
## Tech Stack

- **ZK circuits:** Circom 2.2.3 + snarkjs 0.7.6 (Groth16)
- **Blockchain:** Solidity + Hardhat + Ethereum Sepolia testnet
- **Merkle hashing:** Poseidon hash (circomlib)
- **Trusted setup:** Hermez ceremony ptau (powersOfTau28_hez_final_16)

## Setup

### 1. Install dependencies
```bash
npm install
npm install -g circom snarkjs
```

### 2. Environment variables
Create a `.env` file:
SEPOLIA_URL=your_alchemy_sepolia_url
PRIVATE_KEY=your_wallet_private_key

### 3. Download trusted setup file
The ptau file is too large for GitHub. Download it:
```bash
Invoke-WebRequest -Uri "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_16.ptau" -OutFile "pot16_hez.ptau"
```

### 4. Generate logs
```bash
node generate_logs.js
```

### 5. Build Merkle trees
```bash
node build_merkle.js
```

### 6. Anchor roots on-chain
```bash
npx hardhat run scripts/anchor_all.js --network sepolia
```

### 7. Generate proofs and benchmark
```bash
node scripts/prove_all.js
```

### 8. Verify on-chain
```bash
npx hardhat run scripts/verify_onchain.js --network sepolia
```

## Benchmark Results (batch size = 8 entries)

| Metric | Value |
|--------|-------|
| Witness generation | ~120ms |
| Proof generation | ~1184ms avg |
| Local verification | ~540ms avg |
| Root anchoring gas | 145,191 |
| ZK proof verification gas | 231,374 |
| Privacy overhead | ~60% extra gas |

## Deployed Contracts (Sepolia)

| Contract | Address |
|----------|---------|
| LogAnchor | `0xd2fBd6579f069481CF43ecdB1a91CC74D1aE60f8` |
| LogVerifier | `0xfB0B444EEe2d6C83AE957C6EAfC8b62a4F232934` |

## Team

- **Arnav** — ZK circuits, smart contracts, blockchain pipeline
- **[Teammate]** — Log generation, pipeline integration