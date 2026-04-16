"use client";

/**
 * open-disputes.jsx
 *
 * Two fixes from the gap audit:
 *  1. Removed mockDisputes / mockMilestones imports — uses disputes from ContractContext
 *  2. handleVote now passes `reasoning` to voteOnDispute() so the signed
 *     message is stored in localStorage via contract-context.castVote()
 */

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { useContract } from "@/contexts/contract-context";
import { useWallet } from "@/contexts/wallet-context";
import {
  Scale, Clock, FileText, User, AlertTriangle,
  CheckCircle, Eye, ThumbsUp, ThumbsDown,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function OpenDisputes() {
  const { walletAddress }   = useWallet();
  // disputes comes from DisputeCreated event query in ContractContext
  const { disputes, voteOnDispute, isLoading } = useContract();

  const [selectedDispute, setSelectedDispute] = useState(null);
  const [showVoteDialog,  setShowVoteDialog]  = useState(false);
  const [vote,      setVote]      = useState(null);
  const [reasoning, setReasoning] = useState("");

  // Filter to disputes where this wallet is an assigned juror
  const myDisputes = disputes.filter(d =>
    d.assignedJurors?.some(j => j?.toLowerCase() === walletAddress?.toLowerCase())
  );
  const pendingDisputes  = myDisputes.filter(d => d.status !== "resolved");
  const resolvedDisputes = myDisputes.filter(d => d.status === "resolved");

  const getVotingProgress = (dispute) => {
    const total     = dispute.assignedJurors?.length || 1;
    const submitted = dispute.votes?.length         || 0;
    return (submitted / total) * 100;
  };

  const getTimeRemaining = (deadline) => {
    const diff  = new Date(deadline).getTime() - Date.now();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 0)  return "Expired";
    if (hours < 24) return `${hours} hours`;
    return `${Math.floor(hours / 24)} days`;
  };

  const hasVoted = (dispute) =>
    dispute.votes?.some(v => v.jurorAddress?.toLowerCase() === walletAddress?.toLowerCase());

  // ── FIX: pass reasoning as third argument so contract-context signs and stores it
  const handleVote = async () => {
    if (!selectedDispute || !vote) return;
    await voteOnDispute(selectedDispute.id, vote, reasoning);
    setShowVoteDialog(false);
    setVote(null);
    setReasoning("");
    setSelectedDispute(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Open Disputes</h2>
        <p className="text-muted-foreground">Review evidence and cast your vote on active disputes</p>
      </div>

      <Tabs defaultValue="pending" className="w-full">
        <TabsList>
          <TabsTrigger value="pending">Pending Vote ({pendingDisputes.length})</TabsTrigger>
          <TabsTrigger value="resolved">Resolved ({resolvedDisputes.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-6">
          {pendingDisputes.length === 0 ? (
            <EmptyState
              icon="vote"
              title="No pending disputes"
              description="You have no disputes requiring your vote at this time."
            />
          ) : (
            <div className="grid gap-4">
              {pendingDisputes.map((dispute) => {
                const voted = hasVoted(dispute);
                return (
                  <Card key={dispute.id} className={`transition-all ${voted ? "opacity-60" : "hover:border-primary/50"}`}>
                    <CardHeader>
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-lg">{dispute.reason}</CardTitle>
                            {voted && (
                              <Badge variant="outline" className="bg-primary/10 text-primary">
                                <CheckCircle className="mr-1 h-3 w-3"/>Voted
                              </Badge>
                            )}
                          </div>
                          <CardDescription>Milestone #{dispute.milestoneId}</CardDescription>
                        </div>
                        <StatusBadge status="active"/>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {/* Parties */}
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="rounded-lg border border-border bg-muted/30 p-3">
                            <div className="flex items-center gap-2 text-sm font-medium">
                              <User className="h-4 w-4 text-primary"/>Client
                            </div>
                            <p className="mt-1 font-mono text-xs text-muted-foreground">
                              {dispute.clientAddress
                                ? `${dispute.clientAddress.slice(0,8)}...${dispute.clientAddress.slice(-6)}`
                                : "—"}
                            </p>
                          </div>
                          <div className="rounded-lg border border-border bg-muted/30 p-3">
                            <div className="flex items-center gap-2 text-sm font-medium">
                              <User className="h-4 w-4 text-secondary-foreground"/>Freelancer
                            </div>
                            <p className="mt-1 font-mono text-xs text-muted-foreground">
                              {dispute.freelancerAddress
                                ? `${dispute.freelancerAddress.slice(0,8)}...${dispute.freelancerAddress.slice(-6)}`
                                : "—"}
                            </p>
                          </div>
                        </div>

                        {/* Voting progress */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Voting Progress</span>
                            <span className="font-medium">
                              {dispute.votes?.length ?? 0}/{dispute.assignedJurors?.length ?? 0} votes
                            </span>
                          </div>
                          <Progress value={getVotingProgress(dispute)} className="h-2"/>
                        </div>

                        {/* Meta */}
                        <div className="flex items-center gap-4 text-sm">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Clock className="h-4 w-4"/>
                            <span>Time remaining: {getTimeRemaining(dispute.votingDeadline)}</span>
                          </div>
                          {dispute.ipfsCID && (
                            <div className="flex items-center gap-1.5 text-muted-foreground">
                              <FileText className="h-4 w-4"/>
                              <a
                                href={`https://gateway.pinata.cloud/ipfs/${dispute.ipfsCID}`}
                                target="_blank" rel="noreferrer"
                                className="text-primary hover:underline text-xs"
                              >
                                View submission
                              </a>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2 pt-2">
                          <Button variant="outline" size="sm" onClick={() => setSelectedDispute(dispute)}>
                            <Eye className="mr-2 h-4 w-4"/>Review Evidence
                          </Button>
                          {!voted && (
                            <Button
                              size="sm"
                              disabled={isLoading}
                              onClick={() => { setSelectedDispute(dispute); setShowVoteDialog(true); }}
                            >
                              <Scale className="mr-2 h-4 w-4"/>Cast Vote
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="resolved" className="mt-6">
          {resolvedDisputes.length === 0 ? (
            <EmptyState icon="contract" title="No resolved disputes" description="Resolved disputes will appear here."/>
          ) : (
            <div className="grid gap-4">
              {resolvedDisputes.map(dispute => (
                <Card key={dispute.id}>
                  <CardHeader>
                    <CardTitle className="text-lg">{dispute.reason}</CardTitle>
                    <CardDescription>
                      Resolved — outcome: {dispute.releaseToFreelancer ? "Freelancer won" : "Client won"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <StatusBadge status="resolved"/>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Evidence Review Dialog */}
      <Dialog open={!!selectedDispute && !showVoteDialog} onOpenChange={() => setSelectedDispute(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Dispute Evidence</DialogTitle>
            <DialogDescription>{selectedDispute?.reason}</DialogDescription>
          </DialogHeader>
          <div className="space-y-6">
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <h4 className="font-medium">Dispute Summary</h4>
              <p className="mt-2 text-sm text-muted-foreground">
                Milestone #{selectedDispute?.milestoneId} · Staked: {selectedDispute?.stakedAmount ?? 0} ETH
              </p>
            </div>

            {/* IPFS submission link */}
            {selectedDispute?.ipfsCID && (
              <div className="rounded-lg border border-border p-4">
                <h4 className="font-medium mb-2">Submission on IPFS</h4>
                <a
                  href={`https://gateway.pinata.cloud/ipfs/${selectedDispute.ipfsCID}`}
                  target="_blank" rel="noreferrer"
                  className="text-sm text-primary underline break-all"
                >
                  {selectedDispute.ipfsCID}
                </a>
              </div>
            )}

            {(selectedDispute?.evidence?.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">
                The IPFS submission above is the primary evidence. No additional evidence has been uploaded.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedDispute(null)}>Close</Button>
            <Button onClick={() => setShowVoteDialog(true)}>
              <Scale className="mr-2 h-4 w-4"/>Proceed to Vote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vote Dialog */}
      <Dialog open={showVoteDialog} onOpenChange={setShowVoteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cast Your Vote</DialogTitle>
            <DialogDescription>Your vote is final and will be recorded on-chain</DialogDescription>
          </DialogHeader>
          <div className="space-y-6">
            <div className="rounded-lg border border-[#F59E0B]/50 bg-[#F59E0B]/10 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-[#F59E0B]"/>
                <div className="text-sm text-[#F59E0B]">
                  <p className="font-medium">Important Notice</p>
                  <p className="mt-1">
                    Voting against the majority results in your stake being slashed. This cannot be undone.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium">Your Decision</Label>
              <RadioGroup value={vote || ""} onValueChange={v => setVote(v)} className="mt-3 grid grid-cols-2 gap-4">
                <div>
                  <RadioGroupItem value="client" id="vote-client" className="peer sr-only"/>
                  <Label htmlFor="vote-client" className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-border bg-background p-4 hover:bg-muted peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5">
                    <ThumbsUp className="mb-2 h-6 w-6 text-primary"/>
                    <span className="font-medium">Client</span>
                    <span className="text-xs text-muted-foreground">Rule in favour of client</span>
                  </Label>
                </div>
                <div>
                  <RadioGroupItem value="freelancer" id="vote-freelancer" className="peer sr-only"/>
                  <Label htmlFor="vote-freelancer" className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-border bg-background p-4 hover:bg-muted peer-data-[state=checked]:border-secondary peer-data-[state=checked]:bg-secondary/5">
                    <ThumbsDown className="mb-2 h-6 w-6 text-secondary-foreground"/>
                    <span className="font-medium">Freelancer</span>
                    <span className="text-xs text-muted-foreground">Rule in favour of freelancer</span>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Reasoning — passed to voteOnDispute → signed and stored locally */}
            <div>
              <Label htmlFor="reasoning">Reasoning (Optional)</Label>
              <Textarea
                id="reasoning"
                placeholder="Explain your decision based on the evidence..."
                value={reasoning}
                onChange={e => setReasoning(e.target.value)}
                rows={3}
                className="mt-2"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Your reasoning will be signed with your wallet and stored locally for reference.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVoteDialog(false)}>Cancel</Button>
            <Button onClick={handleVote} disabled={!vote || isLoading}>
              <CheckCircle className="mr-2 h-4 w-4"/>
              {isLoading ? "Submitting…" : "Submit Vote"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
