"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/empty-state"
import { useWallet } from "@/contexts/wallet-context"
import { mockDisputes } from "@/lib/mock-data"
import { History, CheckCircle, XCircle, Scale, TrendingUp } from "lucide-react"

export function VotingHistory() {
  const { walletAddress } = useWallet()

  const votedDisputes = mockDisputes.filter((d) =>
    d.votes.some((v) => v.jurorAddress === walletAddress) &&
    d.status === "resolved"
  )

  const getMyVote = (dispute: typeof mockDisputes[0]) =>
    dispute.votes.find((v) => v.jurorAddress === walletAddress)?.vote

  const wasCorrect = (dispute: typeof mockDisputes[0]) => {
    const myVote = getMyVote(dispute)
    return myVote === dispute.resolution
  }

  // Calculate stats
  const correctVotes = votedDisputes.filter(wasCorrect).length
  const totalVotes = votedDisputes.length
  const accuracy = totalVotes > 0 ? Math.round((correctVotes / totalVotes) * 100) : 0

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

      {/* Voting History List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Vote Records</CardTitle>
          <CardDescription>Detailed history of your dispute resolutions</CardDescription>
        </CardHeader>
        <CardContent>
          {votedDisputes.length === 0 ? (
            <EmptyState
              icon="vote"
              title="No voting history"
              description="Your past votes and their outcomes will appear here."
            />
          ) : (
            <div className="space-y-4">
              {votedDisputes.map((dispute) => {
                const myVote = getMyVote(dispute)
                const correct = wasCorrect(dispute)

                return (
                  <div
                    key={dispute.id}
                    className="flex items-center justify-between rounded-lg border border-border p-4"
                  >
                    <div className="flex items-start gap-4">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
                        correct ? "bg-primary/10" : "bg-destructive/10"
                      }`}>
                        {correct ? (
                          <CheckCircle className="h-5 w-5 text-primary" />
                        ) : (
                          <XCircle className="h-5 w-5 text-destructive" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{dispute.reason}</p>
                        <p className="text-sm text-muted-foreground">
                          Dispute #{dispute.id.slice(0, 8)}
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            Your Vote: {myVote === "client" ? "Client" : "Freelancer"}
                          </Badge>
                          <Badge 
                            variant="outline" 
                            className={`text-xs ${correct ? "border-primary/50 text-primary" : "border-destructive/50 text-destructive"}`}
                          >
                            {correct ? "Aligned with Majority" : "Against Majority"}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge className={dispute.status === "resolved" ? "bg-primary" : "bg-warning"}>
                        {dispute.status === "resolved" ? "Resolved" : "Appealed"}
                      </Badge>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Outcome: {dispute.resolution === "client" ? "Client Won" : "Freelancer Won"}
                      </p>
                      <p className="mt-1 text-xs font-medium text-primary">
                        {correct ? "+15 JURY" : "-5 JURY"}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
