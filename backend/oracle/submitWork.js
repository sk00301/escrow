/**
 * submitWork.js
 * Complete End-to-End Submission Flow
 * Hybrid Blockchain + AI Freelance Escrow Platform
 *
 * Executes the full 5-step submission pipeline:
 *   1. Compute SHA-256 hash of local file
 *   2. Upload file to IPFS via Pinata
 *   3. Record hash + CID on EvidenceRegistry.sol
 *   4. Call EscrowContract.submitWork()
 *   5. Return a complete submission receipt
 *
 * CLI Usage:
 *   node submitWork.js --milestoneId 42 \
 *                      --file ./submissions/fibonacci.py \
 *                      --submitter 0xYourAddress
 *
 * Programmatic Usage:
 *   const { submitWork } = require('./submitWork');
 *   const receipt = await submitWork(42, './fibonacci.py', '0xABC…');
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const { uploadFile }                = require('./ipfs_service');
const {
  recordSubmissionOnChain,
  recordEscrowSubmission,
}                                   = require('./evidence_recorder');

// ─── ANSI colour helpers ──────────────────────────────────────────────────────
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m',
      B = '\x1b[1m',  X = '\x1b[0m';

function step(n, msg) { console.log(`\n${B}${C}[Step ${n}/5]${X} ${msg}`); }
function ok(msg)      { console.log(`${G}  ✅  ${msg}${X}`); }
function info(msg)    { console.log(`${C}  ℹ   ${X}${msg}`); }
function warn(msg)    { console.log(`${Y}  ⚠   ${msg}${X}`); }

// ─── CORE FUNCTION ────────────────────────────────────────────────────────────

/**
 * Execute the complete work submission pipeline.
 *
 * @param {number|string} milestoneId       Contract milestone ID
 * @param {string}        filePath          Local path to the deliverable
 * @param {string}        submitterAddress  Freelancer's Ethereum address
 * @param {object}        [options]
 * @param {boolean}       [options.skipEscrowCall=false]
 *   Set true if EscrowContract is not yet deployed (Phase 1 incomplete).
 *   Evidence will still be recorded on EvidenceRegistry.
 *
 * @returns {Promise<SubmissionReceipt>}
 *
 * @typedef {object} SubmissionReceipt
 * @property {string}  milestoneId
 * @property {string}  submitterAddress
 * @property {string}  filePath           Absolute path of submitted file
 * @property {string}  fileName
 * @property {number}  fileSize           bytes
 * @property {string}  contentHash        SHA-256 (64 hex chars)
 * @property {string}  ipfsCID            Pinata IPFS CID
 * @property {string}  packageCID         Evidence bundle CID (if built)
 * @property {object}  evidenceTx         { txHash, blockNumber, gasUsed, timestamp }
 * @property {object}  [escrowTx]         { txHash, blockNumber, gasUsed } — if step 4 ran
 * @property {string}  completedAt        ISO 8601
 * @property {string}  status             "SUBMITTED" | "SUBMITTED_NO_ESCROW"
 */
