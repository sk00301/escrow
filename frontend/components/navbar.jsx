'use client';
import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWallet }    from '@/contexts/wallet-context';
import { useUser }      from '@/contexts/user-context';
import { WalletModal }  from '@/components/wallet-modal';
import {
  Wallet, Bell, ChevronDown, LogOut, Menu, X,
  Home, Briefcase, Users, Scale, Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// All possible links — filtered by role below
const ALL_NAV = [
  { href: '/',           label: 'Home',        icon: Home,     roles: ['client','freelancer','jury'] },
  { href: '/client',     label: 'Client',      icon: Briefcase,roles: ['client'] },
  { href: '/freelancer', label: 'Freelancer',   icon: Users,    roles: ['freelancer'] },
  { href: '/jury',       label: 'Jury',         icon: Scale,    roles: ['jury'] },
  { href: '/governance', label: 'Governance',   icon: Settings, roles: ['client','freelancer','jury'] },
];

const ROLE_CONFIG = {
  client:     { label: 'Client',     color: 'bg-primary/10 text-primary border-primary/30',     dot: 'bg-primary' },
  freelancer: { label: 'Freelancer', color: 'bg-[#8B5CF6]/10 text-[#8B5CF6] border-[#8B5CF6]/30', dot: 'bg-[#8B5CF6]' },
  jury:       { label: 'Jury',       color: 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30', dot: 'bg-[#F59E0B]' },
};

const ROLE_HOMES = { client: '/client', freelancer: '/freelancer', jury: '/jury' };
const AEGISTRA_LOGO_SMALL = '/Aegistra%20Logo%20small.png';

export function Navbar() {
  const pathname  = usePathname();
  const router    = useRouter();
  const { walletAddress, isConnected, chainId, balance, disconnectWallet, isDemoMode } = useWallet();
  const { activeRole, setActiveRole, notifications, unreadCount, markAsRead, markAllAsRead } = useUser();

  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [mobileMenuOpen,  setMobileMenuOpen]  = useState(false);
  const [rolePickerOpen,  setRolePickerOpen]  = useState(false);

  const visibleLinks = isConnected
    ? ALL_NAV.filter(l => l.roles.includes(activeRole))
    : ALL_NAV.filter(l => l.href === '/');

  const truncateAddress = (a) => `${a.slice(0,6)}...${a.slice(-4)}`;
  const getNetworkName  = (id) => id === 11155111 ? 'Sepolia' : id === 1 ? 'Mainnet' : 'Unknown';
  const formatTimeAgo   = (date) => {
    const mins = Math.floor((Date.now() - new Date(date)) / 60000);
    if (mins < 60)         return `${mins}m ago`;
    if (mins < 1440)       return `${Math.floor(mins/60)}h ago`;
    return `${Math.floor(mins/1440)}d ago`;
  };

  const switchRole = (role) => {
    setActiveRole(role);
    setRolePickerOpen(false);
    router.push(ROLE_HOMES[role]);
  };

  const rc = ROLE_CONFIG[activeRole];

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">

            {/* Logo */}
            <Link href="/" className="flex items-center gap-2 shrink-0">
              <Image
                src={AEGISTRA_LOGO_SMALL}
                alt="Aegistra"
                width={36}
                height={36}
                className="h-9 w-9 rounded-lg object-contain"
                priority
              />
              <span className="text-xl font-bold text-foreground">Aegistra</span>
            </Link>

            {/* Desktop nav */}
            <div className="hidden md:flex items-center gap-1">
              {visibleLinks.map((link) => {
                const isActive =
                  pathname === link.href ||
                  (link.href !== '/' && pathname.startsWith(link.href));
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      'px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    )}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>

            {/* Right side */}
            <div className="flex items-center gap-2">

              {/* ── Role Switcher pill — only when connected ── */}
              {isConnected && (
                <div className="relative">
                  <button
                    onClick={() => setRolePickerOpen(p => !p)}
                    className={cn(
                      'hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors',
                      rc.color
                    )}
                  >
                    <span className={cn('w-2 h-2 rounded-full', rc.dot)} />
                    {rc.label}
                    <ChevronDown className="h-3 w-3 opacity-70" />
                  </button>

                  {rolePickerOpen && (
                    <>
                      {/* backdrop */}
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setRolePickerOpen(false)}
                      />
                      <div className="absolute right-0 top-full mt-2 z-50 w-52 rounded-xl border border-border glass-card shadow-xl overflow-hidden">
                        <div className="px-3 py-2 border-b border-border">
                          <p className="text-xs text-muted-foreground font-medium">Switch Dashboard</p>
                        </div>
                        {Object.entries(ROLE_CONFIG).map(([role, cfg]) => (
                          <button
                            key={role}
                            onClick={() => switchRole(role)}
                            className={cn(
                              'w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50',
                              activeRole === role ? 'bg-muted/60' : ''
                            )}
                          >
                            <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', cfg.dot)} />
                            <span className={activeRole === role ? cfg.color.split(' ')[1] : 'text-foreground'}>
                              {cfg.label}
                            </span>
                            {activeRole === role && (
                              <span className="ml-auto text-[10px] text-muted-foreground">Active</span>
                            )}
                          </button>
                        ))}
                        <div className="px-3 py-2 border-t border-border bg-muted/20">
                          <p className="text-[10px] text-muted-foreground leading-relaxed">
                            Each role shows only its own dashboard. Your wallet stays connected.
                          </p>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Network badge */}
              {isConnected && (
                <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border border-border">
                  <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" />
                  <span className="text-xs font-medium text-muted-foreground">
                    {getNetworkName(chainId)}
                  </span>
                  {isDemoMode && <span className="text-xs text-primary">(Demo)</span>}
                </div>
              )}

              {/* Notifications */}
              {isConnected && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
                      <Bell className="h-5 w-5" />
                      {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 w-5 h-5 bg-primary text-primary-foreground text-xs rounded-full flex items-center justify-center">
                          {unreadCount}
                        </span>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-80 glass-card border-border">
                    <div className="flex items-center justify-between px-4 py-2">
                      <span className="font-semibold text-foreground">Notifications</span>
                      {unreadCount > 0 && (
                        <Button variant="ghost" size="sm" className="text-xs text-primary hover:text-primary/80" onClick={markAllAsRead}>
                          Mark all read
                        </Button>
                      )}
                    </div>
                    <DropdownMenuSeparator className="bg-border" />
                    <div className="max-h-80 overflow-y-auto">
                      {notifications.slice(0, 5).map(notif => (
                        <DropdownMenuItem
                          key={notif.id}
                          className={cn('flex flex-col items-start gap-1 p-4 cursor-pointer', !notif.read && 'bg-primary/5')}
                          onClick={() => markAsRead(notif.id)}
                        >
                          <span className="font-medium text-foreground text-sm">{notif.title}</span>
                          <span className="text-xs text-muted-foreground">{notif.message}</span>
                          <span className="text-xs text-muted-foreground">{formatTimeAgo(notif.timestamp)}</span>
                        </DropdownMenuItem>
                      ))}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {/* Wallet / Connect */}
              {isConnected && walletAddress ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="border-border bg-muted/50 hover:bg-muted gap-2">
                      <Wallet className="h-4 w-4 text-primary" />
                      <span className="hidden sm:inline text-sm">{truncateAddress(walletAddress)}</span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64 glass-card border-border">
                    <div className="p-4">
                      <p className="text-xs text-muted-foreground mb-1">Balance</p>
                      <p className="text-lg font-bold text-foreground">{balance} ETH</p>
                    </div>
                    <DropdownMenuSeparator className="bg-border" />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive cursor-pointer"
                      onClick={disconnectWallet}
                    >
                      <LogOut className="h-4 w-4 mr-2" />
                      Disconnect
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button
                  className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
                  onClick={() => setWalletModalOpen(true)}
                >
                  <Wallet className="h-4 w-4" />
                  <span className="hidden sm:inline">Connect Wallet</span>
                </Button>
              )}

              {/* Mobile toggle */}
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden text-muted-foreground hover:text-foreground"
                onClick={() => setMobileMenuOpen(v => !v)}
              >
                {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </Button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border animate-slide-in-up">
            <div className="px-4 py-4 space-y-2">

              {/* Mobile role switcher */}
              {isConnected && (
                <div className="mb-3 pb-3 border-b border-border">
                  <p className="text-xs text-muted-foreground mb-2 px-1">Switch Dashboard</p>
                  <div className="flex gap-2">
                    {Object.entries(ROLE_CONFIG).map(([role, cfg]) => (
                      <button
                        key={role}
                        onClick={() => { switchRole(role); setMobileMenuOpen(false); }}
                        className={cn(
                          'flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors',
                          activeRole === role ? cfg.color : 'border-border text-muted-foreground'
                        )}
                      >
                        {cfg.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {visibleLinks.map(link => {
                const isActive = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href));
                const Icon = link.icon;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    )}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <Icon className="h-5 w-5" />
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </nav>

      <WalletModal open={walletModalOpen} onOpenChange={setWalletModalOpen} />
    </>
  );
}
