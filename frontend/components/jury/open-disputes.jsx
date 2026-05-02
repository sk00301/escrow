"use client";

import { useState } from "react";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { useContracts } from "@/contexts/contract-context";
import { useWallet } from "@/contexts/wallet-context";
import {
  Scale, Clock, FileText, User, AlertTriangle, CheckCircle,
  Eye, Gavel, Loader2, ExternalLink, XCircle,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * OpenDisputes
 * ─────────────
 * Shows disputes assigned to this juror.
 * Key flows:
 *   1. Review evidence (IPFS link + SRS)
 *   2. Cast vote (client wins / freelancer wins) + optional reasoning
 *   3. After ALL jurors have voted → Tally Votes button appears → calls tallyVotes()
 *
 * Status mapping (from DisputeContract.sol):
 *   0 = OPEN → "open"
 *   1 = JURORS_ASSIGNED → "jurors_assigned"
 *   2 = VOTING → "voting"
 *   3 = RESOLVED → "resolved"
 */
export function OpenDisputes() {
  const { walletAddress } = useWallet();
  const {
    disputes, contracts,
    voteOnDispute, tallyVotes,
    isLoading,
  } = useContracts();

  const [selectedDispute, setSelectedDispute]   = useState(null);
  const [showVoteDialog,  setShowVoteDialog]     = useState(false);
  const [vote,            setVote]               = useState("");       // "client" | "freelancer"
  const [reasoning,       setReasoning]          = useState("");
  const [actionPending,   setActionPending]      = useState(null);    // disputeId

  // Disputes this wallet is an assigned juror on
  const myDisputes = disputes.filter((d) =>
    d.assignedJurors?.some((j) => j?.toLowerCase() === walletAddress?.toLowerCase())
  );
  const pendingDisputes  = myDisputes.filter((d) => d.status !== "resolved");
  const resolvedDisputes = myDisputes.filter((d) => d.status === "resolved");

  // ── Helpers ──────────────────────────────────────────────────────────────

  const getMilestone = (d) => contracts.find((c) => c.id === d.milestoneId);

  const hasVoted = (dispute) =>
    dispute.votes?.some(
      (v) => v.jurorAddress?.toLowerCase() === walletAddress?.toLowerCase()
    );

  // All jurors have voted and votes haven't been tallied yet
  const canTally = (dispute) => {
    if (dispute.status === "resolved") return false;
    const jurorCount = dispute.assignedJurors?.length ?? 0;
    const voteCount  = dispute.votes?.length ?? 0;
    return jurorCount > 0 && voteCount >= jurorCount;
  };

  const getVotingProgress = (d) => {
    const total     = d.assignedJurors?.length || 1;
    const submitted = d.votes?.length          || 0;
    return (submitted / total) * 100;
  };

  const getTimeRemaining = (deadline) => {
    const hours = Math.floor((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60));
    if (hours < 0)  return "Expired";
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  };

  const statusLabel = (status) =>
    ({ open: "Open", jurors_assigned: "Jurors Assigned", voting: "Voting", resolved: "Resolved" }[status] ?? status);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleVote = async () => {
    if (!selectedDispute || !vote) return;
    setActionPending(selectedDispute.id);
    try {
      await voteOnDispute(selectedDispute.id, vote, reasoning);
      setShowVoteDialog(false);
      setVote("");
      setReasoning("");
      setSelectedDispute(null);
    } finally {
      setActionPending(null);
    }
  };

  const handleTally = async (disputeId) => {
    setActionPending(disputeId);
    try {
      await tallyVotes(disputeId);
    } finally {
      setActionPending(null);
    }
  };

  const openVoteDialog = (dispute) => {
    setSelectedDispute(dispute);
    setVote("");
    setReasoning("");
    setShowVoteDialog(true);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Open Disputes</h2>
        <p className="text-muted-foreground">Review evidence and cast your vote on disputes you are assigned to</p>
      </div>

      <Tabs defaultValue="pending" className="w-full">
        <TabsList>
          <TabsTrigger value="pending">
            Pending ({pendingDisputes.length})
          </TabsTrigger>
          <TabsTrigger value="resolved">
            Resolved ({resolvedDisputes.length})
          </TabsTrigger>
        </TabsList>

        {/* ── Pending tab ── */}
        <TabsContent value="pending" className="mt-6">
          {pendingDisputes.length === 0 ? (
            <EmptyState
              icon="vote"
              title="No pending disputes"
              description="You have no disputes requiring your vote. You will be notified when a dispute is assigned to you."
            />
          ) : (
            <div className="grid gap-4">
              {pendingDisputes.map((dispute) => {
                const voted     = hasVoted(dispute);
                const tallying  = canTally(dispute);
                const milestone = getMilestone(dispute);
                const isPending = actionPending === dispute.id;

                return (
                  <Card
                    key={dispute.id}
                    className={`transition-all ${voted && !tallying ? "opacity-70" : "hover:border-primary/50"}`}
                  >
                    <CardHeader>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <CardTitle className="text-lg">
                              {milestone?.milestoneTitle ?? `Dispute #${dispute.id}`}
                            </CardTitle>
                            {voted && (
                              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                                <CheckCircle className="mr-1 h-3 w-3" />Voted
                              </Badge>
                            )}
                            {tallying && (
                              <Badge variant="outline" className="bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30">
                                <Gavel className="mr-1 h-3 w-3" />Ready to Tally
                              </Badge>
                            )}
                          </div>
                          <CardDescription>
                            Dispute #{dispute.id} · Milestone #{dispute.milestoneId} · {statusLabel(dispute.status)}
                          </CardDescription>
                        </div>
                        <StatusBadge status="disputed" />
                      </div>
                    </CardHeader>

                    <CardContent>
                      <div className="space-y-4">
                        {/* Parties */}
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg border border-border bg-muted/30 p-3">
                            <div className="flex items-center gap-2 text-sm font-medium mb-1">
                              <User className="h-4 w-4 text-primary" /> Client
                            </div>
                            <p className="font-mono text-xs text-muted-foreground">
                              {dispute.clientAddress
                                ? `${dispute.clientAddress.slice(0,10)}…${dispute.clientAddress.slice(-6)}`
                                : "—"}
                            </p>
                          </div>
                          <div className="rounded-lg border border-border bg-muted/30 p-3">
                            <div className="flex items-center gap-2 text-sm font-medium mb-1">
                              <User className="h-4 w-4 text-muted-foreground" /> Freelancer
                            </div>
                            <p className="font-mono text-xs text-muted-foreground">
                              {dispute.freelancerAddress
                                ? `${dispute.freelancerAddress.slice(0,10)}…${dispute.freelancerAddress.slice(-6)}`
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
                          <Progress value={getVotingProgress(dispute)} className="h-2" />
                        </div>

                        {/* Evidence + deadline */}
                        <div className="flex flex-wrap items-center gap-4 text-sm">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            <span>{getTimeRemaining(dispute.votingDeadline)} remaining</span>
                          </div>
                          {dispute.ipfsCID && (
                            <a
                              href={`https://gateway.pinata.cloud/ipfs/${dispute.ipfsCID}`}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1.5 text-primary hover:underline text-sm"
                            >
                              <FileText className="h-4 w-4" />
                              Submission on IPFS
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          {milestone?.acceptanceCriteria?.srsCID && (
                            <a
                              href={`https://gateway.pinata.cloud/ipfs/${milestone.acceptanceCriteria.srsCID}`}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1.5 text-primary hover:underline text-sm"
                            >
                              <FileText className="h-4 w-4" />
                              SRS Spec
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex flex-wrap gap-2 pt-2">
                          {/* Evidence review */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setSelectedDispute(dispute); }}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            Review Evidence
                          </Button>

                          {/* Cast vote (only if not yet voted) */}
                          {!voted && dispute.status !== "resolved" && (
                            <Button
                              size="sm"
                              disabled={isPending || isLoading}
                              onClick={() => openVoteDialog(dispute)}
                            >
                              <Scale className="mr-2 h-4 w-4" />
                              Cast Vote
                            </Button>
                          )}

                          {/* Tally votes — appears when all jurors have voted */}
                          {tallying && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={isPending || isLoading}
                              onClick={() => handleTally(dispute.id)}
                            >
                              {isPending
                                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Tallying…</>
                                : <><Gavel className="mr-2 h-4 w-4" />Tally Votes & Close</>}
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

        {/* ── Resolved tab ── */}
        <TabsContent value="resolved" className="mt-6">
          {resolvedDisputes.length === 0 ? (
            <EmptyState
              icon="contract"
              title="No resolved disputes"
              description="Resolved disputes will appear here."
            />
          ) : (
            <div className="grid gap-4">
              {resolvedDisputes.map((dispute) => {
                const milestone = getMilestone(dispute);
                return (
                  <Card key={dispute.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-lg">
                            {milestone?.milestoneTitle ?? `Dispute #${dispute.id}`}
                          </CardTitle>
                          <CardDescription>
                            Dispute #{dispute.id} · Milestone #{dispute.milestoneId}
                          </CardDescription>
                        </div>
                        <StatusBadge status="resolved" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className={`rounded-lg border p-3 flex items-center gap-2 text-sm font-medium
                        ${dispute.releaseToFreelancer
                          ? "border-primary/30 bg-primary/5 text-primary"
                          : "border-destructive/30 bg-destructive/5 text-destructive"}`}
                      >
                        {dispute.releaseToFreelancer
                          ? <><CheckCircle className="h-4 w-4" /> Freelancer won — payment released</>
                          : <><XCircle className="h-4 w-4" /> Client won — funds returned</>}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Evidence Review Dialog ── */}
      <Dialog
        open={!!selectedDispute && !showVoteDialog}
        onOpenChange={() => setSelectedDispute(null)}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Evidence Review</DialogTitle>
            <DialogDescription>
              Dispute #{selectedDispute?.id} · Milestone #{selectedDispute?.milestoneId}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* Parties summary */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground mb-1">Client</p>
                <p className="font-mono text-xs text-foreground break-all">
                  {selectedDispute?.clientAddress ?? "—"}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground mb-1">Freelancer</p>
                <p className="font-mono text-xs text-foreground break-all">
                  {selectedDispute?.freelancerAddress ?? "—"}
                </p>
              </div>
            </div>

            {/* Staked amount */}
            <div className="rounded-lg border border-border bg-muted/30 p-4 flex justify-between items-center">
              <span className="text-sm text-muted-foreground">ETH locked in escrow</span>
              <span className="font-bold text-foreground">
                {selectedDispute?.stakedAmount?.toFixed(4) ?? "—"} ETH
              </span>
            </div>

            {/* Deliverable on IPFS */}
            {selectedDispute?.ipfsCID ? (
              <div className="rounded-lg border border-border p-4">
                <p className="text-sm font-medium mb-2">Freelancer Deliverable (IPFS)</p>
                <a
                  href={`https://gateway.pinata.cloud/ipfs/${selectedDispute.ipfsCID}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-sm text-primary hover:underline break-all"
                >
                  <ExternalLink className="h-4 w-4 shrink-0" />
                  {selectedDispute.ipfsCID}
                </a>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No IPFS submission recorded for this dispute.
              </p>
            )}

            {/* SRS / spec */}
            {(() => {
              const milestone = getMilestone(selectedDispute ?? {});
              return milestone?.acceptanceCriteria?.srsCID ? (
                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm font-medium mb-2">Client Specification (SRS)</p>
                  <a
                    href={`https://gateway.pinata.cloud/ipfs/${milestone.acceptanceCriteria.srsCID}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-sm text-primary hover:underline break-all"
                  >
                    <ExternalLink className="h-4 w-4 shrink-0" />
                    {milestone.acceptanceCriteria.srsCID}
                  </a>
                </div>
              ) : null;
            })()}

            {/* Acceptance requirements */}
            {(() => {
              const milestone = getMilestone(selectedDispute ?? {});
              const reqs = milestone?.acceptanceCriteria?.requirements ?? [];
              return reqs.length > 0 ? (
                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm font-medium mb-3">Acceptance Requirements</p>
                  <ul className="space-y-2">
                    {reqs.map((req, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <CheckCircle className="mt-0.5 h-4 w-4 text-primary shrink-0" />
                        {req}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null;
            })()}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedDispute(null)}>Close</Button>
            {selectedDispute && !hasVoted(selectedDispute) && selectedDispute.status !== "resolved" && (
              <Button onClick={() => openVoteDialog(selectedDispute)}>
                <Scale className="mr-2 h-4 w-4" />
                Proceed to Vote
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Vote Dialog ── */}
      <Dialog open={showVoteDialog} onOpenChange={setShowVoteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cast Your Vote</DialogTitle>
            <DialogDescription>
              Your vote is final and recorded on-chain. You cannot change it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* Warning */}
            <div className="rounded-lg border border-[#F59E0B]/50 bg-[#F59E0B]/10 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-[#F59E0B] shrink-0" />
                <div className="text-sm text-[#F59E0B]">
                  <p className="font-medium">Voting against the majority slashes your stake.</p>
                  <p className="mt-1 text-xs">Review the IPFS submission and SRS spec before deciding.</p>
                </div>
              </div>
            </div>

            {/* Decision */}
            <div>
              <Label className="text-sm font-medium mb-3 block">Your Decision</Label>
              <RadioGroup
                value={vote}
                onValueChange={setVote}
                className="grid grid-cols-2 gap-3"
              >
                {/* Client wins */}
                <div>
                  <RadioGroupItem value="client" id="vote-client" className="peer sr-only" />
                  <Label
                    htmlFor="vote-client"
                    className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-border bg-background p-4 hover:bg-muted
                      peer-data-[state=checked]:border-destructive peer-data-[state=checked]:bg-destructive/5 transition-colors"
                  >
                    <XCircle className="mb-2 h-7 w-7 text-destructive" />
                    <span className="font-semibold">Client Wins</span>
                    <span className="text-xs text-muted-foreground text-center mt-1">
                      Work did not meet requirements — refund client
                    </span>
                  </Label>
                </div>

                {/* Freelancer wins */}
                <div>
                  <RadioGroupItem value="freelancer" id="vote-freelancer" className="peer sr-only" />
                  <Label
                    htmlFor="vote-freelancer"
                    className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-border bg-background p-4 hover:bg-muted
                      peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 transition-colors"
                  >
                    <CheckCircle className="mb-2 h-7 w-7 text-primary" />
                    <span className="font-semibold">Freelancer Wins</span>
                    <span className="text-xs text-muted-foreground text-center mt-1">
                      Work meets requirements — release payment
                    </span>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Reasoning */}
            <div>
              <Label htmlFor="reasoning">Reasoning
                <span className="ml-1 text-xs text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                id="reasoning"
                placeholder="Explain your decision based on the evidence…"
                value={reasoning}
                onChange={(e) => setReasoning(e.target.value)}
                rows={3}
                className="mt-2"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Signed with your wallet and stored locally for reference.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVoteDialog(false)}>Cancel</Button>
            <Button
              onClick={handleVote}
              disabled={!vote || actionPending !== null || isLoading}
            >
              {actionPending !== null
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting…</>
                : <><CheckCircle className="mr-2 h-4 w-4" />Submit Vote</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
