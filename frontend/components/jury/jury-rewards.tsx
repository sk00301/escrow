"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { StatsCard } from "@/components/stats-card"
import { useWallet } from "@/contexts/wallet-context"
import { useUser } from "@/contexts/user-context"
import { 
  Coins, 
  TrendingUp, 
  Lock,
  Unlock,
  Gift,
  ArrowUpRight,
  Clock,
  CheckCircle
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function JuryRewards() {
  const { walletAddress } = useWallet()
  const { userProfile } = useUser()
  const [showStakeDialog, setShowStakeDialog] = useState(false)
  const [showUnstakeDialog, setShowUnstakeDialog] = useState(false)
  const [stakeAmount, setStakeAmount] = useState("")

  // Mock reward data
  const totalRewards = 245
  const pendingRewards = 35
  const claimedRewards = 210
  const stakedAmount = userProfile?.juryStake || 500

  // Mock reward history
  const rewardHistory = [
    { id: 1, type: "voting_reward", amount: 15, timestamp: "2024-01-15T10:30:00", description: "Voted on Dispute #1234" },
    { id: 2, type: "voting_reward", amount: 15, timestamp: "2024-01-14T14:20:00", description: "Voted on Dispute #1233" },
    { id: 3, type: "staking_reward", amount: 5, timestamp: "2024-01-13T00:00:00", description: "Daily staking reward" },
    { id: 4, type: "accuracy_bonus", amount: 25, timestamp: "2024-01-12T16:45:00", description: "95% accuracy bonus" },
    { id: 5, type: "voting_reward", amount: 15, timestamp: "2024-01-11T09:15:00", description: "Voted on Dispute #1232" },
  ]

  const handleStake = async () => {
    // In a real app, this would stake JURY tokens
    setShowStakeDialog(false)
    setStakeAmount("")
  }

  const handleUnstake = async () => {
    // In a real app, this would unstake JURY tokens
    setShowUnstakeDialog(false)
    setStakeAmount("")
  }

  const handleClaimRewards = async () => {
    // In a real app, this would claim pending rewards
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Rewards & Staking</h2>
          <p className="text-muted-foreground">Manage your JURY tokens and claim rewards</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowStakeDialog(true)}>
            <Lock className="mr-2 h-4 w-4" />
            Stake
          </Button>
          <Button variant="outline" onClick={() => setShowUnstakeDialog(true)}>
            <Unlock className="mr-2 h-4 w-4" />
            Unstake
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Total Earned"
          value={totalRewards}
          suffix=" JURY"
          icon={TrendingUp}
          trend={{ value: 8, positive: true }}
        />
        <StatsCard
          title="Pending Rewards"
          value={pendingRewards}
          suffix=" JURY"
          icon={Gift}
        />
        <StatsCard
          title="Staked Amount"
          value={stakedAmount}
          suffix=" JURY"
          icon={Lock}
        />
        <StatsCard
          title="Claimed"
          value={claimedRewards}
          suffix=" JURY"
          icon={CheckCircle}
        />
      </div>

      {/* Claim Rewards Card */}
      {pendingRewards > 0 && (
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="flex flex-col items-center justify-between gap-4 p-6 sm:flex-row">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Gift className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">You have unclaimed rewards!</p>
                <p className="text-sm text-muted-foreground">
                  {pendingRewards} JURY tokens are ready to be claimed
                </p>
              </div>
            </div>
            <Button onClick={handleClaimRewards}>
              <Coins className="mr-2 h-4 w-4" />
              Claim {pendingRewards} JURY
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Staking Info */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Staking Overview</CardTitle>
            <CardDescription>Your JURY token staking details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Staked Amount</span>
              <span className="font-semibold">{stakedAmount} JURY</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Lock Period</span>
              <span className="font-medium">14 days remaining</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">APY</span>
              <span className="font-semibold text-primary">12.5%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Daily Reward</span>
              <span className="font-medium">~1.7 JURY</span>
            </div>

            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Next Tier Progress</span>
                <span className="font-medium">500 / 1000 JURY</span>
              </div>
              <Progress value={50} className="h-2" />
              <p className="text-xs text-muted-foreground">
                Stake 500 more JURY to reach Tier 3 and earn 15% APY
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Reward Breakdown</CardTitle>
            <CardDescription>How you earn JURY tokens</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  <span className="font-medium">Voting Rewards</span>
                </div>
                <Badge variant="outline">15 JURY / vote</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Earn tokens for each vote cast on disputes
              </p>
            </div>

            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <span className="font-medium">Accuracy Bonus</span>
                </div>
                <Badge variant="outline">Up to 50 JURY</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Bonus rewards for voting with the majority
              </p>
            </div>

            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-primary" />
                  <span className="font-medium">Staking Rewards</span>
                </div>
                <Badge variant="outline">12.5% APY</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Daily rewards based on staked amount
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Reward History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Reward History</CardTitle>
          <CardDescription>Recent JURY token earnings</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {rewardHistory.map((reward) => (
              <div
                key={reward.id}
                className="flex items-center justify-between rounded-lg border border-border p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                    {reward.type === "voting_reward" && <CheckCircle className="h-5 w-5 text-primary" />}
                    {reward.type === "staking_reward" && <Lock className="h-5 w-5 text-primary" />}
                    {reward.type === "accuracy_bonus" && <TrendingUp className="h-5 w-5 text-primary" />}
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{reward.description}</p>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {new Date(reward.timestamp).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 font-semibold text-primary">
                  <ArrowUpRight className="h-4 w-4" />
                  +{reward.amount} JURY
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Stake Dialog */}
      <Dialog open={showStakeDialog} onOpenChange={setShowStakeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stake JURY Tokens</DialogTitle>
            <DialogDescription>
              Lock your JURY tokens to earn staking rewards and increase voting power
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Available Balance</span>
                <span className="font-semibold">1,000 JURY</span>
              </div>
            </div>
            <div>
              <Label htmlFor="stake-amount">Amount to Stake</Label>
              <Input
                id="stake-amount"
                type="number"
                placeholder="0"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
                className="mt-2"
              />
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              <p>Staking Period: <span className="font-medium text-foreground">30 days minimum</span></p>
              <p className="mt-1">Current APY: <span className="font-medium text-primary">12.5%</span></p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStakeDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleStake} disabled={!stakeAmount}>
              <Lock className="mr-2 h-4 w-4" />
              Stake Tokens
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unstake Dialog */}
      <Dialog open={showUnstakeDialog} onOpenChange={setShowUnstakeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unstake JURY Tokens</DialogTitle>
            <DialogDescription>
              Withdraw your staked JURY tokens
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Currently Staked</span>
                <span className="font-semibold">{stakedAmount} JURY</span>
              </div>
            </div>
            <div>
              <Label htmlFor="unstake-amount">Amount to Unstake</Label>
              <Input
                id="unstake-amount"
                type="number"
                placeholder="0"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
                className="mt-2"
              />
            </div>
            <div className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm text-warning">
              Early unstaking may result in a penalty. You have 14 days remaining in your lock period.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUnstakeDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleUnstake} disabled={!stakeAmount}>
              <Unlock className="mr-2 h-4 w-4" />
              Unstake Tokens
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
