/**
 * ipfs_service.js
 * IPFS Integration Layer — Phase 3
 * Hybrid Blockchain + AI Freelance Escrow Platform
 *
 * Uses Pinata SDK to upload, download, and verify files on IPFS.
 * Provides tamper-evident evidence packaging for milestone deliverables.
 *
 * Usage (Node.js, CommonJS):
 *   const ipfs = require('./ipfs_service');
 *   const result = await ipfs.uploadFile('./submission.zip', { milestoneId: '42', ... });
 */

'use strict';

require('dotenv').config();

const PinataSDK   = require('@pinata/sdk');
const fs          = require('fs');
const path        = require('path');
const crypto      = require('crypto');
const https       = require('https');
const http        = require('http');
const { pipeline } = require('stream/promises');

// ─── 1. CLIENT INITIALISATION ─────────────────────────────────────────────────

const PINATA_API_KEY    = process.env.PINATA_API_KEY;
const PINATA_SECRET     = process.env.PINATA_SECRET;
const PINATA_GATEWAY    = process.env.PINATA_GATEWAY
                          || 'https://gateway.pinata.cloud/ipfs';

if (!PINATA_API_KEY || !PINATA_SECRET) {
  throw new Error(
    '[ipfs_service] PINATA_API_KEY and PINATA_SECRET must be set in environment. ' +
    'Copy .env.example to .env and fill in your Pinata credentials.'
  );
}

/** Configured Pinata client — exported so callers can call pinata.testAuthentication() */
const pinata = new PinataSDK(PINATA_API_KEY, PINATA_SECRET);

// ─── 2. INTERNAL HELPERS ──────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of a Buffer or file path.
 * @param {Buffer|string} input  Buffer of bytes  OR  absolute/relative file path
 * @returns {string}  Hex-encoded SHA-256 digest  (e.g. "a3f0…")
 */
function computeHash(input) {
  const hash = crypto.createHash('sha256');
  if (Buffer.isBuffer(input)) {
    hash.update(input);
  } else {
    // streaming read — works for large files without loading into RAM
    const data = fs.readFileSync(input);   // keep sync for simplicity in prototype
    hash.update(data);
  }
  return hash.digest('hex');
}

/**
 * Build the standard Pinata metadata options object.
 * All values are coerced to strings because Pinata key-value metadata is string-only.
 */
function buildPinataMetadata(name, keyValues = {}) {
  const sanitised = {};
  for (const [k, v] of Object.entries(keyValues)) {
    sanitised[k] = String(v);
  }
  return { pinataMetadata: { name, keyvalues: sanitised } };
}

/**
 * Retry wrapper — retries an async fn up to `maxAttempts` times with exponential back-off.
 */
async function withRetry(fn, maxAttempts = 3, baseDelayMs = 500) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`[ipfs_service] Attempt ${attempt} failed: ${err.message}. Retrying in ${delay}ms…`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// ─── 3. FUNCTION 1 — uploadFile ───────────────────────────────────────────────

/**
 * Upload a local file to IPFS via Pinata.
 *
 * @param {string} filePath   Absolute or relative path to the file
 * @param {object} metadata   { milestoneId, submitterAddress, timestamp, deliverableType }
 * @returns {Promise<{
 *   ipfsCID:         string,   // IPFS Content Identifier (v0 or v1)
 *   contentHash:     string,   // SHA-256 hex of the raw file bytes
 *   fileName:        string,
 *   fileSize:        number,   // bytes
 *   uploadTimestamp: string,   // ISO 8601
 * }>}
 */
async function uploadFile(filePath, metadata = {}) {
  // ── Validate file exists ──────────────────────────────────────────────────
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`[uploadFile] File not found: ${absolutePath}`);
  }

  const stat     = fs.statSync(absolutePath);
  const fileName = path.basename(absolutePath);

  // ── Compute hash BEFORE upload (tamper-evidence anchor) ──────────────────
  console.log(`[uploadFile] Computing SHA-256 for "${fileName}" (${stat.size} bytes)…`);
  const contentHash = computeHash(absolutePath);

  // ── Pinata metadata ───────────────────────────────────────────────────────
  const timestamp = metadata.timestamp || new Date().toISOString();
  const options   = buildPinataMetadata(fileName, {
    milestoneId:      metadata.milestoneId      || '',
    submitterAddress: metadata.submitterAddress || '',
    timestamp,
    deliverableType:  metadata.deliverableType  || 'code',
    sha256:           contentHash,
  });

  // ── Upload with retry ─────────────────────────────────────────────────────
  console.log(`[uploadFile] Uploading to Pinata IPFS…`);
  const readStream = fs.createReadStream(absolutePath);

  const result = await withRetry(
    () => pinata.pinFileToIPFS(readStream, options),
    3
  );

  const uploadTimestamp = new Date().toISOString();

  console.log(`[uploadFile] ✅  CID: ${result.IpfsHash}  |  Hash: ${contentHash.slice(0, 12)}…`);

  return {
    ipfsCID:         result.IpfsHash,
    contentHash,
    fileName,
    fileSize:        stat.size,
    uploadTimestamp,
  };
}

