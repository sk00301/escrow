'use client';
import { StatusBadge } from '@/components/status-badge';
import { EmptyState } from '@/components/empty-state';
import { useContracts } from '@/contexts/contract-context';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Clock, Users, Eye } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
export function ClientDisputes() {
    const { disputes, contracts } = useContracts();
    const activeDisputes = disputes.filter(d => d.status === 'active' || d.status === 'pending');
    const getContract = (contractId) => {
        return contracts.find(c => c.id === contractId);
    };
    return (<div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Disputes</h1>
        <p className="text-muted-foreground">Track and manage active disputes</p>
      </div>

      {activeDisputes.length === 0 ? (<EmptyState icon="dispute" title="No active disputes" description="You don't have any active disputes at the moment."/>) : (<div className="space-y-4">
          {activeDisputes.map((dispute) => {
                const contract = getContract(dispute.contractId);
                const totalVotes = dispute.votesFor + dispute.votesAgainst;
                const voteProgress = totalVotes > 0
                    ? (dispute.votesFor / totalVotes) * 100
                    : 50;
                return (<div key={dispute.id} className="glass-card rounded-xl border border-border p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center">
                      <AlertTriangle className="h-6 w-6 text-destructive"/>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">
                        {contract?.milestoneTitle || 'Unknown Contract'}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Contract: {dispute.contractId}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={dispute.status} pulse={dispute.status === 'active'}/>
                </div>

                <div className="glass rounded-lg p-4 mb-4">
                  <p className="text-sm text-muted-foreground mb-1">Dispute Reason</p>
                  <p className="text-foreground">{dispute.reason}</p>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="glass rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-foreground">
                      {dispute.ethAtStake.toFixed(4)}
                    </p>
                    <p className="text-xs text-muted-foreground">ETH at Stake</p>
                  </div>
                  <div className="glass rounded-lg p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-2xl font-bold text-foreground">
                      <Users className="h-5 w-5 text-muted-foreground"/>
                      {dispute.jurorCount}
                    </div>
                    <p className="text-xs text-muted-foreground">Jurors Assigned</p>
                  </div>
                  <div className="glass rounded-lg p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-2xl font-bold text-foreground">
                      <Clock className="h-5 w-5 text-muted-foreground"/>
                      {formatDistanceToNow(new Date(dispute.votingDeadline), { addSuffix: false })}
                    </div>
                    <p className="text-xs text-muted-foreground">Time Remaining</p>
                  </div>
                </div>

                {/* Voting Progress */}
                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[#10B981]">Approve ({dispute.votesFor})</span>
                    <span className="text-[#EF4444]">Reject ({dispute.votesAgainst})</span>
                  </div>
                  <div className="relative h-3 rounded-full overflow-hidden bg-[#EF4444]/20">
                    <div className="absolute inset-y-0 left-0 bg-[#10B981] transition-all duration-500" style={{ width: `${voteProgress}%` }}/>
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    {totalVotes} of {dispute.jurorCount} votes cast
                  </p>
                </div>

                {/* Evidence */}
                <div className="grid md:grid-cols-2 gap-4 mb-4">
                  <div className="glass rounded-lg p-4">
                    <p className="text-xs text-accent mb-2">Client Evidence</p>
                    <p className="text-sm text-foreground">{dispute.evidence.clientEvidence}</p>
                  </div>
                  <div className="glass rounded-lg p-4">
                    <p className="text-xs text-accent mb-2">Freelancer Evidence</p>
                    <p className="text-sm text-foreground">
                      {dispute.evidence.freelancerEvidence || 'No evidence submitted yet'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <p className="text-xs text-muted-foreground">
                    Opened on {format(new Date(dispute.createdAt), 'dd MMM yyyy')}
                  </p>
                  <Link href={`/verification/${dispute.contractId}`}>
                    <Button variant="outline" size="sm" className="border-border gap-2">
                      <Eye className="h-4 w-4"/>
                      View Contract
                    </Button>
                  </Link>
                </div>
              </div>);
            })}
        </div>)}
    </div>);
}
