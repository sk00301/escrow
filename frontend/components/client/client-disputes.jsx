'use client';
import { useState } from 'react';
import { StatusBadge } from '@/components/status-badge';
import { EmptyState } from '@/components/empty-state';
import { useContracts } from '@/contexts/contract-context';
import { useWallet } from '@/contexts/wallet-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  AlertTriangle, Clock, Users, Eye, FileText,
  CheckCircle, XCircle, Scale, Loader2,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader,
  DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

/**
 * ClientDisputes
 * ──────────────
 * Shows disputes the client is a party to.
 * Also lets the client raise a new dispute from their verified/submitted milestones
 * if they disagree with the AI result.
 */
export function ClientDisputes() {
  const { disputes, contracts, raiseDispute, isLoading } = useContracts();
  const { walletAddress } = useWallet();

  const [showRaiseDialog, setShowRaiseDialog] = useState(false);
  const [selectedContract, setSelectedContract] = useState(null);
  const [disputeReason, setDisputeReason]       = useState('');
  const [raising, setRaising]                   = useState(false);

  // Disputes where this wallet is the client
  const myDisputes = disputes.filter(
    (d) => d.clientAddress?.toLowerCase() === walletAddress?.toLowerCase()
  );

  // Milestones the client can raise a dispute on:
  // submitted (client disagrees with AI score) or verified-but-disputed
  const raisableContracts = contracts.filter(
    (c) =>
      c.clientAddress?.toLowerCase() === walletAddress?.toLowerCase() &&
      c.status === 'disputed' &&
      // not already disputed
      !disputes.some((d) => d.milestoneId === c.id)
  );

  const getDisputeStatus = (d) => {
    // Map on-chain enum strings to display labels
    const map = {
      open:            'Awaiting Jurors',
      jurors_assigned: 'Jurors Assigned',
      voting:          'Jury Voting',
      resolved:        'Resolved',
    };
    return map[d.status] ?? d.status;
  };

  const handleRaiseDispute = async () => {
    if (!selectedContract) return;
    setRaising(true);
    try {
      await raiseDispute(selectedContract.id, disputeReason);
      setShowRaiseDialog(false);
      setDisputeReason('');
      setSelectedContract(null);
    } finally {
      setRaising(false);
    }
  };

  const openRaiseDialog = (contract) => {
    setSelectedContract(contract);
    setDisputeReason('');
    setShowRaiseDialog(true);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Disputes</h1>
          <p className="text-muted-foreground">Track active disputes and raise new ones</p>
        </div>

        {raisableContracts.length > 0 && (
          <Button onClick={() => setShowRaiseDialog(true)} variant="destructive" size="sm">
            <AlertTriangle className="mr-2 h-4 w-4" />
            Raise Dispute
          </Button>
        )}
      </div>

      {/* ── Active / pending disputes ── */}
      {myDisputes.length === 0 ? (
        <EmptyState
          icon="dispute"
          title="No disputes"
          description="You have no active disputes. If you disagree with a verification result, you can raise a dispute from a submitted or verified milestone."
        />
      ) : (
        <div className="space-y-4">
          {myDisputes.map((dispute) => {
            const milestone    = contracts.find((c) => c.id === dispute.milestoneId);
            const jurorCount   = dispute.assignedJurors?.length ?? 0;
            const votesCast    = dispute.votes?.length ?? 0;
            const voteProgress = jurorCount > 0 ? (votesCast / jurorCount) * 100 : 0;
            const isResolved   = dispute.status === 'resolved';

            return (
              <div key={dispute.id} className="glass-card rounded-xl border border-border p-6">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center">
                      <AlertTriangle className="h-6 w-6 text-destructive" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">
                        {milestone?.milestoneTitle ?? `Milestone #${dispute.milestoneId}`}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Dispute #{dispute.id} · {getDisputeStatus(dispute)}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={isResolved ? 'resolved' : 'disputed'} />
                </div>

                {/* Parties */}
                <div className="grid sm:grid-cols-2 gap-3 mb-4">
                  <div className="glass rounded-lg p-3 text-sm">
                    <p className="text-xs text-muted-foreground mb-1">Client (you)</p>
                    <p className="font-mono text-xs text-foreground">
                      {dispute.clientAddress
                        ? `${dispute.clientAddress.slice(0,10)}…${dispute.clientAddress.slice(-6)}`
                        : '—'}
                    </p>
                  </div>
                  <div className="glass rounded-lg p-3 text-sm">
                    <p className="text-xs text-muted-foreground mb-1">Freelancer</p>
                    <p className="font-mono text-xs text-foreground">
                      {dispute.freelancerAddress
                        ? `${dispute.freelancerAddress.slice(0,10)}…${dispute.freelancerAddress.slice(-6)}`
                        : '—'}
                    </p>
                  </div>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="glass rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground">
                      {dispute.stakedAmount?.toFixed(4) ?? '—'}
                    </p>
                    <p className="text-xs text-muted-foreground">ETH at Stake</p>
                  </div>
                  <div className="glass rounded-lg p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-xl font-bold text-foreground">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      {jurorCount}
                    </div>
                    <p className="text-xs text-muted-foreground">Jurors</p>
                  </div>
                  <div className="glass rounded-lg p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-xl font-bold text-foreground">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      {isResolved
                        ? 'Done'
                        : formatDistanceToNow(new Date(dispute.votingDeadline), { addSuffix: false })}
                    </div>
                    <p className="text-xs text-muted-foreground">Time Left</p>
                  </div>
                </div>

                {/* Jury voting progress */}
                {jurorCount > 0 && (
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Jury Voting Progress</span>
                      <span className="text-muted-foreground">{votesCast}/{jurorCount} votes</span>
                    </div>
                    <Progress value={voteProgress} className="h-2" />
                  </div>
                )}

                {/* Resolution outcome */}
                {isResolved && (
                  <div className={`rounded-lg border p-3 mb-4 flex items-center gap-2 text-sm font-medium
                    ${dispute.releaseToFreelancer
                      ? 'border-primary/30 bg-primary/5 text-primary'
                      : 'border-destructive/30 bg-destructive/5 text-destructive'}`}
                  >
                    {dispute.releaseToFreelancer
                      ? <><CheckCircle className="h-4 w-4" /> Freelancer won — payment released</>
                      : <><XCircle className="h-4 w-4" /> Client won — funds returned</>}
                  </div>
                )}

                {/* IPFS submission link */}
                {dispute.ipfsCID && (
                  <div className="flex items-center gap-2 mb-4 text-sm">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <a
                      href={`https://gateway.pinata.cloud/ipfs/${dispute.ipfsCID}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      View freelancer submission on IPFS ↗
                    </a>
                  </div>
                )}

                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <p className="text-xs text-muted-foreground">
                    Opened {format(new Date(dispute.createdAt), 'dd MMM yyyy')}
                  </p>
                  {milestone && (
                    <Link href={`/verification/${dispute.milestoneId}`}>
                      <Button variant="outline" size="sm" className="border-border gap-2">
                        <Eye className="h-4 w-4" />
                        View Milestone
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Raise Dispute dialog ── */}
      <Dialog open={showRaiseDialog} onOpenChange={setShowRaiseDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-destructive" />
              Raise a Dispute
            </DialogTitle>
            <DialogDescription>
              Select the milestone you want to dispute and describe your reason. This will
              escalate the case to the jury pool.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Milestone selector */}
            <div>
              <Label className="text-sm font-medium">Select Milestone</Label>
              <div className="mt-2 space-y-2 max-h-48 overflow-y-auto pr-1">
                {raisableContracts.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">
                    No milestones eligible for dispute right now.
                  </p>
                ) : (
                  raisableContracts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedContract(c)}
                      className={`w-full text-left rounded-lg border p-3 text-sm transition-colors
                        ${selectedContract?.id === c.id
                          ? 'border-destructive/60 bg-destructive/5'
                          : 'border-border bg-muted/30 hover:border-border/80'}`}
                    >
                      <p className="font-medium text-foreground">{c.milestoneTitle}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        #{c.id} · {c.amount} ETH · Status: {c.status}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Reason */}
            <div>
              <Label htmlFor="dispute-reason">Reason for Dispute</Label>
              <Textarea
                id="dispute-reason"
                placeholder="Explain why you are disputing this milestone…"
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                rows={4}
                className="mt-2"
              />
            </div>

            {/* Warning */}
            <div className="rounded-lg border border-[#F59E0B]/50 bg-[#F59E0B]/10 p-3 text-sm text-[#F59E0B]">
              <p className="font-medium">Before you raise a dispute</p>
              <p className="mt-1 text-xs">
                A panel of 3 staked jurors will review the evidence and vote. The milestone
                ETH will remain locked until the jury decides. This action cannot be undone.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRaiseDialog(false)} disabled={raising}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRaiseDispute}
              disabled={raising || !selectedContract}
            >
              {raising
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Raising…</>
                : <><AlertTriangle className="mr-2 h-4 w-4" />Raise Dispute</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