// ─── 4. FUNCTION 2 — uploadJSON ───────────────────────────────────────────────

/**
 * Serialize a JSON object and pin it to IPFS.
 * Used for verification result bundles, evidence manifests, etc.
 *
 * @param {object} jsonObject    Plain JS object — will be JSON-stringified
 * @param {string} name          Human-readable pin name (shown in Pinata dashboard)
 * @returns {Promise<{ ipfsCID: string, contentHash: string }>}
 */
async function uploadJSON(jsonObject, name = 'verification-result') {
  if (typeof jsonObject !== 'object' || jsonObject === null) {
    throw new Error('[uploadJSON] jsonObject must be a non-null object.');
  }

  const jsonString  = JSON.stringify(jsonObject, null, 2);
  const buf         = Buffer.from(jsonString, 'utf8');
  const contentHash = crypto.createHash('sha256').update(buf).digest('hex');

  const options = buildPinataMetadata(name, {
    sha256:    contentHash,
    createdAt: new Date().toISOString(),
  });

  console.log(`[uploadJSON] Uploading JSON "${name}" (${buf.length} bytes)…`);

  const result = await withRetry(
    () => pinata.pinJSONToIPFS(jsonObject, options),
    3
  );

  console.log(`[uploadJSON] ✅  CID: ${result.IpfsHash}`);

  return {
    ipfsCID:     result.IpfsHash,
    contentHash,
  };
}

// ─── 5. FUNCTION 3 — downloadFile ─────────────────────────────────────────────

/**
 * Download a file from IPFS via the Pinata public gateway and save it locally.
 *
 * @param {string} ipfsCID    IPFS Content Identifier (e.g. "Qm…" or "bafy…")
 * @param {string} outputPath Destination file path (created if needed)
 * @returns {Promise<{ filePath: string, contentHash: string, downloadTimestamp: string }>}
 */
