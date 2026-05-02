/**
 * verifySubmission.js
 * Cryptographic Submission Authenticator
 * Hybrid Blockchain + AI Freelance Escrow Platform
 *
 * Given a milestoneId, proves a submission is authentic by executing
 * a 4-step verification pipeline:
 *
 *   1. Fetch stored hash from EvidenceRegistry on-chain
 *   2. Download the file from IPFS using the stored CID
 *   3. Recompute SHA-256 locally from the downloaded bytes
 *   4. Compare — if they match, the submission is cryptographically proven
 *
 * This can be run by anyone (client, juror, auditor) — it requires no
 * special permissions and produces a signed verification report.
 *
 * CLI Usage:
 *   node verifySubmission.js --milestoneId 42
 *   node verifySubmission.js --milestoneId 42 --saveReport
 *
 * Programmatic Usage:
 *   const { verifySubmission } = require('./verifySubmission');
 *   const report = await verifySubmission(42);
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

const { downloadFile }      = require('./ipfs_service');
const {
  verifyOnChainRecord,
  getSubmissionHistory,
}                           = require('./evidence_recorder');

// ─── ANSI colour helpers ──────────────────────────────────────────────────────
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m',
      B = '\x1b[1m',  X = '\x1b[0m';

function step(n, total, msg) { console.log(`\n${B}${C}[Step ${n}/${total}]${X} ${msg}`); }
function ok(msg)   { console.log(`${G}  ✅  ${msg}${X}`); }
function fail(msg) { console.log(`${R}  ❌  ${msg}${X}`); }
function info(msg) { console.log(`${C}  ℹ   ${X}${msg}`); }

// ─── CORE FUNCTION ────────────────────────────────────────────────────────────

/**
 * Verify a submission is authentic end-to-end.
 *
 * @param {number|string} milestoneId   Milestone to verify
 * @param {object}        [options]
 * @param {boolean}       [options.saveReport=false]
 *   Write a JSON verification report to ./reports/
 * @param {string}        [options.downloadDir]
 *   Directory to save the downloaded IPFS file (default: OS temp)
 *
 * @returns {Promise<VerificationReport>}
 *
 * @typedef {object} VerificationReport
 * @property {string}  milestoneId
 * @property {boolean} isAuthentic           True only if ALL checks pass
 * @property {object}  chainRecord           Data fetched from EvidenceRegistry
 * @property {object}  ipfsDownload          Downloaded file info
 * @property {object}  hashComparison        The core hash check
 * @property {Array}   auditTrail            Full event history from chain
 * @property {string}  verifiedAt            ISO 8601
 * @property {string}  verdict               Human-readable conclusion
 */
