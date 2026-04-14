'use client';
import { useMemo } from 'react';
import { StatsCard } from '@/components/stats-card';
import { useContracts } from '@/contexts/contract-context';
import { useWallet } from '@/contexts/wallet-context';
import { useUser } from '@/contexts/user-context';
import { FileCheck, Clock, Wallet, TrendingUp, Calendar } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

export function FreelancerOverview() {
  const { contracts }  = useContracts();
  const { walletAddress } = useWallet();
  const { userStats }  = useUser();

  // Active milestones for this freelancer
  const activeMilestones = contracts.filter(c =>
    c.freelancerAddress?.toLowerCase() === walletAddress?.toLowerCase() &&
    (c.status === 'funded' || c.status === 'submitted')
  );

  // Build monthly earnings chart data from real released contracts
  const earningsChartData = useMemo(() => {
    const released = contracts.filter(c =>
      c.freelancerAddress?.toLowerCase() === walletAddress?.toLowerCase() &&
      c.status === 'released' &&
      c.resolvedAt
    );

    // Group by "Mon YYYY" label
    const byMonth = {};
    released.forEach(c => {
      const d     = new Date(c.resolvedAt);
      const label = format(d, 'MMM yy');
      byMonth[label] = (byMonth[label] ?? 0) + (c.amount ?? 0);
    });

    // If no real data yet, show empty months so the chart isn't blank
    if (Object.keys(byMonth).length === 0) {
      const now = new Date();
      return Array.from({ length: 6 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
        return { month: format(d, 'MMM yy'), earnings: 0 };
      });
    }

    return Object.entries(byMonth)
      .map(([month, earnings]) => ({ month, earnings: parseFloat(earnings.toFixed(4)) }))
      .slice(-6); // show last 6 months
  }, [contracts, walletAddress]);

  const truncateAddress = (address) =>
    address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '—';

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Freelancer Dashboard</h1>
        <p className="text-muted-foreground">Track your milestones and earnings</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard title="Active Milestones"  value={userStats.activeMilestones || 0}                        icon={FileCheck} />
        <StatsCard title="Pending Payments"   value={(userStats.pendingPayments || 0).toFixed(4)} suffix="ETH" icon={Clock} />
        <StatsCard title="Total Earned"       value={(userStats.totalEarned || 0).toFixed(4)}     suffix="ETH" icon={Wallet} trend={{ value: 0, positive: true }} />
        <StatsCard title="Success Rate"       value={userStats.successRate || 0}                  suffix="%"   icon={TrendingUp} />
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Earnings Chart — built from real on-chain data */}
        <div className="glass-card rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-6">Monthly Earnings</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={earningsChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E3A5F" />
                <XAxis
                  dataKey="month"
                  tick={{ fill: '#94A3B8', fontSize: 12 }}
                  axisLine={{ stroke: '#1E3A5F' }}
                />
                <YAxis
                  tick={{ fill: '#94A3B8', fontSize: 12 }}
                  axisLine={{ stroke: '#1E3A5F' }}
                  tickFormatter={(v) => `${v} ETH`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#112233',
                    border: '1px solid #1E3A5F',
                    borderRadius: '8px',
                    color: '#FFFFFF',
                  }}
                  formatter={(value) => [`${Number(value).toFixed(4)} ETH`, 'Earnings']}
                />
                <Bar dataKey="earnings" fill="#00B4D8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {earningsChartData.every(d => d.earnings === 0) && (
            <p className="text-center text-xs text-muted-foreground mt-2">
              Earnings will appear here once payments are released on-chain.
            </p>
          )}
        </div>

        {/* Active Milestone Cards */}
        <div className="glass-card rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-6">Active Milestones</h2>
          <div className="space-y-4">
            {activeMilestones.slice(0, 3).map((milestone) => {
              const isOverdue      = new Date(milestone.deadline) < new Date();
              const daysRemaining  = formatDistanceToNow(new Date(milestone.deadline), { addSuffix: true });
              return (
                <div
                  key={milestone.id}
                  className="glass rounded-xl p-4 border border-border hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-medium text-foreground">{milestone.milestoneTitle}</h3>
                      <p className="text-xs text-muted-foreground">
                        Client: {truncateAddress(milestone.clientAddress)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-primary">
                        {milestone.amount.toFixed(4)} ETH
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className={`flex items-center gap-2 text-sm ${isOverdue ? 'text-destructive' : 'text-muted-foreground'}`}>
                      <Calendar className="h-4 w-4" />
                      <span>{isOverdue ? 'Overdue' : `Due ${daysRemaining}`}</span>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs ${isOverdue ? 'bg-destructive/20 text-destructive' : 'bg-primary/20 text-primary'}`}>
                      {format(new Date(milestone.deadline), 'dd MMM yyyy')}
                    </span>
                  </div>
                </div>
              );
            })}

            {activeMilestones.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <FileCheck className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No active milestones</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
