/**
 * oracle.js
 * Phase 4 — Oracle Bridge Service
 * Hybrid Blockchain + AI Freelance Escrow Platform
 *
 * Listens for WorkSubmitted events on EscrowContract, triggers AI
 * verification, signs the result, and posts it back on-chain.
 *
 * Usage:
 *   node oracle.js          — start the oracle service
 *   npm run oracle          — same via npm
 *   pm2 start ecosystem.config.js  — production process manager
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { ethers }  = require('ethers');
const http        = require('http');
const fs          = require('fs');
const path        = require('path');
const https       = require('https');

// ─── 1. LOGGER ────────────────────────────────────────────────────────────────

const LOG_FILE = path.join(__dirname, 'oracle.log');
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

function timestamp() { return new Date().toISOString(); }

const LOG_LEVELS = { INFO: '\x1b[36m', WARN: '\x1b[33m', ERROR: '\x1b[31m', OK: '\x1b[32m', RESET: '\x1b[0m', BOLD: '\x1b[1m' };

function log(level, msg, data = '') {
  const line = `[${timestamp()}] [${level}] ${msg}${data ? ' ' + JSON.stringify(data) : ''}`;
  const coloured = `${LOG_LEVELS[level] || ''}${line}${LOG_LEVELS.RESET}`;
  console.log(coloured);
  logStream.write(line + '\n');
}

const logger = {
  info:  (msg, d) => log('INFO',  msg, d),
  warn:  (msg, d) => log('WARN',  msg, d),
  error: (msg, d) => log('ERROR', msg, d),
  ok:    (msg, d) => log('OK',    msg, d),
};

// ─── 2. CONFIG & VALIDATION ───────────────────────────────────────────────────

const CONFIG = {
  WS_RPC_URL:               process.env.ALCHEMY_WS_URL,
  HTTP_RPC_URL:             process.env.ALCHEMY_RPC_URL,
  ORACLE_PRIVATE_KEY:       process.env.ORACLE_PRIVATE_KEY,
  ESCROW_CONTRACT_ADDRESS:  process.env.ESCROW_CONTRACT_ADDRESS,
  AI_VERIFICATION_URL:      process.env.AI_VERIFICATION_URL || 'http://localhost:8000',
  STATUS_PORT:              parseInt(process.env.ORACLE_STATUS_PORT || '3001'),
  MAX_WS_RETRIES:           5,
  WS_BASE_DELAY_MS:         2000,
  POLL_INTERVAL_MS:         5000,
  POLL_TIMEOUT_MS:          300_000,   // 5 minutes
};

for (const [key, val] of Object.entries({
  ALCHEMY_WS_URL:           CONFIG.WS_RPC_URL,
  ALCHEMY_RPC_URL:          CONFIG.HTTP_RPC_URL,
  ORACLE_PRIVATE_KEY:       CONFIG.ORACLE_PRIVATE_KEY,
  ESCROW_CONTRACT_ADDRESS:  CONFIG.ESCROW_CONTRACT_ADDRESS,
})) {
  if (!val) throw new Error(`[oracle] Missing required env var: ${key}. Check your .env file.`);
}

// ─── 3. ABI ───────────────────────────────────────────────────────────────────

const ESCROW_ABI = [
  // Events
  'event WorkSubmitted(uint256 indexed milestoneId, bytes32 evidenceHash, string ipfsCID)',
  'event VerificationResultPosted(uint256 indexed milestoneId, uint256 score, string verdict)',

  // Read
  'function getMilestone(uint256 milestoneId) external view returns (tuple(address client, address freelancer, bytes32 milestoneHash, uint256 deadline, uint256 amount, bytes32 evidenceHash, string ipfsCID, uint256 score, string verdict, uint8 state, uint256 createdAt, uint256 fundedAt, uint256 submittedAt, uint256 resolvedAt))',
  'function getMilestoneState(uint256 milestoneId) external view returns (uint8)',

  // Write
  'function postVerificationResult(uint256 milestoneId, uint256 score, bytes calldata signature) external',
];

// ─── 4. ORACLE STATE ──────────────────────────────────────────────────────────

const state = {
  running:        false,
  processedCount: 0,
  lastProcessed:  null,
  pendingJobs:    0,
  processedIds:   new Set(),    // prevent double-processing
  wsRetries:      0,
  provider:       null,
  contract:       null,
  signer:         null,
};

// ─── 5. PROVIDER & CONTRACT SETUP ────────────────────────────────────────────

function buildHttpSigner() {
  const provider = new ethers.JsonRpcProvider(CONFIG.HTTP_RPC_URL);
  const signer   = new ethers.Wallet(CONFIG.ORACLE_PRIVATE_KEY, provider);
  return { provider, signer };
}

async function connectWebSocket() {
  logger.info('Connecting WebSocket provider…', { url: CONFIG.WS_RPC_URL.slice(0, 40) + '…' });

  const wsProvider = new ethers.WebSocketProvider(CONFIG.WS_RPC_URL);

  // ethers v6 WebSocketProvider — attach error/close handlers
  wsProvider.websocket.on('error', (err) => {
    logger.error('WebSocket error', { message: err.message });
  });

  wsProvider.websocket.on('close', async (code) => {
    logger.warn(`WebSocket closed (code ${code}) — scheduling reconnect…`);
    state.provider = null;
    state.contract = null;
    await scheduleReconnect();
  });

  // Verify connection
  const network = await wsProvider.getNetwork();
  logger.ok(`WebSocket connected — network: ${network.name} (chainId: ${network.chainId})`);

  state.wsRetries = 0;
  state.provider  = wsProvider;
  state.contract  = new ethers.Contract(
    CONFIG.ESCROW_CONTRACT_ADDRESS,
    ESCROW_ABI,
    wsProvider
  );

  return wsProvider;
}

async function scheduleReconnect() {
  if (state.wsRetries >= CONFIG.MAX_WS_RETRIES) {
    logger.error(`Max WebSocket retries (${CONFIG.MAX_WS_RETRIES}) reached. Oracle stopping.`);
    state.running = false;
    return;
  }

  const delay = CONFIG.WS_BASE_DELAY_MS * Math.pow(2, state.wsRetries);
  state.wsRetries++;
  logger.warn(`Reconnect attempt ${state.wsRetries}/${CONFIG.MAX_WS_RETRIES} in ${delay}ms…`);

  await new Promise(r => setTimeout(r, delay));
  try {
    await connectWebSocket();
    await attachEventListeners();
    logger.ok('Reconnected and event listeners re-attached');
  } catch (err) {
    logger.error('Reconnect failed', { message: err.message });
    await scheduleReconnect();
  }
}

// ─── 6. PART 1 — EVENT LISTENER ──────────────────────────────────────────────

async function attachEventListeners() {
  if (!state.contract) throw new Error('Contract not initialised');

  logger.info('Attaching WorkSubmitted event listener…');

  state.contract.on('WorkSubmitted', async (milestoneId, evidenceHash, ipfsCID, event) => {
    const id = milestoneId.toString();

    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info(`WorkSubmitted event received`, {
      milestoneId:  id,
      evidenceHash: evidenceHash.slice(0, 18) + '…',
      ipfsCID:      ipfsCID.slice(0, 20) + '…',
      block:        event.log?.blockNumber,
      txHash:       event.log?.transactionHash,
    });

    // ── Guard: skip if already processed ────────────────────────────────
    if (state.processedIds.has(id)) {
      logger.warn(`Milestone ${id} already processed — skipping duplicate event`);
      return;
    }

    state.pendingJobs++;
    try {
      await handleSubmission(id, evidenceHash, ipfsCID);
    } catch (err) {
      logger.error(`Unhandled error processing milestone ${id}`, { message: err.message });
    } finally {
      state.pendingJobs--;
    }
  });

  logger.ok(`Listening for WorkSubmitted on ${CONFIG.ESCROW_CONTRACT_ADDRESS}`);
}

// ─── 7. PART 2 — VERIFICATION TRIGGER ────────────────────────────────────────

/**
 * Fetch milestone details then call the AI verification service.
 */
