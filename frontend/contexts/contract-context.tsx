'use client'

import React, { createContext, useContext, useState, useCallback } from 'react'
import { MOCK_CONTRACTS, MOCK_DISPUTES, MOCK_VERIFICATION_RESULTS } from '@/lib/mock-data'

export interface Contract {
  id: string
  freelancerAddress: string
  clientAddress: string
  milestoneTitle: string
  description: string
  amount: number
  status: 'funded' | 'submitted' | 'verified' | 'disputed' | 'released'
  deliverableType: 'code' | 'document' | 'design'
  deadline: Date
  createdAt: Date
  acceptanceCriteria: {
    testPassRate: number
    requirements: string[]
  }
}

export interface Dispute {
  id: string
  contractId: string
  reason: string
  status: 'active' | 'resolved' | 'pending'
  ethAtStake: number
  jurorCount: number
  votesFor: number
  votesAgainst: number
  votingDeadline: Date
  verdict?: string
  evidence: {
    clientEvidence: string
    freelancerEvidence: string
  }
  createdAt: Date
}

export interface VerificationResult {
  contractId: string
  deliverableType: string
  overallScore: number
  verdict: 'approved' | 'rejected' | 'disputed'
  breakdown: Record<string, number>
  passedTests: string[]
  failedTests: string[]
  missingRequirements: string[]
  confidenceInterval: [number, number]
  fileHash: string
  submissionTimestamp: Date
  ipfsLink: string
  oracleSignature: string
}

interface TransactionResult {
  success: boolean
  hash?: string
  error?: string
}

interface ContractContextType {
  contracts: Contract[]
  disputes: Dispute[]
  verificationResults: Record<string, VerificationResult>
  isLoading: boolean
  createMilestone: (milestone: Omit<Contract, 'id' | 'status' | 'createdAt'>) => Promise<TransactionResult>
  submitWork: (contractId: string, fileHash: string) => Promise<TransactionResult>
  releasePayment: (contractId: string) => Promise<TransactionResult>
  raiseDispute: (contractId: string, reason: string) => Promise<TransactionResult>
  castVote: (disputeId: string, vote: 'approve' | 'reject', reasoning: string) => Promise<TransactionResult>
  voteOnDispute: (disputeId: string, vote: 'client' | 'freelancer') => Promise<TransactionResult>
}

const ContractContext = createContext<ContractContextType | undefined>(undefined)

export function ContractProvider({ children }: { children: React.ReactNode }) {
  const [contracts, setContracts] = useState<Contract[]>(
    MOCK_CONTRACTS.map(c => ({
      ...c,
      status: c.status as Contract['status'],
      deliverableType: c.deliverableType as Contract['deliverableType']
    }))
  )
  const [disputes, setDisputes] = useState<Dispute[]>(
    MOCK_DISPUTES.map(d => ({
      ...d,
      status: d.status as Dispute['status']
    }))
  )
  const [verificationResults] = useState<Record<string, VerificationResult>>(
    Object.fromEntries(
      Object.entries(MOCK_VERIFICATION_RESULTS).map(([key, value]) => [
        key,
        {
          ...value,
          verdict: value.verdict as VerificationResult['verdict']
        }
      ])
    )
  )
  const [isLoading, setIsLoading] = useState(false)

  const simulateTransaction = useCallback(async (): Promise<TransactionResult> => {
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 1000))
    if (Math.random() > 0.05) {
      return {
        success: true,
        hash: `0x${Array.from({ length: 64 }, () =>
          Math.floor(Math.random() * 16).toString(16)
        ).join('')}`
      }
    }
    return { success: false, error: 'Transaction failed. Please try again.' }
  }, [])

  const createMilestone = useCallback(async (
    milestone: Omit<Contract, 'id' | 'status' | 'createdAt'>
  ): Promise<TransactionResult> => {
    setIsLoading(true)
    try {
      const result = await simulateTransaction()
      if (result.success) {
        const newContract: Contract = {
          ...milestone,
          id: `contract-${Date.now()}`,
          status: 'funded',
          createdAt: new Date()
        }
        setContracts(prev => [...prev, newContract])
      }
      return result
    } finally {
      setIsLoading(false)
    }
  }, [simulateTransaction])

  const submitWork = useCallback(async (
    contractId: string,
    _fileHash: string
  ): Promise<TransactionResult> => {
    setIsLoading(true)
    try {
      const result = await simulateTransaction()
      if (result.success) {
        setContracts(prev =>
          prev.map(c => c.id === contractId ? { ...c, status: 'submitted' as const } : c)
        )
      }
      return result
    } finally {
      setIsLoading(false)
    }
  }, [simulateTransaction])

  const releasePayment = useCallback(async (contractId: string): Promise<TransactionResult> => {
    setIsLoading(true)
    try {
      const result = await simulateTransaction()
      if (result.success) {
        setContracts(prev =>
          prev.map(c => c.id === contractId ? { ...c, status: 'released' as const } : c)
        )
      }
      return result
    } finally {
      setIsLoading(false)
    }
  }, [simulateTransaction])

  const raiseDispute = useCallback(async (
    contractId: string,
    reason: string
  ): Promise<TransactionResult> => {
    setIsLoading(true)
    try {
      const result = await simulateTransaction()
      if (result.success) {
        setContracts(prev =>
          prev.map(c => c.id === contractId ? { ...c, status: 'disputed' as const } : c)
        )
        setContracts(prev => {
          const contract = prev.find(c => c.id === contractId)
          if (contract) {
            const newDispute: Dispute = {
              id: `dispute-${Date.now()}`,
              contractId,
              reason,
              status: 'active',
              ethAtStake: contract.amount,
              jurorCount: 5,
              votesFor: 0,
              votesAgainst: 0,
              votingDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              evidence: { clientEvidence: reason, freelancerEvidence: '' },
              createdAt: new Date()
            }
            setDisputes(prev => [...prev, newDispute])
          }
          return prev
        })
      }
      return result
    } finally {
      setIsLoading(false)
    }
  }, [simulateTransaction])

  const castVote = useCallback(async (
    disputeId: string,
    vote: 'approve' | 'reject',
    _reasoning: string
  ): Promise<TransactionResult> => {
    setIsLoading(true)
    try {
      const result = await simulateTransaction()
      if (result.success) {
        setDisputes(prev =>
          prev.map(d => {
            if (d.id === disputeId) {
              return {
                ...d,
                votesFor: vote === 'approve' ? d.votesFor + 1 : d.votesFor,
                votesAgainst: vote === 'reject' ? d.votesAgainst + 1 : d.votesAgainst
              }
            }
            return d
          })
        )
      }
      return result
    } finally {
      setIsLoading(false)
    }
  }, [simulateTransaction])

  // Alias for jury components that use 'client'/'freelancer' vote values
  const voteOnDispute = useCallback(async (
    disputeId: string,
    vote: 'client' | 'freelancer'
  ): Promise<TransactionResult> => {
    return castVote(disputeId, vote === 'client' ? 'approve' : 'reject', '')
  }, [castVote])

  return (
    <ContractContext.Provider
      value={{
        contracts,
        disputes,
        verificationResults,
        isLoading,
        createMilestone,
        submitWork,
        releasePayment,
        raiseDispute,
        castVote,
        voteOnDispute
      }}
    >
      {children}
    </ContractContext.Provider>
  )
}

export function useContracts() {
  const context = useContext(ContractContext)
  if (context === undefined) {
    throw new Error('useContracts must be used within a ContractProvider')
  }
  return context
}

// Alias for components that use useContract (singular)
export const useContract = useContracts
