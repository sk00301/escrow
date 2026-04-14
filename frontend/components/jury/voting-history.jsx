"use client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { useWallet } from "@/contexts/wallet-context";
import { useContracts } from "@/contexts/contract-context";
import { CheckCircle, XCircle, Scale, TrendingUp } from "lucide-react";

export function VotingHistory() {
  const { walletAddress } = useWallet();
  const { disputes }      = useContracts();

  // Only resolved disputes where this wallet cast a vote
  const votedDisputes = disputes.filter(d =>
    d.status === "resolved" &&
    d.votes?.some(v => v.jurorAddress?.toLowerCase() === walletAddress?.toLowerCase())
  );

  const getMyVote  = (dispute) =>
    dispute.votes?.find(v => v.jurorAddress?.toLowerCase() === walletAddress?.toLowerCase())?.vote;

  const wasCorrect = (dispute) => {
    const myVote = getMyVote(dispute);
    if (!myVote) return false;
    // releaseToFreelancer=true means freelancer won
    const outcome = dispute.releaseToFreelancer ? "freelancer" : "client";
    return myVote === outcome;
  };

  const totalVotes   = votedDisputes.length;
  const correctVotes = votedDisputes.filter(wasCorrect).length;
  const accuracy     = totalVotes > 0 ? Math.round((correctVotes / totalVotes) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Voting History</h2>
        <p className="text-muted-foreground">Your past votes and their outcomes</p>
      </div>

      {/* Stats Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Scale className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalVotes}</p>
                <p className="text-sm text-muted-foreground">Total Votes Cast</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <CheckCircle className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{correctVotes}</p>
                <p className="text-sm text-muted-foreground">Majority Aligned</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <TrendingUp className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{accuracy}%</p>
                <p className="text-sm text-muted-foreground">Accuracy Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Vote Records */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Vote Records</CardTitle>
          <CardDescription>Detailed history of your dispute resolutions</CardDescription>
        </CardHeader>
        <CardContent>
          {votedDisputes.length === 0 ? (
            <EmptyState
              icon="vote"
              title="No voting history yet"
              description="Your completed dispute votes will appear here once resolved."
            />
          ) : (
            <div className="space-y-4">
              {votedDisputes.map((dispute) => {
                const myVote  = getMyVote(dispute);
                const correct = wasCorrect(dispute);
                const outcome = dispute.releaseToFreelancer ? "Freelancer Won" : "Client Won";
                return (
                  <div
                    key={dispute.id}
                    className="flex items-center justify-between rounded-lg border border-border p-4"
                  >
                    <div className="flex items-start gap-4">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-full ${correct ? "bg-primary/10" : "bg-destructive/10"}`}>
                        {correct
                          ? <CheckCircle className="h-5 w-5 text-primary" />
                          : <XCircle    className="h-5 w-5 text-destructive" />}
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{dispute.reason}</p>
                        <p className="text-sm text-muted-foreground">
                          Dispute #{dispute.id} · Milestone #{dispute.milestoneId}
                        </p>
                        {myVote && (
                          <div className="mt-2 flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              Your Vote: {myVote === "client" ? "Client" : "Freelancer"}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={`text-xs ${correct
                                ? "border-primary/50 text-primary"
                                : "border-destructive/50 text-destructive"}`}
                            >
                              {correct ? "Aligned with Majority" : "Against Majority"}
                            </Badge>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge className="bg-primary">Resolved</Badge>
                      <p className="mt-1 text-xs text-muted-foreground">Outcome: {outcome}</p>
                      <p className={`mt-1 text-xs font-medium ${correct ? "text-primary" : "text-destructive"}`}>
                        {correct ? "Stake preserved + reward" : "Stake slashed"}
                      </p>
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
