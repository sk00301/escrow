"use client";
import { useState } from "react";
import { Navbar } from "@/components/navbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWallet } from "@/contexts/wallet-context";
import { useUser } from "@/contexts/user-context";
import { Shield, CheckCircle, Circle, Lock, User, FileText, Coins, ArrowRight, ExternalLink, AlertCircle } from "lucide-react";
const verificationSteps = [
    {
        id: 1,
        title: "Connect Wallet",
        description: "Connect your Ethereum wallet to get started",
        icon: User,
    },
    {
        id: 2,
        title: "Identity Verification",
        description: "Verify your identity through our KYC partner",
        icon: Shield,
    },
    {
        id: 3,
        title: "Stake JURY Tokens",
        description: "Stake minimum 100 JURY tokens to become eligible",
        icon: Coins,
    },
    {
        id: 4,
        title: "Complete Training",
        description: "Pass the juror training assessment",
        icon: FileText,
    },
];
export default function VerifyPage() {
    const { isConnected, address } = useWallet();
    const { userProfile } = useUser();
    const [currentStep, setCurrentStep] = useState(isConnected ? 2 : 1);
    const [stakeAmount, setStakeAmount] = useState("");
    const [isVerifying, setIsVerifying] = useState(false);
    const completedSteps = isConnected ? [1] : [];
    const progress = (completedSteps.length / verificationSteps.length) * 100;
    const handleStartKYC = () => {
        setIsVerifying(true);
        // Simulate KYC process
        setTimeout(() => {
            setIsVerifying(false);
            setCurrentStep(3);
        }, 2000);
    };
    const handleStake = () => {
        // Simulate staking
        setCurrentStep(4);
    };
    const handleStartTraining = () => {
        // Navigate to training
    };
    return (<div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto max-w-4xl px-4 py-12">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Shield className="h-8 w-8 text-primary"/>
          </div>
          <h1 className="text-3xl font-bold text-foreground">Become a Juror</h1>
          <p className="mt-2 text-muted-foreground">
            Complete the verification process to join the decentralized jury pool
          </p>
        </div>

        {/* Progress Bar */}
        <Card className="mb-8">
          <CardContent className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Verification Progress</span>
              <span className="text-sm font-medium">{Math.round(progress)}% Complete</span>
            </div>
            <Progress value={progress} className="h-2"/>
          </CardContent>
        </Card>

        {/* Verification Steps */}
        <div className="space-y-4">
          {verificationSteps.map((step, index) => {
            const isCompleted = completedSteps.includes(step.id);
            const isCurrent = currentStep === step.id;
            const isLocked = step.id > currentStep;
            return (<Card key={step.id} className={`transition-all ${isCurrent ? "border-primary shadow-md" : ""} ${isLocked ? "opacity-60" : ""}`}>
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    {/* Step Number/Status */}
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${isCompleted
                    ? "bg-primary text-primary-foreground"
                    : isCurrent
                        ? "border-2 border-primary bg-primary/10 text-primary"
                        : "border-2 border-border bg-muted text-muted-foreground"}`}>
                      {isCompleted ? (<CheckCircle className="h-5 w-5"/>) : isLocked ? (<Lock className="h-4 w-4"/>) : (<span className="text-sm font-semibold">{step.id}</span>)}
                    </div>

                    {/* Step Content */}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-foreground">{step.title}</h3>
                        {isCompleted && (<Badge className="bg-primary text-primary-foreground">Completed</Badge>)}
                        {isCurrent && (<Badge variant="outline" className="border-primary text-primary">In Progress</Badge>)}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>

                      {/* Step-specific content */}
                      {isCurrent && (<div className="mt-4">
                          {step.id === 1 && !isConnected && (<div className="rounded-lg border border-border bg-muted/30 p-4">
                              <p className="mb-4 text-sm text-muted-foreground">
                                Connect your wallet to begin the verification process. We support MetaMask, 
                                WalletConnect, and Coinbase Wallet.
                              </p>
                              <Button>Connect Wallet</Button>
                            </div>)}

                          {step.id === 2 && (<div className="rounded-lg border border-border bg-muted/30 p-4">
                              <p className="mb-4 text-sm text-muted-foreground">
                                We partner with trusted KYC providers to verify your identity. 
                                This helps maintain the integrity of our dispute resolution system.
                              </p>
                              <div className="mb-4 space-y-2">
                                <div className="flex items-center gap-2 text-sm">
                                  <CheckCircle className="h-4 w-4 text-primary"/>
                                  <span>Government-issued ID required</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm">
                                  <CheckCircle className="h-4 w-4 text-primary"/>
                                  <span>Data encrypted and secure</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm">
                                  <CheckCircle className="h-4 w-4 text-primary"/>
                                  <span>Typically takes 2-5 minutes</span>
                                </div>
                              </div>
                              <Button onClick={handleStartKYC} disabled={isVerifying}>
                                {isVerifying ? (<>Verifying...</>) : (<>
                                    Start Verification
                                    <ExternalLink className="ml-2 h-4 w-4"/>
                                  </>)}
                              </Button>
                            </div>)}

                          {step.id === 3 && (<div className="rounded-lg border border-border bg-muted/30 p-4">
                              <p className="mb-4 text-sm text-muted-foreground">
                                Stake a minimum of 100 JURY tokens to become eligible as a juror. 
                                Your stake acts as collateral and earns rewards.
                              </p>
                              <div className="mb-4 grid gap-4 sm:grid-cols-2">
                                <div className="rounded-lg border border-border bg-background p-3">
                                  <p className="text-xs text-muted-foreground">Minimum Stake</p>
                                  <p className="text-lg font-semibold">100 JURY</p>
                                </div>
                                <div className="rounded-lg border border-border bg-background p-3">
                                  <p className="text-xs text-muted-foreground">Your Balance</p>
                                  <p className="text-lg font-semibold">1,000 JURY</p>
                                </div>
                              </div>
                              <div className="mb-4">
                                <Label htmlFor="stake">Amount to Stake</Label>
                                <Input id="stake" type="number" placeholder="100" value={stakeAmount} onChange={(e) => setStakeAmount(e.target.value)} className="mt-2"/>
                              </div>
                              <Button onClick={handleStake} disabled={!stakeAmount || parseInt(stakeAmount) < 100}>
                                Stake Tokens
                                <Lock className="ml-2 h-4 w-4"/>
                              </Button>
                            </div>)}

                          {step.id === 4 && (<div className="rounded-lg border border-border bg-muted/30 p-4">
                              <p className="mb-4 text-sm text-muted-foreground">
                                Complete our training module to understand the dispute resolution process 
                                and your responsibilities as a juror.
                              </p>
                              <div className="mb-4 space-y-2">
                                <div className="flex items-center gap-2 text-sm">
                                  <Circle className="h-4 w-4 text-muted-foreground"/>
                                  <span>Module 1: Introduction to Dispute Resolution</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm">
                                  <Circle className="h-4 w-4 text-muted-foreground"/>
                                  <span>Module 2: Evidence Evaluation</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm">
                                  <Circle className="h-4 w-4 text-muted-foreground"/>
                                  <span>Module 3: Voting Best Practices</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm">
                                  <Circle className="h-4 w-4 text-muted-foreground"/>
                                  <span>Final Assessment (80% pass rate required)</span>
                                </div>
                              </div>
                              <Button onClick={handleStartTraining}>
                                Start Training
                                <ArrowRight className="ml-2 h-4 w-4"/>
                              </Button>
                            </div>)}
                        </div>)}
                    </div>
                  </div>
                </CardContent>
              </Card>);
        })}
        </div>

        {/* Benefits Card */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="text-lg">Juror Benefits</CardTitle>
            <CardDescription>Why become a verified juror?</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-border p-4 text-center">
                <Coins className="mx-auto mb-2 h-8 w-8 text-primary"/>
                <h4 className="font-medium">Earn Rewards</h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  Get paid in JURY tokens for each vote
                </p>
              </div>
              <div className="rounded-lg border border-border p-4 text-center">
                <Shield className="mx-auto mb-2 h-8 w-8 text-primary"/>
                <h4 className="font-medium">Decentralized Justice</h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  Help maintain fair dispute resolution
                </p>
              </div>
              <div className="rounded-lg border border-border p-4 text-center">
                <Lock className="mx-auto mb-2 h-8 w-8 text-primary"/>
                <h4 className="font-medium">Staking Rewards</h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  Earn passive income on staked tokens
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Warning */}
        <div className="mt-6 rounded-lg border border-warning/50 bg-warning/10 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-5 w-5 text-warning"/>
            <div className="text-sm text-warning">
              <p className="font-medium">Important Notice</p>
              <p className="mt-1">
                Jurors who consistently vote against the majority may lose a portion of their 
                staked tokens. Make sure to carefully review all evidence before casting your vote.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>);
}
