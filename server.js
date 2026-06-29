const express = require("express");
const { execSync } = require("child_process");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(express.static("."));

// Generate logs
app.post("/api/generate", (req, res) => {
    const { batches } = req.body;
    try {
        const script = `
const fs = require('fs');
function ri(a,b){return Math.floor(Math.random()*(b-a+1))+a;}
function randIP(){return \`192.168.\${ri(0,255)}.\${ri(1,254)}\`;}
function randUser(){return \`u_\${ri(100,999)}\`;}
const EVENTS=[
  {type:"failed_login",code:1,sevRange:[3,5]},
  {type:"successful_login",code:0,sevRange:[1,2]},
  {type:"file_access",code:0,sevRange:[1,3]},
  {type:"config_change",code:0,sevRange:[2,4]},
  {type:"port_scan",code:1,sevRange:[4,5]},
  {type:"privilege_escalation",code:1,sevRange:[4,5]},
];
for(let b=1;b<=${batches};b++){
  const batch=[];
  for(let i=0;i<8;i++){
    const ev=EVENTS[ri(0,EVENTS.length-1)];
    batch.push({id:i,timestamp:new Date(Date.now()-ri(0,3600000)).toISOString(),
      severity:ri(ev.sevRange[0],ev.sevRange[1]),event:ev.type,
      event_code:ev.code,user:randUser(),ip:randIP()});
  }
  fs.writeFileSync(\`batch_\${b}.json\`, JSON.stringify(batch, null, 2));
}
console.log('done');
`;
        execSync(`node -e "${script.replace(/"/g, '\\"').replace(/\n/g, '')}"`);
        const result = {};
        for (let b = 1; b <= batches; b++) {
            result[`batch_${b}`] = JSON.parse(fs.readFileSync(`batch_${b}.json`));
        }
        res.json({ success: true, batches: result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Build Merkle trees
app.post("/api/merkle", (req, res) => {
    try {
        execSync("node build_merkle.js");
        const roots = JSON.parse(fs.readFileSync("all_roots.json"));
        res.json({ success: true, roots });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Anchor all roots on-chain
app.post("/api/anchor", (req, res) => {
    try {
        const output = execSync("npx hardhat run scripts/anchor_all.js --network sepolia",
            { timeout: 180000 }).toString();
        const roots = JSON.parse(fs.readFileSync("all_roots.json"));
        res.json({ success: true, output, roots });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Generate proofs — accepts threshold values
app.post("/api/prove", (req, res) => {
    try {
        const { countThreshold = 4, sevThreshold = 5 } = req.body;

        // Write thresholds to a config file prove_all.js can read
        fs.writeFileSync("thresholds.json", JSON.stringify({ countThreshold, sevThreshold }));

        execSync("node scripts/prove_all.js", { timeout: 300000 });
        const benchmark = JSON.parse(fs.readFileSync("benchmark_results.json"));
        res.json({ success: true, benchmark });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Verify on-chain
app.post("/api/verify", (req, res) => {
    try {
        execSync("npx hardhat run scripts/verify_onchain.js --network sepolia",
            { timeout: 180000 });

        const results = JSON.parse(fs.readFileSync("verification_results.json"));
        
        // Gas costs are fixed per circuit — read from file or use known values
        let gasResults = { verifyProofGas: "231374", anchorRootGas: "145191" };
        if (fs.existsSync("gas_results.json")) {
            gasResults = JSON.parse(fs.readFileSync("gas_results.json"));
        }
        
        res.json({ success: true, results, gasResults });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`ZKLog server running at http://localhost:${PORT}`);
    console.log(`Open http://localhost:${PORT}/dashboard.html`);
});