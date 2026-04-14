"use client";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { useContracts } from "@/contexts/contract-context";
import { useWallet } from "@/contexts/wallet-context";
import { Clock, DollarSign, Upload, CheckCircle, AlertCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
export function ActiveContracts() {
    const { walletAddress } = useWallet();
    const { contracts, submitWork } = useContracts();
    const [selectedContract, setSelectedContract] = useState(null);
    const [showSubmitDialog, setShowSubmitDialog] = useState(false);
    const [workDescription, setWorkDescription] = useState("");
    const [workLinks, setWorkLinks] = useState("");
    // Filter contracts where this freelancer is working
    const activeContracts = contracts.filter((c) => c.freelancerAddress === walletAddress && ["funded", "submitted", "verified"].includes(c.status));
    const handleSubmitWork = async () => {
        if (!selectedContract)
            return;
        await submitWork(selectedContract.id, workDescription);
        setShowSubmitDialog(false);
        setWorkDescription("");
        setWorkLinks("");
        setSelectedContract(null);
    };
    const getProgressValue = (status) => {
        switch (status) {
            case "funded":
                return 25;
            case "submitted":
                return 75;
            case "verified":
                return 90;
            case "released":
                return 100;
            default:
                return 0;
        }
    };
    const getDaysRemaining = (deadline) => {
        const diff = new Date(deadline).getTime() - new Date().getTime();
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
    };
    return (<div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Active Contracts</h2>
        <p className="text-muted-foreground">Manage your ongoing work and submit deliverables</p>
      </div>

      {activeContracts.length === 0 ? (<EmptyState icon="milestone" title="No active contracts" description="You don't have any active contracts. Browse available jobs to get started!"/>) : (<div className="grid gap-4">
          {activeContracts.map((contract) => {
                const daysRemaining = getDaysRemaining(contract.deadline);
                const isUrgent = daysRemaining <= 3 && daysRemaining > 0;
                const isOverdue = daysRemaining < 0;
                return (<Card key={contract.id} className="transition-all hover:shadow-md">
                <CardHeader>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-lg">{contract.milestoneTitle}</CardTitle>
                      <CardDescription className="line-clamp-2">{contract.description}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={contract.status}/>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Progress Bar */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="font-medium">{getProgressValue(contract.status)}%</span>
                      </div>
                      <Progress value={getProgressValue(contract.status)} className="h-2"/>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {contract.acceptanceCriteria.requirements.map((req) => (<Badge key={req} variant="secondary" className="text-xs">
                          {req}
                        </Badge>))}
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <DollarSign className="h-4 w-4 text-primary"/>
                        <span className="font-medium text-foreground">{contract.amount} ETH</span>
                      </div>
                      <div className={`flex items-center gap-1.5 ${isOverdue ? "text-destructive" : isUrgent ? "text-warning" : ""}`}>
                        {isOverdue || isUrgent ? (<AlertCircle className="h-4 w-4"/>) : (<Clock className="h-4 w-4"/>)}
                        <span>
                          {isOverdue
                        ? `${Math.abs(daysRemaining)} days overdue`
                        : `${daysRemaining} days remaining`}
                        </span>
                      </div>
                    </div>

                    {/* Deliverables Checklist */}
                    <div className="rounded-lg border border-border bg-muted/30 p-4">
                      <Label className="text-sm font-medium">Requirements</Label>
                      <ul className="mt-2 space-y-2">
                        {contract.acceptanceCriteria.requirements.map((req, index) => (<li key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <CheckCircle className="mt-0.5 h-4 w-4 text-muted-foreground"/>
                            {req}
                          </li>))}
                      </ul>
                    </div>

                    {/* Status-specific actions */}
                    <div className="flex gap-2 pt-2">
                      {contract.status === "funded" && (<Button onClick={() => {
                            setSelectedContract(contract);
                            setShowSubmitDialog(true);
                        }}>
                          <Upload className="mr-2 h-4 w-4"/>
                          Submit Work
                        </Button>)}

                      {contract.status === "submitted" && (<Badge variant="outline" className="border-primary/50 bg-primary/10 text-primary">
                          <Clock className="mr-1.5 h-3 w-3"/>
                          Awaiting Client Review
                        </Badge>)}

                      {contract.status === "verified" && (<Badge variant="outline" className="border-primary/50 bg-primary/10 text-primary">
                          <CheckCircle className="mr-1.5 h-3 w-3"/>
                          Verified - Awaiting Release
                        </Badge>)}
                    </div>
                  </div>
                </CardContent>
              </Card>);
            })}
        </div>)}

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
            <div>
              <Label htmlFor="work-description">Work Description</Label>
              <Textarea id="work-description" placeholder="Describe what you've completed and any notes for the client..." value={workDescription} onChange={(e) => setWorkDescription(e.target.value)} rows={4} className="mt-2"/>
            </div>
            <div>
              <Label htmlFor="work-links">Links to Deliverables</Label>
              <Input id="work-links" placeholder="https://github.com/..., https://figma.com/..." value={workLinks} onChange={(e) => setWorkLinks(e.target.value)} className="mt-2"/>
              <p className="mt-1 text-xs text-muted-foreground">
                Separate multiple links with commas
              </p>
            </div>

            <div className="rounded-lg border border-border bg-muted/50 p-4">
              <h4 className="text-sm font-medium">Requirements Checklist</h4>
              <ul className="mt-2 space-y-1">
                {selectedContract?.acceptanceCriteria.requirements.map((req, index) => (<li key={index} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle className="h-4 w-4 text-primary"/>
                    {req}
                  </li>))}
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubmitDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmitWork} disabled={!workDescription.trim()}>
              <Upload className="mr-2 h-4 w-4"/>
              Submit for Review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>);
}
