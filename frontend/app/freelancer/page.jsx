"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { FreelancerOverview } from "@/components/freelancer/freelancer-overview";
import { AvailableJobs } from "@/components/freelancer/available-jobs";
import { ActiveContracts } from "@/components/freelancer/active-contracts";
import { Earnings } from "@/components/freelancer/earnings";
import { useWallet } from "@/contexts/wallet-context";
import { LayoutDashboard, Search, FileCheck, Wallet, Briefcase } from "lucide-react";
const sidebarLinks = [
    { href: '/freelancer?tab=overview', label: 'Overview', icon: LayoutDashboard, tab: 'overview' },
    { href: '/freelancer?tab=jobs', label: 'Find Jobs', icon: Search, tab: 'jobs' },
    { href: '/freelancer?tab=contracts', label: 'Active Contracts', icon: FileCheck, tab: 'contracts' },
    { href: '/freelancer?tab=earnings', label: 'Earnings', icon: Wallet, tab: 'earnings' },
];
function FreelancerContent() {
    const { isConnected } = useWallet();
    const searchParams = useSearchParams();
    const tab = searchParams.get("tab") || "overview";
    if (!isConnected) {
        return (<div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex min-h-[calc(100vh-64px)] items-center justify-center">
          <div className="text-center">
            <Briefcase className="mx-auto h-16 w-16 text-muted-foreground"/>
            <h2 className="mt-4 text-2xl font-bold text-foreground">Connect Your Wallet</h2>
            <p className="mt-2 text-muted-foreground">
              Connect your wallet to access the Freelancer Dashboard
            </p>
          </div>
        </div>
      </div>);
    }
    return (<div className="min-h-screen bg-background">
      <Navbar />
      <div className="flex pt-16">
        <DashboardSidebar links={sidebarLinks} role="freelancer" basePath="/freelancer"/>
        <main className="flex-1 p-6 lg:p-8 animate-fade-in">
          {tab === "overview" && <FreelancerOverview />}
          {tab === "jobs" && <AvailableJobs />}
          {tab === "contracts" && <ActiveContracts />}
          {tab === "earnings" && <Earnings />}
        </main>
      </div>
    </div>);
}
export default function FreelancerDashboard() {
    return (<Suspense fallback={<div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex pt-16">
          <div className="w-64 min-h-[calc(100vh-4rem)] glass-card border-r border-border animate-pulse"/>
          <main className="flex-1 p-8">
            <div className="grid grid-cols-4 gap-6 mb-8">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-32 glass-card rounded-xl animate-pulse"/>)}
            </div>
          </main>
        </div>
      </div>}>
      <FreelancerContent />
    </Suspense>);
}
