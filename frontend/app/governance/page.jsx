"use client";

/**
 * app/governance/page.jsx
 * ══════════════════════════════════════════════════════════════════════
 * Governance page — fully wired to the FastAPI backend.
 *
 * What changed from the prototype
 * ────────────────────────────────
 *  REMOVED  in-memory useState arrays for proposals
 *  REMOVED  handleVote() / handleCreateProposal() local functions
 *  ADDED    useGovernance(walletAddress, signer) hook (all API calls)
 *  ADDED    eligibility gating — banner + disabled buttons
 *  ADDED    "already voted" badge per proposal
 *  ADDED    MetaMask sign step in vote and create flows
 *  ADDED    loading spinners, error toasts, optimistic UI updates
 *  UPDATED  stats cards pull from GET /api/governance/stats
 *  UPDATED  vote dialog explains off-chain + publicly auditable storage
 */

import { useState, useCallback } from "react";
import { Navbar }        from "@/components/navbar";
import { StatsCard }     from "@/components/stats-card";
import { useWallet }     from "@/contexts/wallet-context";
import { toast }         from "@/hooks/use-toast";
import { useGovernance } from "@/hooks/useGovernance";

import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button }   from "@/components/ui/button";
import { Badge }    from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input }    from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label }    from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import {
  Vote, Users, Clock, CheckCircle, XCircle, AlertCircle,
  FileText, ThumbsUp, ThumbsDown, Plus, Loader2,
  ShieldAlert, ShieldCheck, RefreshCw,
} from "lucide-react";

// ── helpers ───────────────────────────────────────────────────────────────────

