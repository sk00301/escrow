'use client'

import { WalletProvider } from '@/contexts/wallet-context'
import { ContractProvider } from '@/contexts/contract-context'
import { UserProvider } from '@/contexts/user-context'

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <ContractProvider>
        <UserProvider>
          {children}
        </UserProvider>
      </ContractProvider>
    </WalletProvider>
  )
}
