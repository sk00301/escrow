"use client";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatsCard } from "@/components/stats-card";
import { useContracts } from "@/contexts/contract-context";
import { useWallet } from "@/contexts/wallet-context";
import { DollarSign, TrendingUp, Clock, ArrowDownRight, ArrowUpRight, Wallet, ExternalLink, CheckCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// Mock transaction history since it doesn't exist in mock-data
const mockTransactionHistory = [
    {
        hash: "0x1234...5678",
        from: "0x742d35Cc6634C0532925a3b844Bc9e7595f8bE47",
        to: "0x8Ba1f109551bD432803012645Ac136ddd64DBA72",
        amount: 1.2,
        type: "payment_released",
        timestamp: new Date("2026-03-20")
    },
    {
        hash: "0xabcd...efgh",
        from: "0x8Ba1f109551bD432803012645Ac136ddd64DBA72",
        to: "0x742d35Cc6634C0532925a3b844Bc9e7595f8bE47",
        amount: 2.5,
        type: "escrow_funded",
        timestamp: new Date("2026-03-15")
    }
];
export function Earnings() {
    const { walletAddress, balance } = useWallet();
    const { contracts } = useContracts();
    const [showWithdrawDialog, setShowWithdrawDialog] = useState(false);
    const [withdrawAmount, setWithdrawAmount] = useState("");
    // Calculate earnings from contracts
    const completedContracts = contracts.filter((c) => c.freelancerAddress === walletAddress && c.status === "released");
    const pendingContracts = contracts.filter((c) => c.freelancerAddress === walletAddress && ["submitted", "verified"].includes(c.status));
    const inProgressContracts = contracts.filter((c) => c.freelancerAddress === walletAddress && ["funded"].includes(c.status));
    const totalEarned = completedContracts.reduce((sum, c) => sum + c.amount, 0);
    const pendingPayment = pendingContracts.reduce((sum, c) => sum + c.amount, 0);
    const inEscrow = inProgressContracts.reduce((sum, c) => sum + c.amount, 0);
    // Filter transactions for this freelancer
    const myTransactions = mockTransactionHistory.filter((t) => t.from === walletAddress || t.to === walletAddress);
    const handleWithdraw = async () => {
        // In a real app, this would withdraw from the platform
        setShowWithdrawDialog(false);
        setWithdrawAmount("");
    };
    return (<div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Earnings</h2>
          <p className="text-muted-foreground">Track your income and transaction history</p>
        </div>
        <Button onClick={() => setShowWithdrawDialog(true)}>
          <Wallet className="mr-2 h-4 w-4"/>
          Withdraw Funds
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title="Wallet Balance" value={balance} suffix="ETH" icon={Wallet}/>
        <StatsCard title="Total Earned" value={totalEarned.toFixed(2)} suffix="ETH" icon={TrendingUp} trend={{ value: 12, positive: true }}/>
        <StatsCard title="Pending Payment" value={pendingPayment.toFixed(2)} suffix="ETH" icon={Clock}/>
        <StatsCard title="In Escrow" value={inEscrow.toFixed(2)} suffix="ETH" icon={DollarSign}/>
      </div>

      {/* Earnings Breakdown */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pending Payments */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pending Payments</CardTitle>
            <CardDescription>Contracts awaiting fund release</CardDescription>
          </CardHeader>
          <CardContent>
            {pendingContracts.length === 0 ? (<p className="text-sm text-muted-foreground">No pending payments</p>) : (<div className="space-y-3">
                {pendingContracts.map((contract) => (<div key={contract.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div>
                      <p className="font-medium text-foreground">{contract.milestoneTitle}</p>
                      <p className="text-sm text-muted-foreground">
                        {contract.status === "submitted" ? "Awaiting approval" : "Ready for release"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-primary">{contract.amount} ETH</p>
                      <Badge variant="outline" className="mt-1">
                        {contract.status === "submitted" ? "In Review" : "Verified"}
                      </Badge>
                    </div>
                  </div>))}
              </div>)}
          </CardContent>
        </Card>

        {/* Completed Payments */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Completed Payments</CardTitle>
            <CardDescription>Successfully released funds</CardDescription>
          </CardHeader>
          <CardContent>
            {completedContracts.length === 0 ? (<p className="text-sm text-muted-foreground">No completed payments yet</p>) : (<div className="space-y-3">
                {completedContracts.slice(0, 5).map((contract) => (<div key={contract.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                        <CheckCircle className="h-4 w-4 text-primary"/>
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{contract.milestoneTitle}</p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(contract.deadline).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <p className="font-semibold text-primary">+{contract.amount} ETH</p>
                  </div>))}
              </div>)}
          </CardContent>
        </Card>
      </div>

      {/* Transaction History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Transaction History</CardTitle>
          <CardDescription>All blockchain transactions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {myTransactions.length === 0 ? (<p className="text-sm text-muted-foreground">No transactions yet</p>) : (myTransactions.map((tx) => {
            const isIncoming = tx.to === walletAddress;
            return (<div key={tx.hash} className="flex items-center justify-between rounded-lg border border-border p-4">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-full ${isIncoming ? "bg-primary/10" : "bg-muted"}`}>
                        {isIncoming ? (<ArrowDownRight className="h-5 w-5 text-primary"/>) : (<ArrowUpRight className="h-5 w-5 text-muted-foreground"/>)}
                      </div>
                      <div>
                        <p className="font-medium text-foreground">
                          {isIncoming ? "Received" : "Sent"} - {tx.type.replace("_", " ")}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(tx.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`font-semibold ${isIncoming ? "text-primary" : "text-foreground"}`}>
                        {isIncoming ? "+" : "-"}{tx.amount} ETH
                      </p>
                      <Button variant="link" size="sm" className="h-auto p-0 text-xs">
                        View on Etherscan
                        <ExternalLink className="ml-1 h-3 w-3"/>
                      </Button>
                    </div>
                  </div>);
        }))}
          </div>
        </CardContent>
      </Card>

      {/* Withdraw Dialog */}
      <Dialog open={showWithdrawDialog} onOpenChange={setShowWithdrawDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw Funds</DialogTitle>
            <DialogDescription>
              Transfer funds from your platform balance to your wallet
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Available Balance</span>
                <span className="font-semibold text-primary">{balance} ETH</span>
              </div>
            </div>
            <div>
              <Label htmlFor="withdraw-amount">Amount (ETH)</Label>
              <Input id="withdraw-amount" type="number" step="0.01" placeholder="0.00" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="mt-2"/>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWithdrawDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleWithdraw} disabled={!withdrawAmount || parseFloat(withdrawAmount) > parseFloat(balance)}>
              <Wallet className="mr-2 h-4 w-4"/>
              Withdraw
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>);
}
