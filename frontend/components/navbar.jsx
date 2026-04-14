'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, } from '@/components/ui/dropdown-menu';
import { useWallet } from '@/contexts/wallet-context';
import { useUser } from '@/contexts/user-context';
import { WalletModal } from '@/components/wallet-modal';
import { Wallet, Bell, ChevronDown, LogOut, Menu, X, Home, Briefcase, Users, Scale, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
const navLinks = [
    { href: '/', label: 'Home', icon: Home },
    { href: '/client', label: 'Client', icon: Briefcase },
    { href: '/freelancer', label: 'Freelancer', icon: Users },
    { href: '/jury', label: 'Jury', icon: Scale },
    { href: '/governance', label: 'Governance', icon: Settings },
];
export function Navbar() {
    const pathname = usePathname();
    const { walletAddress, isConnected, chainId, balance, disconnectWallet, isDemoMode } = useWallet();
    const { notifications, unreadCount, markAsRead, markAllAsRead } = useUser();
    const [walletModalOpen, setWalletModalOpen] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const truncateAddress = (address) => {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    };
    const getNetworkName = (id) => {
        if (id === 11155111)
            return 'Sepolia';
        if (id === 1)
            return 'Mainnet';
        return 'Unknown';
    };
    const formatTimeAgo = (date) => {
        const now = new Date();
        const diff = now.getTime() - new Date(date).getTime();
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        if (minutes < 60)
            return `${minutes}m ago`;
        if (hours < 24)
            return `${hours}h ago`;
        return `${days}d ago`;
    };
    return (<>
      <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-lg">E</span>
              </div>
              <span className="text-xl font-bold text-foreground">
                Escrow<span className="text-primary">Chain</span>
              </span>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => {
            const isActive = pathname === link.href ||
                (link.href !== '/' && pathname.startsWith(link.href));
            return (<Link key={link.href} href={link.href} className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200', isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50')}>
                    {link.label}
                  </Link>);
        })}
            </div>

            {/* Right Side */}
            <div className="flex items-center gap-3">
              {/* Network Badge */}
              {isConnected && (<div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border border-border">
                  <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse"/>
                  <span className="text-xs font-medium text-muted-foreground">
                    {getNetworkName(chainId)}
                  </span>
                  {isDemoMode && (<span className="text-xs text-primary">(Demo)</span>)}
                </div>)}

              {/* Notifications */}
              {isConnected && (<DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
                      <Bell className="h-5 w-5"/>
                      {unreadCount > 0 && (<span className="absolute -top-1 -right-1 w-5 h-5 bg-primary text-primary-foreground text-xs rounded-full flex items-center justify-center">
                          {unreadCount}
                        </span>)}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-80 glass-card border-border">
                    <div className="flex items-center justify-between px-4 py-2">
                      <span className="font-semibold text-foreground">Notifications</span>
                      {unreadCount > 0 && (<Button variant="ghost" size="sm" className="text-xs text-primary hover:text-primary/80" onClick={markAllAsRead}>
                          Mark all read
                        </Button>)}
                    </div>
                    <DropdownMenuSeparator className="bg-border"/>
                    <div className="max-h-80 overflow-y-auto">
                      {notifications.slice(0, 5).map((notif) => (<DropdownMenuItem key={notif.id} className={cn('flex flex-col items-start gap-1 p-4 cursor-pointer', !notif.read && 'bg-primary/5')} onClick={() => markAsRead(notif.id)}>
                          <span className="font-medium text-foreground text-sm">
                            {notif.title}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {notif.message}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatTimeAgo(notif.timestamp)}
                          </span>
                        </DropdownMenuItem>))}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>)}

              {/* Wallet */}
              {isConnected && walletAddress ? (<DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="border-border bg-muted/50 hover:bg-muted gap-2">
                      <Wallet className="h-4 w-4 text-primary"/>
                      <span className="hidden sm:inline text-sm">
                        {truncateAddress(walletAddress)}
                      </span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground"/>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64 glass-card border-border">
                    <div className="p-4">
                      <p className="text-xs text-muted-foreground mb-1">Balance</p>
                      <p className="text-lg font-bold text-foreground">{balance} ETH</p>
                    </div>
                    <DropdownMenuSeparator className="bg-border"/>
                    <DropdownMenuItem className="text-destructive focus:text-destructive cursor-pointer" onClick={disconnectWallet}>
                      <LogOut className="h-4 w-4 mr-2"/>
                      Disconnect
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>) : (<Button className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2" onClick={() => setWalletModalOpen(true)}>
                  <Wallet className="h-4 w-4"/>
                  <span className="hidden sm:inline">Connect Wallet</span>
                </Button>)}

              {/* Mobile Menu Toggle */}
              <Button variant="ghost" size="icon" className="md:hidden text-muted-foreground hover:text-foreground" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
                {mobileMenuOpen ? <X className="h-6 w-6"/> : <Menu className="h-6 w-6"/>}
              </Button>
            </div>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (<div className="md:hidden border-t border-border animate-slide-in-up">
            <div className="px-4 py-4 space-y-2">
              {navLinks.map((link) => {
                const isActive = pathname === link.href ||
                    (link.href !== '/' && pathname.startsWith(link.href));
                const Icon = link.icon;
                return (<Link key={link.href} href={link.href} className={cn('flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200', isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50')} onClick={() => setMobileMenuOpen(false)}>
                    <Icon className="h-5 w-5"/>
                    {link.label}
                  </Link>);
            })}
            </div>
          </div>)}
      </nav>

      <WalletModal open={walletModalOpen} onOpenChange={setWalletModalOpen}/>
    </>);
}