async function downloadFile(ipfsCID, outputPath) {
  if (!ipfsCID) throw new Error('[downloadFile] ipfsCID is required.');
  if (!outputPath) throw new Error('[downloadFile] outputPath is required.');

  const absoluteOutput = path.resolve(outputPath);
  const dir = path.dirname(absoluteOutput);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const url = `${PINATA_GATEWAY}/${ipfsCID}`;
  console.log(`[downloadFile] Fetching ${url} …`);

  await withRetry(() => new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file  = fs.createWriteStream(absoluteOutput);

    const req = proto.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // follow redirect
        const redirectUrl = res.headers.location;
        file.close();
        proto.get(redirectUrl, (res2) => {
          res2.pipe(file);
          file.on('finish', () => file.close(resolve));
          file.on('error',  reject);
        }).on('error', reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`[downloadFile] Gateway returned HTTP ${res.statusCode} for CID ${ipfsCID}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    });

    req.setTimeout(30_000, () => {
      req.destroy();
      reject(new Error('[downloadFile] Request timed out after 30 s'));
    });

    req.on('error', reject);
  }), 3);

  // ── Recompute hash of downloaded bytes ────────────────────────────────────
  const contentHash       = computeHash(absoluteOutput);
  const downloadTimestamp = new Date().toISOString();

  console.log(`[downloadFile] ✅  Saved to ${absoluteOutput}  |  Hash: ${contentHash.slice(0,12)}…`);

  return {
    filePath:          absoluteOutput,
    contentHash,
    downloadTimestamp,
  };
}

// ─── 6. FUNCTION 4 — verifyIntegrity ──────────────────────────────────────────

/**
 * Verify a file on IPFS hasn't been tampered with by comparing its
 * SHA-256 hash against an expected value.
 *
 * @param {string} ipfsCID       IPFS CID to fetch
 * @param {string} expectedHash  SHA-256 hex string recorded at upload time
 * @returns {Promise<{
 *   isValid:      boolean,
 *   computedHash: string,
 *   expectedHash: string,
 *   match:        boolean,   // alias for isValid, for convenience
 * }>}
 */
async function verifyIntegrity(ipfsCID, expectedHash) {
  if (!ipfsCID)       throw new Error('[verifyIntegrity] ipfsCID is required.');
  if (!expectedHash)  throw new Error('[verifyIntegrity] expectedHash is required.');

  // Download to a temp file
  const tmpPath = path.join(
    require('os').tmpdir(),
    `ipfs_verify_${ipfsCID.slice(-12)}_${Date.now()}`
  );

  try {
    const { contentHash } = await downloadFile(ipfsCID, tmpPath);
    const match = contentHash.toLowerCase() === expectedHash.toLowerCase();

    if (match) {
      console.log(`[verifyIntegrity] ✅  Integrity OK  |  CID: ${ipfsCID}`);
    } else {
      console.warn(`[verifyIntegrity] ❌  Hash mismatch!`);
      console.warn(`   Expected: ${expectedHash}`);
      console.warn(`   Got:      ${contentHash}`);
    }

    return { isValid: match, computedHash: contentHash, expectedHash, match };
  } finally {
    // Clean up temp file
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

// ─── 7. FUNCTION 5 — buildEvidencePackage ────────────────────────────────────

/**
 * Build a tamper-evident evidence package combining:
 *   - The original deliverable file (uploaded to IPFS)
 *   - AI verification result
 *   - Submission metadata
 *
 * The entire bundle is also uploaded as a single JSON to IPFS, giving it
 * its own CID that can be stored on-chain as the authoritative audit record.
 *
 * @param {string} milestoneId         Contract milestone identifier
 * @param {string} submitterAddress    Freelancer's Ethereum address
 * @param {string} filePath            Local path to the deliverable
 * @param {object} verificationResult  Output from the AI verification service
 * @returns {Promise<EvidencePackage>}
 *
 * @typedef {object} EvidencePackage
 * @property {string} packageCID          IPFS CID of the evidence bundle JSON
 * @property {string} packageHash         SHA-256 of the bundle JSON
 * @property {string} fileCID             IPFS CID of the raw deliverable
 * @property {string} fileHash            SHA-256 of the raw deliverable
 * @property {string} milestoneId
 * @property {string} submitterAddress
 * @property {string} createdAt           ISO timestamp
 * @property {object} verificationResult
 * @property {object} merkleAnchors       CID + hash for each component
 */
async function buildEvidencePackage(
  milestoneId,
  submitterAddress,
  filePath,
  verificationResult
) {
  if (!milestoneId)       throw new Error('[buildEvidencePackage] milestoneId is required.');
  if (!submitterAddress)  throw new Error('[buildEvidencePackage] submitterAddress is required.');
  if (!filePath)          throw new Error('[buildEvidencePackage] filePath is required.');

  console.log(`\n[buildEvidencePackage] Building evidence package for milestone ${milestoneId}…`);

  // ── Step 1: Upload raw deliverable ────────────────────────────────────────
  const fileUpload = await uploadFile(filePath, {
    milestoneId,
    submitterAddress,
    timestamp:       new Date().toISOString(),
    deliverableType: 'code',
  });

  // ── Step 2: Hash the verification result ─────────────────────────────────
  const verResultBuf  = Buffer.from(JSON.stringify(verificationResult), 'utf8');
  const verResultHash = crypto.createHash('sha256').update(verResultBuf).digest('hex');

  // ── Step 3: Assemble bundle ───────────────────────────────────────────────
  const createdAt = new Date().toISOString();

  const bundle = {
    schemaVersion:    '1.0.0',
    packageType:      'EscrowEvidencePackage',
    milestoneId,
    submitterAddress,
    createdAt,

    deliverable: {
      fileName:    fileUpload.fileName,
      fileSize:    fileUpload.fileSize,
      ipfsCID:     fileUpload.ipfsCID,
      sha256:      fileUpload.contentHash,
      uploadedAt:  fileUpload.uploadTimestamp,
    },

    verification: {
      result:    verificationResult,
      sha256:    verResultHash,
    },

    // Merkle-style component anchors — lets on-chain contract verify each piece
    merkleAnchors: {
      deliverable:  { cid: fileUpload.ipfsCID,   hash: fileUpload.contentHash },
      verification: { cid: null,                  hash: verResultHash },   // CID set below
    },
  };

  // ── Step 4: Upload verification result JSON separately ───────────────────
  const verUpload = await uploadJSON(
    verificationResult,
    `verification-result-milestone-${milestoneId}`
  );
  bundle.merkleAnchors.verification.cid = verUpload.ipfsCID;

  // ── Step 5: Upload the entire bundle ─────────────────────────────────────
  const pkgUpload = await uploadJSON(
    bundle,
    `evidence-package-milestone-${milestoneId}`
  );

  // ── Step 6: Construct return value ────────────────────────────────────────
  const evidencePackage = {
    packageCID:         pkgUpload.ipfsCID,
    packageHash:        pkgUpload.contentHash,
    fileCID:            fileUpload.ipfsCID,
    fileHash:           fileUpload.contentHash,
    milestoneId,
    submitterAddress,
    createdAt,
    verificationResult,
    merkleAnchors:      bundle.merkleAnchors,
  };

  console.log(`[buildEvidencePackage] ✅  Package CID: ${pkgUpload.ipfsCID}`);
  console.log(`[buildEvidencePackage]     File CID:    ${fileUpload.ipfsCID}`);
  console.log(`[buildEvidencePackage]     Package Hash: ${pkgUpload.contentHash.slice(0,16)}…\n`);

  return evidencePackage;
}

// ─── 8. EXPORTS ──────────────────────────────────────────────────────────────

module.exports = {
  pinata,           // Configured SDK instance (for testAuthentication etc.)
  uploadFile,
  uploadJSON,
  downloadFile,
  verifyIntegrity,
  buildEvidencePackage,
  // Internal helpers exported for unit testing
  _computeHash: computeHash,
};
