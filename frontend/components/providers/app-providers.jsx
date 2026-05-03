'use client';
import { WalletProvider }    from '@/contexts/wallet-context';
import { ContractProvider }  from '@/contexts/contract-context';
import { UserProvider }      from '@/contexts/user-context';
import { JobBoardProvider }  from '@/contexts/job-board-context';

export function AppProviders({ children }) {
  return (
    <WalletProvider>
      <ContractProvider>
        <JobBoardProvider>
          <UserProvider>
            {children}
          </UserProvider>
        </JobBoardProvider>
      </ContractProvider>
    </WalletProvider>
  );
}
