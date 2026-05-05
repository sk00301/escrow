'use client';

/**
 * contract-context.jsx
 *
 * Changes from previous version:
 *
 * PART 3 — Real-time event listeners
 *   • PaymentReleased  → updates contract status to 'released' + toast
 *   • DisputeRaised    → updates contract status to 'disputed' + notification + toast
 *   • VotesTallied     → updates dispute resolution status + toast
 *   • All listeners cleaned up on unmount via useEffect cleanup
 *
 * PART 4 — Unified error handler with toast notifications
 *   • sendTx() now calls toast({ variant: 'destructive' }) automatically
 *   • Every revert reason maps to a friendly message
 *   • Components no longer need to manually render contractError
 *   • contractError state still available for inline display if needed
 */

import React, {
  createContext, useContext, useState, useEffect, useCallback, useRef,
} from 'react';
import { ethers } from 'ethers';
import { useWallet } from '@/contexts/wallet-context';
import { toast } from '@/hooks/use-toast';

import EscrowABI   from '@/contracts/abis/EscrowContract.json';
import DisputeABI  from '@/contracts/abis/DisputeContract.json';
import EvidenceABI from '@/contracts/abis/EvidenceRegistry.json';
import JuryABI     from '@/contracts/abis/JuryStaking.json';
import ADDRESSES   from '@/contracts/addresses.json';

const ContractContext = createContext(undefined);

// ── State enum ────────────────────────────────────────────────────────────────

const STATE_TO_STATUS = {
  0: 'created', 1: 'funded',   2: 'submitted', 3: 'verified',
  4: 'rejected', 5: 'disputed', 6: 'resolved',  7: 'released', 8: 'refunded',
};

// ── Data adapters ─────────────────────────────────────────────────────────────

function normaliseContract(milestoneId, m, evidenceData = null, meta = null) {
  const id        = milestoneId.toString();
  const amountEth = parseFloat(ethers.formatEther(m.amount ?? 0n));
  const state     = Number(m.state ?? 0);
  return {
    id, milestoneId: id,
    client: m.client, clientAddress: m.client,
    freelancer: m.freelancer, freelancerAddress: m.freelancer,
    milestoneHash:   m.milestoneHash,
    milestoneTitle:  meta?.title          ?? `Milestone #${id}`,
    description:     meta?.description    ?? '',
    deliverableType: meta?.deliverableType ?? 'code',
    amount:     amountEth,
    deadline:   new Date(Number(m.deadline)     * 1000).toISOString(),
    createdAt:  new Date(Number(m.createdAt  ?? 0) * 1000).toISOString(),
    fundedAt:   m.fundedAt    ? new Date(Number(m.fundedAt)    * 1000).toISOString() : null,
    submittedAt:m.submittedAt ? new Date(Number(m.submittedAt) * 1000).toISOString() : null,
    resolvedAt: m.resolvedAt  ? new Date(Number(m.resolvedAt)  * 1000).toISOString() : null,
    state, status: STATE_TO_STATUS[state] ?? 'unknown',
    score:   Number(m.score   ?? 0),
    verdict: m.verdict ?? '',
    evidenceHash: m.evidenceHash,
    ipfsCID:      m.ipfsCID ?? '',
    evidence:     evidenceData,
    acceptanceCriteria: meta?.acceptanceCriteria ?? {
      testPassRate: 75,
      requirements: ['Automated tests passing', 'Static analysis clean'],
    },
  };
}

