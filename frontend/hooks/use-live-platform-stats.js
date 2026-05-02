'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ethers } from 'ethers';
import EscrowABI from '@/contracts/abis/EscrowContract.json';
import DisputeABI from '@/contracts/abis/DisputeContract.json';
import JuryABI from '@/contracts/abis/JuryStaking.json';
import ADDRESSES from '@/contracts/addresses.json';

const SEPOLIA_CHAIN_ID = 11155111;
const REFRESH_INTERVAL_MS = 30_000;

const FALLBACK_RPC_URLS = [
  process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL,
  process.env.NEXT_PUBLIC_RPC_URL,
  'https://rpc.sepolia.org',
  'https://ethereum-sepolia-rpc.publicnode.com',
].filter(Boolean);

const EMPTY_STATS = {
  totalContracts: 0,
  totalPaidOut: 0,
  disputesResolved: 0,
  activeJurors: 0,
};

function toNumber(value) {
  if (value == null) return 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

export function useLivePlatformStats({ provider } = {}) {
  const [stats, setStats] = useState(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const hasLoaded = useRef(false);

  const getReadProvider = useCallback(async () => {
    if (provider) return provider;

    let lastError = null;
    for (const rpcUrl of FALLBACK_RPC_URLS) {
      try {
        const readProvider = new ethers.JsonRpcProvider(rpcUrl, SEPOLIA_CHAIN_ID);
        await readProvider.getBlockNumber();
        return readProvider;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('Unable to connect to a Sepolia RPC endpoint.');
  }, [provider]);

  const fetchStats = useCallback(async (isActive = () => true) => {
    if (!hasLoaded.current && isActive()) setLoading(true);

    try {
      const readProvider = await getReadProvider();
      const escrow = new ethers.Contract(ADDRESSES.EscrowContract, EscrowABI.abi, readProvider);
      const dispute = new ethers.Contract(ADDRESSES.DisputeContract, DisputeABI.abi, readProvider);
      const jury = new ethers.Contract(ADDRESSES.JuryStaking, JuryABI.abi, readProvider);

      const [totalContractsRaw, paidEvents, resolvedDisputes, activeJurorsRaw] = await Promise.all([
        escrow.getTotalMilestones().catch(() => escrow.milestoneCount()),
        escrow.queryFilter(escrow.filters.PaymentReleased(), 0, 'latest'),
        dispute.queryFilter(dispute.filters.VerdictSubmitted(), 0, 'latest'),
        jury.getPoolSize(),
      ]);

      let paidOutWei = 0n;
      for (const evt of paidEvents) {
        const amount = evt?.args?.amount ?? 0n;
        paidOutWei += BigInt(amount);
      }

      if (!isActive()) return;

      setStats({
        totalContracts: toNumber(totalContractsRaw),
        totalPaidOut: parseFloat(ethers.formatEther(paidOutWei)),
        disputesResolved: resolvedDisputes.length,
        activeJurors: toNumber(activeJurorsRaw),
      });
      setError(null);
      setLoading(false);
      setLastUpdated(new Date());
      hasLoaded.current = true;
    } catch (err) {
      if (!isActive()) return;
      setError(err instanceof Error ? err.message : 'Failed to load platform stats.');
      setLoading(false);
    }
  }, [getReadProvider]);

  useEffect(() => {
    let active = true;
    const isActive = () => active;

    fetchStats(isActive);
    const timer = setInterval(() => fetchStats(isActive), REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [fetchStats]);

  return { stats, loading, error, lastUpdated, refresh: fetchStats };
}
