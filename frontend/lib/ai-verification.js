/**
 * lib/ai-verification.js
 *
 * Routes verification to the right backend endpoint based on deliverable type:
 *
 *   deliverableType === 'code'  →  POST /llm-verify   (CodeVerificationAgent:
 *                                   downloads IPFS zip, runs pytest/pylint/flake8 + LLM)
 *   everything else            →  POST /text-verify   (LLM-only: reads IPFS text,
 *                                   evaluates against criteria, no code tools)
 *
 * Both endpoints share the same polling path:  GET /result/:jobId
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

// ── Build criteria text ───────────────────────────────────────────────────────

export function buildCriteriaText(acceptanceCriteria, jobTitle = '') {
  if (!acceptanceCriteria) return 'Verify the submission meets the project requirements.';

  const parts = [];
  if (jobTitle) parts.push(`Project: ${jobTitle}`);

  if (acceptanceCriteria.requirements?.length) {
    parts.push('Requirements:\n' + acceptanceCriteria.requirements.map(r => `- ${r}`).join('\n'));
  }
  if (acceptanceCriteria.testPassRate != null) {
    parts.push(`Minimum test pass rate: ${acceptanceCriteria.testPassRate}%`);
  }
  if (acceptanceCriteria.paymentTerms?.length) {
    parts.push(
      'Payment milestones:\n' +
      acceptanceCriteria.paymentTerms
        .map((ms, i) => `  ${i + 1}. ${ms.name} (${ms.percentage}%)${ms.description ? ': ' + ms.description : ''}`)
        .join('\n')
    );
  }
  if (acceptanceCriteria.srsCID) {
    parts.push(`Specification document (IPFS): ${acceptanceCriteria.srsCID}`);
  }

  return parts.join('\n\n') || 'Verify the submission meets the project requirements.';
}

// ── Submit verification job ───────────────────────────────────────────────────

/**
 * Submit a verification job.
 * Automatically routes to /llm-verify (code) or /text-verify (documents/notes).
 *
 * @param {object} opts
 * @param {string} opts.milestoneId
 * @param {string} opts.ipfsCID           - IPFS CID of the uploaded submission
 * @param {object} opts.acceptanceCriteria - structured criteria from job board
 * @param {string} opts.jobTitle
 * @param {string} opts.deliverableType   - 'code' | 'document' | 'design'
 * @param {number} opts.acceptanceThreshold - 0.0–1.0 (default 0.75)
 */
export async function submitVerificationJob({
  milestoneId,
  ipfsCID,
  acceptanceCriteria,
  jobTitle = '',
  deliverableType = 'code',
  acceptanceThreshold = 0.75,
}) {
  const criteriaText = buildCriteriaText(acceptanceCriteria, jobTitle);
  const threshold    = acceptanceThreshold ?? ((acceptanceCriteria?.testPassRate ?? 75) / 100);

  const isCode = deliverableType === 'code';

  const endpoint = isCode ? '/llm-verify' : '/text-verify';

  const body = isCode
    ? {
        milestone_id:         milestoneId,
        submission_type:      'ipfs_cid',
        submission_value:     ipfsCID,
        acceptance_criteria:  criteriaText,
        acceptance_threshold: threshold,
      }
    : {
        milestone_id:         milestoneId,
        submission_type:      'ipfs_cid',
        submission_value:     ipfsCID,
        acceptance_criteria:  criteriaText,
        deliverable_type:     deliverableType,  // 'document' | 'design'
        acceptance_threshold: threshold,
      };

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.detail ?? err?.error ?? `Verification request failed (${response.status})`);
  }

  const data = await response.json();
  return { jobId: data.job_id, status: data.status, endpoint };
}

// ── Poll result ───────────────────────────────────────────────────────────────

export async function pollVerificationResult(jobId) {
  const response = await fetch(`${BASE_URL}/result/${jobId}`);
  if (!response.ok) throw new Error(`Failed to fetch verification result (${response.status})`);
  return response.json();
}

/**
 * Poll until COMPLETED or FAILED.
 * Calls onUpdate(parsedResult) on each poll tick.
 */
export async function waitForVerification(
  jobId,
  onUpdate,
  { maxAttempts = 150, intervalMs = 5000 } = {}
) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? 800 : intervalMs));
    const raw    = await pollVerificationResult(jobId);
    const parsed = parseVerificationResult(raw);
    onUpdate?.(parsed);
    if (parsed.status === 'COMPLETED' || parsed.status === 'FAILED') return parsed;
  }
  throw new Error('Verification timed out after maximum polling attempts.');
}

// ── Parse result ──────────────────────────────────────────────────────────────

export function parseVerificationResult(raw) {
  // GET /result/:jobId returns a Job object with these top-level fields:
  //   job_id, status, verdict, score, score_breakdown, details,
  //   error_code, error_message
  // (See backend app/models/schemas.py Job model)
  const status  = raw?.status;
  const score   = raw?.score   ?? null;          // float 0.0–1.0
  const verdict = (raw?.verdict === 'PENDING' || !raw?.verdict)
    ? null
    : raw.verdict;                               // APPROVED | DISPUTED | REJECTED | null

  const isPassed = status === 'COMPLETED' && score != null && score >= 0.75;

  // score_breakdown comes from Job.score_breakdown (ScoreBreakdown model)
  // details comes from Job.details (full LLM verdict dict for llm-verify jobs)
  const details = raw?.details ?? raw?.score_breakdown ?? null;

  return {
    jobId:     raw?.job_id,
    status,
    score,
    verdict,
    isPassed,
    errorCode: raw?.error_code    ?? null,
    errorMsg:  raw?.error_message ?? null,
    details,
  };
}

// ── Oracle: post verified result on-chain ─────────────────────────────────────
// After AI verification completes, call the oracle service which signs the
// result with the oracle private key and calls postVerificationResult on-chain.
// This transitions the contract state from SUBMITTED → VERIFIED/REJECTED/DISPUTED
// and makes the result visible to ALL wallets by reading from the blockchain.

const ORACLE_URL = process.env.NEXT_PUBLIC_ORACLE_URL ?? 'http://localhost:3001';

/**
 * Submit the AI verification result to the oracle for on-chain posting.
 * The oracle signs the (milestoneId, score) pair and calls
 * EscrowContract.postVerificationResult() on Sepolia.
 *
 * @param {string|number} milestoneId  On-chain milestone ID (e.g. "2")
 * @param {number}        score        0.0 – 1.0 from AI backend
 * @param {string}        ipfsCID      IPFS CID of the submission (optional)
 * @returns {Promise<{success, txHash, verdict, score}>}
 */
export async function postResultToOracle(milestoneId, score, ipfsCID = null) {
  // Strip the "_0" suffix if milestoneId was constructed as "2_0"
  const cleanId = String(milestoneId).replace(/_\d+$/, '');

  const response = await fetch(`${ORACLE_URL}/oracle/submit-result`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      milestoneId: cleanId,
      score,
      ipfsCID,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error ?? `Oracle request failed (${response.status})`);
  }

  return response.json();
}