function normaliseDispute(disputeId, d) {
  const STATUSES = ['open', 'jurors_assigned', 'voting', 'resolved'];
  return {
    id:                  disputeId.toString(),
    milestoneId:         d.milestoneId?.toString() ?? '',
    clientAddress:       d.client      ?? '',
    freelancerAddress:   d.freelancer  ?? '',
    stakedAmount:        parseFloat(ethers.formatEther(d.stakedAmount ?? 0n)),
    status:              STATUSES[Number(d.status ?? 0)] ?? 'open',
    releaseToFreelancer: d.releaseToFreelancer ?? false,
    createdAt:   new Date(Number(d.createdAt ?? 0) * 1000).toISOString(),
    resolvedAt:  d.resolvedAt ? new Date(Number(d.resolvedAt) * 1000).toISOString() : null,
    reason:         `Dispute for Milestone #${d.milestoneId}`,
    assignedJurors: d.jurors ?? [],
    jurors:         d.jurors ?? [],
    votes:          [],
    evidence:       [],
    votingDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

// ── PART 4 — Unified error handler ───────────────────────────────────────────

const REVERT_MAP = {
  // EscrowContract
  'milestone does not exist':         'This milestone does not exist.',
  'invalid state transition':         'This action cannot be done in the current state.',
  'caller is not the client':         'Only the client can perform this action.',
  'caller is not the freelancer':     'Only the freelancer can perform this action.',
  'caller is not the oracle':         'Only the oracle can post verification results.',
  'must send eth to fund milestone':  'You must send ETH to fund the milestone.',
  'deadline must be in the future':   'The deadline must be a future date.',
  'submission deadline has passed':   'The submission deadline has already passed.',
  'deadline has not passed yet':      'The milestone deadline has not passed yet.',
  'empty evidence hash':              'Submission hash is empty — please re-upload.',
  'empty ipfs cid':                   'IPFS upload did not return a CID.',
  'client and freelancer must differ':'You cannot assign yourself as both client and freelancer.',
  // DisputeContract
  'dispute already exists':           'A dispute already exists for this milestone.',
  'dispute does not exist':           'This dispute does not exist.',
  'invalid status transition':        'This action cannot be done in the current dispute state.',
  // JuryStaking
  'stake below minimum':              'Minimum stake is 0.01 ETH.',
  'already staked':                   'You are already staked as a juror.',
  'not currently staked':             'You are not currently staked.',
  'cannot unstake while assigned':    'You cannot unstake while assigned to an active dispute.',
  'juror has already voted':          'You have already voted on this dispute.',
  'caller is not a selected juror':   'You are not a selected juror for this dispute.',
  'not all jurors have voted yet':    'Waiting for all jurors to vote before tallying.',
  'not enough available jurors':      'Not enough jurors have staked to form a jury panel.',
  // Generic
  'insufficient funds':               'Insufficient ETH in your wallet.',
  'alreadyfunded':                    'This milestone has already been funded.',
  'notsubmitted':                     'No work has been submitted for this milestone yet.',
};

function parseContractError(err) {
  const raw = [
    err?.reason, err?.data?.message, err?.error?.message, err?.message,
  ].filter(Boolean).join(' ').toLowerCase();

  // User rejected in MetaMask — no toast needed, just return silently
  if (raw.includes('user rejected') || raw.includes('user denied') || raw.includes('action_rejected')) {
    return null; // null = user cancellation, don't toast
  }
  if (raw.includes('insufficient funds')) return 'Insufficient ETH in your wallet for this transaction.';

  for (const [fragment, friendly] of Object.entries(REVERT_MAP)) {
    if (raw.includes(fragment.toLowerCase())) return friendly;
  }
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

  // Ref to current contracts — needed inside event callbacks without stale closure
  const contractsRef = useRef(contracts);
  useEffect(() => { contractsRef.current = contracts; }, [contracts]);

  // ── Metadata cache ────────────────────────────────────────────────────────

  const saveMeta = useCallback((id, meta) => {
    try { localStorage.setItem(`m_meta_${id}`, JSON.stringify(meta)); } catch { /* ignore */ }
  }, []);

  const loadMeta = useCallback((id) => {
    try { const r = localStorage.getItem(`m_meta_${id}`); return r ? JSON.parse(r) : null; }
    catch { return null; }
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

  // ── PART 3 — Real-time event listeners ───────────────────────────────────
  // Attach when escrow/jury contract instances are ready.
  // Return cleanup to remove listeners when the component unmounts or
  // contracts are re-initialised (e.g. wallet switch).

  useEffect(() => {
    if (!escrow) return;

    // PaymentReleased(uint256 indexed milestoneId, uint256 amount, address indexed freelancer)
    const onPaymentReleased = (milestoneId, amount, freelancer) => {
      const id = milestoneId.toString();
      setContracts(prev => prev.map(c =>
        c.id === id ? { ...c, status: 'released', amount: parseFloat(ethers.formatEther(amount)) } : c
      ));
      toast({
        title: 'Payment Released',
        description: `${ethers.formatEther(amount)} ETH sent to ${freelancer.slice(0,6)}...${freelancer.slice(-4)}`,
      });
    };

    // DisputeRaised(uint256 indexed milestoneId, address indexed raisedBy)
    const onDisputeRaised = (milestoneId, raisedBy) => {
      const id = milestoneId.toString();
      setContracts(prev => prev.map(c =>
        c.id === id ? { ...c, status: 'disputed' } : c
      ));
      toast({
        title:       'Dispute Raised',
        description: `Milestone #${id} has been sent to the jury. Raised by ${raisedBy.slice(0,6)}...`,
        variant:     'default',
      });
    };

    // VerificationResultPosted(uint256 indexed milestoneId, uint256 score, string verdict)
    const onVerificationPosted = (milestoneId, score, verdict) => {
      const id     = milestoneId.toString();
      const scoreN = Number(score);
      const newStatus = scoreN >= 75 ? 'verified' : scoreN >= 45 ? 'disputed' : 'rejected';
      setContracts(prev => prev.map(c =>
        c.id === id ? { ...c, status: newStatus, score: scoreN, verdict } : c
      ));
      setVerificationResults(prev => ({
        ...prev,
        [id]: { score: scoreN / 100, verdict, state: scoreN >= 75 ? 3 : scoreN >= 45 ? 5 : 4 },
      }));
      const verdictLabel = verdict === 'APPROVED' ? '✅ Approved'
                         : verdict === 'DISPUTED' ? '⚠️ Disputed — jury required'
                         : '❌ Rejected';
      toast({
        title:       `Verification Complete — Milestone #${id}`,
        description: `${verdictLabel} (score: ${scoreN}/100)`,
        variant:     verdict === 'REJECTED' ? 'destructive' : 'default',
      });
    };

    escrow.on('PaymentReleased',        onPaymentReleased);
    escrow.on('DisputeRaised',          onDisputeRaised);
    escrow.on('VerificationResultPosted', onVerificationPosted);

    return () => {
      escrow.off('PaymentReleased',          onPaymentReleased);
      escrow.off('DisputeRaised',            onDisputeRaised);
      escrow.off('VerificationResultPosted', onVerificationPosted);
    };
  }, [escrow]);

  useEffect(() => {
    if (!jury) return;

    // VotesTallied(uint256 indexed disputeId, bool releaseToFreelancer, uint256 votesFor, uint256 votesAgainst)
    const onVotesTallied = (disputeId, releaseToFreelancer, votesFor, votesAgainst) => {
      const id = disputeId.toString();
      setDisputes(prev => prev.map(d =>
        d.id === id ? { ...d, status: 'resolved', releaseToFreelancer } : d
      ));
      const outcome = releaseToFreelancer ? 'Freelancer won' : 'Client won';
      toast({
        title:       `Jury Verdict — Dispute #${id}`,
        description: `${outcome} (${Number(votesFor)} for / ${Number(votesAgainst)} against)`,
      });
    };

    jury.on('VotesTallied', onVotesTallied);
    return () => { jury.off('VotesTallied', onVotesTallied); };
  }, [jury]);

  // ── PART 4 — sendTx with auto-toast on error ──────────────────────────────

  const sendTx = useCallback(async (txPromise, description = 'Transaction') => {
    setIsLoading(true);
    setContractError(null);
    setLastTx(null);
    try {
      const tx = await txPromise;
      setLastTx({ hash: tx.hash, description });
      const receipt = await tx.wait(1);
      // Success toast
      toast({
        title:       `${description} confirmed`,
        description: `TX: ${tx.hash.slice(0,10)}...${tx.hash.slice(-8)}`,
      });
      return receipt;
    } catch (err) {
      const msg = parseContractError(err);
      if (msg) {
        // Non-null = real error (not user cancellation)
        setContractError(msg);
        toast({ title: 'Transaction Failed', description: msg, variant: 'destructive' });
        throw new Error(msg);
      }
      // User cancelled — don't toast, just re-throw silently
      throw new Error('Transaction cancelled.');
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
      const msg = err.detail || `IPFS upload failed (HTTP ${res.status})`;
      toast({ title: 'Upload Failed', description: msg, variant: 'destructive' });
      throw new Error(msg);
    }
    const data = await res.json();
    return { cid: data.cid, contentHash: data.content_hash };
  }, []);

  // ── getContract ───────────────────────────────────────────────────────────

  const getContract = useCallback(async (milestoneId) => {
    if (!escrow) throw new Error('Contracts not initialised.');

    const m = await escrow.getMilestone(milestoneId);

    let evidenceData = null;

    // ✅ ONLY call if evidence actually exists
    if (evidence) {
      try {
        const exists = await evidence.hasEvidence(milestoneId);
        if (exists) {
          const ev = await evidence.getEvidence(milestoneId);
          evidenceData = {
            contentHash: ev.contentHash,
            ipfsCID:     ev.ipfsCID,
            submitter:   ev.submitter,
            timestamp:   Number(ev.timestamp),
          };
        }
      } catch (err) {
        console.warn('Evidence lookup failed for milestone', milestoneId, err);
      }
    }

    return normaliseContract(
      milestoneId,
      m,
      evidenceData,
      loadMeta(milestoneId)
    );
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
        if (parsed?.name === 'MilestoneCreated') { milestoneId = parsed.args.milestoneId.toString(); break; }
      } catch { /* skip */ }
    }
    if (!milestoneId) throw new Error('Could not read milestoneId from MilestoneCreated event.');

    const fundReceipt = await sendTx(
      escrow.fundMilestone(milestoneId, { value: ethers.parseEther(amount.toString()) }),
      'Fund Milestone'
    );

    saveMeta(milestoneId, { title: milestoneTitle, description, deliverableType, acceptanceCriteria });

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

  const submitWork = useCallback(async (milestoneId, fileOrString) => {
    if (!escrow) throw new Error('Contracts not initialised. Connect your wallet first.');
    let file = fileOrString;
    if (typeof fileOrString === 'string') file = new Blob([fileOrString], { type: 'text/plain' });

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

  const castVote = useCallback(async (disputeId, vote, reasoning = '') => {
    if (!jury) throw new Error('Contracts not initialised.');
    const releaseToFreelancer = typeof vote === 'boolean'
      ? vote : (vote === 'freelancer' || vote === 'approve');

    const receipt = await sendTx(jury.castVote(disputeId, releaseToFreelancer), 'Cast Vote');

    // Store reasoning as a wallet-signed message locally (prototype — not on-chain).
    // This satisfies the spec requirement: "stores reasoning as signed message,
    // not on-chain, just locally for prototype — show in UI".
    if (reasoning?.trim() && signer) {
      try {
        const voteLabel  = releaseToFreelancer ? 'freelancer' : 'client';
        const payload    = JSON.stringify({ disputeId: disputeId.toString(), vote: voteLabel, reasoning: reasoning.trim() });
        const signature  = await signer.signMessage(payload);
        const key        = `vote_reason_${disputeId}_${(await signer.getAddress()).toLowerCase()}`;
        localStorage.setItem(key, JSON.stringify({
          vote:      voteLabel,
          text:      reasoning.trim(),
          signature,
          timestamp: new Date().toISOString(),
          txHash:    receipt.hash,
        }));
      } catch (err) {
        // Non-fatal — vote already submitted on-chain, just log the signing failure
        console.warn('[castVote] Could not sign reasoning:', err.message);
      }
    }

    return { success: true, hash: receipt.hash };
  }, [jury, signer, sendTx]);

  const voteOnDispute = useCallback(
    (disputeId, vote, reasoning = '') => castVote(disputeId, vote, reasoning),
    [castVote]
  );

  const tallyVotes = useCallback(async (disputeId) => {
    if (!jury) throw new Error('Contracts not initialised.');
    const receipt = await sendTx(jury.tallyVotes(disputeId), 'Tally Votes');
    return { success: true, hash: receipt.hash };
  }, [jury, sendTx]);

  // ── PART 2 — getJurorStats ────────────────────────────────────────────────
  // Queries VoteCast events to build accuracy history for a juror address.

  const getJurorStats = useCallback(async (address) => {
    if (!jury || !provider) return { totalVotes: 0, correctVotes: 0, accuracyRate: 0 };

    try {
      // VoteCast(uint256 indexed disputeId, address indexed juror, bool releaseToFreelancer)
      const filter = jury.filters.VoteCast(null, address);
      const voteEvents = await jury.queryFilter(filter, 0, 'latest');

      // VotesTallied(uint256 indexed disputeId, bool releaseToFreelancer, ...)
      const tallyFilter = jury.filters.VotesTallied();
      const tallyEvents = await jury.queryFilter(tallyFilter, 0, 'latest');

      // Build map: disputeId → final verdict
      const tallied = {};
      for (const evt of tallyEvents) {
        tallied[evt.args.disputeId.toString()] = evt.args.releaseToFreelancer;
      }

      let correct = 0;
      for (const evt of voteEvents) {
        const did = evt.args.disputeId.toString();
        if (tallied[did] !== undefined) {
          if (evt.args.releaseToFreelancer === tallied[did]) correct++;
        }
      }

      const total = voteEvents.length;
      return {
        totalVotes:  total,
        correctVotes: correct,
        accuracyRate: total > 0 ? Math.round((correct / total) * 100) : 0,
      };
    } catch (err) {
      console.warn('[getJurorStats]', err.message);
      return { totalVotes: 0, correctVotes: 0, accuracyRate: 0 };
    }
  }, [jury, provider]);

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
          if (seen.has(c.id)) return false; seen.add(c.id); return true;
        });
        setContracts(all);

        const vr = {};
        for (const c of all) {
          if (c.verdict) vr[c.id] = { score: c.score / 100, verdict: c.verdict, state: c.state };
        }
        setVerificationResults(vr);

        if (dispute) {
          // Query ALL DisputeCreated events from DisputeContract — covers
          // disputes the juror is assigned to even if they have no milestone
          // of their own. Spec: "Load active disputes from DisputeContract
          // events (filter DisputeCreated events for open disputes)".
          const disputeEvents = await dispute.queryFilter(
            dispute.filters.DisputeCreated(),
            0, 'latest'
          ).catch(() => []);

          const loadedDisputes = await Promise.allSettled(
            disputeEvents.map(async (evt) => {
              const did = evt.args.disputeId.toString();
              const d   = await dispute.getDispute(did);
              const normalised = normaliseDispute(did, {
                milestoneId:         d[0],
                client:              d[1],
                freelancer:          d[2],
                stakedAmount:        d[3],
                jurors:              d[4],
                status:              d[5],
                releaseToFreelancer: d[6],
                createdAt:           d[7],
                resolvedAt:          d[8],
              });
              // Enrich with ipfsCID from the milestone for evidence links
              const mid = normalised.milestoneId;
              if (mid) {
                const milestone = all.find(c => c.id === mid);
                if (milestone?.ipfsCID) normalised.ipfsCID = milestone.ipfsCID;
              }
              return normalised;
            })
          );

          setDisputes(
            loadedDisputes
              .filter(r => r.status === 'fulfilled' && r.value)
              .map(r => r.value)
          );
        }
      } catch (err) {
        console.error('[ContractContext] Load error:', err.message);
      }
    };

    load();
  }, [escrow, dispute, walletAddress, isCorrectNetwork, getAllContracts]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const etherscanTxLink      = (hash) => `https://sepolia.etherscan.io/tx/${hash}`;
  const etherscanAddressLink = (addr) => `https://sepolia.etherscan.io/address/${addr}`;

  return (
    <ContractContext.Provider value={{
      contracts, disputes, verificationResults, isLoading,
      createMilestone, submitWork, releasePayment, raiseDispute,
      getContract, getAllContracts, getTimeoutRefund,
      castVote, voteOnDispute, stakeToBeJuror, unstake, tallyVotes,
      getJurorStats,
      uploadToIPFS,
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
