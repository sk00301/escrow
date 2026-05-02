"use client";
import { useState } from "react";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { useContracts } from "@/contexts/contract-context";
import { useWallet } from "@/contexts/wallet-context";
import {
  Search, Clock, DollarSign, FileText, CheckCircle, Eye, Upload,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader,
  DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

/**
 * AvailableJobs
 * ─────────────
 * Shows on-chain milestones that are in the "funded" state and
 * assigned to the currently connected wallet — i.e. jobs the client
 * has already funded and is waiting for *this* freelancer to start.
 *
 * The freelancer clicks "Start Working" which navigates them straight
 * to the Active Contracts tab (no separate apply flow is needed in this
 * escrow model because the client already specified the freelancer address).
 */
export function AvailableJobs() {
  const { walletAddress, isConnected } = useWallet();
  const { contracts } = useContracts();

  const [searchQuery, setSearchQuery]     = useState("");
  const [selectedJob, setSelectedJob]     = useState(null);

  // "Available" = funded milestones assigned to me that I haven't submitted yet
  const availableJobs = contracts.filter(
    (c) =>
      c.freelancerAddress?.toLowerCase() === walletAddress?.toLowerCase() &&
      c.status === "funded"
  );

  const filtered = availableJobs.filter(
    (job) =>
      job.milestoneTitle?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.deliverableType?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getDaysRemaining = (deadline) =>
    Math.ceil((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  // Navigate to the active-contracts tab so the freelancer can submit right away
  const handleStartWorking = () => {
    window.location.href = "/freelancer?tab=active";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Available Jobs</h2>
          <p className="text-muted-foreground">Funded milestones assigned to you — ready to start</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search title, type…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {!isConnected ? (
        <EmptyState
          icon="wallet"
          title="Connect your wallet"
          description="Connect your wallet to see jobs assigned to you."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="milestone"
          title={availableJobs.length === 0 ? "No jobs assigned yet" : "No matches"}
          description={
            availableJobs.length === 0
              ? "When a client funds a milestone for your address it will appear here."
              : "Try a different search term."
          }
        />
      ) : (
        <div className="grid gap-4">
          {filtered.map((job) => {
            const daysRemaining = getDaysRemaining(job.deadline);
            const isUrgent  = daysRemaining <= 3 && daysRemaining > 0;
            const isOverdue = daysRemaining < 0;

            return (
              <Card key={job.id} className="transition-all hover:border-primary/50 hover:shadow-md">
                <CardHeader>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-lg">{job.milestoneTitle}</CardTitle>
                      <CardDescription className="line-clamp-2">{job.description}</CardDescription>
                    </div>
                    <Badge variant="outline" className="w-fit capitalize">
                      {job.deliverableType}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Requirements badges */}
                    {job.acceptanceCriteria?.requirements?.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {job.acceptanceCriteria.requirements.map((req) => (
                          <Badge key={req} variant="secondary" className="text-xs">{req}</Badge>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <DollarSign className="h-4 w-4 text-primary" />
                        <span className="font-medium text-foreground">{job.amount} ETH</span>
                      </div>
                      <div className={`flex items-center gap-1.5 ${isOverdue ? "text-destructive" : isUrgent ? "text-warning" : ""}`}>
                        <Clock className="h-4 w-4" />
                        <span>
                          {isOverdue
                            ? `${Math.abs(daysRemaining)}d overdue`
                            : `${daysRemaining}d remaining`}
                        </span>
                      </div>
                      {job.acceptanceCriteria?.requirements && (
                        <div className="flex items-center gap-1.5">
                          <FileText className="h-4 w-4" />
                          <span>{job.acceptanceCriteria.requirements.length} requirements</span>
                        </div>
                      )}
                    </div>

                    {/* SRS link */}
                    {job.acceptanceCriteria?.srsCID && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">SRS: </span>
                        <a
                          href={`https://gateway.pinata.cloud/ipfs/${job.acceptanceCriteria.srsCID}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-primary hover:underline"
                        >
                          View on IPFS ↗
                        </a>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      <Button variant="outline" size="sm" onClick={() => setSelectedJob(job)}>
                        <Eye className="mr-2 h-4 w-4" />
                        View Details
                      </Button>
                      <Button size="sm" onClick={handleStartWorking} disabled={!isConnected}>
                        <Upload className="mr-2 h-4 w-4" />
                        Start Working
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Job Detail Dialog */}
      <Dialog open={!!selectedJob} onOpenChange={() => setSelectedJob(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedJob?.milestoneTitle}</DialogTitle>
            <DialogDescription>Milestone #{selectedJob?.id} — Funded by client</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">Description</Label>
              <p className="mt-1 text-sm text-muted-foreground">{selectedJob?.description || "No description"}</p>
            </div>

            {selectedJob?.acceptanceCriteria?.requirements?.length > 0 && (
              <div>
                <Label className="text-sm font-medium">Requirements</Label>
                <ul className="mt-2 space-y-2">
                  {selectedJob.acceptanceCriteria.requirements.map((req, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <CheckCircle className="mt-0.5 h-4 w-4 text-primary" />
                      {req}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {selectedJob?.acceptanceCriteria?.srsCID && (
              <div>
                <Label className="text-sm font-medium">Specification Document (SRS)</Label>
                <a
                  href={`https://gateway.pinata.cloud/ipfs/${selectedJob.acceptanceCriteria.srsCID}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block font-mono text-xs text-primary hover:underline break-all"
                >
                  {selectedJob.acceptanceCriteria.srsCID}
                </a>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Budget</Label>
                <p className="mt-1 text-lg font-semibold text-primary">{selectedJob?.amount} ETH</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Deadline</Label>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedJob && new Date(selectedJob.deadline).toLocaleDateString()}
                </p>
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium">Client Address</Label>
              <p className="mt-1 font-mono text-xs text-muted-foreground break-all">
                {selectedJob?.clientAddress}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedJob(null)}>Close</Button>
            <Button onClick={() => { setSelectedJob(null); handleStartWorking(); }} disabled={!isConnected}>
              <Upload className="mr-2 h-4 w-4" />
              Go to Active Contracts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
