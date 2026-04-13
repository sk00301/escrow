/**
 * evidence_recorder.js
 * Phase 4 — Blockchain Integration Layer
 * Hybrid Blockchain + AI Freelance Escrow Platform
 *
 * Connects the IPFS layer (ipfs_service.js) to EvidenceRegistry.sol on
 * Ethereum Sepolia testnet. Provides three functions:
 *
 *   recordSubmissionOnChain()  — writes hash + CID to EvidenceRegistry
 *   verifyOnChainRecord()      — cross-checks on-chain hash vs local hash
 *   getSubmissionHistory()     — returns the full EvidenceRegistered event log
 *
 * Usage:
 *   const recorder = require('./evidence_recorder');
 *   const receipt  = await recorder.recordSubmissionOnChain(42, hash, cid, addr);
 */

'use strict';

require('dotenv').config();

const { ethers } = require('ethers');

// ─── 1. ENVIRONMENT & PROVIDER SETUP ─────────────────────────────────────────

const ALCHEMY_RPC_URL             = process.env.ALCHEMY_RPC_URL;
const ORACLE_PRIVATE_KEY          = process.env.ORACLE_PRIVATE_KEY;
const EVIDENCE_REGISTRY_ADDRESS   = process.env.EVIDENCE_REGISTRY_ADDRESS;
const ESCROW_CONTRACT_ADDRESS     = process.env.ESCROW_CONTRACT_ADDRESS;

// Validate required env vars at module load time so failures are loud and early
const REQUIRED_ENV = {
  ALCHEMY_RPC_URL,
  ORACLE_PRIVATE_KEY,
  EVIDENCE_REGISTRY_ADDRESS,
};
for (const [key, val] of Object.entries(REQUIRED_ENV)) {
  if (!val || val.startsWith('0x000000') || val === `your_${key.toLowerCase()}_here`) {
    throw new Error(
      `[evidence_recorder] Missing or placeholder env var: ${key}\n` +
      `  Copy .env.example to .env and fill in your real values.`
    );
  }
}

// ─── 2. ABI DEFINITIONS ───────────────────────────────────────────────────────

/**
 * Minimal ABI — only the functions and events we call.
 * Full ABI is in artifacts/contracts/EvidenceRegistry.sol/EvidenceRegistry.json
 * after running `npx hardhat compile`.
 */
const EVIDENCE_REGISTRY_ABI = [
  // Write
  'function registerEvidence(uint256 milestoneId, bytes32 contentHash, string calldata ipfsCID, address submitter) external',

  // Read
  'function getEvidence(uint256 milestoneId) external view returns (bytes32 contentHash, string memory ipfsCID, address submitter, uint256 timestamp)',
  'function verifyIntegrity(uint256 milestoneId, bytes32 checkHash) external view returns (bool)',
  'function hasEvidence(uint256 milestoneId) external view returns (bool)',

  // Events
  'event EvidenceRegistered(uint256 indexed milestoneId, bytes32 indexed contentHash, string ipfsCID, address indexed submitter, uint256 timestamp)',
];

const ESCROW_CONTRACT_ABI = [
  // submitWork — freelancer calls this (must be in FUNDED state)
  'function submitWork(uint256 milestoneId, bytes32 evidenceHash, string calldata ipfsCID) external',

  // createMilestone — client calls this to set up a job
  'function createMilestone(address freelancer, bytes32 milestoneHash, uint256 deadline) external returns (uint256 milestoneId)',

  // fundMilestone — client sends ETH to lock in escrow
  'function fundMilestone(uint256 milestoneId) external payable',

  // read state
  'function getMilestone(uint256 milestoneId) external view returns (tuple(address client, address freelancer, bytes32 milestoneHash, uint256 deadline, uint256 amount, bytes32 evidenceHash, string ipfsCID, uint256 score, string verdict, uint8 state, uint256 createdAt, uint256 fundedAt, uint256 submittedAt, uint256 resolvedAt))',
  'function getMilestoneState(uint256 milestoneId) external view returns (uint8)',
  'function getTotalMilestones() external view returns (uint256)',

  // oracle posts result
  'function postVerificationResult(uint256 milestoneId, uint256 score, bytes calldata signature) external',

  // Events
  'event WorkSubmitted(uint256 indexed milestoneId, bytes32 evidenceHash, string ipfsCID)',
  'event MilestoneCreated(uint256 indexed milestoneId, address indexed client, address indexed freelancer, bytes32 milestoneHash, uint256 deadline)',
  'event MilestoneFunded(uint256 indexed milestoneId, uint256 amount)',
];

