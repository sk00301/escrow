'use client';

import React, {
  createContext, useContext, useState, useCallback,
  useEffect, useMemo,
} from 'react';
import { ethers } from 'ethers';
import { useWallet }    from '@/contexts/wallet-context';
import { useContracts } from '@/contexts/contract-context';
import { useJobBoard }  from '@/contexts/job-board-context';

const ROLES        = ['client', 'freelancer', 'jury'];
const STORAGE_KEY  = 'escrowchain_active_role';

const UserContext = createContext(undefined);

export function UserProvider({ children }) {
  const { walletAddress, isConnected }        = useWallet();
  const { contracts, disputes, jury, escrow } = useContracts();
  const { jobs }                              = useJobBoard();

  // ── Active role ────────────────────────────────────────────────────────────
  const [activeRole, _setActiveRole] = useState(() => {
    if (typeof window === 'undefined') return 'client';
    return localStorage.getItem(STORAGE_KEY) ?? 'client';
  });

  const setActiveRole = useCallback((role) => {
    if (!ROLES.includes(role)) return;
    _setActiveRole(role);
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, role);
  }, []);

  // ── Juror on-chain state ──────────────────────────────────────────────────
  const [jurorStake,    setJurorStake]    = useState(0);
  const [jurorIsActive, setJurorIsActive] = useState(false);

  useEffect(() => {
    if (!jury || !walletAddress || !isConnected) return;
    jury.getStake(walletAddress)
      .then(raw => setJurorStake(parseFloat(ethers.formatEther(raw))))
      .catch(() => setJurorStake(0));
    jury.jurors(walletAddress)
      .then(j => setJurorIsActive(j.isActive))
      .catch(() => setJurorIsActive(false));
  }, [jury, walletAddress, isConnected]);

  // ── Notifications ─────────────────────────────────────────────────────────
  const [notifications, setNotifications] = useState([]);

  // ── Derived stats — merge on-chain contracts + board jobs ─────────────────
  const userStats = useMemo(() => {
    if (!walletAddress) {
      return {
        activeContracts: 0, pendingReviews: 0, totalPaid: 0, disputesOpen: 0,
        activeMilestones: 0, pendingPayments: 0, totalEarned: 0, successRate: 0,
        stakedTokens: 0, casesReviewed: 0, accuracyRate: 0, totalRewardsEarned: 0,
      };
    }
    const addr = walletAddress.toLowerCase();

    // On-chain contracts (funded and beyond)
    const myClient     = contracts.filter(c => c.clientAddress?.toLowerCase()     === addr);
    const myFreelancer = contracts.filter(c => c.freelancerAddress?.toLowerCase() === addr);

    // Board jobs (pre-funding: open, accepted; or board-funded not yet in contracts)
    const jobList = Object.values(jobs ?? {});
    const myClientJobs     = jobList.filter(j => j.clientAddress?.toLowerCase()     === addr);
    const myFreelancerJobs = jobList.filter(j => j.freelancerAddress?.toLowerCase() === addr);

    // ── CLIENT stats ──────────────────────────────────────────────────────────
    // Active = on-chain active + board open/accepted (not yet funded)
    const onChainActive    = myClient.filter(c =>
      ['funded','submitted','verified','disputed'].includes(c.status)).length;
    const boardPreFund     = myClientJobs.filter(j =>
      ['open','accepted'].includes(j.status)).length;
    const activeContracts  = onChainActive + boardPreFund;

    // Pending reviews = on-chain verified (awaiting client release)
    const pendingReviews   = myClient.filter(c => c.status === 'verified').length;

    // Total paid = on-chain released
    const totalPaid        = myClient.filter(c => c.status === 'released')
      .reduce((s, c) => s + (c.amount ?? 0), 0);

    // Disputes
    const disputesOpen     = disputes.filter(d =>
      d.clientAddress?.toLowerCase()     === addr ||
      d.freelancerAddress?.toLowerCase() === addr
    ).length;

    // ── FREELANCER stats ──────────────────────────────────────────────────────
    // Active milestones = on-chain funded/submitted + board accepted (escrow pending)
    const onChainActiveMil = myFreelancer.filter(c =>
      ['funded','submitted'].includes(c.status)).length;
    const boardAccepted    = myFreelancerJobs.filter(j => j.status === 'accepted').length;
    const activeMilestones = onChainActiveMil + boardAccepted;

    // Pending payments = on-chain verified (AI approved, awaiting release)
    // + board milestones that have AI-approved verification results
    const onChainPending   = myFreelancer.filter(c => c.status === 'verified')
      .reduce((s, c) => s + (c.amount ?? 0), 0);
    const boardPending     = myFreelancerJobs.filter(j => {
      if (!j.milestoneVerifications) return false;
      return Object.values(j.milestoneVerifications).some(v => v?.isPassed);
    }).reduce((s, j) => s + (j.amount ?? 0), 0);
    const pendingPayments  = onChainPending + boardPending;

    // Total earned = on-chain released
    const totalEarned      = myFreelancer.filter(c => c.status === 'released')
      .reduce((s, c) => s + (c.amount ?? 0), 0);

    // Success rate = on-chain only (need settled state)
    const completed        = myFreelancer.filter(c =>
      ['released','verified','rejected','refunded'].includes(c.status));
    const successes        = myFreelancer.filter(c =>
      ['released','verified'].includes(c.status)).length;
    const successRate = completed.length > 0
      ? Math.round((successes / completed.length) * 100) : 0;

    return {
      activeContracts, pendingReviews,
      totalPaid:       parseFloat(totalPaid.toFixed(4)),
      disputesOpen,
      activeMilestones,
      pendingPayments: parseFloat(pendingPayments.toFixed(4)),
      totalEarned:     parseFloat(totalEarned.toFixed(4)),
      successRate,
      stakedTokens:       jurorStake,
      casesReviewed:      0,
      accuracyRate:       0,
      totalRewardsEarned: 0,
    };
  }, [contracts, disputes, jobs, walletAddress, jurorStake]);

  // ── Notification helpers ──────────────────────────────────────────────────
  const unreadCount  = notifications.filter(n => !n.read).length;
  const markAsRead   = useCallback((id) =>
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n)), []);
  const markAllAsRead = useCallback(() =>
    setNotifications(prev => prev.map(n => ({ ...n, read: true }))), []);
  const addNotification = useCallback((notification) =>
    setNotifications(prev => [{
      ...notification,
      id:        `notif-${Date.now()}`,
      timestamp: new Date(),
      read:      false,
    }, ...prev]), []);

  // ── Profile shapes ────────────────────────────────────────────────────────
  const userProfile = { isJuror: jurorIsActive, juryStake: jurorStake, reputation: 0, skills: [] };
  const jurorData   = { stakedTokens: jurorStake, casesReviewed: 0, accuracyRate: 0, totalRewardsEarned: 0, reputation: 0, skills: [] };
  const userRole    = activeRole;
  const setUserRole = setActiveRole;

  return (
    <UserContext.Provider value={{
      activeRole, setActiveRole,
      userRole,   setUserRole,
      userStats, userProfile, jurorData,
      notifications, unreadCount,
      markAsRead, markAllAsRead, addNotification,
    }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used within a UserProvider');
  return ctx;
}
