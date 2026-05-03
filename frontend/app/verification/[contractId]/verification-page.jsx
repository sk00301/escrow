'use client';

/**
 * app/verification/[contractId]/page.jsx
 *
 * Verification results page — now wired to the real FastAPI service.
 *
 * Data flow:
 *   1. Load milestone from ContractContext (on-chain data)
 *   2. If milestone has an ipfsCID (work submitted), derive jobId and poll
 *      GET /result/{jobId} every 10s via useVerification hook
 *   3. Map API response fields to UI components
 *   4. Show "Release Payment" to client when verdict === APPROVED
 *   5. Show "Raise Dispute" to either party when verdict === DISPUTED
 */

import { use, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/navbar';
import { StatusBadge } from '@/components/status-badge';
import { TransactionModal } from '@/components/transaction-modal';
import { useContracts } from '@/contexts/contract-context';
import { useWallet } from '@/contexts/wallet-context';
import { useJobBoard, loadVerifyRecord } from '@/contexts/job-board-context';
import { useToast } from '@/hooks/use-toast';
import { useVerification } from '@/hooks/use-verification';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowLeft, CheckCircle, XCircle, AlertTriangle, FileCode,
  ExternalLink, Shield, Clock, Hash, Activity, ChevronRight,
  RefreshCw, Loader2, DollarSign, Scale,
} from 'lucide-react';
import { format } from 'date-fns';

// ── Skeleton loader shown while fetching on first load ────────────────────────

function VerificationSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="glass-card rounded-2xl border border-border p-6">
        <Skeleton className="h-8 w-2/3 mb-3" />
        <Skeleton className="h-4 w-1/2 mb-6" />
        <div className="grid grid-cols-4 gap-4 pt-6 border-t border-border">
          {[1,2,3,4].map(i => <div key={i}><Skeleton className="h-3 w-16 mb-2"/><Skeleton className="h-5 w-24"/></div>)}
        </div>
      </div>
      <div className="glass-card rounded-2xl border border-border p-6">
        <Skeleton className="h-24 w-full" />
      </div>
      <div className="glass-card rounded-2xl border border-border p-6">
        <Skeleton className="h-4 w-32 mb-4"/>
        {[1,2,3].map(i => <Skeleton key={i} className="h-8 w-full mb-3"/>)}
      </div>
    </div>
  );
}

// ── Pending / Running state shown while oracle is working ─────────────────────