// ─── 3. PROVIDER / SIGNER FACTORY ─────────────────────────────────────────────

/**
 * Build a fresh provider + signer each call so nonce is always current.
 * This avoids stale nonce issues in long-running oracle processes.
 */
function buildSigner() {
  const provider = new ethers.JsonRpcProvider(ALCHEMY_RPC_URL);
  const signer   = new ethers.Wallet(ORACLE_PRIVATE_KEY, provider);
  return { provider, signer };
}

function getEvidenceRegistry(signerOrProvider) {
  return new ethers.Contract(
    EVIDENCE_REGISTRY_ADDRESS,
    EVIDENCE_REGISTRY_ABI,
    signerOrProvider
  );
}

function getEscrowContract(signerOrProvider) {
  if (!ESCROW_CONTRACT_ADDRESS) {
    throw new Error('[evidence_recorder] ESCROW_CONTRACT_ADDRESS is not set in .env');
  }
  return new ethers.Contract(
    ESCROW_CONTRACT_ADDRESS,
    ESCROW_CONTRACT_ABI,
    signerOrProvider
  );
}

// ─── 4. INTERNAL HELPERS ──────────────────────────────────────────────────────

/**
 * Convert a 64-char hex SHA-256 string to bytes32 for Solidity.
 * Input:  "a70e39c00eb5e190…"  (64 hex chars, no 0x prefix)
 * Output: "0xa70e39c00eb5e190…" (bytes32 padded)
 */
function hexToBytes32(hexString) {
  const clean = hexString.replace(/^0x/, '').toLowerCase();
  if (clean.length !== 64) {
    throw new Error(
      `[evidence_recorder] contentHash must be 64 hex chars (SHA-256). Got ${clean.length} chars: ${clean}`
    );
  }
  return '0x' + clean;
}

/**
 * Parse a Solidity revert reason from an ethers error object.
 * Returns a human-readable string for logging.
 */
function parseRevert(err) {
  // ethers v6 puts the reason in err.reason or err.shortMessage
  if (err.reason)       return `Revert: ${err.reason}`;
  if (err.shortMessage) return `Revert: ${err.shortMessage}`;
  if (err.message)      return err.message;
  return String(err);
}

/**
 * Estimate gas with a 20% safety buffer and cap.
 */
async function estimateGasWithBuffer(contractFn, args) {
  try {
    const estimated = await contractFn.estimateGas(...args);
    return (estimated * 120n) / 100n;   // +20%
  } catch (err) {
    // If estimate fails the tx will also fail — surface the reason now
    throw new Error(`[evidence_recorder] Gas estimation failed: ${parseRevert(err)}`);
  }
}

// ─── 5. FUNCTION 1 — recordSubmissionOnChain ─────────────────────────────────

/**
 * Write a submission's SHA-256 hash and IPFS CID to EvidenceRegistry on Sepolia.
 *
 * @param {number|string} milestoneId      Contract milestone ID
 * @param {string}        contentHash      64-char hex SHA-256 (no 0x prefix)
 * @param {string}        ipfsCID          IPFS CID string (e.g. "QmXyz…")
 * @param {string}        submitterAddress Freelancer's Ethereum address
 *
 * @returns {Promise<{
 *   txHash:      string,   // transaction hash
 *   blockNumber: number,
 *   gasUsed:     string,   // as decimal string
 *   timestamp:   string,   // ISO 8601 of the block
 * }>}
 */
