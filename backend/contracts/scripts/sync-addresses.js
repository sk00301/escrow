/**
 * sync-addresses.js
 * ─────────────────
 * Reads deployedAddresses.json (written by deploy.js) and syncs contract
 * addresses to:
 *   1. frontend/contracts/addresses.json   — used by ethers.js in the browser
 *   2. backend/.env                        — used by oracle.js and ai-verification
 *
 * Run after every redeploy if the automatic sync in deploy.js fails:
 *   cd backend/contracts && node scripts/sync-addresses.js
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const fs   = require('fs');
const path = require('path');

const DEPLOYED_FILE      = path.resolve(__dirname, '..', 'deployedAddresses.json');
const FRONTEND_ADDRESSES = path.resolve(__dirname, '..', '..', '..', 'frontend', 'contracts', 'addresses.json');
const BACKEND_ENV        = path.resolve(__dirname, '..', '..', '.env');

// ── 1. Read deployedAddresses.json ────────────────────────────────────────────
if (!fs.existsSync(DEPLOYED_FILE)) {
  console.error(`❌ ${DEPLOYED_FILE} not found.`);
  console.error('   Run `npx hardhat run scripts/deploy.js --network sepolia` first.');
  process.exit(1);
}

const deployed = JSON.parse(fs.readFileSync(DEPLOYED_FILE, 'utf8'));
const addrs    = deployed.contracts ?? deployed;  // support both wrapped and flat formats

console.log('\n🔄  Syncing contract addresses…\n');
console.log('  Source:', DEPLOYED_FILE);
console.log('  Addresses:');
console.log('    EscrowContract   :', addrs.EscrowContract);
console.log('    EvidenceRegistry :', addrs.EvidenceRegistry);
console.log('    DisputeContract  :', addrs.DisputeContract);
console.log('    JuryStaking      :', addrs.JuryStaking);
console.log();

// ── 2. Write frontend/contracts/addresses.json ────────────────────────────────
const frontendPayload = {
  network:          deployed.network   ?? 'sepolia',
  chainId:          deployed.chainId   ?? 11155111,
  deployer:         deployed.deployer  ?? '',
  oracle:           deployed.oracle    ?? '',
  EscrowContract:   addrs.EscrowContract,
  EvidenceRegistry: addrs.EvidenceRegistry,
  DisputeContract:  addrs.DisputeContract,
  JuryStaking:      addrs.JuryStaking,
};

try {
  fs.mkdirSync(path.dirname(FRONTEND_ADDRESSES), { recursive: true });
  fs.writeFileSync(FRONTEND_ADDRESSES, JSON.stringify(frontendPayload, null, 2));
  console.log('✅  Frontend addresses.json written:', FRONTEND_ADDRESSES);
} catch (err) {
  console.error('❌  Could not write frontend addresses:', err.message);
}

// ── 3. Patch backend/.env ─────────────────────────────────────────────────────
if (!fs.existsSync(BACKEND_ENV)) {
  console.warn('⚠️   backend/.env not found — skipping .env patch.');
  console.warn('    Copy backend/.env.example → backend/.env first.');
} else {
  let envContent = fs.readFileSync(BACKEND_ENV, 'utf8');

  const patch = {
    ESCROW_CONTRACT_ADDRESS:   addrs.EscrowContract,
    EVIDENCE_REGISTRY_ADDRESS: addrs.EvidenceRegistry,
    DISPUTE_CONTRACT_ADDRESS:  addrs.DisputeContract,
    JURY_STAKING_ADDRESS:      addrs.JuryStaking,
  };

  for (const [key, val] of Object.entries(patch)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${val}`);
    } else {
      envContent += `\n${key}=${val}`;
    }
  }

  fs.writeFileSync(BACKEND_ENV, envContent);
  console.log('✅  backend/.env updated with new contract addresses');
}

console.log('\n✅  Sync complete. Restart oracle.js and ai-verification for changes to take effect.\n');
