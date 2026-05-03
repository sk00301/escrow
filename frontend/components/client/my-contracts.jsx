'use client';
import { useState, useCallback } from 'react';
import { Button }       from '@/components/ui/button';
import { StatusBadge }  from '@/components/status-badge';
import { EmptyState }   from '@/components/empty-state';
import { useContracts } from '@/contexts/contract-context';
import { useWallet }    from '@/contexts/wallet-context';
import { useJobBoard }  from '@/contexts/job-board-context';
import { TransactionModal } from '@/components/transaction-modal';
import { useToast }     from '@/hooks/use-toast';
import {
  submitVerificationJob, waitForVerification, parseVerificationResult,
} from '@/lib/ai-verification';
import {
  ChevronDown, ChevronUp, Code, FileText, Palette, Calendar,
  Eye, CheckCircle, AlertTriangle, Wallet, Layers,
  ExternalLink, Brain, Clock, AlertCircle, RefreshCw, Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn }     from '@/lib/utils';

const PLACEHOLDER = '0x0000000000000000000000000000000001';
const deliverableIcons = { code: Code, document: FileText, design: Palette };

const BOARD_BADGE = {
  open:      { label: 'Open — Awaiting Freelancer',  cls: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
  accepted:  { label: 'Accepted — Pending Escrow',   cls: 'bg-amber-500/10 text-amber-500 border-amber-500/20' },
  completed: { label: 'Completed',                   cls: 'bg-green-500/10 text-green-600 border-green-500/20' },
  cancelled: { label: 'Cancelled',                   cls: 'bg-muted text-muted-foreground border-border' },
};

function VerifBadge({ v }) {
  if (!v) return null;
  if (v.status === 'COMPLETED') {
    return v.isPassed
      ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 border border-green-500/20"><CheckCircle className="h-2.5 w-2.5" />AI Approved · {Math.round((v.score ?? 0) * 100)}%</span>
      : <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20"><AlertCircle className="h-2.5 w-2.5" />{v.verdict} · {Math.round((v.score ?? 0) * 100)}%</span>;
  }
  if (v.status === 'FAILED') return <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/20"><AlertTriangle className="h-2.5 w-2.5" />Verify failed</span>;
  return <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"><Loader2 className="h-2.5 w-2.5 animate-spin" />Verifying…</span>;
}

export function MyContracts() {
  const { contracts, releasePayment, raiseDispute, disputes, isLoading, createMilestone } = useContracts();
  const { walletAddress } = useWallet();
  const { clientJobs, markFunded, cancelJob, releaseMilestonePayment, recordVerification } = useJobBoard();
  const { toast } = useToast();

  const [filter, setFilter]           = useState('all');
  // Per-milestone transient verification state (keyed by "jobId_milestoneIdx")
  const [liveVerify, setLiveVerify]   = useState({});
  const [liveResults, setLiveResults] = useState({});

  const runVerification = useCallback(async (boardJob, milestoneIdx, ipfsCID) => {
    if (!ipfsCID || !boardJob) return;
    const key = `${boardJob.id}_${milestoneIdx}`;
    setLiveVerify(p => ({ ...p, [key]: true }));
    setLiveResults(p => ({ ...p, [key]: { status: 'PENDING' } }));
    try {
      const meta  = boardJob.acceptanceCriteria;
      const terms = meta?.paymentTerms ?? [];
      const term  = terms[milestoneIdx] ?? {};
      const title = `${boardJob.title} — ${term.name ?? `Milestone ${milestoneIdx + 1}`}`;
      const { jobId: aiJobId } = await submitVerificationJob({
        milestoneId: `${boardJob.milestoneId}_${milestoneIdx}`,
        ipfsCID, acceptanceCriteria: meta, jobTitle: title,
        deliverableType: boardJob.deliverableType ?? 'document',
        acceptanceThreshold: (meta?.testPassRate ?? 75) / 100,
      });
      const final = await waitForVerification(aiJobId, raw => {
        const parsed = parseVerificationResult(raw);
        setLiveResults(p => ({ ...p, [key]: parsed }));
      }, { intervalMs: 5000, maxAttempts: 150 });
      const parsed = parseVerificationResult(final);
      recordVerification(boardJob.id, milestoneIdx, { ...parsed, aiJobId });
      setLiveResults(p => ({ ...p, [key]: parsed }));
    } catch (err) {
      setLiveResults(p => ({ ...p, [key]: { status: 'FAILED', errorMsg: err.message } }));
      toast({ title: 'Verification error', description: err.message, variant: 'destructive' });
    } finally {
      setLiveVerify(p => ({ ...p, [key]: false }));
    }
  }, [recordVerification, toast]);
  const [expandedId, setExpandedId]   = useState(null);
  const [actionPending, setActionPending] = useState(null);
  const [fundingJob, setFundingJob]   = useState(null);
  const [showFundModal, setShowFundModal] = useState(false);

  // ── Build ONE card per job — strict deduplication ─────────────────────────
  const boardJobs = clientJobs(walletAddress);

  // Map milestoneId → board job for funded jobs
  const boardByMId = {};
  boardJobs.forEach(j => { if (j.milestoneId) boardByMId[j.milestoneId] = j; });
  const coveredMIds = new Set(Object.keys(boardByMId));

  const allItems = [
    // 1. Board jobs not yet funded (open / accepted / cancelled)
    ...boardJobs
      .filter(j => ['open', 'accepted', 'cancelled'].includes(j.status))
      .map(j => ({ ...j, _src: 'board' })),

    // 2. Funded board jobs — show the on-chain data merged with board metadata
    //    Skip if on-chain not loaded yet (show board_funded fallback)
    ...boardJobs
      .filter(j => j.status === 'funded' && j.milestoneId)
      .map(j => {
        const chain = contracts.find(c => c.id === j.milestoneId);
        if (chain) return { ...chain, _boardJob: j, _src: 'chain' };
        return { ...j, milestoneTitle: j.title, _src: 'board_funded' };
      }),

    // 3. On-chain contracts NOT linked to any board job AND not placeholder
    ...contracts.filter(c =>
      c.clientAddress?.toLowerCase() === walletAddress?.toLowerCase() &&
      !coveredMIds.has(c.id) &&
      c.freelancerAddress?.toLowerCase() !== PLACEHOLDER.toLowerCase()
    ).map(c => ({ ...c, _src: 'chain_legacy' })),
  ];

  const filterCounts = {};
  allItems.forEach(i => { filterCounts[i.status] = (filterCounts[i.status] ?? 0) + 1; });

  const statusFilters = [
    { value: 'all',       label: 'All' },
    { value: 'open',      label: 'Open' },
    { value: 'accepted',  label: 'Accepted' },
    { value: 'funded',    label: 'Funded' },
    { value: 'submitted', label: 'Submitted' },
    { value: 'verified',  label: 'Verified' },
    { value: 'released',  label: 'Released' },
    { value: 'disputed',  label: 'Disputed' },
    { value: 'completed', label: 'Completed' },
  ].filter(f => f.value === 'all' || filterCounts[f.value]);

  const filteredItems = filter === 'all'
    ? allItems
    : allItems.filter(i => i.status === filter);

  const truncate = a => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—';

  // ── Fund escrow ───────────────────────────────────────────────────────────
  const handleFundConfirm = async () => {
    if (!fundingJob) return;
    const result = await createMilestone({
      freelancerAddress:  fundingJob.freelancerAddress,
      clientAddress:      walletAddress,
      milestoneTitle:     fundingJob.title,
      description:        fundingJob.description,
      amount:             fundingJob.amount,
      deliverableType:    fundingJob.deliverableType,
      deadline:           new Date(fundingJob.deadline),
      acceptanceCriteria: fundingJob.acceptanceCriteria,
    });
    if (result.success) {
      markFunded(fundingJob.id, result.milestoneId);
      toast({ title: 'Escrow funded!', description: `Milestone #${result.milestoneId} is live on-chain.` });
    }
    return result;
  };

  const handleRelease = async (id) => {
    setActionPending(id);
    try { await releasePayment(id); }
    finally { setActionPending(null); }
  };

  const handleDispute = async (id) => {
    setActionPending(id);
    try { await raiseDispute(id); }
    finally { setActionPending(null); }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2">My Contracts</h1>
        <p className="text-muted-foreground">One card per job — from posting through payment</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {statusFilters.map(s => (
          <Button key={s.value} variant="outline" size="sm"
            className={cn('border-border', filter === s.value
              ? 'bg-primary/10 text-primary border-primary/30' : 'bg-muted/30')}
            onClick={() => setFilter(s.value)}>
            {s.label}
            {s.value !== 'all' && filterCounts[s.value] && (
              <span className="ml-1 opacity-60 text-xs">({filterCounts[s.value]})</span>
            )}
          </Button>
        ))}
      </div>

      {filteredItems.length === 0 ? (
        <EmptyState icon="contract" title="No contracts yet"
          description={filter === 'all'
            ? 'Post a job to get started — it will appear here immediately.'
            : 'No contracts match this filter.'} />
      ) : (
        <div className="space-y-4">
          {filteredItems.map(item => {
            const id           = item.id;
            const boardJob     = item._boardJob ?? (item._src === 'board' || item._src === 'board_funded' ? item : null);
            const isChain      = item._src === 'chain' || item._src === 'chain_legacy';
            const title        = item.milestoneTitle ?? item.title ?? '—';
            const status       = item.status;
            const amount       = item.amount ?? boardJob?.amount;
            const deadline     = item.deadline;
            const freelancer   = item.freelancerAddress ?? boardJob?.freelancerAddress;
            const DeliverIcon  = deliverableIcons[item.deliverableType ?? boardJob?.deliverableType] ?? FileText;
            const isExpanded   = expandedId === id;
            const meta         = item.acceptanceCriteria ?? boardJob?.acceptanceCriteria;
            const payTerms     = meta?.paymentTerms ?? [];
            const mVerifs      = boardJob?.milestoneVerifications ?? {};
            const mSubs        = boardJob?.milestoneSubmissions ?? {};
            const released     = boardJob?.releasedMilestones ?? [];
            const currentIdx   = boardJob?.currentMilestoneIdx ?? 0;
            const ipfsCID      = item.ipfsCID;

            return (
              <div key={id} className="glass-card rounded-xl border border-border overflow-hidden">
                {/* Header */}
                <div className="p-6 cursor-pointer hover:bg-muted/20 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : id)}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <DeliverIcon className="h-6 w-6 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-foreground truncate">{title}</h3>
                        <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          <Wallet className="h-3 w-3 flex-shrink-0" />
                          {freelancer ? truncate(freelancer) : 'Awaiting freelancer'}
                          {isChain && <span className="text-xs text-primary/60 font-mono">· #{item.id}</span>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right hidden sm:block">
                        <p className="font-semibold text-foreground">{Number(amount ?? 0).toFixed(4)} ETH</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                          <Calendar className="h-3 w-3" />
                          {deadline ? format(new Date(deadline), 'dd MMM yyyy') : '—'}
                        </p>
                      </div>
                      {BOARD_BADGE[status] && !isChain
                        ? <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full border hidden sm:inline-flex', BOARD_BADGE[status].cls)}>{BOARD_BADGE[status].label}</span>
                        : <StatusBadge status={status} />}
                      <Button variant="ghost" size="icon">
                        {isExpanded ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Expanded */}
                {isExpanded && (
                  <div className="px-6 pb-6 border-t border-border pt-6 space-y-6">
                    <div className="grid md:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        {item.description && (
                          <div><p className="text-xs text-muted-foreground mb-1">Description</p>
                            <p className="text-sm text-foreground">{item.description}</p></div>
                        )}
                        <div><p className="text-xs text-muted-foreground mb-1">Freelancer</p>
                          <p className="text-sm font-mono text-foreground break-all">{freelancer ?? 'Not yet assigned'}</p></div>
                        {(boardJob?.postedAt ?? item.createdAt) && (
                          <div><p className="text-xs text-muted-foreground mb-1">Posted</p>
                            <p className="text-sm">{format(new Date(boardJob?.postedAt ?? item.createdAt), 'dd MMM yyyy HH:mm')}</p></div>
                        )}
                        {boardJob?.acceptedAt && (
                          <div><p className="text-xs text-muted-foreground mb-1">Accepted</p>
                            <p className="text-sm">{format(new Date(boardJob.acceptedAt), 'dd MMM yyyy HH:mm')}</p></div>
                        )}
                        {ipfsCID && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Submission (IPFS)</p>
                            <a href={`https://gateway.pinata.cloud/ipfs/${ipfsCID}`}
                              target="_blank" rel="noopener noreferrer"
                              className="text-xs text-primary font-mono hover:underline flex items-center gap-1 break-all">
                              {ipfsCID.slice(0, 24)}… <ExternalLink className="h-3 w-3 flex-shrink-0" />
                            </a>
                          </div>
                        )}
                        {meta?.srsCID && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">SRS (IPFS)</p>
                            <a href={`https://gateway.pinata.cloud/ipfs/${meta.srsCID}`}
                              target="_blank" rel="noopener noreferrer"
                              className="text-xs text-primary font-mono hover:underline flex items-center gap-1 break-all">
                              {meta.srsCID.slice(0, 24)}… <ExternalLink className="h-3 w-3 flex-shrink-0" />
                            </a>
                          </div>
                        )}
                      </div>

                      <div className="space-y-4">
                        {/* Payment milestones with per-milestone verification + submission */}
                        {payTerms.length > 0 && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                              <Layers className="h-3 w-3" /> Payment Schedule
                            </p>
                            <div className="space-y-2">
                              {payTerms.map((ms, i) => {
                                const verif     = mVerifs[i];
                                const sub       = mSubs[i];
                                const isReleased = released.includes(i);
                                const isActive   = i === currentIdx && isChain;
                                const isFinal    = i === payTerms.length - 1;
                                return (
                                  <div key={i} className={cn(
                                    'rounded-lg border p-3 space-y-1.5',
                                    isActive ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/20'
                                  )}>
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                                        <span className="text-xs font-medium text-foreground truncate">{ms.name}</span>
                                      </div>
                                      <div className="flex items-center gap-2 flex-shrink-0">
                                        <span className="text-xs font-bold text-primary">{ms.percentage}%</span>
                                        {amount && <span className="text-[10px] text-muted-foreground">({(Number(amount) * ms.percentage / 100).toFixed(4)} ETH)</span>}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      {isReleased
                                        ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 border border-green-500/20"><CheckCircle className="h-2.5 w-2.5" />Released</span>
                                        : sub
                                          ? (() => {
                                              const vKey = `${boardJob?.id}_${i}`;
                                              const liveV = liveResults[vKey];
                                              const effectiveVerif = liveV ?? verif;
                                              const isVerifying = liveVerify[vKey];
                                              const ipfsCID = sub.ipfsCID;
                                              return (
                                                <div className="space-y-1.5 w-full">
                                                  <div className="flex flex-wrap items-center gap-2">
                                                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">Submitted <a href={`https://gateway.pinata.cloud/ipfs/${ipfsCID}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-0.5">view <ExternalLink className="h-2.5 w-2.5" /></a></span>
                                                    <VerifBadge v={isVerifying ? {status:'RUNNING'} : effectiveVerif} />
                                                  </div>
                                                  <button
                                                    type="button"
                                                    disabled={isVerifying}
                                                    onClick={() => boardJob && runVerification(boardJob, i, ipfsCID)}
                                                    className="inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                                                    {isVerifying
                                                      ? <><Loader2 className="h-2.5 w-2.5 animate-spin"/>Verifying…</>
                                                      : effectiveVerif?.status === 'COMPLETED'
                                                        ? <><RefreshCw className="h-2.5 w-2.5"/>Re-verify</>
                                                        : <><Brain className="h-2.5 w-2.5"/>Run AI Verification</>}
                                                  </button>
                                                </div>
                                              );
                                            })()
                                          : <span className="text-[10px] text-muted-foreground">{i < currentIdx ? 'Skipped' : isActive ? 'Active' : 'Pending'}</span>
                                      }
                                      {/* Client can raise dispute or release on verified final milestone */}
                                      {!isReleased && verif?.isPassed && isFinal && isChain && status !== 'released' && (
                                        <div className="flex gap-1.5 mt-1 w-full">
                                          <Button size="sm" className="h-7 text-xs flex-1"
                                            disabled={actionPending === id}
                                            onClick={() => handleRelease(id)}>
                                            {actionPending === id
                                              ? <Loader2 className="h-3 w-3 animate-spin" />
                                              : <><CheckCircle className="h-3 w-3 mr-1" />Release Final Payment</>}
                                          </Button>
                                          {!disputes.some(d => d.milestoneId === id) && (
                                            <Button variant="outline" size="sm" className="h-7 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
                                              disabled={actionPending === id}
                                              onClick={() => handleDispute(id)}>
                                              <AlertTriangle className="h-3 w-3 mr-1" />Dispute
                                            </Button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Quality requirement */}
                        {meta?.testPassRate != null && (
                          <div><p className="text-xs text-muted-foreground mb-2">Quality Requirement</p>
                            <div className="glass rounded-lg p-3 space-y-2">
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">Pass Rate</span>
                                <span className="font-medium">{meta.testPassRate}%</span>
                              </div>
                              <div className="w-full bg-muted rounded-full h-2">
                                <div className="bg-primary rounded-full h-2" style={{ width: `${meta.testPassRate}%` }} />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-3 pt-2 border-t border-border">
                      {status === 'open' && item._src === 'board' && (
                        <Button variant="outline" size="sm"
                          className="border-destructive/30 text-destructive hover:bg-destructive/10"
                          onClick={() => { if (confirm('Cancel this job?')) cancelJob(id); }}>
                          Cancel Job
                        </Button>
                      )}
                      {status === 'accepted' && item._src === 'board' && (
                        <Button size="sm" className="gap-2"
                          onClick={() => { setFundingJob(item); setShowFundModal(true); }}>
                          <Wallet className="h-4 w-4" /> Fund Escrow
                        </Button>
                      )}
                      {isChain && (
                        <a href={`/verification/${item.id}`} target="_blank" rel="noopener noreferrer">
                          <Button variant="outline" size="sm" className="gap-2">
                            <Eye className="h-4 w-4" /> View On-Chain Details
                          </Button>
                        </a>
                      )}
                      {item._src === 'board_funded' && item.milestoneId && (
                        <a href={`/verification/${item.milestoneId}`} target="_blank" rel="noopener noreferrer">
                          <Button variant="outline" size="sm" className="gap-2">
                            <Eye className="h-4 w-4" /> View On-Chain Details
                          </Button>
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <TransactionModal
        open={showFundModal}
        onOpenChange={(o) => { setShowFundModal(o); if (!o) setFundingJob(null); }}
        action="Fund Escrow"
        amount={fundingJob ? Number(fundingJob.amount) * 1.02 : undefined}
        onConfirm={handleFundConfirm}
      />
    </div>
  );
}
