'use client';

/**
 * wallet-context.jsx
 * Real MetaMask integration — replaces the mock/demo wallet context.
 *
 * Exports:
 *   WalletProvider  — wrap your app (already done in app-providers.jsx)
 *   useWallet()     — hook for any component
 *
 * API surface is backwards-compatible with the old mock context:
 *   walletAddress, isConnected, chainId, balance, isConnecting,
 *   connectWallet, disconnectWallet, isDemoMode (always false now)
 * Plus new real fields:
 *   signer, provider, isCorrectNetwork, shortAddress,
 *   switchToSepolia, error, setError
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from 'react';
import { ethers } from 'ethers';

const WalletContext = createContext(undefined);

// ── Network constants ────────────────────────────────────────────────────────

const SEPOLIA_CHAIN_ID  = 11155111;
const SEPOLIA_HEX       = '0xaa36a7';

const SEPOLIA_PARAMS = {
  chainId:           SEPOLIA_HEX,
  chainName:         'Sepolia Testnet',
  nativeCurrency:    { name: 'SepoliaETH', symbol: 'ETH', decimals: 18 },
  rpcUrls:           ['https://rpc.sepolia.org', 'https://sepolia.infura.io/v3/'],
  blockExplorerUrls: ['https://sepolia.etherscan.io'],
};

// ── Provider ─────────────────────────────────────────────────────────────────

export function WalletProvider({ children }) {
  const [provider,      setProvider]      = useState(null);
  const [signer,        setSigner]        = useState(null);
  const [walletAddress, setWalletAddress] = useState(null);
  const [balance,       setBalance]       = useState('0.0000');
  const [chainId,       setChainId]       = useState(null);
  const [isConnecting,  setIsConnecting]  = useState(false);
  const [error,         setError]         = useState(null);

  // ── Derived state ──────────────────────────────────────────────────────────

  const isConnected      = Boolean(walletAddress);
  const isCorrectNetwork = chainId === SEPOLIA_CHAIN_ID;
  const isDemoMode       = false; // always false — this is the real implementation
  const shortAddress     = walletAddress
    ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
    : null;

  // ── Internal helpers ───────────────────────────────────────────────────────

  const clearState = useCallback(() => {
    setProvider(null);
    setSigner(null);
    setWalletAddress(null);
    setBalance('0.0000');
    setChainId(null);
    setError(null);
  }, []);

  const hydrateFromProvider = useCallback(async (ethersProvider, address) => {
    const network    = await ethersProvider.getNetwork();
    const ethSigner  = await ethersProvider.getSigner();
    const rawBalance = await ethersProvider.getBalance(address);

    setProvider(ethersProvider);
    setSigner(ethSigner);
    setWalletAddress(address);
    setChainId(Number(network.chainId));
    setBalance(parseFloat(ethers.formatEther(rawBalance)).toFixed(4));
  }, []);

  // ── switchToSepolia ────────────────────────────────────────────────────────

  const switchToSepolia = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: SEPOLIA_HEX }],
      });
    } catch (switchErr) {
      // Error 4902 = chain not added yet
      if (switchErr.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [SEPOLIA_PARAMS],
          });
        } catch {
          setError('Could not add Sepolia to MetaMask. Please add it manually.');
        }
      } else {
        setError('Failed to switch network. Please switch to Sepolia in MetaMask.');
      }
    }
  }, []);

  // ── connectWallet ──────────────────────────────────────────────────────────

  const connectWallet = useCallback(async (type = 'metamask') => {
    setError(null);
    setIsConnecting(true);

    try {
      // Only MetaMask supported — no demo fallback anymore
      if (typeof window === 'undefined' || !window.ethereum) {
        setError('MetaMask is not installed. Please install it from metamask.io');
        return;
      }

      // eth_requestAccounts triggers the MetaMask popup
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });

      if (!accounts || accounts.length === 0) {
        setError('No accounts returned. Please unlock MetaMask and try again.');
        return;
      }

      const ethersProvider = new ethers.BrowserProvider(window.ethereum);
      await hydrateFromProvider(ethersProvider, accounts[0]);
    } catch (err) {
      if (err.code === 4001) {
        setError('Connection rejected. Please approve the MetaMask request.');
      } else {
        setError(err.message || 'Failed to connect wallet. Please try again.');
      }
      clearState();
    } finally {
      setIsConnecting(false);
    }
  }, [hydrateFromProvider, clearState]);

  // ── disconnectWallet ───────────────────────────────────────────────────────
  // MetaMask has no programmatic disconnect — we clear local state only.

  const disconnectWallet = useCallback(() => {
    clearState();
  }, [clearState]);

  // ── Auto-reconnect on page load (silent — no popup) ───────────────────────

  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) return;

    const autoConnect = async () => {
      try {
        // eth_accounts does NOT prompt the user
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts && accounts.length > 0) {
          const ethersProvider = new ethers.BrowserProvider(window.ethereum);
          await hydrateFromProvider(ethersProvider, accounts[0]);
        }
      } catch {
        // Silently ignore — user simply isn't connected
      }
    };

    autoConnect();
  }, [hydrateFromProvider]);

  // ── MetaMask event listeners ───────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) return;

    const handleAccountsChanged = async (accounts) => {
      if (!accounts || accounts.length === 0) {
        clearState();
        return;
      }
      try {
        const ethersProvider = new ethers.BrowserProvider(window.ethereum);
        await hydrateFromProvider(ethersProvider, accounts[0]);
      } catch {
        clearState();
      }
    };

    const handleChainChanged = () => {
      // MetaMask recommends a full reload on chain change
      window.location.reload();
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged',    handleChainChanged);

    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener('chainChanged',    handleChainChanged);
    };
  }, [hydrateFromProvider, clearState]);

  // ── Context value ──────────────────────────────────────────────────────────

  return (
    <WalletContext.Provider value={{
      // Backwards-compatible fields (same names as old mock context)
      walletAddress,
      isConnected,
      chainId,
      balance,
      isConnecting,
      isDemoMode,
      connectWallet,
      disconnectWallet,
      // New real fields
      provider,
      signer,
      shortAddress,
      isCorrectNetwork,
      switchToSepolia,
      error,
      setError,
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
