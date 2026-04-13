"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { StatsCard } from "@/components/stats-card"
import { StatusBadge } from "@/components/status-badge"
import { useWallet } from "@/contexts/wallet-context"
import { useUser } from "@/contexts/user-context"
import { mockDisputes } from "@/lib/mock-data"
import {
  Scale,
  CheckCircle,
  Clock,
  Coins,
  TrendingUp,
  AlertCircle,
  ArrowRight
} from "lucide-react"

export function JuryOverview() {
  const { walletAddress } = useWallet()
  const { userProfile } = useUser()

  const myDisputes = mockDisputes.filter((d) =>
    d.assignedJurors.includes(walletAddress || "")
  )
  const pendingDisputes = myDisputes.filter((d) => d.status === "active")
  const completedDisputes = myDisputes.filter((d) => d.status === "resolved")

  const correctVotes = completedDisputes.filter((d) => {
    const myVote = d.votes.find((v) => v.jurorAddress === walletAddress)?.vote
    return myVote === (d.resolution === "client" ? "client" : "freelancer")
  }).length
  const accuracy = completedDisputes.length > 0
    ? Math.round((correctVotes / completedDisputes.length) * 100)
    : 100

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Jury Overview</h2>
        <p className="text-muted-foreground">Your juror dashboard and dispute resolution stats</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Pending Votes"
          value={pendingDisputes.length}
          icon={Clock}
        />
        <StatsCard
          title="Total Cases"
          value={myDisputes.length}
          icon={Scale}
        />
        <StatsCard
          title="Voting Accuracy"
          value={accuracy}
          suffix="%"
          icon={TrendingUp}
          trend={{ value: 5, positive: true }}
        />
        <StatsCard
          title="JURY Staked"
          value={userProfile?.juryStake ?? 0}
          icon={Coins}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Juror Status</CardTitle>
          <CardDescription>Your current standing in the jury pool</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge className="bg-primary text-primary-foreground">Active Juror</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Reputation Score</span>
                <span className="font-semibold">{userProfile?.reputation ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Cases Resolved</span>
                <span className="font-semibold">{completedDisputes.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">JURY Rewards Earned</span>
                <span className="font-semibold text-primary">245 JURY</span>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Voting Power</span>
                  <span className="font-medium">Level 3</span>
                </div>
                <Progress value={75} className="h-2" />
                <p className="mt-1 text-xs text-muted-foreground">
                  250 more JURY needed for Level 4
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  <span>Identity Verified</span>
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  <span>Minimum Stake Met</span>
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  <span>Training Completed</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {pendingDisputes.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Pending Votes</CardTitle>
                <CardDescription>Disputes requiring your attention</CardDescription>
              </div>
              <Button variant="outline" size="sm">
                View All
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {pendingDisputes.slice(0, 3).map((dispute) => (
                <div
                  key={dispute.id}
                  className="flex items-center justify-between rounded-lg border border-border p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F59E0B]/10">
                      <AlertCircle className="h-5 w-5 text-[#F59E0B]" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{dispute.reason}</p>
                      <p className="text-sm text-muted-foreground">
                        Contract: {dispute.contractId}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <StatusBadge status="active" />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Ends: {new Date(dispute.votingDeadline).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Activity</CardTitle>
          <CardDescription>Your latest jury actions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                <CheckCircle className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Voted on Dispute #1234</p>
                <p className="text-xs text-muted-foreground">2 hours ago</p>
              </div>
              <Badge variant="outline">+15 JURY</Badge>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                <Scale className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Assigned to Dispute #1235</p>
                <p className="text-xs text-muted-foreground">5 hours ago</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                <Coins className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Staked 100 JURY</p>
                <p className="text-xs text-muted-foreground">1 day ago</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
