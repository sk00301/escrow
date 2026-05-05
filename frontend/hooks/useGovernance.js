"use client";
/**
 * hooks/useGovernance.js
 * ══════════════════════════════════════════════════════════════════════
 * Encapsulates all governance API interactions.
 * Replaces the in-memory useState arrays in governance/page.jsx.
 *
 * Usage
 * ─────
 *   const {
 *     proposals, stats, eligibility, myVotes,
 *     loading, error,
 *     fetchProposals, castVote, createProposal, checkEligibility,
 *   } = useGovernance(walletAddress, signer);
 *
 * Signature flow (MetaMask personal_sign)
 * ────────────────────────────────────────
 *   1. Build a deterministic message string with a unix timestamp.
 *   2. Ask signer.signMessage(message) — triggers MetaMask popup.
 *   3. POST the message timestamp + signature to the API.
 *   4. Backend recovers the signer address from the ECDSA sig and
 *      compares it to the submitted wallet. If they match → accepted.
 */

import { useState, useCallback, useEffect, useRef } from "react";

const API_BASE = (process.env.NEXT_PUBLIC_GOVERNANCE_URL || "http://localhost:8001") + "/api/governance";

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Thin fetch wrapper: throws an object { message, code } on non-2xx.
 */
async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.detail || data;
    throw { message: detail?.error || "Request failed", code: detail?.code || "UNKNOWN", status: res.status };
  }
  return data;
}

/**
 * Ask MetaMask to personal_sign a message and return { signature, timestamp }.
 * `signer` is an ethers.js Signer obtained from WalletContext.
 */
async function signMessage(signer, message) {
  const timestamp = Math.floor(Date.now() / 1000);
  const full      = `${message} at ${timestamp}`;
  const signature = await signer.signMessage(full);
  return { signature, timestamp };
}

// ── hook ──────────────────────────────────────────────────────────────────────

export function useGovernance(walletAddress, signer) {
  const [proposals,    setProposals]    = useState([]);
  const [stats,        setStats]        = useState(null);
  const [eligibility,  setEligibility]  = useState(null);   // { eligible, completed_txns, reason }
  const [myVotes,      setMyVotes]      = useState({});     // { [proposal_id]: "for"|"against" }
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);

  // Track in-flight requests to avoid state updates after unmount
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // ── fetchProposals ──────────────────────────────────────────────────────────

  const fetchProposals = useCallback(async (statusFilter = null) => {
    setLoading(true);
    setError(null);
    try {
      const query = statusFilter ? `?status=${statusFilter}` : "";
      const data  = await apiFetch(`/proposals${query}&limit=100`);
      if (mounted.current) setProposals(data.proposals || []);
    } catch (err) {
      if (mounted.current) setError(err.message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  // ── fetchStats ──────────────────────────────────────────────────────────────

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiFetch("/stats");
      if (mounted.current) setStats(data);
    } catch (_) { /* non-fatal */ }
  }, []);

  // ── checkEligibility ────────────────────────────────────────────────────────

  const checkEligibility = useCallback(async (wallet, forceRefresh = false) => {
    if (!wallet) return;
    try {
      const qs   = forceRefresh ? "?refresh=true" : "";
      const data = await apiFetch(`/eligibility/${wallet}${qs}`);
      if (mounted.current) setEligibility(data);
      return data;
    } catch (_) { return null; }
  }, []);

  // ── fetchMyVotes ────────────────────────────────────────────────────────────

  const fetchMyVotes = useCallback(async (wallet) => {
    if (!wallet) return;
    try {
      const votes = await apiFetch(`/wallet/${wallet}/votes`);
      const map   = {};
      for (const v of votes) map[v.proposal_id] = v.vote;
      if (mounted.current) setMyVotes(map);
    } catch (_) { /* non-fatal */ }
  }, []);

  // ── castVote ────────────────────────────────────────────────────────────────

  const castVote = useCallback(async (proposalId, vote) => {
    if (!walletAddress || !signer) throw { message: "Wallet not connected", code: "NO_WALLET" };

    const msgText = `Aegistra governance: vote ${vote} on ${proposalId}`;
    const { signature, timestamp } = await signMessage(signer, msgText);

    const result = await apiFetch(`/proposals/${proposalId}/vote`, {
      method: "POST",
      body: JSON.stringify({ wallet: walletAddress, vote, signature, timestamp }),
    });

    // Optimistic update — update local state immediately
    if (mounted.current) {
      setMyVotes(prev => ({ ...prev, [proposalId]: vote }));
      setProposals(prev => prev.map(p => {
        if (p.id !== proposalId) return p;
        const updatedFor     = vote === "for"     ? p.votes_for + 1     : p.votes_for;
        const updatedAgainst = vote === "against" ? p.votes_against + 1 : p.votes_against;
        const total          = updatedFor + updatedAgainst;
        return {
          ...p,
          votes_for:      updatedFor,
          votes_against:  updatedAgainst,
          total_votes:    total,
          for_percentage: total > 0 ? parseFloat(((updatedFor / total) * 100).toFixed(1)) : 50,
          has_met_quorum: total >= p.quorum,
        };
      }));
    }

    return result;
  }, [walletAddress, signer]);

  // ── createProposal ──────────────────────────────────────────────────────────

  const createProposal = useCallback(async ({ title, description, category }) => {
    if (!walletAddress || !signer) throw { message: "Wallet not connected", code: "NO_WALLET" };

    const msgText = `Aegistra governance: create proposal '${title}'`;
    const { signature, timestamp } = await signMessage(signer, msgText);

    const created = await apiFetch("/proposals", {
      method: "POST",
      body: JSON.stringify({ title, description, category: category || "General", wallet: walletAddress, signature, timestamp }),
    });

    // Prepend the new proposal to local state
    if (mounted.current) setProposals(prev => [created, ...prev]);
    fetchStats();  // refresh counters

    return created;
  }, [walletAddress, signer, fetchStats]);

  // ── Initial load ────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchProposals();
    fetchStats();
  }, [fetchProposals, fetchStats]);

  useEffect(() => {
    if (walletAddress) {
      checkEligibility(walletAddress);
      fetchMyVotes(walletAddress);
    } else {
      setEligibility(null);
      setMyVotes({});
    }
  }, [walletAddress, checkEligibility, fetchMyVotes]);

  return {
    // State
    proposals,
    stats,
    eligibility,
    myVotes,
    loading,
    error,
    // Actions
    fetchProposals,
    fetchStats,
    checkEligibility,
    castVote,
    createProposal,
  };
}
