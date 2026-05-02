'use client';
import { useRouter }   from 'next/navigation';
import { useUser }     from '@/contexts/user-context';
import { useWallet }   from '@/contexts/wallet-context';
import { Button }      from '@/components/ui/button';
import { Briefcase, Users, Scale, Wallet } from 'lucide-react';

const ROLE_META = {
  client:     { icon: Briefcase, label: 'Client',     color: 'text-primary',       bg: 'bg-primary/10',        home: '/client' },
  freelancer: { icon: Users,     label: 'Freelancer',  color: 'text-[#8B5CF6]',    bg: 'bg-[#8B5CF6]/10',     home: '/freelancer' },
  jury:       { icon: Scale,     label: 'Jury Member', color: 'text-[#F59E0B]',    bg: 'bg-[#F59E0B]/10',     home: '/jury' },
};

/**
 * RoleGuard
 * Renders children only if activeRole === requiredRole.
 * Otherwise shows a friendly "you're viewing the wrong dashboard" screen.
 *
 * Usage: wrap each dashboard page content with
 *   <RoleGuard requiredRole="client">…</RoleGuard>
 */
export function RoleGuard({ requiredRole, children }) {
  const { activeRole, setActiveRole } = useUser();
  const { isConnected }               = useWallet();
  const router                        = useRouter();

  // Not connected at all — show generic connect prompt
  if (!isConnected) {
    const meta = ROLE_META[requiredRole];
    const Icon = meta.icon;
    return (
      <div className="flex min-h-[calc(100vh-64px)] items-center justify-center">
        <div className="text-center max-w-sm px-4">
          <div className={`mx-auto mb-4 w-16 h-16 rounded-2xl ${meta.bg} flex items-center justify-center`}>
            <Wallet className={`h-8 w-8 ${meta.color}`} />
          </div>
          <h2 className="text-2xl font-bold text-foreground">Connect Your Wallet</h2>
          <p className="mt-2 text-muted-foreground">
            Connect your wallet to access the {meta.label} dashboard.
          </p>
        </div>
      </div>
    );
  }

  // Connected but wrong role
  if (activeRole !== requiredRole) {
    const current  = ROLE_META[activeRole];
    const required = ROLE_META[requiredRole];
    const CurrentIcon  = current.icon;
    const RequiredIcon = required.icon;

    return (
      <div className="flex min-h-[calc(100vh-64px)] items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          {/* Icon */}
          <div className={`mx-auto mb-6 w-20 h-20 rounded-2xl ${required.bg} flex items-center justify-center`}>
            <RequiredIcon className={`h-10 w-10 ${required.color}`} />
          </div>

          <h2 className="text-2xl font-bold text-foreground mb-2">
            Wrong Dashboard
          </h2>
          <p className="text-muted-foreground mb-6">
            You are currently in{' '}
            <span className={`font-semibold ${current.color}`}>{current.label} mode</span>.
            This is the <span className={`font-semibold ${required.color}`}>{required.label}</span> dashboard.
          </p>

          <div className="space-y-3">
            {/* Switch to the required role */}
            <Button
              className="w-full gap-2"
              onClick={() => {
                setActiveRole(requiredRole);
                // Stay on this page — it will re-render with the guard passing
              }}
            >
              <RequiredIcon className="h-4 w-4" />
              Switch to {required.label} Mode
            </Button>

            {/* Go back to their current dashboard */}
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => router.push(current.home)}
            >
              <CurrentIcon className="h-4 w-4" />
              Back to {current.label} Dashboard
            </Button>
          </div>

          <p className="mt-6 text-xs text-muted-foreground">
            You can switch your active role from the top-right pill in the navbar at any time.
          </p>
        </div>
      </div>
    );
  }

  // Role matches — render the dashboard
  return children;
}
