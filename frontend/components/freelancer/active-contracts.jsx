"use client";
import { useState, useRef } from "react";
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
import { Clock, DollarSign, Upload, CheckCircle, AlertCircle, FileUp, X, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader,
  DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

export function ActiveContracts() {
  const { walletAddress } = useWallet();
  const { contracts, submitWork } = useContracts();

  const [selectedContract, setSelectedContract] = useState(null);
  const [showSubmitDialog, setShowSubmitDialog]  = useState(false);
  const [workDescription, setWorkDescription]    = useState("");
  const [workLinks, setWorkLinks]               = useState("");
  const [deliverableFile, setDeliverableFile]   = useState(null);  // File | null
  const [isSubmitting, setIsSubmitting]         = useState(false);
  const fileInputRef = useRef(null);

  // Contracts where this wallet is the freelancer and work is in progress
  const activeContracts = contracts.filter(
    (c) =>
      c.freelancerAddress?.toLowerCase() === walletAddress?.toLowerCase() &&
      ["funded", "submitted", "verified"].includes(c.status)
  );

  // ── File picker ─────────────────────────────────────────────────────────────
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) setDeliverableFile(file);
  };

  const removeFile = () => {
    setDeliverableFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Submit work ─────────────────────────────────────────────────────────────
  const handleSubmitWork = async () => {
    if (!selectedContract) return;
    if (!workDescription.trim() && !deliverableFile) return;

    setIsSubmitting(true);
    try {
      // Build the payload that gets uploaded to IPFS.
      // If a file is attached, send the file directly so the content hash
      // reflects the actual deliverable.  Otherwise bundle the description
      // + links as a text blob (same behaviour as before).
      let payload;
      if (deliverableFile) {
        // Wrap file + metadata into a single Blob so the oracle can download
        // the deliverable from IPFS and verify it.
        // We pass the raw File — contract-context.uploadToIPFS accepts any Blob.
        payload = deliverableFile;
      } else {
        const text = [
          workDescription,
          workLinks ? `\nLinks:\n${workLinks}` : "",
        ].join("").trim();
        payload = new Blob([text], { type: "text/plain" });
      }

      await submitWork(selectedContract.id, payload);

      setShowSubmitDialog(false);
      setWorkDescription("");
      setWorkLinks("");
      setDeliverableFile(null);
      setSelectedContract(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openSubmitDialog = (contract) => {
    setSelectedContract(contract);
    setWorkDescription("");
    setWorkLinks("");
    setDeliverableFile(null);
    setShowSubmitDialog(true);
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const getProgressValue = (status) =>
    ({ funded: 25, submitted: 75, verified: 90, released: 100 }[status] ?? 0);

  const getDaysRemaining = (deadline) =>
    Math.ceil((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Active Contracts</h2>
        <p className="text-muted-foreground">Manage your ongoing work and submit deliverables</p>
      </div>

      {activeContracts.length === 0 ? (
        <EmptyState
          icon="milestone"
          title="No active contracts"
          description="You don't have any active contracts. Browse available jobs to get started!"
        />
      ) : (
        <div className="grid gap-4">
          {activeContracts.map((contract) => {
            const daysRemaining = getDaysRemaining(contract.deadline);
            const isUrgent  = daysRemaining <= 3 && daysRemaining > 0;
            const isOverdue = daysRemaining < 0;

            return (
              <Card key={contract.id} className="transition-all hover:shadow-md">
                <CardHeader>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-lg">{contract.milestoneTitle}</CardTitle>
                      <CardDescription className="line-clamp-2">{contract.description}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={contract.status} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="font-medium">{getProgressValue(contract.status)}%</span>
                      </div>
                      <Progress value={getProgressValue(contract.status)} className="h-2" />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {contract.acceptanceCriteria.requirements.map((req) => (
                        <Badge key={req} variant="secondary" className="text-xs">{req}</Badge>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <DollarSign className="h-4 w-4 text-primary" />
                        <span className="font-medium text-foreground">{contract.amount} ETH</span>
                      </div>
                      <div className={`flex items-center gap-1.5 ${isOverdue ? "text-destructive" : isUrgent ? "text-warning" : ""}`}>
                        {isOverdue || isUrgent
                          ? <AlertCircle className="h-4 w-4" />
                          : <Clock className="h-4 w-4" />}
                        <span>
                          {isOverdue
                            ? `${Math.abs(daysRemaining)} days overdue`
                            : `${daysRemaining} days remaining`}
                        </span>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border bg-muted/30 p-4">
                      <Label className="text-sm font-medium">Requirements</Label>
                      <ul className="mt-2 space-y-2">
                        {contract.acceptanceCriteria.requirements.map((req, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <CheckCircle className="mt-0.5 h-4 w-4 text-muted-foreground" />
                            {req}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* SRS link if the client attached one */}
                    {contract.acceptanceCriteria?.srsCID && (
                      <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                        <span className="text-muted-foreground">SRS: </span>
                        <a
                          href={`https://gateway.pinata.cloud/ipfs/${contract.acceptanceCriteria.srsCID}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-primary hover:underline break-all"
                        >
                          {contract.acceptanceCriteria.srsCID.slice(0, 24)}…
                        </a>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      {contract.status === "funded" && (
                        <Button onClick={() => openSubmitDialog(contract)}>
                          <Upload className="mr-2 h-4 w-4" />
                          Submit Work
                        </Button>
                      )}
                      {contract.status === "submitted" && (
                        <Badge variant="outline" className="border-primary/50 bg-primary/10 text-primary">
                          <Clock className="mr-1.5 h-3 w-3" />
                          Awaiting Verification
                        </Badge>
                      )}
                      {contract.status === "verified" && (
                        <Badge variant="outline" className="border-primary/50 bg-primary/10 text-primary">
                          <CheckCircle className="mr-1.5 h-3 w-3" />
                          Verified — Awaiting Release
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Submit Work Dialog */}
      <Dialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Submit Work</DialogTitle>
            <DialogDescription>
              Submit your completed work for &quot;{selectedContract?.milestoneTitle}&quot;
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Deliverable file upload */}
            <div>
              <Label>Deliverable File <span className="text-muted-foreground text-xs">(recommended)</span></Label>
              {!deliverableFile ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-2 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 p-6 cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-colors"
                >
                  <FileUp className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Click to attach deliverable</p>
                  <p className="text-xs text-muted-foreground">.py, .js, .zip, .pdf, or any file</p>
                  <input ref={fileInputRef} type="file" onChange={handleFileChange} className="hidden" />
                </div>
              ) : (
                <div className="mt-2 flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
                  <FileUp className="h-5 w-5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{deliverableFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(deliverableFile.size / 1024).toFixed(1)} KB — will be uploaded to IPFS on submit
                    </p>
                  </div>
                  <button type="button" onClick={removeFile}
                    className="text-muted-foreground hover:text-destructive transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="work-description">
                Work Notes {!deliverableFile && <span className="text-destructive">*</span>}
              </Label>
              <Textarea
                id="work-description"
                placeholder="Describe what you've completed and any notes for the client…"
                value={workDescription}
                onChange={(e) => setWorkDescription(e.target.value)}
                rows={4}
                className="mt-2"
              />
            </div>

            <div>
              <Label htmlFor="work-links">Links to Deliverables</Label>
              <Input
                id="work-links"
                placeholder="https://github.com/…, https://figma.com/…"
                value={workLinks}
                onChange={(e) => setWorkLinks(e.target.value)}
                className="mt-2"
              />
              <p className="mt-1 text-xs text-muted-foreground">Separate multiple links with commas</p>
            </div>

            <div className="rounded-lg border border-border bg-muted/50 p-4">
              <h4 className="text-sm font-medium">Requirements Checklist</h4>
              <ul className="mt-2 space-y-1">
                {selectedContract?.acceptanceCriteria.requirements.map((req, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle className="h-4 w-4 text-primary" />
                    {req}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubmitDialog(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmitWork}
              disabled={isSubmitting || (!workDescription.trim() && !deliverableFile)}
            >
              {isSubmitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Uploading to IPFS…</>
              ) : (
                <><Upload className="mr-2 h-4 w-4" />Submit for Review</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
