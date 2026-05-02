'use client';

import React, {
  createContext, useContext, useState, useCallback,
  useEffect, useMemo,
} from 'react';
import { ethers } from 'ethers';
import { useWallet }    from '@/contexts/wallet-context';
import { useContracts } from '@/contexts/contract-context';

const ROLES        = ['client', 'freelancer', 'jury'];
const STORAGE_KEY  = 'aegistra_active_role';

const UserContext = createContext(undefined);

export function UserProvider({ children }) {
  const { walletAddress, isConnected }        = useWallet();
  const { contracts, disputes, jury, escrow } = useContracts();

  // ── Active role — persisted per wallet ────────────────────────────────────
  const [activeRole, _setActiveRole] = useState(() => {
    if (typeof window === 'undefined') return 'client';
    return localStorage.getItem(STORAGE_KEY) ?? 'client';
  });

  const setActiveRole = useCallback((role) => {
    if (!ROLES.includes(role)) return;
    _setActiveRole(role);
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, role);
  }, []);

  // Reset role storage when wallet disconnects
  useEffect(() => {
    if (!isConnected) {
      // Don't clear — remember role for next connection
    }
  }, [isConnected]);

  // ── Notifications ─────────────────────────────────────────────────────────
  const [notifications, setNotifications] = useState([]);

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

  // ── Derived stats from on-chain data ──────────────────────────────────────
  const userStats = useMemo(() => {
    if (!walletAddress) {
      return {
        activeContracts: 0, pendingReviews: 0, totalPaid: 0, disputesOpen: 0,
        activeMilestones: 0, pendingPayments: 0, totalEarned: 0, successRate: 0,
        stakedTokens: 0, casesReviewed: 0, accuracyRate: 0, totalRewardsEarned: 0,
      };
    }
    const addr = walletAddress.toLowerCase();
    const myClient     = contracts.filter(c => c.clientAddress?.toLowerCase()     === addr);
    const myFreelancer = contracts.filter(c => c.freelancerAddress?.toLowerCase() === addr);

    const activeContracts = myClient.filter(c =>
      ['funded','submitted','verified','disputed'].includes(c.status)).length;
    const pendingReviews  = myClient.filter(c => c.status === 'verified').length;
    const totalPaid       = myClient.filter(c => c.status === 'released')
      .reduce((s, c) => s + (c.amount ?? 0), 0);
    const disputesOpen    = disputes.filter(d =>
      d.clientAddress?.toLowerCase() === addr || d.freelancerAddress?.toLowerCase() === addr
    ).length;

    const activeMilestones = myFreelancer.filter(c =>
      ['funded','submitted'].includes(c.status)).length;
    const pendingPayments  = myFreelancer.filter(c => c.status === 'verified')
      .reduce((s, c) => s + (c.amount ?? 0), 0);
    const totalEarned      = myFreelancer.filter(c => c.status === 'released')
      .reduce((s, c) => s + (c.amount ?? 0), 0);
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
      activeMilestones, pendingPayments: parseFloat(pendingPayments.toFixed(4)),
      totalEarned:     parseFloat(totalEarned.toFixed(4)),
      successRate,
      stakedTokens:       jurorStake,
      casesReviewed:      0,
      accuracyRate:       0,
      totalRewardsEarned: 0,
    };
  }, [contracts, disputes, walletAddress, jurorStake]);

  // ── Notification helpers ──────────────────────────────────────────────────
  const unreadCount = notifications.filter(n => !n.read).length;

  const markAsRead = useCallback((id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const addNotification = useCallback((notification) => {
    setNotifications(prev => [{
      ...notification,
      id:        `notif-${Date.now()}`,
      timestamp: new Date(),
      read:      false,
    }, ...prev]);
  }, []);

  // ── Profile shapes ────────────────────────────────────────────────────────
  const userProfile = { isJuror: jurorIsActive, juryStake: jurorStake, reputation: 0, skills: [] };
  const jurorData   = { stakedTokens: jurorStake, casesReviewed: 0, accuracyRate: 0, totalRewardsEarned: 0, reputation: 0, skills: [] };

  // Keep legacy userRole alias so nothing else breaks
  const userRole    = activeRole;
  const setUserRole = setActiveRole;

  return (
    <UserContext.Provider value={{
      activeRole, setActiveRole,
      userRole,   setUserRole,     // legacy aliases
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
