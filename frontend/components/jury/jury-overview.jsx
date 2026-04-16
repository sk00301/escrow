"use client";

/**
 * jury-overview.jsx
 *
 * Uses getJurorStats() to derive accuracy from on-chain VoteCast events
 * rather than the local disputes array (which has no votes[] data).
 */

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatsCard } from "@/components/stats-card";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { useWallet } from "@/contexts/wallet-context";
import { useUser } from "@/contexts/user-context";
import { useContracts } from "@/contexts/contract-context";
import { ethers } from "ethers";
import {
  Scale, CheckCircle, Clock, Coins, TrendingUp,
  AlertCircle, Lock, Unlock,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function JuryOverview() {
  const { walletAddress }          = useWallet();
  const { userProfile }            = useUser();
  const {
    disputes, getJurorStats,
    stakeToBeJuror, unstake,
    isLoading, contractError, etherscanTxLink, lastTx,
  } = useContracts();

  const [jurorStats,        setJurorStats]        = useState(null);
  const [statsLoading,      setStatsLoading]      = useState(false);
  const [showStakeDialog,   setShowStakeDialog]   = useState(false);
  const [showUnstakeDialog, setShowUnstakeDialog] = useState(false);
  const [stakeAmount,       setStakeAmount]       = useState("");

  // Fetch on-chain voting stats via VoteCast event query
  useEffect(() => {
    if (!walletAddress || !getJurorStats) return;
    setStatsLoading(true);
    getJurorStats(walletAddress)
      .then(s => setJurorStats(s))
      .catch(err => console.warn("[JuryOverview] getJurorStats:", err.message))
      .finally(() => setStatsLoading(false));
  }, [walletAddress, getJurorStats]);

  // Disputes assigned to this juror
  const myDisputes = disputes.filter(d =>
    d.assignedJurors?.some(j => j?.toLowerCase() === walletAddress?.toLowerCase())
  );
  const pendingDisputes = myDisputes.filter(d => d.status !== "resolved");

  const stakedEth = userProfile?.juryStake ?? 0;
  const isJuror   = userProfile?.isJuror   ?? false;

  // Stats from on-chain events (fall back to local count if not loaded yet)
  const totalCases  = jurorStats?.totalVotes   ?? myDisputes.length;
  const accuracy    = jurorStats?.accuracyRate ?? 0;

  const handleStake = async () => {
    if (!stakeAmount) return;
    await stakeToBeJuror(stakeAmount);
    setShowStakeDialog(false);
    setStakeAmount("");
  };

  const handleUnstake = async () => {
    await unstake();
    setShowUnstakeDialog(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Jury Overview</h2>
          <p className="text-muted-foreground">Your juror dashboard and dispute resolution stats</p>
        </div>
        <div className="flex gap-2">
          {!isJuror ? (
            <Button onClick={() => setShowStakeDialog(true)} disabled={isLoading}>
              <Lock className="mr-2 h-4 w-4"/>Stake to Join
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setShowUnstakeDialog(true)} disabled={isLoading}>
              <Unlock className="mr-2 h-4 w-4"/>Unstake
            </Button>
          )}
        </div>
      </div>

      {/* TX feedback */}
      {contractError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {contractError}
        </div>
      )}
      {lastTx && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          ✅ {lastTx.description} confirmed —{" "}
          <a href={etherscanTxLink(lastTx.hash)} target="_blank" rel="noreferrer" className="text-primary underline">
            View on Sepolia Etherscan
          </a>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title="Pending Votes" value={pendingDisputes.length} icon={Clock}/>
        <StatsCard title="Total Cases"   value={statsLoading ? "…" : totalCases} icon={Scale}/>
        <StatsCard
          title="Voting Accuracy"
          value={statsLoading ? "…" : accuracy}
          suffix="%"
          icon={TrendingUp}
        />
        <StatsCard title="ETH Staked" value={stakedEth.toFixed(4)} suffix=" ETH" icon={Coins}/>
      </div>

      {/* Juror Status Card */}
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
                {isJuror
                  ? <Badge className="bg-primary text-primary-foreground">Active Juror</Badge>
                  : <Badge variant="outline" className="text-muted-foreground">Not Staked</Badge>}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">ETH Staked</span>
                <span className="font-semibold">{stakedEth.toFixed(4)} ETH</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Cases Resolved</span>
                {statsLoading
                  ? <Skeleton className="h-4 w-8"/>
                  : <span className="font-semibold">{jurorStats?.totalVotes ?? 0}</span>}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Majority Aligned</span>
                {statsLoading
                  ? <Skeleton className="h-4 w-8"/>
                  : <span className="font-semibold">{jurorStats?.correctVotes ?? 0}</span>}
              </div>
            </div>
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  {isJuror
                    ? <CheckCircle className="h-4 w-4 text-primary"/>
                    : <AlertCircle className="h-4 w-4 text-muted-foreground"/>}
                  <span>{isJuror ? "Minimum stake met (0.01 ETH)" : "Stake 0.01 ETH to join"}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  {myDisputes.length > 0
                    ? <CheckCircle className="h-4 w-4 text-primary"/>
                    : <AlertCircle className="h-4 w-4 text-muted-foreground"/>}
                  <span>{myDisputes.length > 0 ? "Has jury experience" : "No disputes assigned yet"}</span>
                </div>
              </div>
              {!isJuror && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-primary">
                  Stake at least 0.01 ETH to be eligible for jury selection on disputed milestones.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pending disputes */}
      {pendingDisputes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pending Votes</CardTitle>
            <CardDescription>Disputes requiring your attention</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {pendingDisputes.slice(0, 3).map(dispute => (
                <div
                  key={dispute.id}
                  className="flex items-center justify-between rounded-lg border border-border p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F59E0B]/10">
                      <AlertCircle className="h-5 w-5 text-[#F59E0B]"/>
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{dispute.reason}</p>
                      <p className="text-sm text-muted-foreground">Milestone #{dispute.milestoneId}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <StatusBadge status="active"/>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Deadline: {new Date(dispute.votingDeadline).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {myDisputes.length === 0 && isJuror && (
        <EmptyState
          icon="vote"
          title="No disputes assigned yet"
          description="Once the admin selects jurors for a disputed milestone, it will appear here."
        />
      )}

      {/* Stake Dialog */}
      <Dialog open={showStakeDialog} onOpenChange={setShowStakeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stake ETH to Join Jury Pool</DialogTitle>
            <DialogDescription>
              Lock ETH (minimum 0.01) to be eligible for jury selection on disputed milestones.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="stake-amount">Amount (ETH)</Label>
              <Input
                id="stake-amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.01"
                value={stakeAmount}
                onChange={e => setStakeAmount(e.target.value)}
                className="mt-2"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Minimum: 0.01 ETH. If you vote against the majority your stake will be slashed.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStakeDialog(false)}>Cancel</Button>
            <Button onClick={handleStake} disabled={!stakeAmount || isLoading}>
              <Lock className="mr-2 h-4 w-4"/>
              {isLoading ? "Staking…" : "Stake & Join Pool"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unstake Dialog */}
      <Dialog open={showUnstakeDialog} onOpenChange={setShowUnstakeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unstake ETH</DialogTitle>
            <DialogDescription>Withdraw your staked ETH from the jury pool.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Currently Staked</span>
                <span className="font-semibold">{stakedEth.toFixed(4)} ETH</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              You cannot unstake while assigned to an active dispute.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUnstakeDialog(false)}>Cancel</Button>
            <Button onClick={handleUnstake} disabled={isLoading}>
              <Unlock className="mr-2 h-4 w-4"/>
              {isLoading ? "Unstaking…" : "Unstake"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
