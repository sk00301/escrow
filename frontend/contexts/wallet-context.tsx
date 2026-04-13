'use client'

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'

interface WalletContextType {
  walletAddress: string | null
  isConnected: boolean
  chainId: number | null
  balance: string
  isConnecting: boolean
  connectWallet: (type: 'metamask' | 'walletconnect') => Promise<void>
  disconnectWallet: () => void
  isDemoMode: boolean
}

const WalletContext = createContext<WalletContextType | undefined>(undefined)

const DEMO_WALLET = '0x8Ba1f109551bD432803012645Ac136ddd64DBA72'
const SEPOLIA_CHAIN_ID = 11155111

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [chainId, setChainId] = useState<number | null>(null)
  const [balance, setBalance] = useState('0.0000')
  const [isConnecting, setIsConnecting] = useState(false)
  const [isDemoMode, setIsDemoMode] = useState(false)

  const connectWallet = useCallback(async (type: 'metamask' | 'walletconnect') => {
    setIsConnecting(true)
    
    try {
      // Check if MetaMask is available
      if (type === 'metamask' && typeof window !== 'undefined' && window.ethereum) {
        try {
          const accounts = await window.ethereum.request({ 
            method: 'eth_requestAccounts' 
          })
          
          if (accounts && accounts.length > 0) {
            setWalletAddress(accounts[0])
            setIsConnected(true)
            setIsDemoMode(false)
            
            // Get chain ID
            const chainIdHex = await window.ethereum.request({ 
              method: 'eth_chainId' 
            })
            setChainId(parseInt(chainIdHex, 16))
            
            // Get balance
            const balanceHex = await window.ethereum.request({
              method: 'eth_getBalance',
              params: [accounts[0], 'latest']
            })
            const balanceEth = parseInt(balanceHex, 16) / 1e18
            setBalance(balanceEth.toFixed(4))
            
            return
          }
        } catch {
          console.log('[v0] MetaMask connection failed, falling back to demo mode')
        }
      }
      
      // Demo mode fallback
      await new Promise(resolve => setTimeout(resolve, 1500))
      setWalletAddress(DEMO_WALLET)
      setIsConnected(true)
      setChainId(SEPOLIA_CHAIN_ID)
      setBalance('4.2500')
      setIsDemoMode(true)
      
    } finally {
      setIsConnecting(false)
    }
  }, [])

  const disconnectWallet = useCallback(() => {
    setWalletAddress(null)
    setIsConnected(false)
    setChainId(null)
    setBalance('0.0000')
    setIsDemoMode(false)
  }, [])

  // Listen for account changes
  useEffect(() => {
    if (typeof window !== 'undefined' && window.ethereum) {
      const handleAccountsChanged = (accounts: string[]) => {
        if (accounts.length === 0) {
          disconnectWallet()
        } else {
          setWalletAddress(accounts[0])
        }
      }

      const handleChainChanged = (chainIdHex: string) => {
        setChainId(parseInt(chainIdHex, 16))
      }

      window.ethereum.on('accountsChanged', handleAccountsChanged)
      window.ethereum.on('chainChanged', handleChainChanged)

      return () => {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged)
        window.ethereum.removeListener('chainChanged', handleChainChanged)
      }
    }
  }, [disconnectWallet])

  return (
    <WalletContext.Provider
      value={{
        walletAddress,
        isConnected,
        chainId,
        balance,
        isConnecting,
        connectWallet,
        disconnectWallet,
        isDemoMode
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const context = useContext(WalletContext)
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return context
}

// Type declaration for window.ethereum
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
      on: (event: string, handler: (...args: unknown[]) => void) => void
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void
    }
  }
}