async function handleSubmission(milestoneId, evidenceHash, ipfsCID) {
  logger.info(`[${milestoneId}] Fetching milestone details from contract…`);

  // ── Fetch milestone struct ────────────────────────────────────────────
  let milestone;
  try {
    const { provider } = buildHttpSigner();
    const contract = new ethers.Contract(
      CONFIG.ESCROW_CONTRACT_ADDRESS, ESCROW_ABI, provider
    );
    milestone = await contract.getMilestone(milestoneId);
  } catch (err) {
    logger.error(`[${milestoneId}] Failed to fetch milestone`, { message: err.message });
    return;
  }

  logger.info(`[${milestoneId}] Milestone fetched`, {
    client:     milestone.client,
    freelancer: milestone.freelancer,
    state:      Number(milestone.state),
    amount:     ethers.formatEther(milestone.amount) + ' ETH',
  });

  // ── Build verification request ────────────────────────────────────────
  // Test commands and threshold come from MilestoneDescriptor (Phase 1).
  // For the prototype we use sensible defaults if not available.
  const verificationPayload = {
    milestone_id:         milestoneId,
    submission_type:      'ipfs_cid',
    submission_value:     ipfsCID,
    evidence_hash:        evidenceHash.replace(/^0x/, ''),
    test_commands:        ['pytest', '--tb=short', '-q'],
    acceptance_threshold: 0.75,
    deliverable_type:     'code',
  };

  logger.info(`[${milestoneId}] Calling AI verification service…`, {
    url:     CONFIG.AI_VERIFICATION_URL + '/verify',
    payload: verificationPayload,
  });

  // ── POST to FastAPI /verify ───────────────────────────────────────────
  let jobId;
  try {
    const response = await httpPost(
      `${CONFIG.AI_VERIFICATION_URL}/verify`,
      verificationPayload
    );
    jobId = response.job_id;
    logger.ok(`[${milestoneId}] Verification job started — job_id: ${jobId}`);
  } catch (err) {
    logger.error(`[${milestoneId}] FastAPI service unreachable`, { message: err.message });
    logger.warn(`[${milestoneId}] Retrying with mock result for prototype testing…`);

    // ── Fallback: mock result if AI service is down ────────────────────
    // Remove this block in production — replace with proper retry queue
    const mockResult = buildMockResult(milestoneId, ipfsCID);
    logger.warn(`[${milestoneId}] Using mock result`, mockResult);
    await postResultOnChain(milestoneId, mockResult);
    return;
  }

  // ── Poll GET /result/{job_id} until complete ──────────────────────────
  const result = await pollVerificationResult(milestoneId, jobId);
  if (!result) {
    logger.error(`[${milestoneId}] Verification timed out or failed — skipping`);
    return;
  }

  logger.ok(`[${milestoneId}] Verification complete`, {
    score:   result.score,
    verdict: result.verdict,
  });

  // ── Post result on-chain ──────────────────────────────────────────────
  await postResultOnChain(milestoneId, result);
}

