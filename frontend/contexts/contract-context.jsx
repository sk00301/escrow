'use client';

/**
 * contract-context.jsx — real on-chain integration
 *
 * The adapter layer (normaliseContract / normaliseDispute) maps raw on-chain
 * struct fields to the shape every existing component already expects,
 * so NO component files need to be changed.
 *
 * On-chain field  →  component expects
 * ─────────────────────────────────────
 * m.freelancer    →  contract.freelancerAddress
 * m.client        →  contract.clientAddress
 * m.amount (wei)  →  contract.amount  (Number in ETH)
 * m.state (uint8) →  contract.status  ('funded','submitted', …)
 * m.score (0-100) →  verificationResults[id].score  (0.0–1.0)
 */

import React, {
  createContext, useContext, useState, useEffect, useCallback,
} from 'react';
import { ethers } from 'ethers';
import { useWallet } from '@/contexts/wallet-context';

import EscrowABI   from '@/contracts/abis/EscrowContract.json';
import DisputeABI  from '@/contracts/abis/DisputeContract.json';
import EvidenceABI from '@/contracts/abis/EvidenceRegistry.json';
import JuryABI     from '@/contracts/abis/JuryStaking.json';
import ADDRESSES   from '@/contracts/addresses.json';

const ContractContext = createContext(undefined);

// ── State enum → status string ────────────────────────────────────────────────

const STATE_TO_STATUS = {
  0: 'created', 1: 'funded', 2: 'submitted', 3: 'verified',
  4: 'rejected', 5: 'disputed', 6: 'resolved', 7: 'released', 8: 'refunded',
};

// ── Adapters ──────────────────────────────────────────────────────────────────

function normaliseContract(milestoneId, m, evidenceData = null, meta = null) {
  const id        = milestoneId.toString();
  const amountEth = parseFloat(ethers.formatEther(m.amount ?? 0n));
  const state     = Number(m.state ?? 0);

  return {
    // identity
    id,
    milestoneId: id,

    // address fields — both naming conventions so all components work
    client:            m.client,
    clientAddress:     m.client,
    freelancer:        m.freelancer,
    freelancerAddress: m.freelancer,

    // milestone descriptor
    milestoneHash:     m.milestoneHash,
    milestoneTitle:    meta?.title          ?? `Milestone #${id}`,
    description:       meta?.description   ?? '',
    deliverableType:   meta?.deliverableType ?? 'code',

    // financials
    amount: amountEth,   // Number in ETH — components do contract.amount.toFixed(4)

    // timing
    deadline:    new Date(Number(m.deadline)    * 1000).toISOString(),
    createdAt:   new Date(Number(m.createdAt   ?? 0) * 1000).toISOString(),
    fundedAt:    m.fundedAt    ? new Date(Number(m.fundedAt)    * 1000).toISOString() : null,
    submittedAt: m.submittedAt ? new Date(Number(m.submittedAt) * 1000).toISOString() : null,
    resolvedAt:  m.resolvedAt  ? new Date(Number(m.resolvedAt)  * 1000).toISOString() : null,

    // state / status
    state,
    status: STATE_TO_STATUS[state] ?? 'unknown',

    // verification
    score:        Number(m.score ?? 0),
    verdict:      m.verdict ?? '',
    evidenceHash: m.evidenceHash,
    ipfsCID:      m.ipfsCID ?? '',
    evidence:     evidenceData,

    // acceptanceCriteria — not stored on-chain; components expect
    // contract.acceptanceCriteria.requirements (array) and .testPassRate (number)
    acceptanceCriteria: meta?.acceptanceCriteria ?? {
      testPassRate: 75,
      requirements: ['Automated tests passing', 'Static analysis clean'],
    },
  };
}

