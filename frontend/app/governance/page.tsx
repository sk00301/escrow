"use client"

import { useState } from "react"
import { Navbar } from "@/components/navbar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StatsCard } from "@/components/stats-card"
import { useWallet } from "@/contexts/wallet-context"
import { mockGovernanceProposals } from "@/lib/mock-data"
import {
  Vote,
  Users,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  TrendingUp,
  FileText,
  ThumbsUp,
  ThumbsDown,
  ExternalLink,
  Plus
} from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

export default function GovernancePage() {
  const { isConnected } = useWallet()
  const [selectedProposal, setSelectedProposal] = useState<typeof mockGovernanceProposals[0] | null>(null)
  const [showVoteDialog, setShowVoteDialog] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [vote, setVote] = useState<"for" | "against" | null>(null)
  const [newProposal, setNewProposal] = useState({ title: "", description: "", category: "" })

  const activeProposals = mockGovernanceProposals.filter((p) => p.status === "active")
  const passedProposals = mockGovernanceProposals.filter((p) => p.status === "passed")
  const rejectedProposals = mockGovernanceProposals.filter((p) => p.status !== "active" && p.status !== "passed")

  const getTotalVotes = (proposal: typeof mockGovernanceProposals[0]) =>
    proposal.votesFor + proposal.votesAgainst

  const getForPercentage = (proposal: typeof mockGovernanceProposals[0]) => {
    const total = getTotalVotes(proposal)
    return total > 0 ? (proposal.votesFor / total) * 100 : 50
  }

  const getTimeRemaining = (endDate: string) => {
    const diff = new Date(endDate).getTime() - new Date().getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    if (days < 0) return "Ended"
    if (days === 0) return "Ends today"
    return `${days} days left`
  }

  const handleVote = async () => {
    if (!selectedProposal || !vote) return
    setShowVoteDialog(false)
    setVote(null)
    setSelectedProposal(null)
  }

  const handleCreateProposal = async () => {
    setShowCreateDialog(false)
    setNewProposal({ title: "", description: "", category: "" })
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto max-w-6xl px-4 pt-24 pb-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Governance</h1>
            <p className="mt-1 text-muted-foreground">
              Vote on proposals and shape the future of the platform
            </p>
          </div>
          {isConnected && (
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Proposal
            </Button>
          )}
        </div>

        {/* Stats */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="Active Proposals"
            value={activeProposals.length}
            icon={Vote}
          />
          <StatsCard
            title="Total Proposals"
            value={mockGovernanceProposals.length}
            icon={FileText}
          />
          <StatsCard
            title="Participation Rate"
            value={67}
            suffix="%"
            icon={Users}
            trend={{ value: 5, positive: true }}
          />
          <StatsCard
            title="Your Voting Power"
            value={500}
            icon={TrendingUp}
          />
        </div>

        {/* Proposals Tabs */}
        <Tabs defaultValue="active" className="w-full">
          <TabsList className="mb-6">
            <TabsTrigger value="active">Active ({activeProposals.length})</TabsTrigger>
            <TabsTrigger value="passed">Passed ({passedProposals.length})</TabsTrigger>
            <TabsTrigger value="rejected">Other ({rejectedProposals.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="active">
            {activeProposals.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Vote className="h-12 w-12 text-muted-foreground" />
                  <h3 className="mt-4 text-lg font-medium">No active proposals</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Check back later or create a new proposal</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {activeProposals.map((proposal) => (
                  <Card key={proposal.id} className="transition-all hover:border-primary/50">
                    <CardHeader>
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-lg">{proposal.title}</CardTitle>
                            <Badge variant="outline">{proposal.category}</Badge>
                          </div>
                          <CardDescription className="line-clamp-2">{proposal.description}</CardDescription>
                        </div>
                        <Badge className="bg-primary text-primary-foreground w-fit">
                          <Clock className="mr-1 h-3 w-3" />
                          {getTimeRemaining(proposal.endDate)}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <ThumbsUp className="h-4 w-4 text-primary" />
                              <span>For: {proposal.votesFor.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span>Against: {proposal.votesAgainst.toLocaleString()}</span>
                              <ThumbsDown className="h-4 w-4 text-destructive" />
                            </div>
                          </div>
                          <div className="relative h-3 overflow-hidden rounded-full bg-destructive/20">
                            <div
                              className="absolute left-0 top-0 h-full bg-primary transition-all"
                              style={{ width: `${getForPercentage(proposal)}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{getForPercentage(proposal).toFixed(1)}% For</span>
                            <span>Quorum: {proposal.quorum?.toLocaleString() ?? 25000} votes needed</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Users className="h-4 w-4" />
                          <span>Proposed by: </span>
                          <span className="font-mono text-xs">
                            {proposal.proposer.slice(0, 8)}...{proposal.proposer.slice(-6)}
                          </span>
                        </div>
                        <div className="flex gap-2 pt-2">
                          <Button variant="outline" size="sm" onClick={() => setSelectedProposal(proposal)}>
                            <FileText className="mr-2 h-4 w-4" />
                            View Details
                          </Button>
                          {isConnected && (
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedProposal(proposal)
                                setShowVoteDialog(true)
                              }}
                            >
                              <Vote className="mr-2 h-4 w-4" />
                              Cast Vote
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="passed">
            <div className="grid gap-4">
              {passedProposals.map((proposal) => (
                <Card key={proposal.id} className="border-primary/30 bg-primary/5">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-lg">{proposal.title}</CardTitle>
                          <Badge variant="outline">{proposal.category}</Badge>
                        </div>
                        <CardDescription className="mt-1">{proposal.description}</CardDescription>
                      </div>
                      <Badge className="bg-primary text-primary-foreground">
                        <CheckCircle className="mr-1 h-3 w-3" />
                        Passed
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>
                        Final Vote: {proposal.votesFor.toLocaleString()} For / {proposal.votesAgainst.toLocaleString()} Against
                      </span>
                      <span>Ended: {new Date(proposal.endDate).toLocaleDateString()}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="rejected">
            <div className="grid gap-4">
              {rejectedProposals.map((proposal) => (
                <Card key={proposal.id} className="border-destructive/30 bg-destructive/5">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-lg">{proposal.title}</CardTitle>
                          <Badge variant="outline">{proposal.category}</Badge>
                        </div>
                        <CardDescription className="mt-1">{proposal.description}</CardDescription>
                      </div>
                      <Badge variant="destructive">
                        <XCircle className="mr-1 h-3 w-3" />
                        Rejected
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>
                        Final Vote: {proposal.votesFor.toLocaleString()} For / {proposal.votesAgainst.toLocaleString()} Against
                      </span>
                      <span>Ended: {new Date(proposal.endDate).toLocaleDateString()}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>

        {/* Proposal Details Dialog */}
        <Dialog open={!!selectedProposal && !showVoteDialog} onOpenChange={() => setSelectedProposal(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{selectedProposal?.title}</DialogTitle>
              <DialogDescription>Proposal Details</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Description</Label>
                <p className="mt-1 text-sm text-muted-foreground">{selectedProposal?.description}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium">Category</Label>
                  <p className="mt-1 text-sm">{selectedProposal?.category}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Proposer</Label>
                  <p className="mt-1 font-mono text-xs">{selectedProposal?.proposer}</p>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <Label className="text-sm font-medium">Voting Summary</Label>
                <div className="mt-2 grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold text-primary">{selectedProposal?.votesFor.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Votes For</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-destructive">{selectedProposal?.votesAgainst.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Votes Against</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{(selectedProposal?.quorum ?? 25000).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Quorum</p>
                  </div>
                </div>
              </div>
              <Button variant="link" className="h-auto p-0">
                View on-chain data
                <ExternalLink className="ml-1 h-3 w-3" />
              </Button>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedProposal(null)}>Close</Button>
              {isConnected && selectedProposal?.status === "active" && (
                <Button onClick={() => setShowVoteDialog(true)}>
                  <Vote className="mr-2 h-4 w-4" />
                  Cast Vote
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Vote Dialog */}
        <Dialog open={showVoteDialog} onOpenChange={setShowVoteDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cast Your Vote</DialogTitle>
              <DialogDescription>Vote on &quot;{selectedProposal?.title}&quot;</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Your Voting Power</span>
                  <span className="font-semibold">500 JURY</span>
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium">Your Vote</Label>
                <RadioGroup
                  value={vote || ""}
                  onValueChange={(v) => setVote(v as "for" | "against")}
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
              <div className="rounded-lg border border-[#F59E0B]/50 bg-[#F59E0B]/10 p-3 text-sm text-[#F59E0B]">
                <AlertCircle className="mr-2 inline-block h-4 w-4" />
                Your vote will be recorded on-chain and cannot be changed.
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowVoteDialog(false)}>Cancel</Button>
              <Button onClick={handleVote} disabled={!vote}>
                <CheckCircle className="mr-2 h-4 w-4" />
                Submit Vote
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create Proposal Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create New Proposal</DialogTitle>
              <DialogDescription>Submit a governance proposal for the community to vote on</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="proposal-title">Title</Label>
                <Input
                  id="proposal-title"
                  placeholder="Enter proposal title"
                  value={newProposal.title}
                  onChange={(e) => setNewProposal({ ...newProposal, title: e.target.value })}
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="proposal-description">Description</Label>
                <Textarea
                  id="proposal-description"
                  placeholder="Describe your proposal in detail..."
                  value={newProposal.description}
                  onChange={(e) => setNewProposal({ ...newProposal, description: e.target.value })}
                  rows={4}
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="proposal-category">Category</Label>
                <Input
                  id="proposal-category"
                  placeholder="e.g., Parameters, Features, Economics"
                  value={newProposal.category}
                  onChange={(e) => setNewProposal({ ...newProposal, category: e.target.value })}
                  className="mt-2"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
              <Button onClick={handleCreateProposal} disabled={!newProposal.title || !newProposal.description}>
                <Plus className="mr-2 h-4 w-4" />
                Submit Proposal
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  )
}
