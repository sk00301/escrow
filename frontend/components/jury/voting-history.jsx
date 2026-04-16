"use client";

/**
 * voting-history.jsx
 *
 * Replaces mockDisputes with real on-chain data via getJurorStats().
 * getJurorStats() queries VoteCast + VotesTallied events from JuryStaking
 * to calculate total votes, majority-aligned votes, and accuracy rate.
 *
 * Signed reasoning is loaded from localStorage (stored by castVote in
 * contract-context when the juror submitted their vote).
 */

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { useWallet } from "@/contexts/wallet-context";
import { useContracts } from "@/contexts/contract-context";
import { CheckCircle, XCircle, Scale, TrendingUp, MessageSquare } from "lucide-react";

// Load signed reasoning the juror stored when casting a vote
function loadReasoning(disputeId, address) {
  try {
    const raw = localStorage.getItem(`vote_reason_${disputeId}_${address?.toLowerCase()}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function VotingHistory() {
  const { walletAddress }          = useWallet();
  const { disputes, getJurorStats } = useContracts();

  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(false);

  // Fetch on-chain juror stats via VoteCast event query
  useEffect(() => {
    if (!walletAddress || !getJurorStats) return;
    setLoading(true);
    getJurorStats(walletAddress)
      .then(s => setStats(s))
      .catch(err => console.warn("[VotingHistory] getJurorStats failed:", err.message))
      .finally(() => setLoading(false));
  }, [walletAddress, getJurorStats]);

  // Resolved disputes where this wallet was an assigned juror
  const votedDisputes = disputes.filter(d =>
    d.status === "resolved" &&
    d.assignedJurors?.some(j => j?.toLowerCase() === walletAddress?.toLowerCase())
  );

  const totalVotes   = stats?.totalVotes   ?? votedDisputes.length;
  const correctVotes = stats?.correctVotes ?? 0;
  const accuracy     = stats?.accuracyRate ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Voting History</h2>
        <p className="text-muted-foreground">Your past votes and their outcomes</p>
      </div>

      {/* Stats Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { icon: Scale,       label: "Total Votes Cast",  value: loading ? null : totalVotes },
          { icon: CheckCircle, label: "Majority Aligned",  value: loading ? null : correctVotes },
          { icon: TrendingUp,  label: "Accuracy Rate",     value: loading ? null : `${accuracy}%` },
        ].map(({ icon: Icon, label, value }) => (
          <Card key={label}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <Icon className="h-6 w-6 text-primary"/>
                </div>
                <div>
                  {value === null
                    ? <Skeleton className="h-8 w-16 mb-1"/>
                    : <p className="text-2xl font-bold">{value}</p>}
                  <p className="text-sm text-muted-foreground">{label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Vote Records */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Vote Records</CardTitle>
          <CardDescription>
            Disputes resolved on-chain where you participated as a juror
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full"/>)}
            </div>
          ) : votedDisputes.length === 0 ? (
            <EmptyState
              icon="vote"
              title="No voting history yet"
              description="Resolved disputes you participated in will appear here once tallied on-chain."
            />
          ) : (
            <div className="space-y-4">
              {votedDisputes.map(dispute => {
                const outcome  = dispute.releaseToFreelancer ? "freelancer" : "client";
                // We know the juror was assigned but can't recover their individual vote
                // from the disputes array (votes[] is empty from chain normalisation).
                // We can check if they were on the winning side via the stored reasoning.
                const reasoning = loadReasoning(dispute.id, walletAddress);
                const myVote    = reasoning?.vote ?? null;
                const correct   = myVote ? (myVote === outcome) : null;

                return (
                  <div
                    key={dispute.id}
                    className="flex items-start justify-between rounded-lg border border-border p-4 gap-4"
                  >
                    <div className="flex items-start gap-4">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-full shrink-0 ${
                        correct === true  ? "bg-primary/10"
                        : correct === false ? "bg-destructive/10"
                        : "bg-muted/50"
                      }`}>
                        {correct === true  ? <CheckCircle className="h-5 w-5 text-primary"/>
                         : correct === false ? <XCircle    className="h-5 w-5 text-destructive"/>
                         : <Scale className="h-5 w-5 text-muted-foreground"/>}
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{dispute.reason}</p>
                        <p className="text-sm text-muted-foreground">
                          Dispute #{dispute.id} · Milestone #{dispute.milestoneId}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {myVote && (
                            <Badge variant="outline" className="text-xs capitalize">
                              Your Vote: {myVote}
                            </Badge>
                          )}
                          {correct !== null && (
                            <Badge
                              variant="outline"
                              className={`text-xs ${
                                correct
                                  ? "border-primary/50 text-primary"
                                  : "border-destructive/50 text-destructive"
                              }`}
                            >
                              {correct ? "Aligned with Majority" : "Against Majority"}
                            </Badge>
                          )}
                          {!myVote && (
                            <Badge variant="outline" className="text-xs text-muted-foreground">
                              Vote detail not available
                            </Badge>
                          )}
                        </div>
                        {/* Show signed reasoning if available */}
                        {reasoning?.text && (
                          <div className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                            <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0"/>
                            <span className="italic">&ldquo;{reasoning.text}&rdquo;</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <Badge className="bg-primary text-primary-foreground">Resolved</Badge>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Outcome: {dispute.releaseToFreelancer ? "Freelancer Won" : "Client Won"}
                      </p>
                      {correct !== null && (
                        <p className={`mt-1 text-xs font-medium ${
                          correct ? "text-primary" : "text-destructive"
                        }`}>
                          {correct ? "Stake preserved + reward" : "Stake slashed"}
                        </p>
                      )}
                      {dispute.resolvedAt && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {new Date(dispute.resolvedAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