function shortWallet(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  EligibilityBanner
// ═══════════════════════════════════════════════════════════════════════════════

function EligibilityBanner({ eligibility, onRefresh, refreshing }) {
  if (!eligibility || eligibility.eligible) return null;
  return (
    <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-600 dark:text-amber-400">
      <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0" />
      <div className="flex-1">
        <p className="font-medium">Voting access restricted</p>
        <p className="mt-0.5 text-amber-600/80 dark:text-amber-400/80">
          You need at least 1 completed transaction on Aegistra to vote or create proposals.
          Currently: <strong>{eligibility.completed_txns}</strong> completed
          transaction{eligibility.completed_txns !== 1 ? "s" : ""}.{" "}
          <a href="/contracts" className="underline underline-offset-2 hover:text-amber-500">
            Find a job to get started →
          </a>
        </p>
      </div>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        title="Re-check eligibility"
        className="flex-shrink-0 rounded p-1 hover:bg-amber-500/20"
      >
        <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ProposalCard
// ═══════════════════════════════════════════════════════════════════════════════

function ProposalCard({ proposal, isConnected, eligible, myVote, onViewDetails, onOpenVote }) {
  const alreadyVoted = Boolean(myVote);

  return (
    <Card className="transition-all hover:border-primary/50">
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-lg">{proposal.title}</CardTitle>
              <Badge variant="outline">{proposal.category}</Badge>
            </div>
            <CardDescription className="line-clamp-2">{proposal.description}</CardDescription>
          </div>

          {proposal.status === "active" && (
            <Badge className="bg-primary text-primary-foreground w-fit whitespace-nowrap">
              <Clock className="mr-1 h-3 w-3" />{proposal.time_remaining}
            </Badge>
          )}
          {proposal.status === "passed" && (
            <Badge className="bg-emerald-600 text-white w-fit">
              <CheckCircle className="mr-1 h-3 w-3" /> Passed
            </Badge>
          )}
          {proposal.status === "rejected" && (
            <Badge variant="destructive" className="w-fit">
              <XCircle className="mr-1 h-3 w-3" /> Rejected
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-4">
          {/* Vote bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <ThumbsUp className="h-4 w-4 text-primary" />
                <span>For: {proposal.votes_for}</span>
              </div>
              <div className="flex items-center gap-2">
                <span>Against: {proposal.votes_against}</span>
                <ThumbsDown className="h-4 w-4 text-destructive" />
              </div>
            </div>
            <div className="relative h-3 overflow-hidden rounded-full bg-destructive/20">
              <div
                className="absolute left-0 top-0 h-full bg-primary transition-all duration-500"
                style={{ width: `${proposal.for_percentage}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{proposal.for_percentage}% For</span>
              <span className={proposal.has_met_quorum ? "text-emerald-600" : ""}>
                {proposal.total_votes}/{proposal.quorum} quorum
                {proposal.has_met_quorum ? " ✓" : ""}
              </span>
            </div>
          </div>

          {/* Proposer */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            <span className="font-mono text-xs">{shortWallet(proposal.proposer_wallet)}</span>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => onViewDetails(proposal)}>
              <FileText className="mr-2 h-4 w-4" />View Details
            </Button>

            {isConnected && proposal.status === "active" && (
              alreadyVoted ? (
                <Badge
                  variant="outline"
                  className={myVote === "for"
                    ? "border-primary/50 text-primary"
                    : "border-destructive/50 text-destructive"}
                >
                  {myVote === "for"
                    ? <><ThumbsUp className="mr-1 h-3 w-3" />You voted For</>
                    : <><ThumbsDown className="mr-1 h-3 w-3" />You voted Against</>}
                </Badge>
              ) : !eligible ? (
                <Button size="sm" variant="outline" disabled title="Complete a transaction first">
                  <ShieldAlert className="mr-2 h-4 w-4" />Vote (Ineligible)
                </Button>
              ) : (
                <Button size="sm" onClick={() => onOpenVote(proposal)}>
                  <Vote className="mr-2 h-4 w-4" />Cast Vote
                </Button>
              )
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Main page
// ═══════════════════════════════════════════════════════════════════════════════

export default function GovernancePage() {
  const { isConnected, walletAddress, signer } = useWallet();

  const {
    proposals, stats, eligibility, myVotes, loading,
    fetchProposals, checkEligibility, castVote, createProposal,
  } = useGovernance(walletAddress, signer);

  // Dialog / form state
  const [selectedProposal, setSelectedProposal] = useState(null);
  const [showVoteDialog,   setShowVoteDialog]   = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [voteDirection,    setVoteDirection]    = useState(null);
  const [newProposal, setNewProposal] = useState({ title: "", description: "", category: "" });

  // In-flight flags
  const [votingInFlight,   setVotingInFlight]   = useState(false);
  const [creatingInFlight, setCreatingInFlight] = useState(false);
  const [eligRefreshing,   setEligRefreshing]   = useState(false);

  const eligible = eligibility?.eligible ?? false;

  const activeProposals   = proposals.filter(p => p.status === "active");
  const passedProposals   = proposals.filter(p => p.status === "passed");
  const rejectedProposals = proposals.filter(p => p.status === "rejected");

  // ── handlers ─────────────────────────────────────────────────────────────

  const handleOpenVote = useCallback((proposal) => {
    setSelectedProposal(proposal);
    setVoteDirection(null);
    setShowVoteDialog(true);
  }, []);

  const handleSubmitVote = async () => {
    if (!selectedProposal || !voteDirection) return;
    setVotingInFlight(true);
    try {
      await castVote(selectedProposal.id, voteDirection);
      toast({ title: "Vote cast", description: `You voted ${voteDirection} on "${selectedProposal.title}".` });
      setShowVoteDialog(false);
      setVoteDirection(null);
      setSelectedProposal(null);
    } catch (err) {
      const msg = err?.message || "Failed to cast vote.";
      const cancelled = msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("denied");
      toast({
        title:       cancelled ? "Signature cancelled" : "Vote failed",
        description: cancelled ? "You cancelled the MetaMask signature." : msg,
        variant:     "destructive",
      });
    } finally {
      setVotingInFlight(false);
    }
  };

  const handleCreateProposal = async () => {
    if (!newProposal.title || !newProposal.description) return;
    setCreatingInFlight(true);
    try {
      await createProposal(newProposal);
      toast({ title: "Proposal submitted", description: "Voting is open for 7 days." });
      setShowCreateDialog(false);
      setNewProposal({ title: "", description: "", category: "" });
    } catch (err) {
      const msg = err?.message || "Failed to create proposal.";
      const cancelled = msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("denied");
      toast({
        title:       cancelled ? "Signature cancelled" : "Proposal failed",
        description: cancelled ? "You cancelled the MetaMask signature." : msg,
        variant:     "destructive",
      });
    } finally {
      setCreatingInFlight(false);
    }
  };

  const handleEligibilityRefresh = async () => {
    if (!walletAddress) return;
    setEligRefreshing(true);
    try { await checkEligibility(walletAddress, true); }
    finally { setEligRefreshing(false); }
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto max-w-6xl px-4 pt-24 pb-8">

        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Governance</h1>
            <p className="mt-1 text-muted-foreground">
              Vote on proposals and shape the future of the platform
            </p>
          </div>
          {isConnected && (
            eligible ? (
              <Button onClick={() => setShowCreateDialog(true)}>
                <Plus className="mr-2 h-4 w-4" />Create Proposal
              </Button>
            ) : (
              <Button variant="outline" disabled title="Complete a transaction to unlock">
                <ShieldAlert className="mr-2 h-4 w-4" />Create Proposal
              </Button>
            )
          )}
        </div>

        {/* Eligibility banner (ineligible only) */}
        {isConnected && (
          <EligibilityBanner
            eligibility={eligibility}
            onRefresh={handleEligibilityRefresh}
            refreshing={eligRefreshing}
          />
        )}

        {/* Eligible badge */}
        {isConnected && eligible && (
          <div className="mb-6 flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="h-4 w-4" />
            <span>
              Verified participant — {eligibility.completed_txns} completed
              transaction{eligibility.completed_txns !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        {/* Stats */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard title="Active Proposals" value={stats?.active          ?? activeProposals.length}   icon={Vote} />
          <StatsCard title="Total Proposals"  value={stats?.total_proposals ?? proposals.length}         icon={FileText} />
          <StatsCard title="Passed"           value={stats?.passed          ?? passedProposals.length}   icon={CheckCircle} />
          <StatsCard title="Rejected"         value={stats?.rejected        ?? rejectedProposals.length} icon={XCircle} />
        </div>

        {/* Loading */}
        {loading && proposals.length === 0 && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Tabs */}
        {(!loading || proposals.length > 0) && (
          <Tabs defaultValue="active" className="w-full">
            <TabsList className="mb-6">
              <TabsTrigger value="active">Active ({activeProposals.length})</TabsTrigger>
              <TabsTrigger value="passed">Passed ({passedProposals.length})</TabsTrigger>
              <TabsTrigger value="rejected">Rejected ({rejectedProposals.length})</TabsTrigger>
            </TabsList>

            {["active", "passed", "rejected"].map((tab) => {
              const list = tab === "active" ? activeProposals
                : tab === "passed" ? passedProposals : rejectedProposals;
              const EmptyIcon = tab === "active" ? Vote : tab === "passed" ? CheckCircle : XCircle;
              const emptyMsg = tab === "active"
                ? isConnected && eligible ? "Be the first to create a governance proposal."
                  : isConnected ? "Complete a transaction on Aegistra to create proposals."
                  : "Connect your wallet to participate."
                : `No ${tab} proposals yet.`;

              return (
                <TabsContent key={tab} value={tab}>
                  {list.length === 0 ? (
                    <Card>
                      <CardContent className="flex flex-col items-center justify-center py-12">
                        <EmptyIcon className="h-12 w-12 text-muted-foreground" />
                        {tab === "active" && (
                          <h3 className="mt-4 text-lg font-medium">No active proposals</h3>
                        )}
                        <p className="mt-1 text-sm text-muted-foreground">{emptyMsg}</p>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="grid gap-4">
                      {list.map(p => (
                        <ProposalCard
                          key={p.id}
                          proposal={p}
                          isConnected={isConnected}
                          eligible={eligible}
                          myVote={myVotes[p.id] || null}
                          onViewDetails={setSelectedProposal}
                          onOpenVote={handleOpenVote}
                        />
                      ))}
                    </div>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        )}


        {/* ── Proposal Details Dialog ──────────────────────────────────────── */}
        <Dialog
          open={!!selectedProposal && !showVoteDialog}
          onOpenChange={(open) => { if (!open) setSelectedProposal(null); }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{selectedProposal?.title}</DialogTitle>
              <DialogDescription>Proposal Details</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Description</Label>
                <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
                  {selectedProposal?.description}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium">Category</Label>
                  <p className="mt-1 text-sm">{selectedProposal?.category}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Proposer</Label>
                  <p className="mt-1 font-mono text-xs break-all">{selectedProposal?.proposer_wallet}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Status</Label>
                  <p className="mt-1 text-sm capitalize">{selectedProposal?.status}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">
                    {selectedProposal?.status === "active" ? "Time Remaining" : "Resolved"}
                  </Label>
                  <p className="mt-1 text-sm">
                    {selectedProposal?.status === "active"
                      ? selectedProposal?.time_remaining
                      : selectedProposal?.resolved_at
                        ? new Date(selectedProposal.resolved_at).toLocaleDateString()
                        : "—"}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <Label className="text-sm font-medium">Voting Summary</Label>
                <div className="mt-3 grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold text-primary">{selectedProposal?.votes_for}</p>
                    <p className="text-xs text-muted-foreground">Votes For</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-destructive">{selectedProposal?.votes_against}</p>
                    <p className="text-xs text-muted-foreground">Votes Against</p>
                  </div>
                  <div>
                    <p className={`text-2xl font-bold ${selectedProposal?.has_met_quorum ? "text-emerald-600" : ""}`}>
                      {selectedProposal?.quorum}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Quorum{selectedProposal?.has_met_quorum ? " ✓" : ""}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedProposal(null)}>Close</Button>
              {isConnected && selectedProposal?.status === "active"
                && !myVotes[selectedProposal?.id] && eligible && (
                <Button onClick={() => setShowVoteDialog(true)}>
                  <Vote className="mr-2 h-4 w-4" />Cast Vote
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>


        {/* ── Vote Dialog ──────────────────────────────────────────────────── */}
        <Dialog
          open={showVoteDialog}
          onOpenChange={(open) => { if (!open && !votingInFlight) { setShowVoteDialog(false); setVoteDirection(null); } }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cast Your Vote</DialogTitle>
              <DialogDescription>Vote on &quot;{selectedProposal?.title}&quot;</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Your Vote</Label>
                <RadioGroup
                  value={voteDirection || ""}
                  onValueChange={setVoteDirection}
                  className="mt-3 grid grid-cols-2 gap-4"
                >
                  <div>
                    <RadioGroupItem value="for" id="vote-for" className="peer sr-only" />
                    <Label
                      htmlFor="vote-for"
                      className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-border bg-background p-4 hover:bg-muted peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5"
                    >
                      <ThumbsUp className="mb-2 h-6 w-6 text-primary" />
                      <span className="font-medium">Vote For</span>
                    </Label>
                  </div>
                  <div>
                    <RadioGroupItem value="against" id="vote-against" className="peer sr-only" />
                    <Label
                      htmlFor="vote-against"
                      className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-border bg-background p-4 hover:bg-muted peer-data-[state=checked]:border-destructive peer-data-[state=checked]:bg-destructive/5"
                    >
                      <ThumbsDown className="mb-2 h-6 w-6 text-destructive" />
                      <span className="font-medium">Vote Against</span>
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-600 dark:text-blue-400">
                <AlertCircle className="mr-2 inline-block h-4 w-4" />
                Your vote is recorded off-chain and publicly auditable. MetaMask will ask
                you to sign a message to verify your identity — no gas is charged.
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => { setShowVoteDialog(false); setVoteDirection(null); }}
                disabled={votingInFlight}
              >
                Cancel
              </Button>
              <Button onClick={handleSubmitVote} disabled={!voteDirection || votingInFlight}>
                {votingInFlight
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing…</>
                  : <><CheckCircle className="mr-2 h-4 w-4" />Submit Vote</>}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


        {/* ── Create Proposal Dialog ───────────────────────────────────────── */}
        <Dialog
          open={showCreateDialog}
          onOpenChange={(open) => { if (!open && !creatingInFlight) setShowCreateDialog(false); }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create New Proposal</DialogTitle>
              <DialogDescription>
                Submit a governance proposal for the community to vote on.
                Voting stays open for 7 days.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label htmlFor="proposal-title">
                  Title <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="proposal-title"
                  placeholder="e.g. Reduce jury quorum to 5 jurors"
                  value={newProposal.title}
                  onChange={(e) => setNewProposal(p => ({ ...p, title: e.target.value }))}
                  maxLength={120}
                  className="mt-2"
                />
                <p className="mt-1 text-right text-xs text-muted-foreground">
                  {newProposal.title.length}/120
                </p>
              </div>

              <div>
                <Label htmlFor="proposal-description">
                  Description <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="proposal-description"
                  placeholder="Describe your proposal and its rationale in detail…"
                  value={newProposal.description}
                  onChange={(e) => setNewProposal(p => ({ ...p, description: e.target.value }))}
                  rows={5}
                  maxLength={2000}
                  className="mt-2"
                />
                <p className="mt-1 text-right text-xs text-muted-foreground">
                  {newProposal.description.length}/2000
                </p>
              </div>

              <div>
                <Label htmlFor="proposal-category">Category</Label>
                <Input
                  id="proposal-category"
                  placeholder="e.g. Parameters, Features, Economics"
                  value={newProposal.category}
                  onChange={(e) => setNewProposal(p => ({ ...p, category: e.target.value }))}
                  maxLength={60}
                  className="mt-2"
                />
              </div>

              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-600 dark:text-blue-400">
                <AlertCircle className="mr-2 inline-block h-4 w-4" />
                MetaMask will ask you to sign a message to authenticate your proposal.
                No gas is charged.
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowCreateDialog(false)}
                disabled={creatingInFlight}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateProposal}
                disabled={
                  newProposal.title.length < 5 ||
                  newProposal.description.length < 20 ||
                  creatingInFlight
                }
              >
                {creatingInFlight
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing…</>
                  : <><Plus className="mr-2 h-4 w-4" />Submit Proposal</>}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </main>
    </div>
  );
}
