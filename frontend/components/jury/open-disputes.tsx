"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { StatusBadge } from "@/components/status-badge"
import { EmptyState } from "@/components/empty-state"
import { useContract } from "@/contexts/contract-context"
import { useWallet } from "@/contexts/wallet-context"
import { mockDisputes, mockMilestones } from "@/lib/mock-data"
import {
  Scale,
  Clock,
  FileText,
  User,
  AlertTriangle,
  CheckCircle,
  Eye,
  ThumbsUp,
  ThumbsDown
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function OpenDisputes() {
  const { walletAddress } = useWallet()
  const { voteOnDispute } = useContract()
  const [selectedDispute, setSelectedDispute] = useState<typeof mockDisputes[0] | null>(null)
  const [showVoteDialog, setShowVoteDialog] = useState(false)
  const [vote, setVote] = useState<"client" | "freelancer" | null>(null)
  const [reasoning, setReasoning] = useState("")

  const myDisputes = mockDisputes.filter((d) =>
    d.assignedJurors.includes(walletAddress || "")
  )
  const pendingDisputes = myDisputes.filter((d) => d.status === "active")
  const resolvedDisputes = myDisputes.filter((d) => d.status === "resolved")

  const getMilestone = (milestoneId: string) =>
    mockMilestones.find((m) => m.id === milestoneId)

  const getVotingProgress = (dispute: typeof mockDisputes[0]) => {
    const totalJurors = dispute.assignedJurors.length
    const votesSubmitted = dispute.votes.length
    return (votesSubmitted / totalJurors) * 100
  }

  const getTimeRemaining = (deadline: string) => {
    const diff = new Date(deadline).getTime() - new Date().getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    if (hours < 0) return "Expired"
    if (hours < 24) return `${hours} hours`
    return `${Math.floor(hours / 24)} days`
  }

  const hasVoted = (dispute: typeof mockDisputes[0]) =>
    dispute.votes.some((v) => v.jurorAddress === walletAddress)

  const handleVote = async () => {
    if (!selectedDispute || !vote) return
    await voteOnDispute(selectedDispute.id, vote)
    setShowVoteDialog(false)
    setVote(null)
    setReasoning("")
    setSelectedDispute(null)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Open Disputes</h2>
        <p className="text-muted-foreground">Review evidence and cast your vote on active disputes</p>
      </div>

      <Tabs defaultValue="pending" className="w-full">
        <TabsList>
          <TabsTrigger value="pending">
            Pending Vote ({pendingDisputes.length})
          </TabsTrigger>
          <TabsTrigger value="resolved">
            Resolved ({resolvedDisputes.length})
          </TabsTrigger>
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
                const milestone = getMilestone(dispute.milestoneId)
                const voted = hasVoted(dispute)

                return (
                  <Card key={dispute.id} className={`transition-all ${voted ? "opacity-60" : "hover:border-primary/50"}`}>
                    <CardHeader>
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-lg">{dispute.reason}</CardTitle>
                            {voted && (
                              <Badge variant="outline" className="bg-primary/10 text-primary">
                                <CheckCircle className="mr-1 h-3 w-3" />
                                Voted
                              </Badge>
                            )}
                          </div>
                          <CardDescription>
                            Milestone: {milestone?.title || dispute.milestoneId}
                          </CardDescription>
                        </div>
                        <StatusBadge status="active" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="rounded-lg border border-border bg-muted/30 p-3">
                            <div className="flex items-center gap-2 text-sm font-medium">
                              <User className="h-4 w-4 text-primary" />
                              Client
                            </div>
                            <p className="mt-1 font-mono text-xs text-muted-foreground">
                              {dispute.clientAddress.slice(0, 8)}...{dispute.clientAddress.slice(-6)}
                            </p>
                          </div>
                          <div className="rounded-lg border border-border bg-muted/30 p-3">
                            <div className="flex items-center gap-2 text-sm font-medium">
                              <User className="h-4 w-4 text-secondary-foreground" />
                              Freelancer
                            </div>
                            <p className="mt-1 font-mono text-xs text-muted-foreground">
                              {dispute.freelancerAddress.slice(0, 8)}...{dispute.freelancerAddress.slice(-6)}
                            </p>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Voting Progress</span>
                            <span className="font-medium">
                              {dispute.votes.length}/{dispute.assignedJurors.length} votes
                            </span>
                          </div>
                          <Progress value={getVotingProgress(dispute)} className="h-2" />
                        </div>

                        <div className="flex items-center gap-4 text-sm">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            <span>Time remaining: {getTimeRemaining(dispute.votingDeadline)}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <FileText className="h-4 w-4" />
                            <span>{dispute.evidence.length} evidence items</span>
                          </div>
                        </div>

                        <div className="flex gap-2 pt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedDispute(dispute)}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            Review Evidence
                          </Button>
                          {!voted && (
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedDispute(dispute)
                                setShowVoteDialog(true)
                              }}
                            >
                              <Scale className="mr-2 h-4 w-4" />
                              Cast Vote
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="resolved" className="mt-6">
          {resolvedDisputes.length === 0 ? (
            <EmptyState
              icon="contract"
              title="No resolved disputes"
              description="Resolved disputes will appear here."
            />
          ) : (
            <div className="grid gap-4">
              {resolvedDisputes.map((dispute) => (
                <Card key={dispute.id}>
                  <CardHeader>
                    <CardTitle className="text-lg">{dispute.reason}</CardTitle>
                    <CardDescription>Resolved — outcome: {dispute.resolution === "client" ? "Client won" : "Freelancer won"}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <StatusBadge status="resolved" />
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
                Review all evidence carefully before casting your vote.
              </p>
            </div>
            <div className="space-y-4">
              <h4 className="font-medium">Evidence Submitted</h4>
              {selectedDispute?.evidence.map((item, index) => (
                <div key={index} className="rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between">
                    <Badge variant={item.submittedBy === "client" ? "default" : "secondary"}>
                      {item.submittedBy === "client" ? "Client" : "Freelancer"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(item.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{item.description}</p>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <h4 className="font-medium">Original Milestone Requirements</h4>
              <div className="rounded-lg border border-border p-4">
                {getMilestone(selectedDispute?.milestoneId || "")?.deliverables.map((d, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CheckCircle className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    {d}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedDispute(null)}>Close</Button>
            <Button onClick={() => setShowVoteDialog(true)}>
              <Scale className="mr-2 h-4 w-4" />
              Proceed to Vote
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
                <AlertTriangle className="mt-0.5 h-4 w-4 text-[#F59E0B]" />
                <div className="text-sm text-[#F59E0B]">
                  <p className="font-medium">Important Notice</p>
                  <p className="mt-1">
                    Your vote cannot be changed once submitted. Voting against the majority may affect your reputation score.
                  </p>
                </div>
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium">Your Decision</Label>
              <RadioGroup
                value={vote || ""}
                onValueChange={(v) => setVote(v as "client" | "freelancer")}
                className="mt-3 grid grid-cols-2 gap-4"
              >
                <div>
                  <RadioGroupItem value="client" id="client" className="peer sr-only" />
                  <Label
                    htmlFor="client"
                    className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-border bg-background p-4 hover:bg-muted peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5"
                  >
                    <ThumbsUp className="mb-2 h-6 w-6 text-primary" />
                    <span className="font-medium">Client</span>
                    <span className="text-xs text-muted-foreground">Rule in favor of client</span>
                  </Label>
                </div>
                <div>
                  <RadioGroupItem value="freelancer" id="freelancer" className="peer sr-only" />
                  <Label
                    htmlFor="freelancer"
                    className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-border bg-background p-4 hover:bg-muted peer-data-[state=checked]:border-secondary peer-data-[state=checked]:bg-secondary/5"
                  >
                    <ThumbsDown className="mb-2 h-6 w-6 text-secondary-foreground" />
                    <span className="font-medium">Freelancer</span>
                    <span className="text-xs text-muted-foreground">Rule in favor of freelancer</span>
                  </Label>
                </div>
              </RadioGroup>
            </div>
            <div>
              <Label htmlFor="reasoning">Reasoning (Optional)</Label>
              <Textarea
                id="reasoning"
                placeholder="Explain your decision based on the evidence..."
                value={reasoning}
                onChange={(e) => setReasoning(e.target.value)}
                rows={3}
                className="mt-2"
              />
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
    </div>
  )
}
