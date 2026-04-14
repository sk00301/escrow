'use client';
import { StatsCard } from '@/components/stats-card';
import { useContracts } from '@/contexts/contract-context';
import { useUser } from '@/contexts/user-context';
import { MOCK_MONTHLY_EARNINGS } from '@/lib/mock-data';
import { FileCheck, Clock, Wallet, TrendingUp, Calendar } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
export function FreelancerOverview() {
    const { contracts } = useContracts();
    const { userStats } = useUser();
    // Get active milestones (funded status)
    const activeMilestones = contracts.filter(c => c.status === 'funded' || c.status === 'submitted');
    const truncateAddress = (address) => {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    };
    return (<div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Freelancer Dashboard</h1>
        <p className="text-muted-foreground">Track your milestones and earnings</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard title="Active Milestones" value={userStats.activeMilestones || 0} icon={FileCheck}/>
        <StatsCard title="Pending Payments" value={(userStats.pendingPayments || 0).toFixed(4)} suffix="ETH" icon={Clock}/>
        <StatsCard title="Total Earned" value={(userStats.totalEarned || 0).toFixed(4)} suffix="ETH" icon={Wallet} trend={{ value: 8, positive: true }}/>
        <StatsCard title="Success Rate" value={userStats.successRate || 0} suffix="%" icon={TrendingUp}/>
      </div>

      {/* Charts and Active Milestones Row */}
      <div className="grid lg:grid-cols-2 gap-8">
        {/* Earnings Chart */}
        <div className="glass-card rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-6">Monthly Earnings</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={MOCK_MONTHLY_EARNINGS}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E3A5F"/>
                <XAxis dataKey="month" tick={{ fill: '#94A3B8', fontSize: 12 }} axisLine={{ stroke: '#1E3A5F' }}/>
                <YAxis tick={{ fill: '#94A3B8', fontSize: 12 }} axisLine={{ stroke: '#1E3A5F' }} tickFormatter={(value) => `${value} ETH`}/>
                <Tooltip contentStyle={{
            backgroundColor: '#112233',
            border: '1px solid #1E3A5F',
            borderRadius: '8px',
            color: '#FFFFFF'
        }} formatter={(value) => [`${value.toFixed(2)} ETH`, 'Earnings']}/>
                <Bar dataKey="earnings" fill="#00B4D8" radius={[4, 4, 0, 0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Active Milestone Cards */}
        <div className="glass-card rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-6">Active Milestones</h2>
          <div className="space-y-4">
            {activeMilestones.slice(0, 3).map((milestone) => {
            const isOverdue = new Date(milestone.deadline) < new Date();
            const daysRemaining = formatDistanceToNow(new Date(milestone.deadline), { addSuffix: true });
            return (<div key={milestone.id} className="glass rounded-xl p-4 border border-border hover:border-primary/30 transition-colors">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-medium text-foreground">{milestone.milestoneTitle}</h3>
                      <p className="text-xs text-muted-foreground">
                        Client: {truncateAddress(milestone.clientAddress)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-primary">{milestone.amount.toFixed(4)} ETH</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className={`flex items-center gap-2 text-sm ${isOverdue ? 'text-destructive' : 'text-muted-foreground'}`}>
                      <Calendar className="h-4 w-4"/>
                      <span>
                        {isOverdue ? 'Overdue' : `Due ${daysRemaining}`}
                      </span>
                    </div>
                    
                    {/* Countdown Timer */}
                    <div className="flex items-center gap-1 text-xs">
                      <span className={`px-2 py-1 rounded ${isOverdue ? 'bg-destructive/20 text-destructive' : 'bg-primary/20 text-primary'}`}>
                        {format(new Date(milestone.deadline), 'dd MMM yyyy')}
                      </span>
                    </div>
                  </div>
                </div>);
        })}

            {activeMilestones.length === 0 && (<div className="text-center py-8 text-muted-foreground">
                <FileCheck className="h-12 w-12 mx-auto mb-3 opacity-50"/>
                <p>No active milestones</p>
              </div>)}
          </div>
        </div>
      </div>
    </div>);
}
