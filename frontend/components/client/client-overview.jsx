'use client';
import { useMemo } from 'react';
import { StatsCard } from '@/components/stats-card';
import { StatusBadge } from '@/components/status-badge';
import { useContracts } from '@/contexts/contract-context';
import { useUser } from '@/contexts/user-context';
import { useWallet } from '@/contexts/wallet-context';
import { Button } from '@/components/ui/button';
import { FileText, Clock, Wallet, AlertTriangle, Eye, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function parseDate(value) {
    const ts = new Date(value).getTime();
    return Number.isFinite(ts) ? ts : null;
}

function calculateTrend(currentValue, previousValue, label) {
    if (currentValue === 0 && previousValue === 0) return null;
    if (previousValue === 0) return { value: 100, positive: currentValue >= previousValue, label };
    const delta = ((currentValue - previousValue) / previousValue) * 100;
    return { value: Math.round(Math.abs(delta)), positive: delta >= 0, label };
}

export function ClientOverview() {
    const { contracts } = useContracts();
    const { userStats } = useUser();
    const { walletAddress } = useWallet();

    const activeContractsTrend = useMemo(() => {
        if (!walletAddress) return null;

        const addr = walletAddress.toLowerCase();
        const myClientContracts = contracts.filter(c => c.clientAddress?.toLowerCase() === addr);
        if (myClientContracts.length === 0) return null;

        const now = Date.now();
        const comparePoint = now - THIRTY_DAYS_MS;
        const previousActive = myClientContracts.filter((contract) => {
            const createdAt = parseDate(contract.createdAt);
            if (!createdAt || createdAt > comparePoint) return false;

            const resolvedAt = parseDate(contract.resolvedAt);
            if (!resolvedAt) return true;
            return resolvedAt > comparePoint;
        }).length;

        return calculateTrend(
            userStats.activeContracts || 0,
            previousActive,
            'vs 30 days ago'
        );
    }, [contracts, walletAddress, userStats.activeContracts]);

    const truncateAddress = (address) => {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    };
    // Get recent contracts (last 5)
    const recentContracts = contracts.slice(0, 5);
    return (<div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Client Dashboard</h1>
        <p className="text-muted-foreground">Manage your contracts and milestones</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard title="Active Contracts" value={userStats.activeContracts || 0} icon={FileText} trend={activeContractsTrend}/>
        <StatsCard title="Pending Reviews" value={userStats.pendingReviews || 0} icon={Clock}/>
        <StatsCard title="Total Paid" value={(userStats.totalPaid || 0).toFixed(4)} suffix="ETH" icon={Wallet}/>
        <StatsCard title="Disputes Open" value={userStats.disputesOpen || 0} icon={AlertTriangle}/>
      </div>

      {/* Recent Contracts Table */}
      <div className="glass-card rounded-xl border border-border">
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Recent Contracts</h2>
          <Link href="/client?tab=contracts">
            <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80 gap-1">
              View All
              <ArrowRight className="h-4 w-4"/>
            </Button>
          </Link>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">
                  Freelancer
                </th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">
                  Milestone
                </th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">
                  Amount
                </th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">
                  Status
                </th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recentContracts.map((contract) => (<tr key={contract.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-4">
                    <span className="font-mono text-sm text-foreground">
                      {truncateAddress(contract.freelancerAddress)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {contract.milestoneTitle}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Due: {format(new Date(contract.deadline), 'dd MMM yyyy')}
                      </p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm font-medium text-foreground">
                      {contract.amount.toFixed(4)} ETH
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={contract.status} pulse={contract.status === 'submitted'}/>
                  </td>
                  <td className="px-6 py-4">
                    <Link href={`/verification/${contract.id}`}>
                      <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80 gap-1">
                        <Eye className="h-4 w-4"/>
                        View
                      </Button>
                    </Link>
                  </td>
                </tr>))}
            </tbody>
          </table>
        </div>
      </div>
    </div>);
}
