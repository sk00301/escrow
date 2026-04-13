'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, XCircle, ExternalLink } from 'lucide-react'

interface TransactionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  action: string
  amount?: number
  onConfirm: () => Promise<{ success: boolean; hash?: string; error?: string }>
}

type TransactionState = 'pending' | 'confirming' | 'success' | 'error'

export function TransactionModal({
  open,
  onOpenChange,
  action,
  amount,
  onConfirm
}: TransactionModalProps) {
  const [state, setState] = useState<TransactionState>('pending')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setState('pending')
      setTxHash(null)
      setError(null)
    }
  }, [open])

  const handleConfirm = async () => {
    setState('confirming')
    const result = await onConfirm()
    
    if (result.success && result.hash) {
      setTxHash(result.hash)
      setState('success')
    } else {
      setError(result.error || 'Transaction failed')
      setState('error')
    }
  }

  const handleClose = () => {
    onOpenChange(false)
  }

  const truncateHash = (hash: string) => {
    return `${hash.slice(0, 10)}...${hash.slice(-8)}`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card sm:max-w-md border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-foreground">
            {state === 'pending' && 'Confirm Transaction'}
            {state === 'confirming' && 'Processing...'}
            {state === 'success' && 'Transaction Successful'}
            {state === 'error' && 'Transaction Failed'}
          </DialogTitle>
        </DialogHeader>

        <div className="py-6">
          {state === 'pending' && (
            <div className="flex flex-col gap-6">
              <div className="glass rounded-xl p-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Action</span>
                  <span className="text-foreground font-medium">{action}</span>
                </div>
                {amount !== undefined && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="text-foreground font-medium">{amount.toFixed(4)} ETH</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Estimated Gas</span>
                  <span className="text-foreground font-medium">~0.0012 ETH</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Network</span>
                  <span className="text-foreground font-medium">Sepolia Testnet</span>
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 border-border"
                  onClick={handleClose}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={handleConfirm}
                >
                  Confirm
                </Button>
              </div>
            </div>
          )}

          {state === 'confirming' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="relative">
                <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
                <div className="absolute inset-0 rounded-full animate-pulse-cyan" />
              </div>
              <p className="text-muted-foreground text-center">
                Confirm this transaction in your wallet...
              </p>
            </div>
          )}

          {state === 'success' && txHash && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="w-16 h-16 rounded-full bg-[#10B981]/20 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-[#10B981]" />
              </div>
              <p className="text-foreground font-medium">Transaction Confirmed!</p>
              
              <div className="glass rounded-xl p-4 w-full">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">TX Hash</span>
                  <a
                    href={`https://sepolia.etherscan.io/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-primary hover:underline"
                  >
                    {truncateHash(txHash)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>

              <Button
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={handleClose}
              >
                Done
              </Button>
            </div>
          )}

          {state === 'error' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="w-16 h-16 rounded-full bg-destructive/20 flex items-center justify-center">
                <XCircle className="h-8 w-8 text-destructive" />
              </div>
              <p className="text-foreground font-medium">Transaction Failed</p>
              <p className="text-sm text-muted-foreground text-center">{error}</p>

              <div className="flex gap-3 w-full">
                <Button
                  variant="outline"
                  className="flex-1 border-border"
                  onClick={handleClose}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={handleConfirm}
                >
                  Retry
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
