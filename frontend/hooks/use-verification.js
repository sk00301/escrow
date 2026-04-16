'use client';

/**
 * useVerification.js
 *
 * Fetches and polls GET /result/{jobId} from the FastAPI AI verification
 * service. Maps the raw API response to the shape the verification page UI
 * expects.
 *
 * FastAPI Job schema  →  UI result shape
 * ─────────────────────────────────────────────────────────────────────
 * status               → status  ('PENDING'|'RUNNING'|'COMPLETED'|'FAILED')
 * verdict              → verdict ('APPROVED'|'DISPUTED'|'REJECTED'|'PENDING')
 * score                → overallScore  (0-100 integer)
 * score_breakdown
 *   .test_pass_rate    → breakdown.testPassRate  (0-100)
 *   .pylint_score      → breakdown.codeQuality   (0-100)
 *   .flake8_score      → breakdown.styleScore    (0-100)
 *   .weighted_total    → breakdown.weightedTotal (0-100)
 * test_summary
 *   .pass_rate         → testPassRate  (0-100)
 *   .passed            → passedCount
 *   .failed            → failedCount
 *   .total             → totalTests
 * passed_tests[]       → passedTests[]
 * failed_tests[]       → failedTests[]  (each is {name, error_message})
 * submission_hash      → fileHash
 * ipfs_cid             → ipfsCID
 * created_at           → submissionTimestamp
 * error_code           → errorCode
 * error_message        → errorMessage
 */

import { useState, useEffect, useRef, useCallback } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const POLL_INTERVAL_MS = 10_000;

// Maps raw Job from FastAPI to the shape verification page components expect
function mapJobToResult(job) {
  if (!job) return null;

  const score = job.score != null ? Math.round(job.score * 100) : null;
  const bd    = job.score_breakdown ?? {};
  const ts    = job.test_summary    ?? {};

  // Build breakdown object — multiply 0-1 floats to 0-100 integers
  const breakdown = {};
  if (bd.test_pass_rate  != null) breakdown.testPassRate  = Math.round(bd.test_pass_rate  * 100);
  if (bd.pylint_score    != null) breakdown.codeQuality   = Math.round(bd.pylint_score    * 100);
  if (bd.flake8_score    != null) breakdown.styleScore    = Math.round(bd.flake8_score    * 100);
  if (bd.weighted_total  != null) breakdown.weightedTotal = Math.round(bd.weighted_total  * 100);

  // passed_tests is string[]
  const passedTests = (job.passed_tests ?? []).map(t =>
    typeof t === 'string' ? t : (t.name ?? String(t))
  );

  // failed_tests is {name, error_message}[]
  const failedTests = (job.failed_tests ?? []).map(t =>
    typeof t === 'string' ? t : `${t.name ?? 'Test'}${t.error_message ? ': ' + t.error_message : ''}`
  );

  // Execution time estimate for pending state
  const createdAt = job.created_at ? new Date(job.created_at) : null;
  const elapsedSec = createdAt ? Math.floor((Date.now() - createdAt.getTime()) / 1000) : 0;

  return {
    // Status
    status:              job.status,   // PENDING | RUNNING | COMPLETED | FAILED
    verdict:             (job.verdict ?? 'PENDING').toLowerCase(),

    // Score
    overallScore:        score,
    score:               job.score,

    // Breakdown (for progress bars)
    breakdown,
    testPassRate:        ts.pass_rate != null ? Math.round(ts.pass_rate * 100) : null,

    // Test lists
    passedTests,
    failedTests,
    passedCount:         ts.passed  ?? passedTests.length,
    failedCount:         ts.failed  ?? failedTests.length,
    totalTests:          ts.total   ?? (passedTests.length + failedTests.length),

    // On-chain proof
    fileHash:            job.submission_hash ?? null,
    ipfsCID:             job.ipfs_cid        ?? null,
    ipfsLink:            job.ipfs_cid ? `ipfs://${job.ipfs_cid}` : null,

    // Metadata
    submissionTimestamp: job.created_at ?? new Date().toISOString(),
    completedAt:         job.completed_at ?? null,
    elapsedSec,

    // Error info (FAILED status)
    errorCode:    job.error_code    ?? null,
    errorMessage: job.error_message ?? null,

    // Raw job for debugging
    _raw: job,
  };
}

/**
 * useVerification(jobId)
 *
 * Pass the job_id returned when the freelancer submitted work.
 * The hook fetches immediately then polls every 10s while status is
 * PENDING or RUNNING. Stops polling when COMPLETED or FAILED.
 *
 * Returns { result, loading, error, refetch }
 */
export function useVerification(jobId) {
  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const timerRef = useRef(null);
  const activeRef = useRef(true);  // guards against state updates after unmount

  const fetchResult = useCallback(async () => {
    if (!jobId) return;
    setLoading(prev => result === null ? true : prev);  // skeleton only on first load
    try {
      const res = await fetch(`${API_URL}/result/${jobId}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error(`Verification job not found (${jobId})`);
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `API error ${res.status}`);
      }
      const job = await res.json();
      if (!activeRef.current) return;
      setResult(mapJobToResult(job));
      setError(null);

      // Stop polling once terminal state reached
      const done = job.status === 'COMPLETED' || job.status === 'FAILED';
      if (!done) {
        timerRef.current = setTimeout(fetchResult, POLL_INTERVAL_MS);
      }
    } catch (err) {
      if (!activeRef.current) return;
      setError(err.message);
    } finally {
      if (activeRef.current) setLoading(false);
    }
  }, [jobId]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    activeRef.current = true;
    if (jobId) fetchResult();
    return () => {
      activeRef.current = false;
      clearTimeout(timerRef.current);
    };
  }, [jobId, fetchResult]);

  return { result, loading, error, refetch: fetchResult };
}