/**
 * Poll GET /result/{job_id} every 5 seconds until COMPLETE or timeout.
 */
async function pollVerificationResult(milestoneId, jobId) {
  const deadline = Date.now() + CONFIG.POLL_TIMEOUT_MS;
  let attempt    = 0;

  logger.info(`[${milestoneId}] Polling result for job ${jobId}…`);

  while (Date.now() < deadline) {
    attempt++;
    await new Promise(r => setTimeout(r, CONFIG.POLL_INTERVAL_MS));

    try {
      const result = await httpGet(`${CONFIG.AI_VERIFICATION_URL}/result/${jobId}`);

      if (result.status === 'COMPLETED') {
        logger.ok(`[${milestoneId}] Job ${jobId} complete after ${attempt} poll(s)`);
        return result;
      }

      if (result.status === 'FAILED') {
        logger.error(`[${milestoneId}] Verification job FAILED`, { reason: result.error });
        return null;
      }

      logger.info(`[${milestoneId}] Poll ${attempt} — status: ${result.status}`);
    } catch (err) {
      logger.warn(`[${milestoneId}] Poll ${attempt} error — ${err.message}`);
    }
  }

  logger.error(`[${milestoneId}] Polling timed out after ${CONFIG.POLL_TIMEOUT_MS / 1000}s`);
  return null;
}