function normaliseDispute(disputeId, d) {
  const DISPUTE_STATUS = ['open', 'jurors_assigned', 'voting', 'resolved'];
  return {
    id:                  disputeId.toString(),
    milestoneId:         d.milestoneId?.toString() ?? '',
    clientAddress:       d.client      ?? '',
    freelancerAddress:   d.freelancer  ?? '',
    stakedAmount:        parseFloat(ethers.formatEther(d.stakedAmount ?? 0n)),
    status:              DISPUTE_STATUS[Number(d.status ?? 0)] ?? 'open',
    releaseToFreelancer: d.releaseToFreelancer ?? false,
    createdAt:           new Date(Number(d.createdAt ?? 0) * 1000).toISOString(),
    resolvedAt:          d.resolvedAt ? new Date(Number(d.resolvedAt) * 1000).toISOString() : null,
    // Fields the jury components expect
    reason:              `Dispute for Milestone #${d.milestoneId}`,
    assignedJurors:      d.jurors ?? [],
    jurors:              d.jurors ?? [],
    votes:               [],
    evidence:            [],
    votingDeadline:      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

// ── Error parser ──────────────────────────────────────────────────────────────

const REVERT_MAP = {
  'milestone does not exist':        'This milestone does not exist.',
  'invalid state transition':        'This action cannot be done in the current state.',
  'caller is not the client':        'Only the client can do this.',
  'caller is not the freelancer':    'Only the freelancer can do this.',
  'must send ETH to fund milestone': 'You must send ETH to fund the milestone.',
  'deadline must be in the future':  'The deadline must be in the future.',
  'submission deadline has passed':  'The submission deadline has passed.',
  'deadline has not passed yet':     'The deadline has not passed yet.',
  'empty evidence hash':             'Submission hash is empty — please re-upload.',
  'empty IPFS CID':                  'IPFS upload did not return a CID.',
  'client and freelancer must differ':'You cannot be both client and freelancer.',
  'stake below minimum':             'Minimum stake is 0.01 ETH.',
  'already staked':                  'You are already staked as a juror.',
  'cannot unstake while assigned':   'Cannot unstake while assigned to a dispute.',
  'juror has already voted':         'You have already voted on this dispute.',
  'caller is not a selected juror':  'You are not a selected juror for this dispute.',
  'not all jurors have voted yet':   'Waiting for all jurors to vote.',
  'user rejected':                   'Transaction cancelled.',
  'insufficient funds':              'Insufficient ETH for this transaction.',
};

function parseContractError(err) {
  const raw = [err?.reason, err?.data?.message, err?.error?.message, err?.message]
    .filter(Boolean).join(' ').toLowerCase();
  for (const [k, v] of Object.entries(REVERT_MAP)) {
    if (raw.includes(k.toLowerCase())) return v;
  }
  if (raw.includes('user rejected') || raw.includes('denied')) return 'Transaction cancelled.';
  return err?.message || 'Transaction failed. Please try again.';
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function ContractProvider({ children }) {
  const { signer, provider, isCorrectNetwork, walletAddress } = useWallet();

  const [escrow,   setEscrow]   = useState(null);
  const [dispute,  setDispute]  = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [jury,     setJury]     = useState(null);

  const [isLoading,     setIsLoading]     = useState(false);
  const [lastTx,        setLastTx]        = useState(null);
  const [contractError, setContractError] = useState(null);

  const [contracts,           setContracts]           = useState([]);
  const [disputes,            setDisputes]            = useState([]);
  const [verificationResults, setVerificationResults] = useState({});

  // ── Off-chain metadata cache (localStorage) ───────────────────────────────
  // Stores title, description, deliverableType, acceptanceCriteria keyed by milestoneId

  const saveMeta = useCallback((id, meta) => {
    try { localStorage.setItem(`m_meta_${id}`, JSON.stringify(meta)); } catch { /* ignore */ }
  }, []);

  const loadMeta = useCallback((id) => {
    try {
      const raw = localStorage.getItem(`m_meta_${id}`);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, []);

  // ── Init contract instances ───────────────────────────────────────────────

  useEffect(() => {
    if (!signer || !isCorrectNetwork) {
      setEscrow(null); setDispute(null); setEvidence(null); setJury(null);
      return;
    }
    try {
      setEscrow(  new ethers.Contract(ADDRESSES.EscrowContract,   EscrowABI.abi,   signer));
      setDispute( new ethers.Contract(ADDRESSES.DisputeContract,  DisputeABI.abi,  signer));
      setEvidence(new ethers.Contract(ADDRESSES.EvidenceRegistry, EvidenceABI.abi, signer));
      setJury(    new ethers.Contract(ADDRESSES.JuryStaking,      JuryABI.abi,     signer));
    } catch (err) {
      setContractError('Failed to load contracts: ' + err.message);
    }
  }, [signer, isCorrectNetwork]);

  // ── sendTx helper ─────────────────────────────────────────────────────────

  const sendTx = useCallback(async (txPromise, description = 'Transaction') => {
    setIsLoading(true);
    setContractError(null);
    setLastTx(null);
    try {
      const tx = await txPromise;
      setLastTx({ hash: tx.hash, description });
      return await tx.wait(1);
    } catch (err) {
      const msg = parseContractError(err);
      setContractError(msg);
      throw new Error(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── IPFS upload ───────────────────────────────────────────────────────────

  const uploadToIPFS = useCallback(async (file) => {
    const formData = new FormData();
    formData.append('file', file instanceof Blob ? file : new Blob([file], { type: 'text/plain' }));
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const res = await fetch(`${apiUrl}/api/ipfs/upload`, { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `IPFS upload failed (HTTP ${res.status})`);
    }
    const data = await res.json();
    return { cid: data.cid, contentHash: data.content_hash };
  }, []);

  // ── getContract ───────────────────────────────────────────────────────────

  const getContract = useCallback(async (milestoneId) => {
    if (!escrow) throw new Error('Contracts not initialised.');
    const m = await escrow.getMilestone(milestoneId);

    let evidenceData = null;
    try {
      const ev = await evidence?.getEvidence(milestoneId);
      if (ev) evidenceData = {
        contentHash: ev.contentHash, ipfsCID: ev.ipfsCID,
        submitter: ev.submitter, timestamp: Number(ev.timestamp),
      };
    } catch { /* not submitted yet */ }

    return normaliseContract(milestoneId, m, evidenceData, loadMeta(milestoneId));
  }, [escrow, evidence, loadMeta]);

  // ── getAllContracts ────────────────────────────────────────────────────────

  const getAllContracts = useCallback(async (address, role = 'client') => {
    if (!escrow || !provider) return [];
    const filter = role === 'client'
      ? escrow.filters.MilestoneCreated(null, address, null)
      : escrow.filters.MilestoneCreated(null, null, address);
    const events = await escrow.queryFilter(filter, 0, 'latest');
    const results = await Promise.allSettled(
      events.map(evt => getContract(evt.args.milestoneId.toString()))
    );
    return results.filter(r => r.status === 'fulfilled').map(r => r.value);
  }, [escrow, provider, getContract]);

  // ── createMilestone ───────────────────────────────────────────────────────

  const createMilestone = useCallback(async ({
    freelancerAddress, clientAddress, milestoneTitle, description,
    amount, deadline, deliverableType = 'code',
    acceptanceCriteria = { testPassRate: 75, requirements: [] },
  }) => {
    if (!escrow) throw new Error('Contracts not initialised. Connect your wallet first.');

    const deadlineTs = deadline instanceof Date
      ? Math.floor(deadline.getTime() / 1000) : Number(deadline);

    const milestoneHash = ethers.keccak256(
      ethers.toUtf8Bytes(JSON.stringify({ title: milestoneTitle, description, deadline: deadlineTs }))
    );

    const createReceipt = await sendTx(
      escrow.createMilestone(freelancerAddress, milestoneHash, deadlineTs),
      'Create Milestone'
    );

    let milestoneId = null;
    for (const log of createReceipt.logs) {
      try {
        const parsed = escrow.interface.parseLog(log);
        if (parsed?.name === 'MilestoneCreated') {
          milestoneId = parsed.args.milestoneId.toString();
          break;
        }
      } catch { /* skip */ }
    }
    if (milestoneId === null) throw new Error('Could not read milestoneId from MilestoneCreated event.');

    const fundReceipt = await sendTx(
      escrow.fundMilestone(milestoneId, { value: ethers.parseEther(amount.toString()) }),
      'Fund Milestone'
    );

    // Persist off-chain metadata
    saveMeta(milestoneId, { title: milestoneTitle, description, deliverableType, acceptanceCriteria });

    // Refresh contracts list
    if (walletAddress) {
      getAllContracts(walletAddress, 'client').then(data => {
        setContracts(prev => {
          const seen = new Set(prev.map(c => c.id));
          return [...prev, ...data.filter(c => !seen.has(c.id))];
        });
      }).catch(() => {});
    }

    return { success: true, hash: fundReceipt.hash, milestoneId };
  }, [escrow, sendTx, saveMeta, walletAddress, getAllContracts]);

  // ── submitWork ────────────────────────────────────────────────────────────
  // Accepts a File object OR a plain string (description/link — from the old mock UI)

  const submitWork = useCallback(async (milestoneId, fileOrString) => {
    if (!escrow) throw new Error('Contracts not initialised. Connect your wallet first.');

    let file = fileOrString;
    if (typeof fileOrString === 'string') {
      file = new Blob([fileOrString], { type: 'text/plain' });
    }

    const { cid, contentHash } = await uploadToIPFS(file);
    const evidenceHashBytes32 = contentHash.startsWith('0x')
      ? contentHash.padEnd(66, '0') : '0x' + contentHash.padEnd(64, '0');

    const receipt = await sendTx(
      escrow.submitWork(milestoneId, evidenceHashBytes32, cid),
      'Submit Work'
    );

    setContracts(prev => prev.map(c =>
      c.id === milestoneId.toString()
        ? { ...c, status: 'submitted', ipfsCID: cid, evidenceHash: evidenceHashBytes32 }
        : c
    ));

    return { success: true, hash: receipt.hash, ipfsCID: cid, contentHash: evidenceHashBytes32 };
  }, [escrow, sendTx, uploadToIPFS]);

  // ── releasePayment ────────────────────────────────────────────────────────

  const releasePayment = useCallback(async (milestoneId) => {
    if (!escrow) throw new Error('Contracts not initialised.');
    const receipt = await sendTx(escrow.releasePayment(milestoneId), 'Release Payment');
    setContracts(prev => prev.map(c =>
      c.id === milestoneId.toString() ? { ...c, status: 'released' } : c
    ));
    return { success: true, hash: receipt.hash };
  }, [escrow, sendTx]);

  // ── raiseDispute ──────────────────────────────────────────────────────────

  const raiseDispute = useCallback(async (milestoneId, _reason = '') => {
    if (!escrow) throw new Error('Contracts not initialised.');
    const receipt = await sendTx(escrow.raiseDispute(milestoneId), 'Raise Dispute');
    setContracts(prev => prev.map(c =>
      c.id === milestoneId.toString() ? { ...c, status: 'disputed' } : c
    ));
    return { success: true, hash: receipt.hash };
  }, [escrow, sendTx]);

  // ── getTimeoutRefund ──────────────────────────────────────────────────────

  const getTimeoutRefund = useCallback(async (milestoneId) => {
    if (!escrow) throw new Error('Contracts not initialised.');
    const receipt = await sendTx(escrow.getTimeoutRefund(milestoneId), 'Claim Timeout Refund');
    return { success: true, hash: receipt.hash };
  }, [escrow, sendTx]);

  // ── Jury ──────────────────────────────────────────────────────────────────

  const stakeToBeJuror = useCallback(async (ethAmount = '0.01') => {
    if (!jury) throw new Error('Contracts not initialised.');
    const receipt = await sendTx(
      jury.stakeToBeJuror({ value: ethers.parseEther(ethAmount.toString()) }),
      'Stake as Juror'
    );
    return { success: true, hash: receipt.hash };
  }, [jury, sendTx]);

  const unstake = useCallback(async () => {
    if (!jury) throw new Error('Contracts not initialised.');
    const receipt = await sendTx(jury.unstake(), 'Unstake');
    return { success: true, hash: receipt.hash };
  }, [jury, sendTx]);

  const castVote = useCallback(async (disputeId, vote, _reasoning = '') => {
    if (!jury) throw new Error('Contracts not initialised.');
    const releaseToFreelancer = typeof vote === 'boolean'
      ? vote : (vote === 'freelancer' || vote === 'approve');
    const receipt = await sendTx(jury.castVote(disputeId, releaseToFreelancer), 'Cast Vote');
    return { success: true, hash: receipt.hash };
  }, [jury, sendTx]);

  const voteOnDispute = useCallback((disputeId, vote) => castVote(disputeId, vote), [castVote]);

  const tallyVotes = useCallback(async (disputeId) => {
    if (!jury) throw new Error('Contracts not initialised.');
    const receipt = await sendTx(jury.tallyVotes(disputeId), 'Tally Votes');
    return { success: true, hash: receipt.hash };
  }, [jury, sendTx]);

  // ── Load data on connect ──────────────────────────────────────────────────

  useEffect(() => {
    if (!escrow || !walletAddress || !isCorrectNetwork) return;

    const load = async () => {
      try {
        const [asClient, asFreelancer] = await Promise.all([
          getAllContracts(walletAddress, 'client'),
          getAllContracts(walletAddress, 'freelancer'),
        ]);

        const seen = new Set();
        const all  = [...asClient, ...asFreelancer].filter(c => {
          if (seen.has(c.id)) return false;
          seen.add(c.id); return true;
        });
        setContracts(all);

        const vr = {};
        for (const c of all) {
          if (c.verdict) vr[c.id] = { score: c.score / 100, verdict: c.verdict, state: c.state };
        }
        setVerificationResults(vr);

        // Load on-chain disputes for any milestone in DISPUTED state
        if (dispute) {
          const disputedMilestones = all.filter(c => c.status === 'disputed');
          const loaded = await Promise.allSettled(
            disputedMilestones.map(async ({ id }) => {
              const did = await dispute.getDisputeIdForMilestone(id).catch(() => null);
              if (did === null) return null;
              const d = await dispute.getDispute(did);
              return normaliseDispute(did, {
                milestoneId: BigInt(id),
                client:      d[1], freelancer: d[2], stakedAmount: d[3],
                jurors: d[4], status: d[5], releaseToFreelancer: d[6],
                createdAt: d[7], resolvedAt: d[8],
              });
            })
          );
          setDisputes(
            loaded.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value)
          );
        }
      } catch (err) {
        console.error('[ContractContext] Load error:', err.message);
      }
    };

    load();
  }, [escrow, dispute, walletAddress, isCorrectNetwork, getAllContracts]);

  // ─────────────────────────────────────────────────────────────────────────

  const etherscanTxLink      = (hash) => `https://sepolia.etherscan.io/tx/${hash}`;
  const etherscanAddressLink = (addr) => `https://sepolia.etherscan.io/address/${addr}`;

  return (
    <ContractContext.Provider value={{
      contracts, disputes, verificationResults, isLoading,
      createMilestone, submitWork, releasePayment, raiseDispute,
      getContract, getAllContracts, getTimeoutRefund,
      castVote, voteOnDispute, stakeToBeJuror, unstake, tallyVotes,
      contractError, setContractError, lastTx,
      escrow, dispute, evidence, jury,
      etherscanTxLink, etherscanAddressLink,
    }}>
      {children}
    </ContractContext.Provider>
  );
}

export function useContracts() {
  const context = useContext(ContractContext);
  if (context === undefined) throw new Error('useContracts must be used within a ContractProvider');
  return context;
}

export const useContract = useContracts;