function PendingVerification({ result, onRefresh }) {
  const elapsed = result?.elapsedSec ?? 0;
  const isRunning = result?.status === 'RUNNING';
  const estimatedTotal = 45; // typical verification takes ~45s
  const progress = isRunning ? Math.min(90, Math.round((elapsed / estimatedTotal) * 100)) : 10;

  return (
    <div className="glass-card rounded-2xl border border-border p-12 text-center">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
        <Loader2 className="h-8 w-8 text-primary animate-spin"/>
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">
        {isRunning ? 'Verification Running' : 'Queued for Verification'}
      </h3>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">
        {isRunning
          ? 'The AI oracle is running pytest, pylint, and flake8 on the submission.'
          : 'The verification job is queued and will start shortly.'}
      </p>
      <div className="max-w-xs mx-auto mb-4">
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>Progress</span>
          <span>~{Math.max(0, estimatedTotal - elapsed)}s remaining</span>
        </div>
        <Progress value={progress} className="h-2"/>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Auto-refreshing every 10 seconds
      </p>
      <Button variant="outline" size="sm" onClick={onRefresh}>
        <RefreshCw className="mr-2 h-4 w-4"/>
        Refresh Now
      </Button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function VerificationPage({ params }) {
  const { contractId } = use(params);
  const router         = useRouter();
  const { walletAddress }                             = useWallet();
  const { contracts, getContract, releasePayment, raiseDispute } = useContracts();
  const { toast }      = useToast();

  const { jobByMilestoneId } = useJobBoard();
  const [contract,         setContract]         = useState(null);
  const [contractLoading,  setContractLoading]  = useState(true);
  const [showReleaseModal, setShowReleaseModal] = useState(false);
  const [showDisputeModal, setShowDisputeModal] = useState(false);

  // Load contract — from cache first, then on-chain if needed
  useEffect(() => {
    const cached = contracts.find(c => c.id === contractId);
    if (cached) { setContract(cached); setContractLoading(false); return; }

    getContract(contractId)
      .then(c => { setContract(c); setContractLoading(false); })
      .catch(() => setContractLoading(false));
  }, [contractId, contracts, getContract]);

  // ── Resolve board job (own wallet — may be null for cross-wallet view) ────
  const boardJob = jobByMilestoneId(contractId);

  // ── Derive AI job UUID ────────────────────────────────────────────────────
  // Priority: board milestoneVerifications (own wallet) → cross-wallet store
  const aiJobId = (() => {
    const verifs = Object.values(boardJob?.milestoneVerifications ?? {});
    const latest = [...verifs].reverse().find(v => v?.aiJobId);
    return latest?.aiJobId ?? null;
  })();

  // ── Local cached result (available cross-wallet from localStorage) ─────────
  // Written by recordVerification under key mv_${milestoneId}
  const localRecord = loadVerifyRecord(contractId);

  // ── Submission IPFS CID ───────────────────────────────────────────────────
  const submissionIpfsCID = contract?.ipfsCID
    ?? Object.values(boardJob?.milestoneSubmissions ?? {}).slice(-1)[0]?.ipfsCID
    ?? localRecord?.submissionIpfsCID
    ?? null;

  // Poll the AI backend only when we have a UUID; otherwise show localRecord
  const { result: liveResult, loading: verLoading, error: verError, refetch } = useVerification(aiJobId);

  // Merge: live poll wins if available, else use the stored record
  // Convert localRecord (parseVerificationResult shape) to useVerification shape
  const result = liveResult ?? (() => {
    if (!localRecord || localRecord.status !== 'COMPLETED') return null;
    const pct = v => (v != null ? Math.round(v * 100) : null);
    return {
      status:       localRecord.status,
      verdict:      (localRecord.verdict ?? 'PENDING').toLowerCase(),
      overallScore: pct(localRecord.score),
      score:        localRecord.score,
      breakdown:    {},
      testPassRate: null,
      passedTests:  [],
      failedTests:  [],
      passedCount:  0,
      failedCount:  0,
      totalTests:   0,
      fileHash:     null,
      ipfsCID:      submissionIpfsCID,
      ipfsLink:     submissionIpfsCID ? `ipfs://${submissionIpfsCID}` : null,
      submissionTimestamp: localRecord.details?.submittedAt ?? new Date().toISOString(),
      completedAt:  null,
      elapsedSec:   0,
      errorCode:    localRecord.errorCode ?? null,
      errorMessage: localRecord.errorMsg  ?? null,
      _raw: localRecord,
    };
  })();

  // Determine who is viewing
  const isClient     = walletAddress?.toLowerCase() === contract?.clientAddress?.toLowerCase();
  const isFreelancer = walletAddress?.toLowerCase() === contract?.freelancerAddress?.toLowerCase();

  // Verdict colours
  const verdict = result?.verdict;
  const verdictColor = verdict === 'approved' ? 'text-[#10B981]'
                     : verdict === 'rejected'  ? 'text-[#EF4444]'
                     : verdict === 'disputed'  ? 'text-[#F59E0B]'
                     : 'text-muted-foreground';
  const verdictBg = verdict === 'approved' ? 'bg-[#10B981]/10 border-[#10B981]/30'
                  : verdict === 'rejected'  ? 'bg-[#EF4444]/10 border-[#EF4444]/30'
                  : 'bg-[#F59E0B]/10 border-[#F59E0B]/30';

  // Action handlers
  const handleRelease = useCallback(async () => {
    try {
      const res = await releasePayment(contractId);
      toast({ title: 'Payment Released', description: 'Funds transferred to the freelancer.' });
      return res;
    } catch (err) {
      toast({ title: 'Transaction Failed', description: err.message, variant: 'destructive' });
      return { success: false, error: err.message };
    }
  }, [contractId, releasePayment, toast]);

  const handleDispute = useCallback(async () => {
    try {
      const res = await raiseDispute(contractId);
      toast({ title: 'Dispute Raised', description: 'The case has been sent to the jury.' });
      return res;
    } catch (err) {
      toast({ title: 'Transaction Failed', description: err.message, variant: 'destructive' });
      return { success: false, error: err.message };
    }
  }, [contractId, raiseDispute, toast]);

  // ── Not found ──────────────────────────────────────────────────────────────

  if (!contractLoading && !contract) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar/>
        <div className="flex flex-col items-center justify-center pt-32 px-4">
          <div className="glass-card rounded-2xl p-12 text-center max-w-md border border-border">
            <AlertTriangle className="h-12 w-12 text-[#F59E0B] mx-auto mb-4"/>
            <h2 className="text-xl font-bold text-foreground mb-2">Contract Not Found</h2>
            <p className="text-muted-foreground mb-6">
              No contract found with ID: <span className="font-mono text-sm">{contractId}</span>
            </p>
            <Button onClick={() => router.back()}>
              <ArrowLeft className="mr-2 h-4 w-4"/>Go Back
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <Navbar/>
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16">

        <Button variant="ghost" size="sm" className="mb-6 text-muted-foreground hover:text-foreground" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4"/>Back
        </Button>

        {/* ── Contract header ── */}
        {contractLoading ? (
          <div className="glass-card rounded-2xl border border-border p-6 mb-6">
            <Skeleton className="h-8 w-1/2 mb-3"/><Skeleton className="h-4 w-1/3"/>
          </div>
        ) : contract && (
          <div className="glass-card rounded-2xl border border-border p-6 mb-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <FileCode className="h-6 w-6 text-primary"/>
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">{contract.milestoneTitle}</h1>
                  <p className="text-muted-foreground mt-1">{contract.description}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <span className="font-mono text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded">{contract.id}</span>
                    <Badge variant="outline" className="capitalize">{contract.deliverableType}</Badge>
                  </div>
                </div>
              </div>
              <StatusBadge status={contract.status}/>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-border">
              <div><p className="text-xs text-muted-foreground mb-1">Amount</p><p className="font-semibold">{contract.amount?.toFixed(4)} ETH</p></div>
              <div><p className="text-xs text-muted-foreground mb-1">Deadline</p><p className="font-semibold">{format(new Date(contract.deadline), 'dd MMM yyyy')}</p></div>
              <div><p className="text-xs text-muted-foreground mb-1">Client</p><p className="font-mono text-xs">{contract.clientAddress?.slice(0,6)}...{contract.clientAddress?.slice(-4)}</p></div>
              <div><p className="text-xs text-muted-foreground mb-1">Freelancer</p><p className="font-mono text-xs">{contract.freelancerAddress?.slice(0,6)}...{contract.freelancerAddress?.slice(-4)}</p></div>
            </div>
          </div>
        )}

        {/* ── Verification result area ── */}
        {verLoading && !result ? (
          <VerificationSkeleton/>
        ) : verError ? (
          <div className="glass-card rounded-2xl border border-border p-8 text-center mb-6 space-y-4">
            <XCircle className="h-10 w-10 text-destructive mx-auto"/>
            <h3 className="font-semibold text-foreground">Could not load verification result</h3>
            <p className="text-sm text-muted-foreground">{verError}</p>
            {submissionIpfsCID && (
              <a href={`https://gateway.pinata.cloud/ipfs/${submissionIpfsCID}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                <ExternalLink className="h-4 w-4"/>View Raw Submission on IPFS
              </a>
            )}
            <div>
              <Button variant="outline" onClick={refetch}>
                <RefreshCw className="mr-2 h-4 w-4"/>Try Again
              </Button>
            </div>
          </div>
        ) : !aiJobId && !localRecord ? (
          /* Work submitted but no AI verification yet, or awaiting submission */
          <div className="glass-card rounded-2xl border border-border p-8 text-center mb-6 space-y-4">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto">
              <Clock className="h-8 w-8 text-muted-foreground"/>
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              {submissionIpfsCID ? 'Submitted — Awaiting AI Verification' : 'Awaiting Submission'}
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              {submissionIpfsCID
                ? 'Work has been submitted. Run AI verification from the freelancer dashboard.'
                : 'Work has not been submitted yet. Once the freelancer submits, the AI oracle will verify it automatically.'}
            </p>
            {submissionIpfsCID && (
              <a href={`https://gateway.pinata.cloud/ipfs/${submissionIpfsCID}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                <ExternalLink className="h-4 w-4"/>View Submission on IPFS
              </a>
            )}
          </div>
        ) : result?.status === 'PENDING' || result?.status === 'RUNNING' ? (
          <div className="mb-6">
            <PendingVerification result={result} onRefresh={refetch}/>
          </div>
        ) : result?.status === 'COMPLETED' ? (
          <>
            {/* ── Verdict banner ── */}
            <div className={`rounded-2xl border p-6 mb-6 ${verdictBg}`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  {verdict === 'approved' ? <CheckCircle className="h-10 w-10 text-[#10B981] shrink-0"/>
                   : verdict === 'rejected' ? <XCircle className="h-10 w-10 text-[#EF4444] shrink-0"/>
                   : <AlertTriangle className="h-10 w-10 text-[#F59E0B] shrink-0"/>}
                  <div>
                    <p className="text-sm text-muted-foreground">AI Verification Verdict</p>
                    <p className={`text-2xl font-bold uppercase ${verdictColor}`}>{verdict}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Submitted {format(new Date(result.submissionTimestamp), 'dd MMM yyyy, HH:mm')}
                    </p>
                  </div>
                </div>
                <div className="text-center sm:text-right">
                  <p className="text-sm text-muted-foreground">Overall Score</p>
                  <p className={`text-5xl font-bold ${verdictColor}`}>{result.overallScore ?? '—'}</p>
                  <p className="text-xs text-muted-foreground mt-1">out of 100</p>
                </div>
              </div>

              {/* ── Action buttons ── */}
              <div className="flex flex-wrap gap-3 mt-6 pt-4 border-t border-current/10">
                {/* Release Payment — client only, APPROVED verdict */}
                {isClient && verdict === 'approved' && contract?.status !== 'released' && (
                  <Button
                    className="bg-[#10B981] hover:bg-[#10B981]/90 text-white gap-2"
                    onClick={() => setShowReleaseModal(true)}
                  >
                    <DollarSign className="h-4 w-4"/>
                    Release Payment
                  </Button>
                )}
                {/* Raise Dispute — either party, DISPUTED verdict */}
                {(isClient || isFreelancer) && verdict === 'disputed' && contract?.status !== 'resolved' && (
                  <Button
                    variant="outline"
                    className="border-[#F59E0B]/50 text-[#F59E0B] hover:bg-[#F59E0B]/10 gap-2"
                    onClick={() => setShowDisputeModal(true)}
                  >
                    <Scale className="h-4 w-4"/>
                    Raise Dispute
                  </Button>
                )}
              </div>
            </div>

            {/* ── Score breakdown ── */}
            {Object.keys(result.breakdown ?? {}).length > 0 && (
              <div className="glass-card rounded-2xl border border-border p-6 mb-6">
                <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary"/>Score Breakdown
                </h2>
                <div className="space-y-4">
                  {Object.entries(result.breakdown).map(([key, value]) => (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm text-muted-foreground capitalize">
                          {key.replace(/([A-Z])/g, ' $1').trim()}
                        </span>
                        <span className={`text-sm font-semibold ${
                          value >= 75 ? 'text-[#10B981]' : value >= 45 ? 'text-[#F59E0B]' : 'text-[#EF4444]'
                        }`}>{value}%</span>
                      </div>
                      <Progress value={value} className="h-2"/>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Passed / Failed tests ── */}
            <div className="grid md:grid-cols-2 gap-6 mb-6">
              <div className="glass-card rounded-2xl border border-border p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-[#10B981]"/>
                  Passed Tests ({result.passedTests.length})
                </h2>
                {result.passedTests.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tests passed.</p>
                ) : (
                  <div className="space-y-2">
                    {result.passedTests.map((test, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <CheckCircle className="h-4 w-4 text-[#10B981] mt-0.5 shrink-0"/>
                        <span className="text-foreground font-mono text-xs">{test}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="glass-card rounded-2xl border border-border p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-[#EF4444]"/>
                  Failed Tests ({result.failedTests.length})
                </h2>
                {result.failedTests.length === 0 ? (
                  <p className="text-sm text-muted-foreground">All tests passed.</p>
                ) : (
                  <div className="space-y-2">
                    {result.failedTests.map((test, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <XCircle className="h-4 w-4 text-[#EF4444] mt-0.5 shrink-0"/>
                        <span className="text-foreground font-mono text-xs">{test}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── On-chain proof ── */}
            <div className="glass-card rounded-2xl border border-border p-6 mb-6">
              <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary"/>On-Chain Proof
              </h2>
              <div className="space-y-3">
                {result.fileHash && (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Hash className="h-4 w-4 text-muted-foreground shrink-0"/>
                      <span className="text-sm text-muted-foreground">Submission Hash</span>
                    </div>
                    <span className="font-mono text-xs text-foreground break-all">{result.fileHash}</span>
                  </div>
                )}
                {(result.ipfsCID || submissionIpfsCID) && (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0"/>
                      <span className="text-sm text-muted-foreground">Submission (IPFS)</span>
                    </div>
                    <a
                      href={`https://gateway.pinata.cloud/ipfs/${result.ipfsCID ?? submissionIpfsCID}`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 font-mono text-xs text-primary hover:underline break-all"
                    >
                      {result.ipfsCID ?? submissionIpfsCID}
                      <ExternalLink className="h-3 w-3 shrink-0"/>
                    </a>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : result?.status === 'FAILED' ? (
          <div className="glass-card rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center mb-6">
            <XCircle className="h-10 w-10 text-destructive mx-auto mb-3"/>
            <h3 className="font-semibold text-foreground mb-1">Verification Failed</h3>
            <p className="text-sm text-muted-foreground mb-1">{result.errorCode}</p>
            <p className="text-sm text-muted-foreground">{result.errorMessage}</p>
            <Button variant="outline" className="mt-4" onClick={refetch}>
              <RefreshCw className="mr-2 h-4 w-4"/>Refresh
            </Button>
          </div>
        ) : null}

        {/* ── Acceptance criteria (always shown if contract loaded) ── */}
        {contract && (
          <div className="glass-card rounded-2xl border border-border p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-primary"/>Acceptance Criteria
            </h2>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-muted-foreground">Required Test Pass Rate</span>
              <span className="font-semibold">{contract.acceptanceCriteria?.testPassRate ?? 75}%</span>
            </div>
            <div className="space-y-2">
              {(contract.acceptanceCriteria?.requirements ?? []).map((req, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <ChevronRight className="h-4 w-4 text-primary shrink-0"/>
                  <span className="text-foreground">{req}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* ── Release Payment modal ── */}
      <TransactionModal
        open={showReleaseModal}
        onOpenChange={setShowReleaseModal}
        action="Release Payment"
        amount={contract?.amount}
        onConfirm={handleRelease}
      />

      {/* ── Raise Dispute modal ── */}
      <TransactionModal
        open={showDisputeModal}
        onOpenChange={setShowDisputeModal}
        action="Raise Dispute"
        onConfirm={handleDispute}
      />
    </div>
  );
}
