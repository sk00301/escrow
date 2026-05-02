/**
 * test-ipfs.js
 * End-to-end integration test for ipfs_service.js
 *
 * What this covers:
 *   1. Pinata authentication check
 *   2. uploadFile()         — upload a local sample file
 *   3. uploadJSON()         — upload a JSON object
 *   4. downloadFile()       — retrieve the file back from IPFS
 *   5. verifyIntegrity()    — compare hashes (should pass)
 *   6. verifyIntegrity()    — tamper test (should fail)
 *   7. buildEvidencePackage() — full end-to-end evidence bundle
 *
 * Run:
 *   node test-ipfs.js
 *
 * Requirements:
 *   .env file with PINATA_API_KEY and PINATA_SECRET set.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const {
  pinata,
  uploadFile,
  uploadJSON,
  downloadFile,
  verifyIntegrity,
  buildEvidencePackage,
} = require('./ipfs_service');

// ─── ANSI colour helpers ──────────────────────────────────────────────────────
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

function pass(msg)  { console.log(`${GREEN}  ✅  PASS${RESET}  ${msg}`); }
function fail(msg)  { console.log(`${RED}  ❌  FAIL${RESET}  ${msg}`); }
function info(msg)  { console.log(`${CYAN}  ℹ   ${RESET}${msg}`); }
function section(t) { console.log(`\n${BOLD}${YELLOW}══════════════════════════════════════════${RESET}`);
                       console.log(`${BOLD}${YELLOW}  ${t}${RESET}`);
                       console.log(`${BOLD}${YELLOW}══════════════════════════════════════════${RESET}`); }

// ─── Sample files ─────────────────────────────────────────────────────────────

const SAMPLE_FILE  = path.join(__dirname, 'sample_submission.py');
const DOWNLOAD_OUT = path.join(__dirname, 'downloads', 'sample_submission_downloaded.py');

/** Create a small Python file to act as a fake freelancer submission */
function createSampleFile() {
  const code = `# Sample freelancer submission
# Milestone: Build a Fibonacci calculator

def fibonacci(n):
    """Return the n-th Fibonacci number (0-indexed)."""
    if n < 0:
        raise ValueError("n must be non-negative")
    if n == 0:
        return 0
    if n == 1:
        return 1
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b

def test_fibonacci():
    assert fibonacci(0) == 0
    assert fibonacci(1) == 1
    assert fibonacci(10) == 55
    assert fibonacci(15) == 610
    print("All tests passed!")

if __name__ == "__main__":
    test_fibonacci()
    print(fibonacci(20))  # 6765
`;
  fs.writeFileSync(SAMPLE_FILE, code, 'utf8');
  info(`Created sample file: ${SAMPLE_FILE}`);
}

// ─── Fake AI verification result ─────────────────────────────────────────────

const MOCK_VERIFICATION_RESULT = {
  milestoneId:   'MILESTONE_42',
  score:         0.87,
  decision:      'APPROVED',
  breakdown: {
    testsPassed:      4,
    testsTotal:       4,
    testScore:        1.0,
    staticAnalysis:   0.85,
    complexity:       0.76,
  },
  analysedAt:    new Date().toISOString(),
  oracleVersion: '1.0.0',
};

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { pass(msg); passed++; }
  else           { fail(msg); failed++; }
}