async function recordSubmissionOnChain(milestoneId, contentHash, ipfsCID, submitterAddress) {
  console.log(`\n[recordSubmissionOnChain] Recording milestone ${milestoneId} on-chain…`);
  console.log(`  contentHash:  ${contentHash.slice(0, 16)}…`);
  console.log(`  ipfsCID:      ${ipfsCID}`);
  console.log(`  submitter:    ${submitterAddress}`);

  // ── Input validation ──────────────────────────────────────────────────────
  if (!milestoneId && milestoneId !== 0) throw new Error('[recordSubmissionOnChain] milestoneId is required');
  if (!contentHash)       throw new Error('[recordSubmissionOnChain] contentHash is required');
  if (!ipfsCID)           throw new Error('[recordSubmissionOnChain] ipfsCID is required');
  if (!submitterAddress)  throw new Error('[recordSubmissionOnChain] submitterAddress is required');
  if (!ethers.isAddress(submitterAddress)) {
    throw new Error(`[recordSubmissionOnChain] Invalid Ethereum address: ${submitterAddress}`);
  }

  const bytes32Hash = hexToBytes32(contentHash);
  const { provider, signer } = buildSigner();
  const registry = getEvidenceRegistry(signer);

  // ── Check if already registered (avoid wasting gas) ──────────────────────
  const alreadyExists = await registry.hasEvidence(milestoneId);
  if (alreadyExists) {
    throw new Error(
      `[recordSubmissionOnChain] Evidence already registered for milestoneId ${milestoneId}. ` +
      `EvidenceRegistry records are immutable.`
    );
  }

  // ── Estimate gas ──────────────────────────────────────────────────────────
  const gasLimit = await estimateGasWithBuffer(
    registry.registerEvidence,
    [milestoneId, bytes32Hash, ipfsCID, submitterAddress]
  );
  console.log(`  Gas limit (est +20%): ${gasLimit.toString()}`);

  // ── Send transaction ──────────────────────────────────────────────────────
  let tx;
  try {
    tx = await registry.registerEvidence(
      milestoneId,
      bytes32Hash,
      ipfsCID,
      submitterAddress,
      { gasLimit }
    );
    console.log(`  Tx sent: ${tx.hash}`);
  } catch (err) {
    // Common errors: insufficient ETH, network timeout, nonce conflict
    const msg = parseRevert(err);
    if (msg.includes('insufficient funds')) {
      throw new Error(
        `[recordSubmissionOnChain] Insufficient Sepolia ETH in oracle wallet (${signer.address}). ` +
        `Get test ETH from https://sepoliafaucet.com`
      );
    }
    throw new Error(`[recordSubmissionOnChain] Transaction failed: ${msg}`);
  }

  // ── Wait for 1 confirmation ───────────────────────────────────────────────
  console.log(`  Waiting for confirmation…`);
  let receipt;
  try {
    receipt = await tx.wait(1);
  } catch (err) {
    throw new Error(`[recordSubmissionOnChain] Transaction reverted on-chain: ${parseRevert(err)}`);
  }

  // ── Get block timestamp ───────────────────────────────────────────────────
  const block     = await provider.getBlock(receipt.blockNumber);
  const timestamp = new Date(Number(block.timestamp) * 1000).toISOString();

  console.log(`  ✅  Confirmed in block ${receipt.blockNumber}  |  Gas used: ${receipt.gasUsed}`);

  return {
    txHash:      receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed:     receipt.gasUsed.toString(),
    timestamp,
  };
}

// ─── 6. FUNCTION 2 — verifyOnChainRecord ─────────────────────────────────────

/**
 * Fetch the stored hash from EvidenceRegistry and compare it against
 * a locally computed hash. Proves a submission is authentic.
 *
 * @param {number|string} milestoneId  Milestone to verify
 * @param {string}        localHash    64-char hex SHA-256 computed locally
 *
 * @returns {Promise<{
 *   isValid:           boolean,
 *   onChainHash:       string,   // hex string from chain (no 0x)
 *   localHash:         string,   // as provided
 *   recordedTimestamp: string,   // ISO 8601 of when evidence was registered
 *   submitter:         string,   // address stored on-chain
 *   ipfsCID:           string,   // CID stored on-chain
 * }>}
 */
async function verifyOnChainRecord(milestoneId, localHash) {
  console.log(`\n[verifyOnChainRecord] Verifying milestone ${milestoneId}…`);

  const { provider } = buildSigner();
  const registry = getEvidenceRegistry(provider);   // read-only, no signer needed

  // ── Check evidence exists ─────────────────────────────────────────────────
  const exists = await registry.hasEvidence(milestoneId);
  if (!exists) {
    throw new Error(
      `[verifyOnChainRecord] No evidence registered for milestoneId ${milestoneId}`
    );
  }

  // ── Fetch on-chain record ─────────────────────────────────────────────────
  const [onChainBytes32, ipfsCID, submitter, timestampBigInt] =
    await registry.getEvidence(milestoneId);

  // Convert bytes32 → 64-char hex (strip 0x prefix)
  const onChainHash = onChainBytes32.replace(/^0x/, '').toLowerCase();
  const cleanLocal  = localHash.replace(/^0x/, '').toLowerCase();

  const isValid = onChainHash === cleanLocal;
  const recordedTimestamp = new Date(Number(timestampBigInt) * 1000).toISOString();

  if (isValid) {
    console.log(`  ✅  Hashes match — submission is authentic`);
  } else {
    console.warn(`  ❌  Hash mismatch!`);
    console.warn(`     On-chain: ${onChainHash}`);
    console.warn(`     Local:    ${cleanLocal}`);
  }

  return {
    isValid,
    onChainHash,
    localHash:         cleanLocal,
    recordedTimestamp,
    submitter,
    ipfsCID,
  };
}

