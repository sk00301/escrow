'use client';
/**
 * components/transaction-history.jsx
 *
 * Shows a live feed of on-chain Escrow events for the connected wallet.
 * Internal transactions (ETH transfers inside smart contract calls) appear
 * here with their Etherscan links — they are real transactions, just
 * initiated by the contract rather than directly by a wallet.
 */

import { ExternalLink, RefreshCw, Loader2, FileText, Wallet, Upload, Brain, DollarSign, AlertTriangle, Hash } from 'lucide-react';
import { Button }  from '@/components/ui/button';
import { Badge }   from '@/components/ui/badge';
import { useTransactionHistory } from '@/hooks/use-transaction-history';
import { format }  from 'date-fns';
import { cn }      from '@/lib/utils';

const ICONS = {
  file:   FileText,
  wallet: Wallet,
  upload: Upload,
  brain:  Brain,
  dollar: DollarSign,
  alert:  AlertTriangle,
};

const COLOUR_CLS = {
  blue:    'bg-blue-500/10 text-blue-500 border-blue-500/20',
  amber:   'bg-amber-500/10 text-amber-500 border-amber-500/20',
  violet:  'bg-violet-500/10 text-violet-500 border-violet-500/20',
  green:   'bg-green-500/10 text-green-600 border-green-500/20',
  emerald: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  red:     'bg-red-500/10 text-red-500 border-red-500/20',
  muted:   'bg-muted text-muted-foreground border-border',
};

const DOT_CLS = {
  blue:    'bg-blue-500',
  amber:   'bg-amber-500',
  violet:  'bg-violet-500',
  green:   'bg-green-500',
  emerald: 'bg-emerald-500',
  red:     'bg-red-500',
  muted:   'bg-muted-foreground',
};

export function TransactionHistory({ maxItems = 10 }) {
  const { history, loading, error, refetch } = useTransactionHistory();

  const visible = history.slice(0, maxItems);

  return (
    <div className="glass-card rounded-xl border border-border">
      {/* Header */}
      <div className="p-6 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Transaction History</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            On-chain events from the EscrowContract · Sepolia
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={refetch} disabled={loading}
          className="text-muted-foreground hover:text-foreground">
          {loading
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {/* Explainer for "internal transactions" */}
      <div className="px-6 py-3 bg-muted/30 border-b border-border">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">ℹ️ Internal transactions</span> — ETH transfers
          triggered by the smart contract (e.g. releasing payment to the freelancer) appear as
          &quot;internal transactions&quot; on Etherscan. They are real on-chain transfers, just
          initiated by the contract rather than directly by your wallet.
        </p>
      </div>

      {/* List */}
      <div className="divide-y divide-border">
        {loading && history.length === 0 ? (
          <div className="p-8 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Loading on-chain events…</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="text-sm text-destructive mb-2">Failed to load: {error}</p>
            <Button variant="outline" size="sm" onClick={refetch}>Retry</Button>
          </div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No on-chain activity yet. Fund a job to see transactions here.
          </div>
        ) : (
          visible.map(tx => {
            const Icon = ICONS[tx.icon] ?? FileText;
            return (
              <div key={tx.id} className="px-6 py-4 hover:bg-muted/20 transition-colors">
                <div className="flex items-start gap-4">
                  {/* Icon dot */}
                  <div className="flex-shrink-0 mt-0.5 relative">
                    <div className={cn('w-8 h-8 rounded-full flex items-center justify-center border', COLOUR_CLS[tx.colour])}>
                      <Icon className="h-4 w-4" />
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full border', COLOUR_CLS[tx.colour])}>
                          {tx.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Job #{tx.milestoneId}
                        </span>
                      </div>
                      {tx.timestamp && (
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          {format(new Date(tx.timestamp), 'dd MMM yyyy HH:mm')}
                        </span>
                      )}
                    </div>

                    <p className="text-sm text-foreground">{tx.description}</p>

                    {/* Amount highlight */}
                    {tx.amount != null && tx.amount > 0 && (
                      <p className={cn('text-sm font-semibold mt-0.5',
                        tx.eventName === 'PaymentReleased' ? 'text-emerald-600' : 'text-primary')}>
                        {tx.eventName === 'PaymentReleased' ? '+' : ''}{tx.amount.toFixed(4)} ETH
                      </p>
                    )}

                    {/* IPFS link for submissions */}
                    {tx.ipfsLink && (
                      <a href={tx.ipfsLink} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1">
                        <ExternalLink className="h-3 w-3" /> View Submission on IPFS
                      </a>
                    )}

                    {/* Tx hash link */}
                    <div className="flex items-center gap-1 mt-1">
                      <Hash className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      <a href={tx.txLink} target="_blank" rel="noopener noreferrer"
                        className="font-mono text-[10px] text-muted-foreground hover:text-primary hover:underline truncate">
                        {tx.txHash.slice(0, 20)}…{tx.txHash.slice(-6)}
                      </a>
                      <a href={tx.txLink} target="_blank" rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-primary flex-shrink-0">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      {history.length > maxItems && (
        <div className="p-4 border-t border-border text-center">
          <p className="text-xs text-muted-foreground">
            Showing {maxItems} of {history.length} events.{' '}
            <a href={`https://sepolia.etherscan.io/address/0xb5aF1CAC332013DeF97d6863FC12ED104CB94b13`}
              target="_blank" rel="noopener noreferrer"
              className="text-primary hover:underline">
              View all on Etherscan ↗
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
