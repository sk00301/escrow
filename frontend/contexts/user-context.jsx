'use client';

/**
 * user-context.jsx
 * Replaces hardcoded mock stats with values derived from real on-chain data.
 * MOCK_NOTIFICATIONS and MOCK_JUROR_DATA are kept only as UI scaffolding
 * until a real notification system is built.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { ethers } from 'ethers';
import { MOCK_NOTIFICATIONS } from '@/lib/mock-data';
import { useWallet } from '@/contexts/wallet-context';
import { useContracts } from '@/contexts/contract-context';

const UserContext = createContext(undefined);

export function UserProvider({ children }) {
  const { walletAddress, isConnected }        = useWallet();
  const { contracts, disputes, jury, escrow } = useContracts();

  const [userRole,       setUserRole]       = useState('client');
  const [notifications,  setNotifications]  = useState(
    MOCK_NOTIFICATIONS.map(n => ({ ...n, type: n.type }))
  );
  const [jurorStake,     setJurorStake]     = useState(0);
  const [jurorIsActive,  setJurorIsActive]  = useState(false);

  // ── Derive real stats from on-chain contract data ─────────────────────────

  const userStats = useMemo(() => {
    if (!walletAddress) {
      return {
        // client
        activeContracts: 0, pendingReviews: 0, totalPaid: 0, disputesOpen: 0,
        // freelancer
        activeMilestones: 0, pendingPayments: 0, totalEarned: 0, successRate: 0,
        // juror
        stakedTokens: 0, casesReviewed: 0, accuracyRate: 0, totalRewardsEarned: 0,
      };
    }

    const addr = walletAddress.toLowerCase();

    const myClientContracts     = contracts.filter(c => c.clientAddress?.toLowerCase()     === addr);
    const myFreelancerContracts = contracts.filter(c => c.freelancerAddress?.toLowerCase() === addr);

    // Client stats
    const activeContracts = myClientContracts.filter(c =>
      ['funded', 'submitted', 'verified', 'disputed'].includes(c.status)
    ).length;

    const pendingReviews = myClientContracts.filter(c =>
      c.status === 'verified'  // verified but not yet released — awaiting client action
    ).length;

    const totalPaid = myClientContracts
      .filter(c => c.status === 'released')
      .reduce((sum, c) => sum + (c.amount ?? 0), 0);

    const disputesOpen = disputes.filter(d =>
      d.clientAddress?.toLowerCase() === addr || d.freelancerAddress?.toLowerCase() === addr
    ).length;

    // Freelancer stats
    const activeMilestones = myFreelancerContracts.filter(c =>
      ['funded', 'submitted'].includes(c.status)
    ).length;

    const pendingPayments = myFreelancerContracts
      .filter(c => c.status === 'verified')
      .reduce((sum, c) => sum + (c.amount ?? 0), 0);

    const totalEarned = myFreelancerContracts
      .filter(c => c.status === 'released')
      .reduce((sum, c) => sum + (c.amount ?? 0), 0);

    const completedFreelancer = myFreelancerContracts.filter(c =>
      ['released', 'verified', 'rejected', 'refunded'].includes(c.status)
    );
    const successCount = myFreelancerContracts.filter(c =>
      ['released', 'verified'].includes(c.status)
    ).length;
    const successRate = completedFreelancer.length > 0
      ? Math.round((successCount / completedFreelancer.length) * 100)
      : 0;

    return {
      activeContracts, pendingReviews,
      totalPaid:      parseFloat(totalPaid.toFixed(4)),
      disputesOpen,
      activeMilestones, pendingPayments: parseFloat(pendingPayments.toFixed(4)),
      totalEarned:    parseFloat(totalEarned.toFixed(4)),
      successRate,
      // Juror stats — from on-chain stake (fetched below)
      stakedTokens:      jurorStake,
      casesReviewed:     0,   // not tracked on-chain in this prototype
      accuracyRate:      0,   // not tracked on-chain in this prototype
      totalRewardsEarned:0,   // not tracked on-chain in this prototype
    };
  }, [contracts, disputes, walletAddress, jurorStake]);

  // ── Fetch juror stake from JuryStaking contract ───────────────────────────

  useEffect(() => {
    if (!jury || !walletAddress || !isConnected) return;
    jury.getStake(walletAddress)
      .then(raw => setJurorStake(parseFloat(ethers.formatEther(raw))))
      .catch(() => setJurorStake(0));
    jury.jurors(walletAddress)
      .then(j => setJurorIsActive(j.isActive))
      .catch(() => setJurorIsActive(false));
  }, [jury, walletAddress, isConnected]);

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

  // ── User profile ──────────────────────────────────────────────────────────

  const userProfile = {
    isJuror:    jurorIsActive,
    juryStake:  jurorStake,
    reputation: 0,
    skills:     [],
  };

  // jurorData — shape kept for backwards compat with components that use useUser().jurorData
  const jurorData = {
    stakedTokens:      jurorStake,
    casesReviewed:     0,
    accuracyRate:      0,
    totalRewardsEarned:0,
    reputation:        0,
    skills:            [],
  };

  return (
    <UserContext.Provider value={{
      userRole, setUserRole,
      userStats,
      userProfile,
      jurorData,
      notifications,
      unreadCount,
      markAsRead,
      markAllAsRead,
      addNotification,
    }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) throw new Error('useUser must be used within a UserProvider');
  return context;
}