async function runTests() {
  console.log(`\n${BOLD}IPFS Service — Integration Test Suite${RESET}`);
  console.log(`Pinata Gateway: ${process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud/ipfs'}\n`);

  // ── Test 0: Pinata authentication ─────────────────────────────────────────
  section('Test 0 · Pinata Authentication');
  try {
    const auth = await pinata.testAuthentication();
    assert(auth.authenticated === true, `Pinata auth — message: "${auth.message}"`);
  } catch (err) {
    fail(`Authentication failed: ${err.message}`);
    console.error('  Check your PINATA_API_KEY and PINATA_SECRET in .env');
    process.exit(1);
  }

  // ── Test 1: uploadFile ────────────────────────────────────────────────────
  section('Test 1 · uploadFile()');
  createSampleFile();

  let uploadResult;
  try {
    uploadResult = await uploadFile(SAMPLE_FILE, {
      milestoneId:      'MILESTONE_42',
      submitterAddress: '0xDeadBeef0000000000000000000000000000CAFE',
      deliverableType:  'code',
    });

    info(`CID:           ${uploadResult.ipfsCID}`);
    info(`SHA-256:       ${uploadResult.contentHash}`);
    info(`File size:     ${uploadResult.fileSize} bytes`);
    info(`Uploaded at:   ${uploadResult.uploadTimestamp}`);

    assert(typeof uploadResult.ipfsCID     === 'string' && uploadResult.ipfsCID.length > 0,  'Returns non-empty ipfsCID');
    assert(typeof uploadResult.contentHash === 'string' && uploadResult.contentHash.length === 64, 'Returns 64-char SHA-256 hex');
    assert(uploadResult.fileSize > 0,  'Returns positive fileSize');
    assert(uploadResult.fileName === 'sample_submission.py', 'Returns correct fileName');
  } catch (err) {
    fail(`uploadFile threw: ${err.message}`);
    failed++;
  }

  // ── Test 2: uploadJSON ────────────────────────────────────────────────────
  section('Test 2 · uploadJSON()');
  let jsonResult;
  try {
    jsonResult = await uploadJSON(MOCK_VERIFICATION_RESULT, 'test-verification-result');

    info(`CID:      ${jsonResult.ipfsCID}`);
    info(`SHA-256:  ${jsonResult.contentHash}`);

    assert(typeof jsonResult.ipfsCID     === 'string' && jsonResult.ipfsCID.length > 0,   'Returns non-empty ipfsCID');
    assert(typeof jsonResult.contentHash === 'string' && jsonResult.contentHash.length === 64, 'Returns 64-char SHA-256 hex');
  } catch (err) {
    fail(`uploadJSON threw: ${err.message}`);
    failed++;
  }

  // ── Test 3: downloadFile ──────────────────────────────────────────────────
  section('Test 3 · downloadFile()');
  let downloadResult;
  if (uploadResult) {
    try {
      downloadResult = await downloadFile(uploadResult.ipfsCID, DOWNLOAD_OUT);

      info(`Saved to:   ${downloadResult.filePath}`);
      info(`SHA-256:    ${downloadResult.contentHash}`);

      assert(fs.existsSync(downloadResult.filePath), 'File exists on disk after download');
      assert(downloadResult.contentHash.length === 64, 'Returns 64-char SHA-256 of downloaded file');
      assert(downloadResult.contentHash === uploadResult.contentHash,
             'Downloaded hash matches original upload hash (content identical)');
    } catch (err) {
      fail(`downloadFile threw: ${err.message}`);
      failed++;
    }
  } else {
    info('Skipping downloadFile test — uploadFile failed.');
  }

  // ── Test 4a: verifyIntegrity — should PASS ────────────────────────────────
  section('Test 4a · verifyIntegrity() — valid file');
  if (uploadResult) {
    try {
      const integrity = await verifyIntegrity(uploadResult.ipfsCID, uploadResult.contentHash);

      info(`isValid:      ${integrity.isValid}`);
      info(`computedHash: ${integrity.computedHash.slice(0,16)}…`);
      info(`expectedHash: ${integrity.expectedHash.slice(0,16)}…`);

      assert(integrity.isValid  === true, 'isValid is true for untampered file');
      assert(integrity.match    === true, 'match alias is also true');
      assert(integrity.computedHash === integrity.expectedHash, 'Hashes are equal');
    } catch (err) {
      fail(`verifyIntegrity (valid) threw: ${err.message}`);
      failed++;
    }
  } else {
    info('Skipping verifyIntegrity test — uploadFile failed.');
  }

  // ── Test 4b: verifyIntegrity — should FAIL (wrong expected hash) ──────────
  section('Test 4b · verifyIntegrity() — tampered hash (expect FAIL)');
  if (uploadResult) {
    try {
      const fakeHash  = 'a'.repeat(64);   // deliberately wrong
      const integrity = await verifyIntegrity(uploadResult.ipfsCID, fakeHash);

      info(`isValid: ${integrity.isValid}  (expected false)`);

      assert(integrity.isValid === false, 'isValid is false when expectedHash is wrong');
      assert(integrity.match   === false, 'match is false when expectedHash is wrong');
    } catch (err) {
      fail(`verifyIntegrity (tampered) threw: ${err.message}`);
      failed++;
    }
  }

  // ── Test 5: buildEvidencePackage ──────────────────────────────────────────
  section('Test 5 · buildEvidencePackage()');
  try {
    const pkg = await buildEvidencePackage(
      'MILESTONE_42',
      '0xDeadBeef0000000000000000000000000000CAFE',
      SAMPLE_FILE,
      MOCK_VERIFICATION_RESULT
    );

    info(`Package CID:    ${pkg.packageCID}`);
    info(`Package Hash:   ${pkg.packageHash.slice(0,16)}…`);
    info(`File CID:       ${pkg.fileCID}`);
    info(`File Hash:      ${pkg.fileHash.slice(0,16)}…`);
    info(`MerkleAnchors:  ${JSON.stringify(pkg.merkleAnchors, null, 2)}`);

    assert(typeof pkg.packageCID       === 'string' && pkg.packageCID.length > 0,   'Returns packageCID');
    assert(typeof pkg.packageHash      === 'string' && pkg.packageHash.length === 64,'Returns packageHash (64 chars)');
    assert(typeof pkg.fileCID          === 'string' && pkg.fileCID.length > 0,       'Returns fileCID');
    assert(typeof pkg.fileHash         === 'string' && pkg.fileHash.length === 64,   'Returns fileHash (64 chars)');
    assert(pkg.milestoneId             === 'MILESTONE_42',                            'milestoneId preserved');
    assert(pkg.merkleAnchors.deliverable.cid   === pkg.fileCID,                       'Deliverable CID in merkleAnchors matches fileCID');
    assert(pkg.merkleAnchors.deliverable.hash  === pkg.fileHash,                      'Deliverable hash in merkleAnchors matches fileHash');
    assert(typeof pkg.merkleAnchors.verification.cid === 'string',                    'Verification result has its own CID in merkleAnchors');

    // Print what you'd store on-chain
    console.log(`\n  ${BOLD}📋 On-chain payload (store these in EvidenceRegistry.sol):${RESET}`);
    console.log(`     milestoneId:  ${pkg.milestoneId}`);
    console.log(`     packageCID:   ${pkg.packageCID}    ← pin this to EvidenceRegistry`);
    console.log(`     fileHash:     ${pkg.fileHash}  ← sha256 for integrity check`);
    console.log(`     packageHash:  ${pkg.packageHash}  ← sha256 of entire evidence bundle`);
  } catch (err) {
    fail(`buildEvidencePackage threw: ${err.message}`);
    console.error(err);
    failed++;
  }

  // ── Test 6: Error handling — file not found ───────────────────────────────
  section('Test 6 · Error Handling — file not found');
  try {
    await uploadFile('/nonexistent/path/file.zip', { milestoneId: 'X' });
    fail('Should have thrown for missing file');
    failed++;
  } catch (err) {
    assert(err.message.includes('File not found'), `Throws "File not found" error: "${err.message}"`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  section('Test Summary');
  console.log(`  ${GREEN}Passed:${RESET} ${passed}`);
  console.log(`  ${RED}Failed:${RESET} ${failed}`);
  console.log(`  Total:  ${passed + failed}\n`);

  if (failed === 0) {
    console.log(`${GREEN}${BOLD}  All tests passed! IPFS service is ready.${RESET}\n`);
  } else {
    console.log(`${RED}${BOLD}  Some tests failed. Check logs above.${RESET}\n`);
    process.exitCode = 1;
  }

  // Cleanup
  try { fs.unlinkSync(SAMPLE_FILE); } catch (_) {}
}

runTests().catch(err => {
  console.error(`${RED}${BOLD}Unhandled error:${RESET}`, err);
  process.exit(1);
});