/**
 * Build a mock result for prototype testing when FastAPI is not running.
 */
function buildMockResult(milestoneId, ipfsCID) {
  return {
    status:    'COMPLETED',
    score:     0.82,
    verdict:   'APPROVED',
    breakdown: {
      tests_passed:    4,
      tests_total:     4,
      test_score:      1.0,
      static_analysis: 0.85,
      complexity:      0.76,
    },
    job_id:    `mock_${milestoneId}_${Date.now()}`,
    ipfsCID,
  };
}

// ─── 8. PART 3 — RESULT SIGNING & POSTING ────────────────────────────────────

/**
 * Sign the result and call EscrowContract.postVerificationResult().
 */
async function postResultOnChain(milestoneId, result) {
  logger.info(`[${milestoneId}] Preparing on-chain result post…`);

  // ── Convert score: 0.82 → 82 ─────────────────────────────────────────
  const scoreInt = Math.round(result.score * 100);
  const verdict  = scoreInt >= 75 ? 'APPROVED'
                 : scoreInt >= 45 ? 'DISPUTED'
                 :                  'REJECTED';

  logger.info(`[${milestoneId}] Score: ${result.score} → ${scoreInt}  |  Verdict: ${verdict}`);

  // ── Build resultHash = keccak256(milestoneId + score + verdict) ───────
  const resultHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'uint256', 'string'],
      [milestoneId, scoreInt, verdict]
    )
  );

  // ── Sign with oracle private key ──────────────────────────────────────
  const { signer } = buildHttpSigner();

  logger.info(`[${milestoneId}] Signing result hash with oracle wallet ${signer.address}…`);
  const signature = await signer.signMessage(ethers.getBytes(resultHash));
  logger.info(`[${milestoneId}] Signature: ${signature.slice(0, 20)}…`);

  // ── Build contract instance with signer ──────────────────────────────
  const { signer: txSigner } = buildHttpSigner();
  const escrow = new ethers.Contract(
    CONFIG.ESCROW_CONTRACT_ADDRESS,
    ESCROW_ABI,
    txSigner
  );

  // ── Estimate gas ──────────────────────────────────────────────────────
  let gasLimit;
  try {
    const estimated = await escrow.postVerificationResult.estimateGas(
      milestoneId, scoreInt, signature
    );
    gasLimit = (estimated * 120n) / 100n;
  } catch (err) {
    logger.error(`[${milestoneId}] Gas estimation failed`, { message: err.message });
    logger.error(`[${milestoneId}] This usually means the oracle address is not authorised in EscrowContract`);
    return;
  }

  // ── Send transaction ──────────────────────────────────────────────────
  let tx;
  try {
    tx = await escrow.postVerificationResult(milestoneId, scoreInt, signature, { gasLimit });
    logger.info(`[${milestoneId}] Tx sent: ${tx.hash}`);
  } catch (err) {
    logger.error(`[${milestoneId}] postVerificationResult failed`, { message: err.message });
    return;
  }

  // ── Wait for confirmation ─────────────────────────────────────────────
  const receipt = await tx.wait(1);

  // ── Update oracle state ───────────────────────────────────────────────
  state.processedIds.add(milestoneId.toString());
  state.processedCount++;
  state.lastProcessed = new Date().toISOString();

  logger.ok(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  logger.ok(`[${milestoneId}] Result posted on-chain ✅`);
  logger.ok(`[${milestoneId}] milestoneId:  ${milestoneId}`);
  logger.ok(`[${milestoneId}] score:        ${scoreInt}/100`);
  logger.ok(`[${milestoneId}] verdict:      ${verdict}`);
  logger.ok(`[${milestoneId}] txHash:       ${receipt.hash}`);
  logger.ok(`[${milestoneId}] block:        ${receipt.blockNumber}`);
  logger.ok(`[${milestoneId}] gasUsed:      ${receipt.gasUsed}`);
  logger.ok(`[${milestoneId}] Etherscan: https://sepolia.etherscan.io/tx/${receipt.hash}`);
  logger.ok(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  return {
    milestoneId,
    scoreInt,
    verdict,
    txHash:      receipt.hash,
    blockNumber: receipt.blockNumber,
  };
}

// ─── 9. HTTP HELPERS ──────────────────────────────────────────────────────────

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const json    = JSON.stringify(body);
    const parsed  = new URL(url);
    const proto   = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(json),
      },
    };

    const req = proto.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); }
          catch { resolve(data); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.setTimeout(15_000, () => { req.destroy(); reject(new Error('POST request timed out')); });
    req.on('error', reject);
    req.write(json);
    req.end();
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const proto   = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'GET',
    };

    const req = proto.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); }
          catch { resolve(data); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('GET request timed out')); });
    req.on('error', reject);
    req.end();
  });
}

