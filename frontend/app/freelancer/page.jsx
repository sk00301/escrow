'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Navbar } from '@/components/navbar';
import { DashboardSidebar } from '@/components/dashboard-sidebar';
import { FreelancerOverview } from '@/components/freelancer/freelancer-overview';
import { AvailableJobs } from '@/components/freelancer/available-jobs';
import { ActiveContracts } from '@/components/freelancer/active-contracts';
import { Earnings } from '@/components/freelancer/earnings';
import { RoleGuard } from '@/components/role-guard';
import { LayoutDashboard, Search, FileCheck, Wallet } from 'lucide-react';

const sidebarLinks = [
  { href: '/freelancer?tab=overview',   label: 'Overview',          icon: LayoutDashboard, tab: 'overview' },
  { href: '/freelancer?tab=jobs',       label: 'Find Jobs',         icon: Search,          tab: 'jobs' },
  { href: '/freelancer?tab=contracts',  label: 'Active Contracts',  icon: FileCheck,       tab: 'contracts' },
  { href: '/freelancer?tab=earnings',   label: 'Earnings',          icon: Wallet,          tab: 'earnings' },
];

function FreelancerContent() {
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') || 'overview';

  return (
    <RoleGuard requiredRole="freelancer">
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex pt-16">
          <DashboardSidebar links={sidebarLinks} role="freelancer" basePath="/freelancer" />
          <main className="flex-1 p-6 lg:p-8 animate-fade-in">
            {tab === 'overview'   && <FreelancerOverview />}
            {tab === 'jobs'       && <AvailableJobs />}
            {tab === 'contracts'  && <ActiveContracts />}
            {tab === 'earnings'   && <Earnings />}
          </main>
        </div>
      </div>
    </RoleGuard>
  );
}

function FreelancerSkeleton() {
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

export default function FreelancerDashboard() {
  return (
    <Suspense fallback={<FreelancerSkeleton />}>
      <FreelancerContent />
    </Suspense>
  );
}
