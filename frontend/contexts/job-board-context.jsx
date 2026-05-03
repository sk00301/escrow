'use client';
/**
 * job-board-context.jsx  — single source of truth for all job state
 *
 * Storage: localStorage key "escrow_job_board"
 *
 * Per-job shape:
 * {
 *   id, title, description, clientAddress, freelancerAddress,
 *   amount, deadline, deliverableType, acceptanceCriteria,
 *   status: 'open'|'accepted'|'funded'|'cancelled',
 *   milestoneId,           // on-chain ID after funding
 *   postedAt, acceptedAt, fundedAt,
 *
 *   // ── Per-milestone-payment tracking ──────────────────────────────────
 *   currentMilestoneIdx: 0,          // which payment term is active (0-based)
 *   milestoneSubmissions: {          // milestoneIdx → { ipfsCID, submittedAt }
 *     0: { ipfsCID: '...', submittedAt: '...' }
 *   },
 *   milestoneVerifications: {        // milestoneIdx → parsed verification result
 *     0: { jobId, status, score, verdict, isPassed, details }
 *   },
 *   releasedMilestones: [],          // indices that have been paid out
 * }
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

const JOB_BOARD_KEY = 'escrow_job_board';
const JobBoardContext = createContext(undefined);

function loadBoard() {
  if (typeof window === 'undefined') return {};
  try { const r = localStorage.getItem(JOB_BOARD_KEY); return r ? JSON.parse(r) : {}; }
  catch { return {}; }
}
function persistBoard(b) {
  try { localStorage.setItem(JOB_BOARD_KEY, JSON.stringify(b)); } catch {}
}

export function JobBoardProvider({ children }) {
  const [jobs, setJobs] = useState({});
  useEffect(() => { setJobs(loadBoard()); }, []);

  const _update = useCallback((jobId, patch) => {
    setJobs(prev => {
      if (!prev[jobId]) return prev;
      const next = { ...prev, [jobId]: { ...prev[jobId], ...patch } };
      persistBoard(next);
      return next;
    });
  }, []);

  // ── Post ──────────────────────────────────────────────────────────────────
  const postJob = useCallback(({
    title, description, clientAddress, amount, deadline,
    deliverableType, acceptanceCriteria,
  }) => {
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const payTerms = acceptanceCriteria?.paymentTerms ?? [];
    const job = {
      id, title, description,
      clientAddress: clientAddress?.toLowerCase() ?? '',
      freelancerAddress: null,
      amount, deadline, deliverableType, acceptanceCriteria,
      status: 'open',
      milestoneId: null,
      postedAt: new Date().toISOString(),
      acceptedAt: null, fundedAt: null,
      // Per-payment-milestone tracking
      currentMilestoneIdx: 0,
      milestoneSubmissions: {},
      milestoneVerifications: {},
      releasedMilestones: [],
    };
    setJobs(prev => { const n = { ...prev, [id]: job }; persistBoard(n); return n; });
    return id;
  }, []);

  // ── Accept ────────────────────────────────────────────────────────────────
  const acceptJob = useCallback((jobId, freelancerAddress) => {
    setJobs(prev => {
      const job = prev[jobId];
      if (!job || job.status !== 'open') return prev;
      const next = { ...prev, [jobId]: {
        ...job,
        freelancerAddress: freelancerAddress?.toLowerCase(),
        status: 'accepted',
        acceptedAt: new Date().toISOString(),
      }};
      persistBoard(next);
      return next;
    });
  }, []);

  // ── Mark funded ───────────────────────────────────────────────────────────
  const markFunded = useCallback((jobId, milestoneId) => {
    _update(jobId, {
      status: 'funded',
      milestoneId: milestoneId?.toString(),
      fundedAt: new Date().toISOString(),
    });
  }, [_update]);

  // ── Cancel ────────────────────────────────────────────────────────────────
  const cancelJob = useCallback((jobId) => {
    _update(jobId, { status: 'cancelled' });
  }, [_update]);

  // ── Record submission for a specific payment milestone ────────────────────
  const recordSubmission = useCallback((jobId, milestoneIdx, ipfsCID) => {
    setJobs(prev => {
      const job = prev[jobId];
      if (!job) return prev;
      const next = { ...prev, [jobId]: {
        ...job,
        milestoneSubmissions: {
          ...job.milestoneSubmissions,
          [milestoneIdx]: { ipfsCID, submittedAt: new Date().toISOString() },
        },
      }};
      persistBoard(next);
      return next;
    });
  }, []);

  // ── Record verification result for a specific payment milestone ───────────
  const recordVerification = useCallback((jobId, milestoneIdx, result) => {
    setJobs(prev => {
      const job = prev[jobId];
      if (!job) return prev;
      const next = { ...prev, [jobId]: {
        ...job,
        milestoneVerifications: {
          ...job.milestoneVerifications,
          [milestoneIdx]: result,
        },
      }};
      persistBoard(next);
      return next;
    });
  }, []);

  // ── Mark a payment milestone as released, advance to next ─────────────────
  const releaseMilestonePayment = useCallback((jobId, milestoneIdx) => {
    setJobs(prev => {
      const job = prev[jobId];
      if (!job) return prev;
      const payTerms = job.acceptanceCriteria?.paymentTerms ?? [];
      const released = [...(job.releasedMilestones ?? []), milestoneIdx];
      const isAllReleased = released.length >= payTerms.length;
      const nextIdx = Math.min(milestoneIdx + 1, payTerms.length - 1);
      const next = { ...prev, [jobId]: {
        ...job,
        releasedMilestones: released,
        currentMilestoneIdx: nextIdx,
        status: isAllReleased ? 'completed' : 'funded',
      }};
      persistBoard(next);
      return next;
    });
  }, []);

  // ── Derived lists ─────────────────────────────────────────────────────────
  const jobList = Object.values(jobs);
  const openJobs = jobList.filter(j => j.status === 'open');

  const clientJobs = useCallback(
    (addr) => jobList.filter(j => j.clientAddress === addr?.toLowerCase()),
    [jobList]
  );

  const freelancerJobs = useCallback(
    (addr) => jobList.filter(
      j => j.freelancerAddress === addr?.toLowerCase() &&
           ['accepted', 'funded', 'completed'].includes(j.status)
    ),
    [jobList]
  );

  // Find a job by its on-chain milestoneId
  const jobByMilestoneId = useCallback(
    (milestoneId) => jobList.find(j => j.milestoneId === milestoneId?.toString()) ?? null,
    [jobList]
  );

  return (
    <JobBoardContext.Provider value={{
      jobs, openJobs, clientJobs, freelancerJobs, jobByMilestoneId,
      postJob, acceptJob, markFunded, cancelJob,
      recordSubmission, recordVerification, releaseMilestonePayment,
    }}>
      {children}
    </JobBoardContext.Provider>
  );
}

export function useJobBoard() {
  const ctx = useContext(JobBoardContext);
  if (!ctx) throw new Error('useJobBoard must be used within JobBoardProvider');
  return ctx;
}
