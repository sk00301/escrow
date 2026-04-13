'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TransactionModal } from '@/components/transaction-modal'
import { useContracts } from '@/contexts/contract-context'
import { useWallet } from '@/contexts/wallet-context'
import { useToast } from '@/hooks/use-toast'
import { format } from 'date-fns'
import { Code, FileText, Palette, Calendar, Wallet } from 'lucide-react'

interface MilestoneFormData {
  title: string
  description: string
  freelancerAddress: string
  amount: string
  deadline: string
  deliverableType: 'code' | 'document' | 'design'
  acceptanceCriteria: string
  testPassRate: number
}

export function PostMilestone() {
  const { createMilestone } = useContracts()
  const { walletAddress } = useWallet()
  const { toast } = useToast()
  const [showTxModal, setShowTxModal] = useState(false)
  const [formData, setFormData] = useState<MilestoneFormData>({
    title: '',
    description: '',
    freelancerAddress: '',
    amount: '',
    deadline: '',
    deliverableType: 'code',
    acceptanceCriteria: '{\n  "requirements": [\n    "Unit tests passing",\n    "Code documentation"\n  ]\n}',
    testPassRate: 90
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.title || !formData.freelancerAddress || !formData.amount) {
      toast({
        title: 'Validation Error',
        description: 'Please fill in all required fields',
        variant: 'destructive'
      })
      return
    }
    setShowTxModal(true)
  }

  const handleConfirmTransaction = async () => {
    const result = await createMilestone({
      freelancerAddress: formData.freelancerAddress,
      clientAddress: walletAddress || '',
      milestoneTitle: formData.title,
      description: formData.description,
      amount: parseFloat(formData.amount),
      deliverableType: formData.deliverableType,
      deadline: new Date(formData.deadline),
      acceptanceCriteria: {
        testPassRate: formData.testPassRate,
        requirements: JSON.parse(formData.acceptanceCriteria).requirements || []
      }
    })

    if (result.success) {
      toast({
        title: 'Milestone Created',
        description: 'Your milestone has been funded and is now active.'
      })
      // Reset form
      setFormData({
        title: '',
        description: '',
        freelancerAddress: '',
        amount: '',
        deadline: '',
        deliverableType: 'code',
        acceptanceCriteria: '{\n  "requirements": [\n    "Unit tests passing",\n    "Code documentation"\n  ]\n}',
        testPassRate: 90
      })
    }

    return result
  }

  const deliverableIcons = {
    code: Code,
    document: FileText,
    design: Palette
  }

  const DeliverableIcon = deliverableIcons[formData.deliverableType]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Post New Milestone</h1>
        <p className="text-muted-foreground">Create a new milestone and fund the escrow</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="glass-card rounded-xl border border-border p-6 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="title" className="text-accent">Milestone Title *</Label>
              <Input
                id="title"
                placeholder="e.g., Smart Contract Development"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="bg-muted/50 border-border focus:border-primary"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-accent">Description</Label>
              <Textarea
                id="description"
                placeholder="Describe the work to be completed..."
                rows={3}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="bg-muted/50 border-border focus:border-primary resize-none"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="freelancer" className="text-accent">Freelancer Wallet Address *</Label>
              <Input
                id="freelancer"
                placeholder="0x..."
                value={formData.freelancerAddress}
                onChange={(e) => setFormData({ ...formData, freelancerAddress: e.target.value })}
                className="bg-muted/50 border-border focus:border-primary font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="amount" className="text-accent">Amount (ETH) *</Label>
                <div className="relative">
                  <Input
                    id="amount"
                    type="number"
                    step="0.0001"
                    min="0"
                    placeholder="0.0000"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    className="bg-muted/50 border-border focus:border-primary pl-10"
                  />
                  <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="deadline" className="text-accent">Deadline *</Label>
                <div className="relative">
                  <Input
                    id="deadline"
                    type="date"
                    value={formData.deadline}
                    onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                    className="bg-muted/50 border-border focus:border-primary pl-10"
                  />
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="deliverableType" className="text-accent">Deliverable Type</Label>
              <Select
                value={formData.deliverableType}
                onValueChange={(value: 'code' | 'document' | 'design') => 
                  setFormData({ ...formData, deliverableType: value })
                }
              >
                <SelectTrigger className="bg-muted/50 border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="glass-card border-border">
                  <SelectItem value="code">Code</SelectItem>
                  <SelectItem value="document">Document</SelectItem>
                  <SelectItem value="design">Design</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="criteria" className="text-accent">Acceptance Criteria (JSON)</Label>
              <Textarea
                id="criteria"
                rows={5}
                value={formData.acceptanceCriteria}
                onChange={(e) => setFormData({ ...formData, acceptanceCriteria: e.target.value })}
                className="bg-muted/50 border-border focus:border-primary resize-none font-mono text-sm"
              />
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-accent">Required Test Pass Rate</Label>
                <span className="text-sm font-medium text-foreground">{formData.testPassRate}%</span>
              </div>
              <Slider
                value={[formData.testPassRate]}
                onValueChange={(value) => setFormData({ ...formData, testPassRate: value[0] })}
                max={100}
                min={0}
                step={5}
                className="w-full"
              />
            </div>

            <Button 
              type="submit" 
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-12 text-lg"
            >
              Fund Escrow
            </Button>
          </div>
        </form>

        {/* Preview Card */}
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-foreground">Milestone Preview</h2>
          
          <div className="glass-card rounded-xl border border-border p-6 space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-bold text-foreground mb-1">
                  {formData.title || 'Milestone Title'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {formData.description || 'No description provided'}
                </p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <DeliverableIcon className="h-6 w-6 text-primary" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="glass rounded-lg p-4">
                <p className="text-xs text-muted-foreground mb-1">Amount</p>
                <p className="text-lg font-bold text-foreground">
                  {formData.amount ? `${parseFloat(formData.amount).toFixed(4)} ETH` : '-- ETH'}
                </p>
              </div>
              <div className="glass rounded-lg p-4">
                <p className="text-xs text-muted-foreground mb-1">Deadline</p>
                <p className="text-lg font-bold text-foreground">
                  {formData.deadline 
                    ? format(new Date(formData.deadline), 'dd MMM yyyy')
                    : '-- --- ----'
                  }
                </p>
              </div>
            </div>

            <div className="glass rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-2">Freelancer</p>
              <p className="font-mono text-sm text-foreground break-all">
                {formData.freelancerAddress || '0x...'}
              </p>
            </div>

            <div className="glass rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-2">Requirements</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-muted rounded-full h-2">
                  <div 
                    className="bg-primary rounded-full h-2 transition-all duration-300"
                    style={{ width: `${formData.testPassRate}%` }}
                  />
                </div>
                <span className="text-sm font-medium text-foreground">
                  {formData.testPassRate}% pass rate
                </span>
              </div>
            </div>

            <div className="pt-4 border-t border-border">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Escrow Fee (2%)</span>
                <span className="text-foreground">
                  {formData.amount 
                    ? `${(parseFloat(formData.amount) * 0.02).toFixed(4)} ETH`
                    : '-- ETH'
                  }
                </span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-muted-foreground">Total</span>
                <span className="text-lg font-bold text-primary">
                  {formData.amount 
                    ? `${(parseFloat(formData.amount) * 1.02).toFixed(4)} ETH`
                    : '-- ETH'
                  }
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <TransactionModal
        open={showTxModal}
        onOpenChange={setShowTxModal}
        action="Fund Escrow"
        amount={formData.amount ? parseFloat(formData.amount) * 1.02 : undefined}
        onConfirm={handleConfirmTransaction}
      />
    </div>
  )
}
