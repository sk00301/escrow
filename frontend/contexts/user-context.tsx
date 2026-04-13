'use client'

import React, { createContext, useContext, useState, useCallback } from 'react'
import { MOCK_NOTIFICATIONS, MOCK_JUROR_DATA } from '@/lib/mock-data'

export type UserRole = 'client' | 'freelancer' | 'juror'

export interface UserProfile {
  isJuror: boolean
  juryStake: number
  reputation: number
  skills: string[]
}

export interface Notification {
  id: string
  type: 'transaction' | 'milestone' | 'dispute' | 'vote' | 'governance'
  title: string
  message: string
  timestamp: Date
  read: boolean
}

export interface UserStats {
  // Client stats
  activeContracts?: number
  pendingReviews?: number
  totalPaid?: number
  disputesOpen?: number
  
  // Freelancer stats
  activeMilestones?: number
  pendingPayments?: number
  totalEarned?: number
  successRate?: number
  
  // Juror stats
  stakedTokens?: number
  casesReviewed?: number
  accuracyRate?: number
  totalRewardsEarned?: number
}

interface UserContextType {
  userRole: UserRole
  setUserRole: (role: UserRole) => void
  userStats: UserStats
  userProfile: UserProfile
  notifications: Notification[]
  unreadCount: number
  markAsRead: (notificationId: string) => void
  markAllAsRead: () => void
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void
  jurorData: typeof MOCK_JUROR_DATA
}

const UserContext = createContext<UserContextType | undefined>(undefined)

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [userRole, setUserRole] = useState<UserRole>('client')
  const [notifications, setNotifications] = useState<Notification[]>(
    MOCK_NOTIFICATIONS.map(n => ({
      ...n,
      type: n.type as Notification['type']
    }))
  )

  const userStats: UserStats = {    // Client stats
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
  }

  const unreadCount = notifications.filter(n => !n.read).length

  const markAsRead = useCallback((notificationId: string) => {
    setNotifications(prev =>
      prev.map(n =>
        n.id === notificationId ? { ...n, read: true } : n
      )
    )
  }, [])

  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }, [])

  const addNotification = useCallback((
    notification: Omit<Notification, 'id' | 'timestamp' | 'read'>
  ) => {
    const newNotification: Notification = {
      ...notification,
      id: `notif-${Date.now()}`,
      timestamp: new Date(),
      read: false
    }
    setNotifications(prev => [newNotification, ...prev])
  }, [])

  const userProfile: UserProfile = {
    isJuror: true,
    juryStake: MOCK_JUROR_DATA.stakedTokens,
    reputation: MOCK_JUROR_DATA.reputation,
    skills: MOCK_JUROR_DATA.skills,
  }

  return (
    <UserContext.Provider
      value={{
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
      }}
    >
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  const context = useContext(UserContext)
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider')
  }
  return context
}
