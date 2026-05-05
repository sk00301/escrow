'use client';
/**
 * hooks/use-transaction-history.js
 *
 * Pulls all Escrow-related on-chain events for a wallet address and
 * normalises them into a flat activity list shown in both dashboards.
 *
 * Events tracked (EscrowContract):
 *   MilestoneCreated(milestoneId, client, freelancer, milestoneHash, deadline)
 *   MilestoneFunded(milestoneId, amount)
 *   WorkSubmitted(milestoneId, evidenceHash, ipfsCID)
 *   VerificationResultPosted(milestoneId, score, verdict)
 *   PaymentReleased(milestoneId, amount, freelancer)
 *   DisputeRaised(milestoneId, raisedBy)
 */

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useContracts } from '@/contexts/contract-context';
import { useWallet }    from '@/contexts/wallet-context';

const SEPOLIA_EXPLORER = 'https://sepolia.etherscan.io';

function txLink(hash)    { return `${SEPOLIA_EXPLORER}/tx/${hash}`; }
function addrLink(addr)  { return `${SEPOLIA_EXPLORER}/address/${addr}`; }
function truncate(addr)  { return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '—'; }

const EVENT_META = {
  MilestoneCreated:          { label: 'Job Created',          colour: 'blue',   icon: 'file' },
  MilestoneFunded:           { label: 'Escrow Funded',        colour: 'amber',  icon: 'wallet' },
  WorkSubmitted:             { label: 'Work Submitted',       colour: 'violet', icon: 'upload' },
  VerificationResultPosted:  { label: 'AI Verified',          colour: 'green',  icon: 'brain' },
  PaymentReleased:           { label: 'Payment Released',     colour: 'emerald',icon: 'dollar' },
  DisputeRaised:             { label: 'Dispute Raised',       colour: 'red',    icon: 'alert' },
};

function normaliseEvent(eventName, log, receipt, args) {
  const milestoneId = args.milestoneId?.toString() ?? '—';
  const base = {
    id:          `${log.transactionHash}-${log.logIndex}`,
    txHash:      log.transactionHash,
    txLink:      txLink(log.transactionHash),
    blockNumber: log.blockNumber,
    milestoneId,
    eventName,
    label:       EVENT_META[eventName]?.label  ?? eventName,
    colour:      EVENT_META[eventName]?.colour ?? 'muted',
    icon:        EVENT_META[eventName]?.icon   ?? 'file',
    timestamp:   null, // filled in after block fetch
  };

  switch (eventName) {
    case 'MilestoneCreated':
      return {
        ...base,
        description: `Job #${milestoneId} created`,
        client:     args.client,
        freelancer: args.freelancer,
        amount:     null,
      };
    case 'MilestoneFunded':
      return {
        ...base,
        description: `${parseFloat(ethers.formatEther(args.amount ?? 0n)).toFixed(4)} ETH locked in escrow`,
        amount:     parseFloat(ethers.formatEther(args.amount ?? 0n)),
      };
    case 'WorkSubmitted':
      return {
        ...base,
        description: `Work submitted for Job #${milestoneId}`,
        ipfsCID:    args.ipfsCID ?? null,
        ipfsLink:   args.ipfsCID ? `https://gateway.pinata.cloud/ipfs/${args.ipfsCID}` : null,
        amount:     null,
      };
    case 'VerificationResultPosted': {
      const score   = Number(args.score ?? 0);
      const verdict = args.verdict ?? '';
      return {
        ...base,
        description: `AI scored ${score}% — ${verdict}`,
        score, verdict,
        amount: null,
      };
    }
    case 'PaymentReleased': {
      const eth = parseFloat(ethers.formatEther(args.amount ?? 0n));
      return {
        ...base,
        description: `${eth.toFixed(4)} ETH released to ${truncate(args.freelancer)}`,
        amount:      eth,
        freelancer:  args.freelancer,
      };
    }
    case 'DisputeRaised':
      return {
        ...base,
        description: `Dispute raised for Job #${milestoneId}`,
        raisedBy:   args.raisedBy ?? args[1],
        amount:     null,
      };
    default:
      return { ...base, description: eventName, amount: null };
  }
}

export function useTransactionHistory() {
  const { escrow }         = useContracts();
  const { walletAddress, provider, isCorrectNetwork } = useWallet();

  const [history,  setHistory]  = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  const fetchHistory = useCallback(async () => {
    if (!escrow || !walletAddress || !provider || !isCorrectNetwork) return;

    setLoading(true);
    setError(null);

    try {
      const addr = walletAddress;

      // Build filters: match events where the wallet is client OR freelancer
      const EVENT_NAMES = [
        'MilestoneCreated',
        'MilestoneFunded',
        'WorkSubmitted',
        'VerificationResultPosted',
        'PaymentReleased',
        'DisputeRaised',
      ];

      // Query all events in parallel
      const allLogs = await Promise.all(
        EVENT_NAMES.map(async (name) => {
          try {
            // Try to get events for this wallet as client or freelancer
            // For events with no address filter, get all and filter locally
            const logs = await escrow.queryFilter(
              escrow.filters[name]?.() ?? { topics: [] },
              0,
              'latest'
            );
            return logs.map(log => {
              try {
                const parsed = escrow.interface.parseLog({ topics: log.topics, data: log.data });
                return { log, args: parsed?.args ?? {}, eventName: name };
              } catch {
                return null;
              }
            }).filter(Boolean);
          } catch {
            return [];
          }
        })
      );

      const flatLogs = allLogs.flat();

      // Filter to events relevant to this wallet
      const addrLower = addr.toLowerCase();
      // ethers Result may contain BigInt values for uint fields — coerce safely
      const toAddr = (v) => {
        if (!v) return '';
        try { return String(v).toLowerCase(); } catch { return ''; }
      };
      const relevant  = flatLogs.filter(({ args }) => {
        // Use only named fields — positional access causes RangeError on short events
        const client     = toAddr(args.client);
        const freelancer = toAddr(args.freelancer);
        const raisedBy   = toAddr(args.raisedBy);
        return (
          client === addrLower ||
          freelancer === addrLower ||
          raisedBy === addrLower
        );
      });

      // Normalise and sort by blockNumber (newest first)
      const normalised = relevant.map(({ log, args, eventName }) =>
        normaliseEvent(eventName, log, null, args)
      );

      // Batch-fetch block timestamps for unique block numbers
      const uniqueBlocks = [...new Set(normalised.map(e => e.blockNumber))];
      const blockTimes   = {};
      await Promise.allSettled(
        uniqueBlocks.map(async (bn) => {
          try {
            const block = await provider.getBlock(bn);
            if (block) blockTimes[bn] = new Date(block.timestamp * 1000).toISOString();
          } catch {}
        })
      );

      const withTimestamps = normalised
        .map(e => ({ ...e, timestamp: blockTimes[e.blockNumber] ?? null }))
        .sort((a, b) => b.blockNumber - a.blockNumber);

      setHistory(withTimestamps);
    } catch (err) {
      console.error('[useTransactionHistory]', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [escrow, walletAddress, provider, isCorrectNetwork]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return { history, loading, error, refetch: fetchHistory };
}
