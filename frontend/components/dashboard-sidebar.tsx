'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useWallet } from '@/contexts/wallet-context'
import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'

interface SidebarLink {
  href: string
  label: string
  icon: LucideIcon
  tab?: string
}

interface DashboardSidebarProps {
  links: SidebarLink[]
  role: 'client' | 'freelancer' | 'juror'
  basePath: string
}

export function DashboardSidebar({ links, role, basePath }: DashboardSidebarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentTab = searchParams.get('tab') || links[0]?.tab
  const { walletAddress } = useWallet()

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  const roleLabels = {
    client: 'Client',
    freelancer: 'Freelancer',
    juror: 'Juror'
  }

  const roleColors = {
    client: 'bg-[#00B4D8]/20 text-[#00B4D8]',
    freelancer: 'bg-[#10B981]/20 text-[#10B981]',
    juror: 'bg-[#F59E0B]/20 text-[#F59E0B]'
  }

  return (
    <aside className="w-64 min-h-[calc(100vh-4rem)] glass-card border-r border-border flex flex-col animate-slide-in-left">
      {/* Role Badge */}
      <div className="p-4 border-b border-border">
        <div className={cn(
          'inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-medium',
          roleColors[role]
        )}>
          {roleLabels[role]}
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 p-4 space-y-1">
        {links.map((link) => {
          const Icon = link.icon
          const isActive = link.tab 
            ? currentTab === link.tab && pathname === basePath
            : pathname === link.href

          return (
            <Link
              key={link.href + (link.tab || '')}
              href={link.href}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 group relative',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full" />
              )}
              <Icon className={cn(
                'h-5 w-5 transition-colors',
                isActive ? 'text-primary' : 'group-hover:text-foreground'
              )} />
              <span className="font-medium">{link.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Wallet Address */}
      {walletAddress && (
        <div className="p-4 border-t border-border">
          <div className="glass rounded-lg p-3">
            <p className="text-xs text-muted-foreground mb-1">Connected Wallet</p>
            <p className="text-sm font-mono text-foreground">
              {truncateAddress(walletAddress)}
            </p>
          </div>
        </div>
      )}
    </aside>
  )
}
