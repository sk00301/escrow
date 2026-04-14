'use client';
import React, { createContext, useContext, useState, useCallback } from 'react';
import { MOCK_NOTIFICATIONS, MOCK_JUROR_DATA } from '@/lib/mock-data';
const UserContext = createContext(undefined);
export function UserProvider({ children }) {
    const [userRole, setUserRole] = useState('client');
    const [notifications, setNotifications] = useState(MOCK_NOTIFICATIONS.map(n => ({
        ...n,
        type: n.type
    })));
    const userStats = {
        activeContracts: 3,
        pendingReviews: 2,
        totalPaid: 8.4500,
        disputesOpen: 1,
        // Freelancer stats
        activeMilestones: 2,
        pendingPayments: 1.8000,
        totalEarned: 24.3500,
        successRate: 94,
        // Juror stats
        stakedTokens: MOCK_JUROR_DATA.stakedTokens,
        casesReviewed: MOCK_JUROR_DATA.casesReviewed,
        accuracyRate: MOCK_JUROR_DATA.accuracyRate,
        totalRewardsEarned: MOCK_JUROR_DATA.totalRewardsEarned
    };
    const unreadCount = notifications.filter(n => !n.read).length;
    const markAsRead = useCallback((notificationId) => {
        setNotifications(prev => prev.map(n => n.id === notificationId ? { ...n, read: true } : n));
    }, []);
    const markAllAsRead = useCallback(() => {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    }, []);
    const addNotification = useCallback((notification) => {
        const newNotification = {
            ...notification,
            id: `notif-${Date.now()}`,
            timestamp: new Date(),
            read: false
        };
        setNotifications(prev => [newNotification, ...prev]);
    }, []);
    const userProfile = {
        isJuror: true,
        juryStake: MOCK_JUROR_DATA.stakedTokens,
        reputation: MOCK_JUROR_DATA.reputation,
        skills: MOCK_JUROR_DATA.skills,
    };
    return (<UserContext.Provider value={{
            userRole,
            setUserRole,
            userStats,
            userProfile,
            notifications,
            unreadCount,
            markAsRead,
            markAllAsRead,
            addNotification,
            jurorData: MOCK_JUROR_DATA
        }}>
      {children}
    </UserContext.Provider>);
}
export function useUser() {
    const context = useContext(UserContext);
    if (context === undefined) {
        throw new Error('useUser must be used within a UserProvider');
    }
    return context;
}