async function verifySubmission(milestoneId, options = {}) {
  const { saveReport = false, downloadDir = os.tmpdir() } = options;
  const TOTAL_STEPS = 4;

  console.log(`\n${B}${'═'.repeat(56)}${X}`);
  console.log(`${B}  Submission Verification — Milestone ${milestoneId}${X}`);
  console.log(`${B}${'═'.repeat(56)}${X}`);

  const startTime = Date.now();
  let isAuthentic = false;
  let chainRecord, ipfsDownload, hashComparison, auditTrail;

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1 — Fetch hash + CID from EvidenceRegistry on-chain
  // ─────────────────────────────────────────────────────────────────────────
  step(1, TOTAL_STEPS, 'Fetching on-chain record from EvidenceRegistry…');

  try {
    const { ethers } = require('ethers');

    const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_RPC_URL);
    const escrow   = new ethers.Contract(
      process.env.ESCROW_CONTRACT_ADDRESS,
      [
        'function getMilestone(uint256 milestoneId) external view returns (tuple(address client, address freelancer, bytes32 milestoneHash, uint256 deadline, uint256 amount, bytes32 evidenceHash, string ipfsCID, uint256 score, string verdict, uint8 state, uint256 createdAt, uint256 fundedAt, uint256 submittedAt, uint256 resolvedAt))',
      ],
      provider
    );

    const milestone = await escrow.getMilestone(milestoneId);

    // state 2 = SUBMITTED (0=CREATED, 1=FUNDED, 2=SUBMITTED, 3=VERIFIED...)
    if (!milestone.ipfsCID || milestone.ipfsCID === '') {
      throw new Error(
        `No submission found for milestone ${milestoneId}. ` +
        `State is ${milestone.state} — work has not been submitted yet.`
      );
    }

    chainRecord = {
      onChainHash:       milestone.evidenceHash.replace(/^0x/, '').toLowerCase(),
      ipfsCID:           milestone.ipfsCID,
      submitter:         milestone.freelancer,
      recordedTimestamp: new Date(Number(milestone.submittedAt) * 1000).toISOString(),
      state:             Number(milestone.state),
    };

    ok(`Record found in EscrowContract`);
    info(`Submitter:   ${chainRecord.submitter}`);
    info(`Submitted:   ${chainRecord.recordedTimestamp}`);
    info(`State:       ${chainRecord.state} (2=SUBMITTED)`);
    info(`On-chain hash: ${chainRecord.onChainHash.slice(0, 16)}…`);
    info(`IPFS CID:    ${chainRecord.ipfsCID}`);
  } catch (err) {
    fail(`Chain fetch failed: ${err.message}`);
    throw err;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2 — Download file from IPFS using stored CID
  // ─────────────────────────────────────────────────────────────────────────
  step(2, TOTAL_STEPS, `Downloading file from IPFS (${chainRecord.ipfsCID})…`);

  const downloadPath = path.join(
    downloadDir,
    `verify_m${milestoneId}_${Date.now()}`
  );

  try {
    const dlResult = await downloadFile(chainRecord.ipfsCID, downloadPath);
    ipfsDownload = {
      filePath:          dlResult.filePath,
      downloadedHash:    dlResult.contentHash,
      downloadTimestamp: dlResult.downloadTimestamp,
    };
    ok(`Downloaded to ${dlResult.filePath}`);
    info(`Downloaded hash: ${ipfsDownload.downloadedHash.slice(0, 16)}…`);
  } catch (err) {
    fail(`IPFS download failed: ${err.message}`);
    throw err;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3 — Recompute SHA-256 from downloaded bytes
  // ─────────────────────────────────────────────────────────────────────────
  step(3, TOTAL_STEPS, 'Recomputing SHA-256 from downloaded file…');

  let recomputedHash;
  try {
    const fileBuffer  = fs.readFileSync(ipfsDownload.filePath);
    recomputedHash    = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    ok(`Recomputed: ${recomputedHash.slice(0, 16)}…`);
  } catch (err) {
    fail(`Hash recompute failed: ${err.message}`);
    throw err;
  } finally {
    // Clean up temp download
    try { fs.unlinkSync(ipfsDownload.filePath); } catch (_) {}
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 4 — Three-way comparison: chain hash = download hash = recomputed hash
  // ─────────────────────────────────────────────────────────────────────────
  step(4, TOTAL_STEPS, 'Comparing hashes (chain ↔ IPFS download ↔ recomputed)…');

  const chainMatchesDownload    = chainRecord.onChainHash    === ipfsDownload.downloadedHash;
  const downloadMatchesRecompute = ipfsDownload.downloadedHash === recomputedHash;
  const chainMatchesRecomputed  = chainRecord.onChainHash    === recomputedHash;

  isAuthentic = chainMatchesDownload && downloadMatchesRecompute && chainMatchesRecomputed;

  hashComparison = {
    onChainHash:           chainRecord.onChainHash,
    downloadedHash:        ipfsDownload.downloadedHash,
    recomputedHash,
    chainMatchesDownload,
    downloadMatchesRecompute,
    chainMatchesRecomputed,
    allMatch:              isAuthentic,
  };

  if (isAuthentic) {
    ok(`All three hashes match — submission is cryptographically authentic`);
  } else {
    fail(`Hash mismatch detected!`);
    if (!chainMatchesDownload)     fail(`Chain hash ≠ Downloaded IPFS hash`);
    if (!downloadMatchesRecompute) fail(`Downloaded hash ≠ Recomputed hash`);
    if (!chainMatchesRecomputed)   fail(`Chain hash ≠ Recomputed hash`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BONUS — Fetch full audit trail from chain event log
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n${B}${C}[Bonus]${X} Fetching full audit trail from event log…`);
  try {
    auditTrail = await getSubmissionHistory(milestoneId);
    info(`${auditTrail.length} EvidenceRegistered event(s) found in chain history`);
  } catch (err) {
    console.warn(`  Could not fetch audit trail: ${err.message}`);
    auditTrail = [];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Build verification report
  // ─────────────────────────────────────────────────────────────────────────
  const elapsed    = ((Date.now() - startTime) / 1000).toFixed(1);
  const verifiedAt = new Date().toISOString();

  const verdict = isAuthentic
    ? `AUTHENTIC — The submission for milestone ${milestoneId} is cryptographically verified. ` +
      `The file on IPFS (CID: ${chainRecord.ipfsCID}) matches the hash permanently recorded ` +
      `on-chain by submitter ${chainRecord.submitter} at ${chainRecord.recordedTimestamp}.`
    : `TAMPERED or INVALID — Hash comparison failed for milestone ${milestoneId}. ` +
      `The file retrieved from IPFS does not match the hash recorded on-chain. ` +
      `This submission should be flagged for dispute resolution.`;

  const report = {
    milestoneId:    String(milestoneId),
    isAuthentic,
    chainRecord,
    ipfsDownload:   { ...ipfsDownload, filePath: undefined },  // don't expose temp path
    hashComparison,
    auditTrail,
    verifiedAt,
    elapsed:        `${elapsed}s`,
    verdict,
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Print summary
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n${B}${'═'.repeat(56)}${X}`);
  const verdictColour = isAuthentic ? G : R;
  console.log(`${B}${verdictColour}  ${isAuthentic ? '✅  AUTHENTIC' : '❌  FAILED'}${X}  (${elapsed}s)`);
  console.log(`${B}${'═'.repeat(56)}${X}`);
  console.log(`\n  ${B}📋 Verification Report:${X}`);
  console.log(`     milestoneId:    ${report.milestoneId}`);
  console.log(`     isAuthentic:    ${report.isAuthentic}`);
  console.log(`     onChainHash:    ${chainRecord.onChainHash}`);
  console.log(`     recomputedHash: ${recomputedHash}`);
  console.log(`     ipfsCID:        ${chainRecord.ipfsCID}`);
  console.log(`     submitter:      ${chainRecord.submitter}`);
  console.log(`     registeredAt:   ${chainRecord.recordedTimestamp}`);
  console.log(`     verifiedAt:     ${verifiedAt}`);
  console.log(`\n  ${B}Verdict:${X}`);
  console.log(`  ${verdictColour}${verdict}${X}`);

  // ─────────────────────────────────────────────────────────────────────────
  // Optionally save JSON report
  // ─────────────────────────────────────────────────────────────────────────
  if (saveReport) {
    const reportsDir = path.join(__dirname, 'reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

    const reportPath = path.join(
      reportsDir,
      `verification_m${milestoneId}_${Date.now()}.json`
    );
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n  📄 Report saved to: ${reportPath}`);
  }

  return report;
}

// ─── CLI ENTRYPOINT ──────────────────────────────────────────────────────────

if (require.main === module) {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')
                  ? argv[i + 1]
                  : true;
      if (!argv[i + 1]?.startsWith('--')) i++;
    }
  }

  const { milestoneId, saveReport } = args;

  if (!milestoneId) {
    console.error(`
Usage:
  node verifySubmission.js --milestoneId <id> [--saveReport]

Examples:
  node verifySubmission.js --milestoneId 42
  node verifySubmission.js --milestoneId 42 --saveReport
`);
    process.exit(1);
  }

  verifySubmission(milestoneId, {
    saveReport: saveReport === true || saveReport === 'true',
  })
    .then(report => {
      process.exit(report.isAuthentic ? 0 : 1);
    })
    .catch(err => {
      console.error(`\n${R}${B}Fatal error:${X}`, err.message);
      process.exit(1);
    });
}

module.exports = { verifySubmission };
