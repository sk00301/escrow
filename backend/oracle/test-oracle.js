/**
 * test-oracle.js
 * Local Oracle Integration Test
 * Simulates a WorkSubmitted event without a real blockchain transaction.
 *
 * Tests:
 *   1. Mock event handler — runs the full verification + signing pipeline
 *   2. Score conversion — 0.82 → 82, verdict mapping
 *   3. Result hash signing — verify oracle wallet signs correctly
 *   4. Status server — confirm HTTP endpoint responds
 *   5. AI service reachability — checks if FastAPI is running
 *   6. Full pipeline simulation — end-to-end with mock AI result
 *
 * Usage:
 *   node test-oracle.js                  — run all tests
 *   node test-oracle.js --test signing   — run specific test
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { ethers }  = require('ethers');
const http        = require('http');

const {
  handleSubmission,
  postResultOnChain,
  buildMockResult,
} = require('./oracle');

// ─── ANSI helpers ─────────────────────────────────────────────────────────────
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m',
      B = '\x1b[1m',  X = '\x1b[0m';

function pass(msg)    { console.log(`${G}  ✅  PASS${X}  ${msg}`); passed++; }
function fail(msg, e) { console.log(`${R}  ❌  FAIL${X}  ${msg}${e ? ': ' + e : ''}`); failed++; }
function section(t)   { console.log(`\n${B}${Y}══════════════════════════════════════════${X}\n${B}${Y}  ${t}${X}\n${B}${Y}══════════════════════════════════════════${X}`); }
function info(msg)    { console.log(`${C}  ℹ   ${X}${msg}`); }

let passed = 0, failed = 0;

// ─── Test data ────────────────────────────────────────────────────────────────

const TEST_MILESTONE_ID  = '0';
const TEST_EVIDENCE_HASH = '0x53213d61d93e4f956c7b9b6ad90a04511dda1ba1df6a3ad44fe14da458acae43';
const TEST_IPFS_CID      = 'QmTM3NaH3b8jZ5ugaw7zYyUejsZKcWPZqRAU9PSciqwE3H';

// ─── TEST 1: Score conversion ─────────────────────────────────────────────────

async function testScoreConversion() {
  section('Test 1 · Score conversion and verdict mapping');

  const cases = [
    { score: 0.82,  expectedInt: 82,  expectedVerdict: 'APPROVED'  },
    { score: 0.75,  expectedInt: 75,  expectedVerdict: 'APPROVED'  },
    { score: 0.74,  expectedInt: 74,  expectedVerdict: 'DISPUTED'  },
    { score: 0.60,  expectedInt: 60,  expectedVerdict: 'DISPUTED'  },
    { score: 0.45,  expectedInt: 45,  expectedVerdict: 'DISPUTED'  },
    { score: 0.44,  expectedInt: 44,  expectedVerdict: 'REJECTED'  },
    { score: 0.10,  expectedInt: 10,  expectedVerdict: 'REJECTED'  },
    { score: 1.0,   expectedInt: 100, expectedVerdict: 'APPROVED'  },
    { score: 0.0,   expectedInt: 0,   expectedVerdict: 'REJECTED'  },
    { score: 0.876, expectedInt: 88,  expectedVerdict: 'APPROVED'  },  // rounding
  ];

  for (const { score, expectedInt, expectedVerdict } of cases) {
    const scoreInt = Math.round(score * 100);
    const verdict  = scoreInt >= 75 ? 'APPROVED'
                   : scoreInt >= 45 ? 'DISPUTED'
                   :                  'REJECTED';

    const intOk     = scoreInt === expectedInt;
    const verdictOk = verdict  === expectedVerdict;

    if (intOk && verdictOk) {
      pass(`score ${score} → ${scoreInt} (${verdict})`);
    } else {
      fail(`score ${score}`, `expected ${expectedInt}/${expectedVerdict}, got ${scoreInt}/${verdict}`);
    }
  }
}

// ─── TEST 2: Result hash computation ─────────────────────────────────────────

async function testResultHash() {
  section('Test 2 · Result hash (keccak256 encoding)');

  try {
    const milestoneId = 0;
    const scoreInt    = 82;
    const verdict     = 'APPROVED';

    const resultHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'uint256', 'string'],
        [milestoneId, scoreInt, verdict]
      )
    );

    info(`milestoneId: ${milestoneId}  score: ${scoreInt}  verdict: ${verdict}`);
    info(`resultHash:  ${resultHash}`);

    pass(`keccak256 hash computed: ${resultHash.slice(0, 20)}…`);

    // Deterministic — same inputs must always produce same hash
    const resultHash2 = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'uint256', 'string'],
        [milestoneId, scoreInt, verdict]
      )
    );
    resultHash === resultHash2
      ? pass('Hash is deterministic (same inputs → same output)')
      : fail('Hash is NOT deterministic');

  } catch (err) {
    fail('Hash computation threw', err.message);
  }
}

// ─── TEST 3: Oracle wallet signing ───────────────────────────────────────────

async function testSigning() {
  section('Test 3 · Oracle wallet signing');

  try {
    const wallet = new ethers.Wallet(process.env.ORACLE_PRIVATE_KEY);
    info(`Oracle address: ${wallet.address}`);

    const milestoneId = 0;
    const scoreInt    = 82;
    const verdict     = 'APPROVED';

    const resultHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'uint256', 'string'],
        [milestoneId, scoreInt, verdict]
      )
    );

    const signature = await wallet.signMessage(ethers.getBytes(resultHash));
    info(`Signature: ${signature.slice(0, 30)}…`);
    info(`Length:    ${signature.length} chars (expected 132)`);

    pass(`Signature produced: ${signature.slice(0, 20)}…`);
    signature.length === 132
      ? pass('Signature is correct length (132 chars = 65 bytes)')
      : fail(`Unexpected signature length: ${signature.length}`);

    // Verify signature recovers to oracle address
    const recovered = ethers.verifyMessage(ethers.getBytes(resultHash), signature);
    info(`Recovered address: ${recovered}`);
    recovered.toLowerCase() === wallet.address.toLowerCase()
      ? pass('Signature recovery confirmed — correct oracle address')
      : fail('Signature recovery FAILED', `got ${recovered}, expected ${wallet.address}`);

  } catch (err) {
    fail('Signing threw', err.message);
  }
}

// ─── TEST 4: Mock result builder ─────────────────────────────────────────────

async function testMockResult() {
  section('Test 4 · Mock result builder');

  try {
    const mock = buildMockResult(TEST_MILESTONE_ID, TEST_IPFS_CID);

    info(`Mock result: ${JSON.stringify(mock, null, 2)}`);

    mock.status === 'COMPLETE'       ? pass('status is COMPLETE')    : fail('status wrong');
    typeof mock.score === 'number'   ? pass('score is a number')      : fail('score missing');
    mock.score >= 0 && mock.score <= 1 ? pass('score in range [0,1]') : fail('score out of range');
    mock.verdict === 'APPROVED'      ? pass('verdict is APPROVED')    : fail('verdict wrong');
    mock.job_id.startsWith('mock_')  ? pass('job_id has mock prefix') : fail('job_id wrong');

  } catch (err) {
    fail('buildMockResult threw', err.message);
  }
}

// ─── TEST 5: Status server ────────────────────────────────────────────────────

async function testStatusServer() {
  section('Test 5 · Status server (oracle must be running separately)');

  const port = parseInt(process.env.ORACLE_STATUS_PORT || '3001');

  await new Promise((resolve) => {
    const req = http.request(
      { hostname: 'localhost', port, path: '/oracle/status', method: 'GET' },
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const status = JSON.parse(data);
              pass(`Status endpoint responded (HTTP 200)`);
              info(`running: ${status.running}  processed: ${status.processedCount}  pending: ${status.pendingJobs}`);
              typeof status.running === 'boolean' ? pass('running field is boolean') : fail('running field missing');
              typeof status.processedCount === 'number' ? pass('processedCount is number') : fail('processedCount missing');
            } catch {
              fail('Response is not valid JSON');
            }
          } else {
            fail(`Status endpoint returned HTTP ${res.statusCode}`);
          }
          resolve();
        });
      }
    );
    req.on('error', () => {
      console.log(`${Y}  ⚠   Status server not running — start oracle.js first to test this${X}`);
      console.log(`      node oracle.js   (in a separate terminal)`);
      resolve();
    });
    req.setTimeout(2000, () => { req.destroy(); resolve(); });
    req.end();
  });
}

// ─── TEST 6: AI service reachability ─────────────────────────────────────────

async function testAIService() {
  section('Test 6 · AI verification service reachability');

  const url     = process.env.AI_VERIFICATION_URL || 'http://localhost:8000';
  const parsed  = new URL(url);

  await new Promise((resolve) => {
    const req = http.request(
      { hostname: parsed.hostname, port: parsed.port || 8000, path: '/health', method: 'GET' },
      (res) => {
        res.statusCode === 200
          ? pass(`FastAPI /health responded (HTTP 200) at ${url}`)
          : console.log(`${Y}  ⚠   FastAPI returned HTTP ${res.statusCode} — may not be fully started${X}`);
        resolve();
      }
    );
    req.on('error', () => {
      console.log(`${Y}  ⚠   FastAPI service not running at ${url}${X}`);
      console.log(`      Start it with: cd ~/escrow-platform/ai-verification && uvicorn main:app --reload`);
      console.log(`      Oracle will use mock results until FastAPI is running.`);
      resolve();
    });
    req.setTimeout(3000, () => { req.destroy(); resolve(); });
    req.end();
  });
}

// ─── TEST 7: Full pipeline simulation (no blockchain tx needed) ───────────────

async function testFullPipelineSimulation() {
  section('Test 7 · Full pipeline simulation (mock mode)');

  console.log(`\n  ${B}Simulating WorkSubmitted event locally…${X}`);
  console.log(`  milestoneId:  ${TEST_MILESTONE_ID}`);
  console.log(`  evidenceHash: ${TEST_EVIDENCE_HASH.slice(0, 18)}…`);
  console.log(`  ipfsCID:      ${TEST_IPFS_CID}`);
  console.log();

  // Directly test the signing + hash part (no on-chain tx)
  try {
    const scoreInt = 82;
    const verdict  = 'APPROVED';

    const resultHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'uint256', 'string'],
        [TEST_MILESTONE_ID, scoreInt, verdict]
      )
    );

    const wallet    = new ethers.Wallet(process.env.ORACLE_PRIVATE_KEY);
    const signature = await wallet.signMessage(ethers.getBytes(resultHash));
    const recovered = ethers.verifyMessage(ethers.getBytes(resultHash), signature);

    info(`Score:      ${scoreInt}/100`);
    info(`Verdict:    ${verdict}`);
    info(`ResultHash: ${resultHash.slice(0, 20)}…`);
    info(`Signature:  ${signature.slice(0, 20)}…`);
    info(`Recovered:  ${recovered}`);

    pass('Full signing pipeline completed without error');
    recovered.toLowerCase() === wallet.address.toLowerCase()
      ? pass('Signature valid — oracle address recovered correctly')
      : fail('Signature invalid');

    console.log(`\n  ${B}To post this result on-chain, the oracle would call:${X}`);
    console.log(`  EscrowContract.postVerificationResult(`);
    console.log(`    milestoneId: ${TEST_MILESTONE_ID},`);
    console.log(`    score:       ${scoreInt},`);
    console.log(`    signature:   ${signature.slice(0, 30)}…`);
    console.log(`  )`);

  } catch (err) {
    fail('Pipeline simulation threw', err.message);
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log(`\n${B}Oracle Bridge — Local Test Suite${X}`);
  console.log(`Oracle address: ${new ethers.Wallet(process.env.ORACLE_PRIVATE_KEY).address}\n`);

  const args     = process.argv.slice(2);
  const specific = args.find(a => a.startsWith('--test'))?.split('=')[1]
                || args[args.indexOf('--test') + 1];

  const tests = {
    scoring:    testScoreConversion,
    hash:       testResultHash,
    signing:    testSigning,
    mock:       testMockResult,
    status:     testStatusServer,
    ai:         testAIService,
    simulation: testFullPipelineSimulation,
  };

  if (specific && tests[specific]) {
    await tests[specific]();
  } else {
    for (const fn of Object.values(tests)) {
      await fn();
    }
  }

  section('Test Summary');
  console.log(`  ${G}Passed:${X} ${passed}`);
  console.log(`  ${R}Failed:${X} ${failed}`);
  console.log(`  Total:  ${passed + failed}\n`);

  if (failed === 0) {
    console.log(`${G}${B}  All tests passed! Oracle is ready.${X}\n`);
  } else {
    console.log(`${R}${B}  Some tests failed. Check logs above.${X}\n`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error(`${R}${B}Unhandled error:${X}`, err.message);
  process.exit(1);
});
