'use client'

import { Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Navbar } from '@/components/navbar'
import { DashboardSidebar } from '@/components/dashboard-sidebar'
import { ClientOverview } from '@/components/client/client-overview'
import { PostMilestone } from '@/components/client/post-milestone'
import { MyContracts } from '@/components/client/my-contracts'
import { ClientDisputes } from '@/components/client/client-disputes'
import { 
  LayoutDashboard, 
  FilePlus, 
  FileText, 
  AlertTriangle 
} from 'lucide-react'

const sidebarLinks = [
  { href: '/client?tab=overview', label: 'Overview', icon: LayoutDashboard, tab: 'overview' },
  { href: '/client?tab=post', label: 'Post Milestone', icon: FilePlus, tab: 'post' },
  { href: '/client?tab=contracts', label: 'My Contracts', icon: FileText, tab: 'contracts' },
  { href: '/client?tab=disputes', label: 'Disputes', icon: AlertTriangle, tab: 'disputes' },
]

function ClientDashboardContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const tab = searchParams.get('tab') || 'overview'

  // Redirect to overview if no tab is specified
  if (!searchParams.get('tab')) {
    router.replace('/client?tab=overview')
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <div className="flex pt-16">
        <DashboardSidebar 
          links={sidebarLinks} 
          role="client" 
          basePath="/client"
        />
        
        <main className="flex-1 p-8 animate-fade-in">
          {tab === 'overview' && <ClientOverview />}
          {tab === 'post' && <PostMilestone />}
          {tab === 'contracts' && <MyContracts />}
          {tab === 'disputes' && <ClientDisputes />}
        </main>
      </div>
    </div>
  )
}

export default function ClientDashboard() {
  return (
    <Suspense fallback={<ClientDashboardSkeleton />}>
      <ClientDashboardContent />
    </Suspense>
  )
}

function ClientDashboardSkeleton() {
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
          <div className="h-96 glass-card rounded-xl animate-pulse" />
        </main>
      </div>
    </div>
  )
}
