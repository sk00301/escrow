'use client';
import { useMemo } from 'react';
import { StatsCard }   from '@/components/stats-card';
import { StatusBadge } from '@/components/status-badge';
import { useContracts } from '@/contexts/contract-context';
import { useUser }      from '@/contexts/user-context';
import { useWallet }    from '@/contexts/wallet-context';
import { useJobBoard }  from '@/contexts/job-board-context';
import { Button }  from '@/components/ui/button';
import { Badge }   from '@/components/ui/badge';
import { FileText, Clock, Wallet, AlertTriangle, Eye, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { TransactionHistory } from '@/components/transaction-history';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const BOARD_STATUS_BADGE = {
  open:      { label: 'Open',     cls: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
  accepted:  { label: 'Accepted', cls: 'bg-amber-500/10 text-amber-500 border-amber-500/20' },
  cancelled: { label: 'Cancelled',cls: 'bg-muted text-muted-foreground border-border' },
};

export function ClientOverview() {
  const { contracts }    = useContracts();
  const { userStats }    = useUser();
  const { walletAddress } = useWallet();
  const { clientJobs }   = useJobBoard();

  const boardJobs = clientJobs(walletAddress);

  // Trend: active contracts vs 30 days ago
  const activeContractsTrend = useMemo(() => {
    if (!walletAddress) return null;
    const addr = walletAddress.toLowerCase();
    const myClientContracts = contracts.filter(c => c.clientAddress?.toLowerCase() === addr);
    if (myClientContracts.length === 0) return null;
    const now          = Date.now();
    const comparePoint = now - THIRTY_DAYS_MS;
    const previousActive = myClientContracts.filter(c => {
      const createdAt = new Date(c.createdAt).getTime();
      if (!Number.isFinite(createdAt) || createdAt > comparePoint) return false;
      const resolvedAt = new Date(c.resolvedAt).getTime();
      if (!Number.isFinite(resolvedAt)) return true;
      return resolvedAt > comparePoint;
    }).length;
    const current = userStats.activeContracts ?? 0;
    if (current === 0 && previousActive === 0) return null;
    if (previousActive === 0) return { value: 100, positive: true, label: 'vs 30 days ago' };
    const delta = ((current - previousActive) / previousActive) * 100;
    return { value: Math.round(Math.abs(delta)), positive: delta >= 0, label: 'vs 30 days ago' };
  }, [contracts, walletAddress, userStats.activeContracts]);

  const truncate = addr => addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '—';

  // Recent items: merge board jobs + on-chain contracts, sorted newest first
  const boardByMId = {};
  boardJobs.forEach(j => { if (j.milestoneId) boardByMId[j.milestoneId] = j; });
  const coveredMIds = new Set(Object.keys(boardByMId));

  const recentItems = useMemo(() => {
    const items = [
      // Board jobs not yet funded
      ...boardJobs
        .filter(j => ['open','accepted','cancelled'].includes(j.status))
        .map(j => ({ ...j, _src: 'board', _sortDate: new Date(j.postedAt ?? 0).getTime() })),
      // Board funded jobs (use on-chain data if available)
      ...boardJobs
        .filter(j => j.status === 'funded' && j.milestoneId)
        .map(j => {
          const chain = contracts.find(c => c.id === j.milestoneId);
          return chain
            ? { ...chain, _boardJob: j, _src: 'chain', _sortDate: new Date(chain.createdAt ?? j.fundedAt ?? 0).getTime() }
            : { ...j, milestoneTitle: j.title, _src: 'board_funded', _sortDate: new Date(j.fundedAt ?? 0).getTime() };
        }),
      // On-chain contracts not linked to board
      ...contracts
        .filter(c =>
          c.clientAddress?.toLowerCase() === walletAddress?.toLowerCase() &&
          !coveredMIds.has(c.id)
        )
        .map(c => ({ ...c, _src: 'chain_legacy', _sortDate: new Date(c.createdAt ?? 0).getTime() })),
    ];
    return items.sort((a, b) => b._sortDate - a._sortDate).slice(0, 5);
  }, [boardJobs, contracts, walletAddress, coveredMIds]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Client Dashboard</h1>
        <p className="text-muted-foreground">Manage your jobs and milestones</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard title="Active Contracts"  value={userStats.activeContracts || 0}                       icon={FileText} trend={activeContractsTrend} />
        <StatsCard title="Pending Reviews"   value={userStats.pendingReviews || 0}                        icon={Clock} />
        <StatsCard title="Total Paid"        value={(userStats.totalPaid || 0).toFixed(4)} suffix="ETH"  icon={Wallet} />
        <StatsCard title="Disputes Open"     value={userStats.disputesOpen || 0}                          icon={AlertTriangle} />
      </div>

      {/* Recent Jobs/Contracts */}
      <div className="glass-card rounded-xl border border-border">
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Recent Jobs</h2>
          <Link href="/client?tab=contracts">
            <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80 gap-1">
              View All <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {['Freelancer','Job / Milestone','Amount','Status','Action'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recentItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-muted-foreground">
                    No jobs yet. <Link href="/client?tab=post" className="text-primary hover:underline">Post your first job →</Link>
                  </td>
                </tr>
              ) : recentItems.map((item, i) => {
                const isBoard   = item._src === 'board' || item._src === 'board_funded';
                const title     = item.milestoneTitle ?? item.title ?? '—';
                const amount    = Number(item.amount ?? 0);
                const deadline  = item.deadline;
                const freelancer = item.freelancerAddress ?? item._boardJob?.freelancerAddress;
                const status    = item.status;
                const boardBadge = BOARD_STATUS_BADGE[status];

                return (
                  <tr key={i} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4">
                      <span className="font-mono text-sm text-foreground">
                        {freelancer ? truncate(freelancer) : <span className="text-muted-foreground italic text-xs">Pending</span>}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-foreground">{title}</p>
                      {deadline && (
                        <p className="text-xs text-muted-foreground">
                          Due: {format(new Date(deadline), 'dd MMM yyyy')}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-medium text-foreground">
                        {amount > 0 ? `${amount.toFixed(4)} ETH` : '—'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {boardBadge && isBoard
                        ? <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full border', boardBadge.cls)}>{boardBadge.label}</span>
                        : <StatusBadge status={status} pulse={status === 'submitted'} />}
                    </td>
                    <td className="px-6 py-4">
                      {(item._src === 'chain' || item._src === 'chain_legacy') ? (
                        <Link href={`/verification/${item.id}`}>
                          <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80 gap-1">
                            <Eye className="h-4 w-4" /> View
                          </Button>
                        </Link>
                      ) : (
                        <Link href="/client?tab=contracts">
                          <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80 gap-1">
                            <Eye className="h-4 w-4" /> Manage
                          </Button>
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {/* Transaction History */}
      <TransactionHistory maxItems={8} />
    </div>
  );
}