// ─── 10. PART 4 — STATUS HTTP SERVER ─────────────────────────────────────────

function startStatusServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/oracle/status') {
      const status = {
        running:        state.running,
        processedCount: state.processedCount,
        lastProcessed:  state.lastProcessed,
        pendingJobs:    state.pendingJobs,
        wsRetries:      state.wsRetries,
        processedIds:   Array.from(state.processedIds),
        uptime:         process.uptime().toFixed(0) + 's',
        timestamp:      new Date().toISOString(),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status, null, 2));
    } else if (req.method === 'GET' && req.url === '/oracle/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(CONFIG.STATUS_PORT, () => {
    logger.ok(`Status server listening on http://localhost:${CONFIG.STATUS_PORT}/oracle/status`);
  });

  return server;
}

// ─── 11. GRACEFUL SHUTDOWN ────────────────────────────────────────────────────

function setupShutdownHandlers(statusServer) {
  async function shutdown(signal) {
    logger.warn(`${signal} received — shutting down oracle gracefully…`);
    state.running = false;

    if (state.provider) {
      try {
        await state.provider.destroy();
        logger.info('WebSocket provider closed');
      } catch (_) {}
    }

    statusServer.close(() => {
      logger.info('Status server closed');
      logStream.end();
      process.exit(0);
    });

    // Force exit after 5s if graceful shutdown hangs
    setTimeout(() => process.exit(1), 5000);
  }

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException',  err => logger.error('Uncaught exception',  { message: err.message, stack: err.stack }));
  process.on('unhandledRejection', err => logger.error('Unhandled rejection', { message: String(err) }));
}

// ─── 12. START ────────────────────────────────────────────────────────────────

async function start() {
  logger.info('═══════════════════════════════════════════════════');
  logger.info('  Oracle Bridge Service starting…');
  logger.info('═══════════════════════════════════════════════════');
  logger.info(`  Escrow contract:  ${CONFIG.ESCROW_CONTRACT_ADDRESS}`);
  logger.info(`  AI service:       ${CONFIG.AI_VERIFICATION_URL}`);
  logger.info(`  Status port:      ${CONFIG.STATUS_PORT}`);
  logger.info(`  Log file:         ${LOG_FILE}`);
  logger.info('═══════════════════════════════════════════════════');

  // ── Start status HTTP server ──────────────────────────────────────────
  const statusServer = startStatusServer();
  setupShutdownHandlers(statusServer);

  // ── Connect WebSocket ─────────────────────────────────────────────────
  try {
    await connectWebSocket();
  } catch (err) {
    logger.error('Initial WebSocket connection failed', { message: err.message });
    logger.warn('Retrying…');
    await scheduleReconnect();
    return;
  }

  // ── Attach event listeners ────────────────────────────────────────────
  await attachEventListeners();

  state.running = true;
  logger.ok('Oracle is running. Waiting for WorkSubmitted events…');
  logger.info('Press Ctrl+C to stop  |  curl http://localhost:3001/oracle/status');
}

// ─── ENTRYPOINT ───────────────────────────────────────────────────────────────

if (require.main === module) {
  start().catch(err => {
    logger.error('Fatal startup error', { message: err.message });
    process.exit(1);
  });
}

module.exports = {
  start,
  handleSubmission,   // exported for test-oracle.js
  postResultOnChain,
  buildMockResult,
};