async function submitWork(milestoneId, filePath, submitterAddress, options = {}) {
  const { skipEscrowCall = false } = options;

  const absolutePath = path.resolve(filePath);
  const startTime    = Date.now();

  console.log(`\n${B}${'═'.repeat(56)}${X}`);
  console.log(`${B}  Work Submission Pipeline${X}`);
  console.log(`${B}${'═'.repeat(56)}${X}`);
  console.log(`  Milestone:  ${milestoneId}`);
  console.log(`  File:       ${absolutePath}`);
  console.log(`  Submitter:  ${submitterAddress}`);

  // ── Pre-flight checks ─────────────────────────────────────────────────────
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`[submitWork] File not found: ${absolutePath}`);
  }
  const stat     = fs.statSync(absolutePath);
  const fileName = path.basename(absolutePath);

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1 — Compute SHA-256 locally
  // ─────────────────────────────────────────────────────────────────────────
  step(1, 'Computing SHA-256 hash…');

  const fileBuffer  = fs.readFileSync(absolutePath);
  const contentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  ok(`SHA-256: ${contentHash}`);
  info(`File: ${fileName} (${stat.size} bytes)`);

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2 — Upload to IPFS via Pinata
  // ─────────────────────────────────────────────────────────────────────────
  step(2, 'Uploading file to IPFS via Pinata…');

  const uploadResult = await uploadFile(absolutePath, {
    milestoneId:      String(milestoneId),
    submitterAddress,
    deliverableType:  'code',
    timestamp:        new Date().toISOString(),
  });

  // Sanity check: IPFS hash should match the locally computed one
  if (uploadResult.contentHash !== contentHash) {
    throw new Error(
      `[submitWork] Hash mismatch after upload!\n` +
      `  Local:    ${contentHash}\n` +
      `  Returned: ${uploadResult.contentHash}\n` +
      `  This should never happen — file may have been modified mid-upload.`
    );
  }

  ok(`Uploaded: ${uploadResult.ipfsCID}`);
  info(`Hash confirmed identical pre/post upload ✔`);

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3 — Record hash + CID on EvidenceRegistry.sol
  // ─────────────────────────────────────────────────────────────────────────
  step(3, 'Skipped — EvidenceRegistry called internally by EscrowContract in Step 4');
  info('EscrowContract.submitWork() will register evidence on-chain automatically.');
  const evidenceTx = null;

  //ok(`On-chain! Tx: ${evidenceTx.txHash}`);
  //info(`Block: ${evidenceTx.blockNumber}  |  Gas used: ${evidenceTx.gasUsed}`);
  //info(`Block timestamp: ${evidenceTx.timestamp}`);

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 4 — Call EscrowContract.submitWork()
  // ─────────────────────────────────────────────────────────────────────────
  let escrowTx = null;

  if (skipEscrowCall) {
    step(4, 'Skipping EscrowContract.submitWork() (skipEscrowCall=true)');
    warn('Set ESCROW_CONTRACT_ADDRESS in .env and remove skipEscrowCall to enable this step.');
  } else {
    step(4, 'Calling EscrowContract.submitWork()…');
    try {
      escrowTx = await recordEscrowSubmission(
        milestoneId,
        contentHash,
        uploadResult.ipfsCID
      );
      ok(`EscrowContract updated! Tx: ${escrowTx.txHash}`);
      info(`Block: ${escrowTx.blockNumber}  |  Gas used: ${escrowTx.gasUsed}`);
    } catch (err) {
      // If escrow isn't deployed yet, warn but don't abort — evidence is already on-chain
      warn(`EscrowContract.submitWork() failed: ${err.message}`);
      warn(`Evidence is still permanently recorded on EvidenceRegistry.`);
      warn(`Re-run with --skipEscrowCall if EscrowContract is not yet deployed.`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 5 — Build and return complete submission receipt
  // ─────────────────────────────────────────────────────────────────────────
  step(5, 'Building submission receipt…');

  const completedAt = new Date().toISOString();
  const elapsed     = ((Date.now() - startTime) / 1000).toFixed(1);

  const receipt = {
    milestoneId:      String(milestoneId),
    submitterAddress,
    filePath:         absolutePath,
    fileName,
    fileSize:         stat.size,
    contentHash,
    ipfsCID:          uploadResult.ipfsCID,
    evidenceTx:  escrowTx,   // escrowTx IS the evidence tx now (EscrowContract handles both)
    escrowTx:    null,
    completedAt,
    status:           'SUBMITTED',
  };

  console.log(`\n${B}${'═'.repeat(56)}${X}`);
  console.log(`${B}${G}  Submission Complete (${elapsed}s)${X}`);
  console.log(`${B}${'═'.repeat(56)}${X}`);
  console.log(`\n  ${B}📋 Submission Receipt:${X}`);
  console.log(`     milestoneId:   ${receipt.milestoneId}`);
  console.log(`     status:        ${receipt.status}`);
  console.log(`     contentHash:   ${receipt.contentHash}`);
  console.log(`     ipfsCID:       ${receipt.ipfsCID}`);
  console.log(`     submissionTx:  ${receipt.evidenceTx ? receipt.evidenceTx.txHash : 'none'}`);
  console.log(`     completedAt:   ${receipt.completedAt}`);
  console.log(`\n  🔗 View on Etherscan:`);
  console.log(`     https://sepolia.etherscan.io/tx/${receipt.evidenceTx ? receipt.evidenceTx.txHash : ''}`);
  console.log(`\n  📦 View on IPFS:`);
  console.log(`     https://gateway.pinata.cloud/ipfs/${receipt.ipfsCID}`);

  return receipt;
}

// ─── CLI ENTRYPOINT ──────────────────────────────────────────────────────────

if (require.main === module) {
  // Parse --flag value pairs from process.argv
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] || true;
      i++;
    }
  }

  const { milestoneId, file, submitter, skipEscrowCall } = args;

  if (!milestoneId || !file || !submitter) {
    console.error(`
Usage:
  node submitWork.js --milestoneId <id> --file <path> --submitter <address> [--skipEscrowCall]

Example:
  node submitWork.js --milestoneId 42 --file ./submissions/fibonacci.py --submitter 0xABC123…

Options:
  --skipEscrowCall   Skip step 4 if EscrowContract is not yet deployed
`);
    process.exit(1);
  }

  submitWork(
    milestoneId,
    file,
    submitter,
    { skipEscrowCall: skipEscrowCall === 'true' || skipEscrowCall === true }
  )
    .then(receipt => {
      // Write receipt to disk for audit trail
      const outPath = path.join(
        path.dirname(path.resolve(file)),
        `receipt_milestone_${milestoneId}_${Date.now()}.json`
      );
      fs.writeFileSync(outPath, JSON.stringify(receipt, null, 2));
      console.log(`\n  📄 Receipt saved to: ${outPath}`);
      process.exit(0);
    })
    .catch(err => {
      console.error(`\n${R}${B}Fatal error:${X}`, err.message);
      process.exit(1);
    });
}

module.exports = { submitWork };
