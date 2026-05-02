'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Navbar } from '@/components/navbar';
import { DashboardSidebar } from '@/components/dashboard-sidebar';
import { JuryOverview } from '@/components/jury/jury-overview';
import { OpenDisputes } from '@/components/jury/open-disputes';
import { VotingHistory } from '@/components/jury/voting-history';
import { JuryRewards } from '@/components/jury/jury-rewards';
import { RoleGuard } from '@/components/role-guard';
import { Scale, History, Coins, LayoutDashboard } from 'lucide-react';

const juryNavLinks = [
  { href: '/jury?tab=overview',   label: 'Overview',       icon: LayoutDashboard, tab: 'overview' },
  { href: '/jury?tab=disputes',   label: 'Open Disputes',  icon: Scale,           tab: 'disputes' },
  { href: '/jury?tab=history',    label: 'Voting History', icon: History,         tab: 'history' },
  { href: '/jury?tab=rewards',    label: 'Rewards',        icon: Coins,           tab: 'rewards' },
];

function JuryContent() {
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') || 'overview';

  return (
    <RoleGuard requiredRole="jury">
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex pt-16">
          <DashboardSidebar links={juryNavLinks} role="juror" basePath="/jury" />
          <main className="flex-1 p-6 lg:p-8 animate-fade-in">
            {tab === 'overview'   && <JuryOverview />}
            {tab === 'disputes'   && <OpenDisputes />}
            {tab === 'history'    && <VotingHistory />}
            {tab === 'rewards'    && <JuryRewards />}
          </main>
        </div>
      </div>
    </RoleGuard>
  );
}

function JurySkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="flex pt-16">
        <div className="w-64 min-h-[calc(100vh-4rem)] glass-card border-r border-border animate-pulse" />
        <main className="flex-1 p-8">
          <div className="grid grid-cols-4 gap-6 mb-8">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 glass-card rounded-xl animate-pulse" />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function JuryDashboard() {
  return (
    <Suspense fallback={<JurySkeleton />}>
      <JuryContent />
    </Suspense>
  );
}
