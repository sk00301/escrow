"use client";
import { useState } from "react";
import { Button }   from "@/components/ui/button";
import { Badge }    from "@/components/ui/badge";
import { Input }    from "@/components/ui/input";
import { Label }    from "@/components/ui/label";
import { EmptyState } from "@/components/empty-state";
import { useJobBoard } from "@/contexts/job-board-context";
import { useWallet }   from "@/contexts/wallet-context";
import { useToast }    from "@/hooks/use-toast";
import {
  Search, Clock, Wallet, FileText, CheckCircle, Eye, Zap,
  Layers, Code, Palette, AlertCircle, Loader2,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader,
  DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { format } from "date-fns";

const deliverableIcons = { code: Code, document: FileText, design: Palette };

export function AvailableJobs() {
  const { walletAddress, isConnected, isCorrectNetwork, connectWallet, isConnecting } = useWallet();
  const { openJobs, acceptJob, freelancerJobs } = useJobBoard();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedJob, setSelectedJob] = useState(null);
  const [accepting, setAccepting]     = useState(null);

  // Already accepted by me — show as "Applied" so they can't double-apply
  const myJobIds = new Set(freelancerJobs(walletAddress).map(j => j.id));

  const filtered = openJobs.filter(job =>
    job.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    job.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    job.deliverableType?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getDaysRemaining = (deadline) =>
    Math.ceil((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  const handleAccept = async (job) => {
    if (!isConnected || !walletAddress) {
      toast({ title: "Connect your wallet first", variant: "destructive" });
      return;
    }
    if (!isCorrectNetwork) {
      toast({ title: "Switch to Sepolia testnet", variant: "destructive" });
      return;
    }
    if (job.clientAddress?.toLowerCase() === walletAddress?.toLowerCase()) {
      toast({ title: "You can't accept your own job", variant: "destructive" });
      return;
    }

    setAccepting(job.id);
    try {
      acceptJob(job.id, walletAddress);
      toast({
        title: "Job accepted!",
        description: `"${job.title}" is now in your Active Contracts. The client will fund the escrow shortly.`,
      });
      setSelectedJob(null);
    } catch (err) {
      toast({ title: "Failed to accept", description: err.message, variant: "destructive" });
    } finally {
      setAccepting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Find Jobs</h2>
          <p className="text-muted-foreground">Browse open jobs posted by clients — accept to get started</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search title, type…" value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
        </div>
      </div>

      {/* Wallet guard */}
      {!isConnected && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">Wallet not connected</p>
            <p className="text-xs text-muted-foreground mt-0.5">Connect MetaMask to accept jobs.</p>
          </div>
          <Button size="sm" onClick={() => connectWallet()} disabled={isConnecting}
            className="bg-amber-500 hover:bg-amber-600 text-white flex-shrink-0">
            {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Connect"}
          </Button>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState icon="milestone"
          title={openJobs.length === 0 ? "No open jobs yet" : "No matches"}
          description={openJobs.length === 0
            ? "When a client posts a job it will appear here."
            : "Try a different search term."} />
      ) : (
        <div className="grid gap-4">
          {filtered.map((job) => {
            const daysRemaining = getDaysRemaining(job.deadline);
            const isUrgent      = daysRemaining <= 3 && daysRemaining > 0;
            const isOverdue     = daysRemaining < 0;
            const alreadyMine   = myJobIds.has(job.id);
            const DeliverIcon   = deliverableIcons[job.deliverableType] ?? FileText;

            return (
              <div key={job.id}
                className="glass-card rounded-xl border border-border p-6 space-y-4 hover:border-primary/40 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <DeliverIcon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-foreground">{job.title}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">{job.description}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="capitalize flex-shrink-0">{job.deliverableType}</Badge>
                </div>

                {/* Requirements */}
                {job.acceptanceCriteria?.requirements?.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {job.acceptanceCriteria.requirements.map((req) => (
                      <Badge key={req} variant="secondary" className="text-xs">{req}</Badge>
                    ))}
                  </div>
                )}

                {/* Payment milestones */}
                {job.acceptanceCriteria?.paymentTerms?.length > 0 && (
                  <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Layers className="h-3 w-3" />
                      {job.acceptanceCriteria.paymentTerms.length} Payment Milestone{job.acceptanceCriteria.paymentTerms.length > 1 ? 's' : ''}
                    </p>
                    <div className="space-y-1.5">
                      {job.acceptanceCriteria.paymentTerms.map((ms, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="w-4 h-4 rounded-full bg-primary/20 text-primary font-bold text-[10px] flex items-center justify-center">{i + 1}</span>
                            <span className="text-muted-foreground">{ms.name}</span>
                          </div>
                          <span className="font-semibold text-primary">{ms.percentage}%
                            <span className="ml-1 text-muted-foreground font-normal">
                              ({(job.amount * ms.percentage / 100).toFixed(4)} ETH)
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Meta */}
                <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Wallet className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-foreground">{job.amount} ETH</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${isOverdue ? "text-destructive" : isUrgent ? "text-warning" : ""}`}>
                    <Clock className="h-4 w-4" />
                    <span>
                      {isOverdue ? `${Math.abs(daysRemaining)}d overdue` : `${daysRemaining}d remaining`}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <FileText className="h-4 w-4" />
                    <span>Posted {format(new Date(job.postedAt), 'dd MMM yyyy')}</span>
                  </div>
                  {job.acceptanceCriteria?.srsCID && (
                    <a href={`https://gateway.pinata.cloud/ipfs/${job.acceptanceCriteria.srsCID}`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-primary hover:underline">
                      <FileText className="h-4 w-4" /> SRS ↗
                    </a>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={() => setSelectedJob(job)}>
                    <Eye className="mr-2 h-4 w-4" /> View Details
                  </Button>
                  {alreadyMine ? (
                    <Badge variant="outline" className="border-green-500/30 bg-green-500/10 text-green-600 px-3">
                      <CheckCircle className="mr-1.5 h-3 w-3" /> Applied
                    </Badge>
                  ) : (
                    <Button size="sm"
                      disabled={!isConnected || accepting === job.id}
                      onClick={() => handleAccept(job)}>
                      {accepting === job.id
                        ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Accepting…</>
                        : <><Zap className="mr-2 h-4 w-4" />Accept Job</>}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selectedJob} onOpenChange={() => setSelectedJob(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedJob?.title}</DialogTitle>
            <DialogDescription>
              Posted {selectedJob && format(new Date(selectedJob.postedAt), 'dd MMM yyyy')} ·{' '}
              {selectedJob?.deliverableType}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
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
                      <CheckCircle className="mt-0.5 h-4 w-4 text-primary flex-shrink-0" />{req}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {selectedJob?.acceptanceCriteria?.paymentTerms?.length > 0 && (
              <div>
                <Label className="text-sm font-medium">Payment Schedule</Label>
                <div className="mt-2 space-y-2">
                  {selectedJob.acceptanceCriteria.paymentTerms.map((ms, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg border border-border bg-muted/20 p-3">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                        <div>
                          <p className="text-sm font-medium text-foreground">{ms.name}</p>
                          {ms.description && <p className="text-xs text-muted-foreground">{ms.description}</p>}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-primary">{ms.percentage}%</p>
                        <p className="text-xs text-muted-foreground">
                          {(selectedJob.amount * ms.percentage / 100).toFixed(4)} ETH
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Total Budget</Label>
                <p className="mt-1 text-lg font-semibold text-primary">{selectedJob?.amount} ETH</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Deadline</Label>
                <p className="mt-1 text-sm text-foreground">
                  {selectedJob && format(new Date(selectedJob.deadline), 'dd MMM yyyy')}
                </p>
              </div>
            </div>

            {selectedJob?.acceptanceCriteria?.srsCID && (
              <div>
                <Label className="text-sm font-medium">Specification Document (SRS)</Label>
                <a href={`https://gateway.pinata.cloud/ipfs/${selectedJob.acceptanceCriteria.srsCID}`}
                  target="_blank" rel="noopener noreferrer"
                  className="mt-1 block font-mono text-xs text-primary hover:underline break-all">
                  {selectedJob.acceptanceCriteria.srsCID} ↗
                </a>
              </div>
            )}

            <div>
              <Label className="text-sm font-medium">Client Address</Label>
              <p className="mt-1 font-mono text-xs text-muted-foreground break-all">
                {selectedJob?.clientAddress}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedJob(null)}>Close</Button>
            {selectedJob && !myJobIds.has(selectedJob.id) && (
              <Button
                disabled={!isConnected || accepting === selectedJob?.id}
                onClick={() => handleAccept(selectedJob)}>
                {accepting === selectedJob?.id
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Accepting…</>
                  : <><Zap className="mr-2 h-4 w-4" />Accept Job</>}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
