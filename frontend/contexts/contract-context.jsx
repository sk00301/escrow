'use client';
import React, { createContext, useContext, useState, useCallback } from 'react';
import { MOCK_CONTRACTS, MOCK_DISPUTES, MOCK_VERIFICATION_RESULTS } from '@/lib/mock-data';
const ContractContext = createContext(undefined);
export function ContractProvider({ children }) {
    const [contracts, setContracts] = useState(MOCK_CONTRACTS.map(c => ({
        ...c,
        status: c.status,
        deliverableType: c.deliverableType
    })));
    const [disputes, setDisputes] = useState(MOCK_DISPUTES.map(d => ({
        ...d,
        status: d.status
    })));
    const [verificationResults] = useState(Object.fromEntries(Object.entries(MOCK_VERIFICATION_RESULTS).map(([key, value]) => [
        key,
        {
            ...value,
            verdict: value.verdict
        }
    ])));
    const [isLoading, setIsLoading] = useState(false);
    const simulateTransaction = useCallback(async () => {
        await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 1000));
        if (Math.random() > 0.05) {
            return {
                success: true,
                hash: `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`
            };
        }
        return { success: false, error: 'Transaction failed. Please try again.' };
    }, []);
    const createMilestone = useCallback(async (milestone) => {
        setIsLoading(true);
        try {
            const result = await simulateTransaction();
            if (result.success) {
                const newContract = {
                    ...milestone,
                    id: `contract-${Date.now()}`,
                    status: 'funded',
                    createdAt: new Date()
                };
                setContracts(prev => [...prev, newContract]);
            }
            return result;
        }
        finally {
            setIsLoading(false);
        }
    }, [simulateTransaction]);
    const submitWork = useCallback(async (contractId, _fileHash) => {
        setIsLoading(true);
        try {
            const result = await simulateTransaction();
            if (result.success) {
                setContracts(prev => prev.map(c => c.id === contractId ? { ...c, status: 'submitted' } : c));
            }
            return result;
        }
        finally {
            setIsLoading(false);
        }
    }, [simulateTransaction]);
    const releasePayment = useCallback(async (contractId) => {
        setIsLoading(true);
        try {
            const result = await simulateTransaction();
            if (result.success) {
                setContracts(prev => prev.map(c => c.id === contractId ? { ...c, status: 'released' } : c));
            }
            return result;
        }
        finally {
            setIsLoading(false);
        }
    }, [simulateTransaction]);
    const raiseDispute = useCallback(async (contractId, reason) => {
        setIsLoading(true);
        try {
            const result = await simulateTransaction();
            if (result.success) {
                setContracts(prev => prev.map(c => c.id === contractId ? { ...c, status: 'disputed' } : c));
                setContracts(prev => {
                    const contract = prev.find(c => c.id === contractId);
                    if (contract) {
                        const newDispute = {
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
                        };
                        setDisputes(prev => [...prev, newDispute]);
                    }
                    return prev;
                });
            }
            return result;
        }
        finally {
            setIsLoading(false);
        }
    }, [simulateTransaction]);
    const castVote = useCallback(async (disputeId, vote, _reasoning) => {
        setIsLoading(true);
        try {
            const result = await simulateTransaction();
            if (result.success) {
                setDisputes(prev => prev.map(d => {
                    if (d.id === disputeId) {
                        return {
                            ...d,
                            votesFor: vote === 'approve' ? d.votesFor + 1 : d.votesFor,
                            votesAgainst: vote === 'reject' ? d.votesAgainst + 1 : d.votesAgainst
                        };
                    }
                    return d;
                }));
            }
            return result;
        }
        finally {
            setIsLoading(false);
        }
    }, [simulateTransaction]);
    // Alias for jury components that use 'client'/'freelancer' vote values
    const voteOnDispute = useCallback(async (disputeId, vote) => {
        return castVote(disputeId, vote === 'client' ? 'approve' : 'reject', '');
    }, [castVote]);
    return (<ContractContext.Provider value={{
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
        }}>
      {children}
    </ContractContext.Provider>);
}
export function useContracts() {
    const context = useContext(ContractContext);
    if (context === undefined) {
        throw new Error('useContracts must be used within a ContractProvider');
    }
    return context;
}
// Alias for components that use useContract (singular)
export const useContract = useContracts;
