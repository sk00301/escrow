"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { StatusBadge } from "@/components/status-badge"
import { EmptyState } from "@/components/empty-state"
import { useContracts } from "@/contexts/contract-context"
import { useWallet } from "@/contexts/wallet-context"
import { Search, Clock, DollarSign, FileText, CheckCircle, Eye, Send } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

// Mock available jobs (contracts without freelancer assigned)
const AVAILABLE_JOBS = [
  {
    id: "job-001",
    milestoneTitle: "Build DEX Interface",
    description: "Create a responsive decentralized exchange interface with wallet connection, token swaps, and liquidity pools management.",
    amount: 4.5,
    deadline: new Date("2026-04-20"),
    deliverableType: "code" as const,
    skills: ["React", "TypeScript", "Web3", "TailwindCSS"],
    deliverables: [
      "Token swap interface",
      "Liquidity pool dashboard",
      "Wallet connection flow",
      "Transaction history view"
    ]
  },
  {
    id: "job-002",
    milestoneTitle: "Smart Contract Audit Report",
    description: "Comprehensive security audit of a DeFi lending protocol including vulnerability assessment and recommendations.",
    amount: 3.2,
    deadline: new Date("2026-04-15"),
    deliverableType: "document" as const,
    skills: ["Solidity", "Security", "DeFi", "Technical Writing"],
    deliverables: [
      "Vulnerability assessment report",
      "Code quality analysis",
      "Gas optimization suggestions",
      "Security recommendations"
    ]
  },
  {
    id: "job-003",
    milestoneTitle: "NFT Collection Artwork",
    description: "Design a collection of 25 unique NFT artworks with consistent style and trait variations for a gaming project.",
    amount: 2.8,
    deadline: new Date("2026-04-25"),
    deliverableType: "design" as const,
    skills: ["Digital Art", "NFT", "Illustration", "Character Design"],
    deliverables: [
      "25 unique base artworks",
      "Trait variation system",
      "Rarity distribution plan",
      "Metadata JSON files"
    ]
  }
]

export function AvailableJobs() {
  const { walletAddress, isConnected } = useWallet()
  const { createMilestone } = useContracts()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedJob, setSelectedJob] = useState<typeof AVAILABLE_JOBS[0] | null>(null)
  const [showApplyDialog, setShowApplyDialog] = useState(false)
  const [proposal, setProposal] = useState("")
  const [isApplying, setIsApplying] = useState(false)

  // Filter jobs based on search
  const availableJobs = AVAILABLE_JOBS.filter(
    (job) =>
      job.milestoneTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.skills.some((s) => s.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  const handleApply = async () => {
    if (!selectedJob || !walletAddress) return
    setIsApplying(true)
    
    // Simulate application process
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    setIsApplying(false)
    setShowApplyDialog(false)
    setProposal("")
    setSelectedJob(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Available Jobs</h2>
          <p className="text-muted-foreground">Browse and apply for open milestone contracts</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search jobs, skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {availableJobs.length === 0 ? (
        <EmptyState
          icon="milestone"
          title="No jobs available"
          description="There are no open jobs matching your search criteria. Check back later!"
        />
      ) : (
        <div className="grid gap-4">
          {availableJobs.map((job) => (
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
                  <div className="flex flex-wrap gap-2">
                    {job.skills.map((skill) => (
                      <Badge key={skill} variant="secondary" className="text-xs">
                        {skill}
                      </Badge>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <DollarSign className="h-4 w-4 text-primary" />
                      <span className="font-medium text-foreground">{job.amount} ETH</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-4 w-4" />
                      <span>Due: {new Date(job.deadline).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <FileText className="h-4 w-4" />
                      <span>{job.deliverables.length} deliverables</span>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedJob(job)}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      View Details
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setSelectedJob(job)
                        setShowApplyDialog(true)
                      }}
                      disabled={!isConnected}
                    >
                      <Send className="mr-2 h-4 w-4" />
                      Apply Now
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Job Details Dialog */}
      <Dialog open={!!selectedJob && !showApplyDialog} onOpenChange={() => setSelectedJob(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedJob?.milestoneTitle}</DialogTitle>
            <DialogDescription>Job Details</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">Description</Label>
              <p className="mt-1 text-sm text-muted-foreground">{selectedJob?.description}</p>
            </div>

            <div>
              <Label className="text-sm font-medium">Required Skills</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedJob?.skills.map((skill) => (
                  <Badge key={skill} variant="secondary">
                    {skill}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium">Deliverables</Label>
              <ul className="mt-2 space-y-2">
                {selectedJob?.deliverables.map((deliverable, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CheckCircle className="mt-0.5 h-4 w-4 text-primary" />
                    {deliverable}
                  </li>
                ))}
              </ul>
            </div>

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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedJob(null)}>
              Close
            </Button>
            <Button onClick={() => setShowApplyDialog(true)} disabled={!isConnected}>
              <Send className="mr-2 h-4 w-4" />
              Apply for This Job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apply Dialog */}
      <Dialog open={showApplyDialog} onOpenChange={setShowApplyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply for Job</DialogTitle>
            <DialogDescription>
              Submit your proposal for &quot;{selectedJob?.milestoneTitle}&quot;
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="proposal">Your Proposal</Label>
              <Textarea
                id="proposal"
                placeholder="Describe your experience and why you're the best fit for this job..."
                value={proposal}
                onChange={(e) => setProposal(e.target.value)}
                rows={5}
                className="mt-2"
              />
            </div>
            <div className="rounded-lg border border-border bg-muted/50 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Job Budget</span>
                <span className="font-semibold text-primary">{selectedJob?.amount} ETH</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApplyDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleApply} disabled={!proposal.trim() || isApplying}>
              {isApplying ? "Submitting..." : "Submit Application"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