// ─── 7. FUNCTION 3 — getSubmissionHistory ────────────────────────────────────

/**
 * Fetch all EvidenceRegistered events for a milestoneId from chain history.
 * Returns the full audit trail — useful for dispute resolution.
 *
 * @param {number|string} milestoneId  Milestone to query
 * @param {number}        [fromBlock]  Start block (default: 0 — full history)
 *
 * @returns {Promise<Array<{
 *   milestoneId:  string,
 *   contentHash:  string,
 *   ipfsCID:      string,
 *   submitter:    string,
 *   blockNumber:  number,
 *   txHash:       string,
 *   timestamp:    string,   // ISO 8601 of block
 * }>>}
 */
async function getSubmissionHistory(milestoneId, fromBlock = 0) {
  console.log(`\n[getSubmissionHistory] Fetching history for milestone ${milestoneId}…`);

  const { provider } = buildSigner();
  const registry = getEvidenceRegistry(provider);

  // ── Build event filter ────────────────────────────────────────────────────
  const filter = registry.filters.EvidenceRegistered(milestoneId);

  let events;
  try {
    events = await registry.queryFilter(filter, fromBlock, 'latest');
  } catch (err) {
    throw new Error(`[getSubmissionHistory] Event query failed: ${parseRevert(err)}`);
  }

  if (events.length === 0) {
    console.log(`  No EvidenceRegistered events found for milestone ${milestoneId}`);
    return [];
  }

  // ── Enrich with block timestamps ──────────────────────────────────────────
  const history = await Promise.all(
    events.map(async (evt) => {
      const block = await provider.getBlock(evt.blockNumber);
      return {
        milestoneId:  evt.args.milestoneId.toString(),
        contentHash:  evt.args.contentHash.replace(/^0x/, ''),
        ipfsCID:      evt.args.ipfsCID,
        submitter:    evt.args.submitter,
        blockNumber:  evt.blockNumber,
        txHash:       evt.transactionHash,
        timestamp:    new Date(Number(block.timestamp) * 1000).toISOString(),
      };
    })
  );

  console.log(`  Found ${history.length} submission event(s) for milestone ${milestoneId}`);
  return history;
}

// ─── 8. BONUS — recordEscrowSubmission ───────────────────────────────────────

/**
 * Call EscrowContract.submitWork() after evidence is already registered.
 * This is a separate step — EscrowContract triggers its own state machine.
 *
 * @param {number|string} milestoneId
 * @param {string}        contentHash  64-char hex SHA-256
 * @param {string}        ipfsCID
 *
 * @returns {Promise<{ txHash: string, blockNumber: number, gasUsed: string }>}
 */
async function recordEscrowSubmission(milestoneId, contentHash, ipfsCID) {
  console.log(`\n[recordEscrowSubmission] Calling EscrowContract.submitWork() for milestone ${milestoneId}…`);

  const bytes32Hash      = hexToBytes32(contentHash);
  const { signer }       = buildSigner();
  const escrow           = getEscrowContract(signer);

  const gasLimit = await estimateGasWithBuffer(
    escrow.submitWork,
    [milestoneId, bytes32Hash, ipfsCID]
  );

  let tx;
  try {
    tx = await escrow.submitWork(milestoneId, bytes32Hash, ipfsCID, { gasLimit });
    console.log(`  Tx sent: ${tx.hash}`);
  } catch (err) {
    throw new Error(`[recordEscrowSubmission] submitWork failed: ${parseRevert(err)}`);
  }

  const receipt = await tx.wait(1);
  console.log(`  ✅  EscrowContract.submitWork() confirmed in block ${receipt.blockNumber}`);

  return {
    txHash:      receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed:     receipt.gasUsed.toString(),
  };
}

// ─── 9. EXPORTS ──────────────────────────────────────────────────────────────

module.exports = {
  recordSubmissionOnChain,
  verifyOnChainRecord,
  getSubmissionHistory,
  recordEscrowSubmission,
  // Exposed for testing / oracle use
  hexToBytes32,
  EVIDENCE_REGISTRY_ABI,
  ESCROW_CONTRACT_ABI,
};
