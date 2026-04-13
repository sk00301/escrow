"use client"

import { Suspense, useState } from "react"
import { Navbar } from "@/components/navbar"
import { DashboardSidebar } from "@/components/dashboard-sidebar"
import { JuryOverview } from "@/components/jury/jury-overview"
import { OpenDisputes } from "@/components/jury/open-disputes"
import { VotingHistory } from "@/components/jury/voting-history"
import { JuryRewards } from "@/components/jury/jury-rewards"
import { useWallet } from "@/contexts/wallet-context"
import { Scale, History, Coins, LayoutDashboard } from "lucide-react"

const juryNavLinks = [
  { href: '/jury?tab=overview', label: 'Overview', icon: LayoutDashboard, tab: 'overview' },
  { href: '/jury?tab=disputes', label: 'Open Disputes', icon: Scale, tab: 'disputes' },
  { href: '/jury?tab=history', label: 'Voting History', icon: History, tab: 'history' },
  { href: '/jury?tab=rewards', label: 'Rewards', icon: Coins, tab: 'rewards' },
]

function JuryDashboardContent() {
  const { isConnected } = useWallet()
  const [activeTab, setActiveTab] = useState("overview")

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex min-h-[calc(100vh-64px)] items-center justify-center">
          <div className="text-center">
            <Scale className="mx-auto h-16 w-16 text-muted-foreground" />
            <h2 className="mt-4 text-2xl font-bold text-foreground">Connect Your Wallet</h2>
            <p className="mt-2 text-muted-foreground">
              Connect your wallet to access the Jury Dashboard
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="flex pt-16">
        <DashboardSidebar
          links={juryNavLinks}
          role="juror"
          basePath="/jury"
        />
        <main className="flex-1 p-6 lg:p-8 animate-fade-in">
          {activeTab === "overview" && <JuryOverview />}
          {activeTab === "disputes" && <OpenDisputes />}
          {activeTab === "history" && <VotingHistory />}
          {activeTab === "rewards" && <JuryRewards />}
        </main>
      </div>
    </div>
  )
}

// We need a wrapper that reads searchParams for tab routing
import { useSearchParams } from "next/navigation"

function JuryWithTabs() {
  const { isConnected } = useWallet()
  const searchParams = useSearchParams()
  const tab = searchParams.get("tab") || "overview"

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex min-h-[calc(100vh-64px)] items-center justify-center">
          <div className="text-center">
            <Scale className="mx-auto h-16 w-16 text-muted-foreground" />
            <h2 className="mt-4 text-2xl font-bold text-foreground">Connect Your Wallet</h2>
            <p className="mt-2 text-muted-foreground">
              Connect your wallet to access the Jury Dashboard
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="flex pt-16">
        <DashboardSidebar
          links={juryNavLinks}
          role="juror"
          basePath="/jury"
        />
        <main className="flex-1 p-6 lg:p-8 animate-fade-in">
          {tab === "overview" && <JuryOverview />}
          {tab === "disputes" && <OpenDisputes />}
          {tab === "history" && <VotingHistory />}
          {tab === "rewards" && <JuryRewards />}
        </main>
      </div>
    </div>
  )
}

export default function JuryDashboard() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex pt-16">
          <div className="w-64 min-h-[calc(100vh-4rem)] glass-card border-r border-border animate-pulse" />
          <main className="flex-1 p-8">
            <div className="grid grid-cols-4 gap-6 mb-8">
              {[1,2,3,4].map(i => <div key={i} className="h-32 glass-card rounded-xl animate-pulse" />)}
            </div>
          </main>
        </div>
      </div>
    }>
      <JuryWithTabs />
    </Suspense>
  )
}
