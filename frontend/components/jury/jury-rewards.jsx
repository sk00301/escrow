"use client";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatsCard } from "@/components/stats-card";
import { useWallet } from "@/contexts/wallet-context";
import { useUser } from "@/contexts/user-context";
import { useContracts } from "@/contexts/contract-context";
import {
  Coins, TrendingUp, Lock, Unlock, CheckCircle, AlertCircle,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function JuryRewards() {
  const { walletAddress }  = useWallet();
  const { userProfile }    = useUser();
  const {
    stakeToBeJuror, unstake, isLoading, contractError, lastTx, etherscanTxLink,
  } = useContracts();

  const [showStakeDialog,   setShowStakeDialog]   = useState(false);
  const [showUnstakeDialog, setShowUnstakeDialog] = useState(false);
  const [stakeAmount,       setStakeAmount]       = useState("");

  const stakedEth = userProfile?.juryStake ?? 0;
  const isJuror   = userProfile?.isJuror   ?? false;

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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Staking</h2>
          <p className="text-muted-foreground">Manage your ETH stake in the jury pool</p>
        </div>
        <div className="flex gap-2">
          {!isJuror ? (
            <Button onClick={() => setShowStakeDialog(true)} disabled={isLoading}>
              <Lock className="mr-2 h-4 w-4" />
              Stake to Join
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setShowUnstakeDialog(true)} disabled={isLoading}>
              <Unlock className="mr-2 h-4 w-4" />
              Unstake
            </Button>
          )}
        </div>
      </div>

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

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatsCard title="ETH Staked"   value={stakedEth.toFixed(4)} suffix=" ETH" icon={Lock} />
        <StatsCard title="Pool Status"  value={isJuror ? "Active" : "Inactive"}    icon={TrendingUp} />
        <StatsCard title="Min Stake"    value="0.01"                 suffix=" ETH" icon={Coins} />
      </div>

      {/* Staking Info */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Staking Overview</CardTitle>
            <CardDescription>Your ETH stake in the jury pool</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Staked Amount</span>
              <span className="font-semibold">{stakedEth.toFixed(4)} ETH</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Juror Status</span>
              {isJuror
                ? <Badge className="bg-primary text-primary-foreground">Active</Badge>
                : <Badge variant="outline">Inactive</Badge>}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Minimum Stake</span>
              <span className="font-medium">0.01 ETH</span>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              <p>Staking ETH makes you eligible for jury selection when a disputed milestone enters the jury phase.</p>
              <p className="mt-1">If you vote with the majority, you earn a share of slashed minority stakes. Minority voters lose their stake.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">How Rewards Work</CardTitle>
            <CardDescription>Slashing and reward mechanics</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle className="h-4 w-4 text-primary" />
                Majority Vote
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                90% of slashed minority stakes are redistributed to majority jurors. 10% goes to the protocol.
              </p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <AlertCircle className="h-4 w-4 text-destructive" />
                Minority Vote
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Voting against the majority results in your full stake being slashed and removed from the pool.
              </p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Lock className="h-4 w-4 text-primary" />
                Unstaking
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                You can unstake at any time unless you are currently assigned to an active dispute.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Stake Dialog */}
      <Dialog open={showStakeDialog} onOpenChange={setShowStakeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stake ETH to Join Jury Pool</DialogTitle>
            <DialogDescription>
              Lock ETH to become eligible for dispute jury selection on Sepolia testnet.
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
                onChange={(e) => setStakeAmount(e.target.value)}
                className="mt-2"
              />
            </div>
            <p className="text-xs text-muted-foreground">Minimum: 0.01 ETH</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStakeDialog(false)}>Cancel</Button>
            <Button onClick={handleStake} disabled={!stakeAmount || isLoading}>
              <Lock className="mr-2 h-4 w-4" />
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
              <Unlock className="mr-2 h-4 w-4" />
              {isLoading ? "Unstaking…" : "Unstake"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
