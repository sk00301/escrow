"use client";
import { useState, useRef, useCallback } from "react";
import { Button }       from "@/components/ui/button";
import { Badge }        from "@/components/ui/badge";
import { Progress }     from "@/components/ui/progress";
import { StatusBadge }  from "@/components/status-badge";
import { EmptyState }   from "@/components/empty-state";
import { useContracts } from "@/contexts/contract-context";
import { useWallet }    from "@/contexts/wallet-context";
import { useJobBoard }  from "@/contexts/job-board-context";
import { useToast }     from "@/hooks/use-toast";
import {
  submitVerificationJob, waitForVerification, parseVerificationResult, postResultToOracle,
} from "@/lib/ai-verification";
import {
  Clock, Wallet, Upload, CheckCircle, AlertCircle, FileUp, X,
  Loader2, Layers, Code, FileText, Palette, Brain, AlertTriangle,
  RefreshCw, ChevronDown, ChevronUp, ExternalLink, DollarSign,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader,
  DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label }    from "@/components/ui/label";
import { Input }    from "@/components/ui/input";
import { format }   from "date-fns";
import { cn }       from "@/lib/utils";

const deliverableIcons = { code: Code, document: FileText, design: Palette };

function getProgress(status) {
  return { accepted: 10, funded: 25, submitted: 60, verified: 90, released: 100 }[status] ?? 0;
}

// ── Verification status pill ───────────────────────────────────────────────────
function VerifPill({ v, isRunning }) {
  if (isRunning || v?.status === 'PENDING' || v?.status === 'RUNNING')
    return <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20"><Loader2 className="h-3 w-3 animate-spin" />{v?.status === 'PENDING' ? 'Queued…' : 'Verifying…'}</span>;
  if (v?.status === 'FAILED')
    return <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-destructive/10 text-destructive border border-destructive/20"><AlertTriangle className="h-3 w-3" />Verify failed</span>;
  if (v?.status === 'COMPLETED')
    return v.isPassed
      ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/10 text-green-600 border border-green-500/20"><CheckCircle className="h-3 w-3" />AI Approved · {Math.round((v.score ?? 0) * 100)}%</span>
      : <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20"><AlertCircle className="h-3 w-3" />{v.verdict} · {Math.round((v.score ?? 0) * 100)}%</span>;
  return null;
}

// ── Collapsible verification detail panel ─────────────────────────────────────
function VerifDetails({ v }) {
  const [open, setOpen] = useState(false);
  if (!v || v.status !== 'COMPLETED') return null;
  const { score, verdict, details } = v;
  const bd = details?.score_breakdown ?? details ?? {};
  const entries = Object.entries(bd)
    .filter(([, val]) => val != null && typeof val === 'number' && val > 0)
    .map(([k, val]) => [k.replace(/_contribution|_score/g, '').replace(/_/g, ' ').trim(), val]);
  const reasoning      = details?.reasoning ?? details?.llm_verdict?.reasoning ?? null;
  const recommendation = details?.recommendation ?? details?.llm_verdict?.recommendation ?? null;
  const reqsMet        = details?.requirements_met ?? details?.llm_verdict?.requirements_met ?? null;

  return (
    <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium hover:bg-muted/30 transition-colors">
        <span className="flex items-center gap-1.5"><Brain className="h-3.5 w-3.5 text-primary" />AI Verification Details</span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border">
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-muted-foreground">Overall Score</span>
            <span className={cn("text-sm font-bold", score >= 0.75 ? "text-green-600" : "text-amber-600")}>
              {Math.round((score ?? 0) * 100)}% · {verdict}
            </span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div className={cn("rounded-full h-2 transition-all", score >= 0.75 ? "bg-green-500" : "bg-amber-500")}
              style={{ width: `${Math.round((score ?? 0) * 100)}%` }} />
          </div>
          {entries.length > 0 && (
            <div className="space-y-1.5 pt-1">
              {entries.map(([label, val]) => (
                <div key={label} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground capitalize">{label}</span>
                  <span className="font-medium">{Math.round(val * 100)}%</span>
                </div>
              ))}
            </div>
          )}
          {reasoning && (
            <div className="rounded-md bg-muted/50 p-2.5 text-xs space-y-1">
              <p className="font-medium text-foreground">AI Assessment</p>
              <p className="text-muted-foreground leading-relaxed">{reasoning}</p>
              {recommendation && <p className="text-primary font-medium mt-1">{recommendation}</p>}
            </div>
          )}
          {reqsMet?.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium">Requirements</p>
              {reqsMet.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className={cn("mt-0.5 flex-shrink-0 font-bold", r.met ? "text-green-500" : "text-destructive")}>{r.met ? "✓" : "✗"}</span>
                  <div>
                    <span className="text-foreground">{r.requirement}</span>
                    {r.evidence && <p className="text-muted-foreground mt-0.5">{r.evidence}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export function ActiveContracts() {
  const { walletAddress }                           = useWallet();
  const { contracts, submitWork, releasePayment, getAllContracts } = useContracts();
  const {
    freelancerJobs, recordSubmission, recordVerification, releaseMilestonePayment,
  } = useJobBoard();
  const { toast } = useToast();

  // ── Submit dialog ──────────────────────────────────────────────────────────
  const [submitCtx, setSubmitCtx]       = useState(null); // { boardJob, milestoneIdx }
  const [showSubmitDlg, setShowSubmitDlg] = useState(false);
  const [workDesc, setWorkDesc]         = useState("");
  const [workLinks, setWorkLinks]       = useState("");
  const [delivFile, setDelivFile]       = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileRef = useRef(null);

  // ── Per-milestone verification state ──────────────────────────────────────
  // key = `${boardJobId}_${milestoneIdx}`
  const [liveVerify, setLiveVerify]   = useState({}); // key → bool
  const [liveResults, setLiveResults] = useState({}); // key → parsed result

  // ── Release pending ────────────────────────────────────────────────────────
  const [releasing, setReleasing] = useState(null);

  // ── Build unified item list ────────────────────────────────────────────────
  const boardJobs = freelancerJobs(walletAddress);
  const boardByMid = {};
  boardJobs.forEach(j => { if (j.milestoneId) boardByMid[j.milestoneId] = j; });
  const coveredMids = new Set(Object.keys(boardByMid));

  const activeItems = [
    ...boardJobs.filter(j => j.status === 'accepted').map(j => ({ ...j, _src: 'board_accepted' })),
    ...boardJobs.filter(j => ['funded', 'completed'].includes(j.status) && j.milestoneId).map(j => {
      const chain = contracts.find(c => c.id === j.milestoneId);
      return chain
        ? { ...chain, _boardJob: j, _src: 'chain' }
        : { ...j, milestoneTitle: j.title, _src: 'board_funded' };
    }),
    ...contracts.filter(c =>
      c.freelancerAddress?.toLowerCase() === walletAddress?.toLowerCase() &&
      ['funded', 'submitted', 'verified', 'released'].includes(c.status) &&
      !coveredMids.has(c.id)
    ).map(c => ({ ...c, _src: 'chain_legacy' })),
  ];

  // ── Run AI verification for a milestone ───────────────────────────────────
  const runVerification = useCallback(async (boardJob, milestoneIdx, ipfsCID) => {
    if (!ipfsCID) {
      toast({ title: 'No submission found', description: 'Please submit work first.', variant: 'destructive' });
      return;
    }
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
        ipfsCID,
        acceptanceCriteria: meta,
        jobTitle: title,
        deliverableType: boardJob.deliverableType ?? 'document',
        acceptanceThreshold: (meta?.testPassRate ?? 75) / 100,
      });

      const finalRaw = await waitForVerification(aiJobId, raw => {
        const parsed = parseVerificationResult(raw);
        setLiveResults(p => ({ ...p, [key]: parsed }));
      }, { intervalMs: 5000, maxAttempts: 150 });

      const parsed = parseVerificationResult(finalRaw);
      recordVerification(boardJob.id, milestoneIdx, { ...parsed, aiJobId, submissionIpfsCID: ipfsCID });
      setLiveResults(p => ({ ...p, [key]: parsed }));

      // Post result on-chain via oracle so both wallets see the updated state
      if (parsed.isPassed || parsed.score != null) {
        try {
          const cleanMilestoneId = boardJob.milestoneId?.toString().replace(/_\d+$/, '');
          if (cleanMilestoneId) {
            await postResultToOracle(cleanMilestoneId, parsed.score, ipfsCID);
            // Refresh on-chain contracts so dashboards update immediately
            if (getAllContracts) await getAllContracts();
          }
        } catch (oracleErr) {
          // Oracle posting failed — result still shown from liveResults/board
          console.warn('[oracle] Failed to post result on-chain:', oracleErr.message);
          toast({ title: 'Note', description: 'AI result verified but could not update on-chain status. The oracle service may be offline.', variant: 'default' });
        }
      }
    } catch (err) {
      setLiveResults(p => ({ ...p, [key]: { status: 'FAILED', errorMsg: err.message, errorCode: 'CLIENT_ERROR' } }));
      toast({ title: 'Verification error', description: err.message, variant: 'destructive' });
    } finally {
      setLiveVerify(p => ({ ...p, [key]: false }));
    }
  }, [recordVerification, toast]);

  // ── Submit work ────────────────────────────────────────────────────────────
  const handleSubmitWork = async () => {
    if (!submitCtx) return;
    const { boardJob, milestoneIdx } = submitCtx;
    if (!boardJob.milestoneId) {
      toast({ title: 'Escrow not funded yet', description: "Client hasn't funded the escrow.", variant: 'destructive' });
      return;
    }
    if (!workDesc.trim() && !delivFile) {
      toast({ title: 'Nothing to submit', description: 'Add a file or write some notes.', variant: 'destructive' });
      return;
    }
    setIsSubmitting(true);
    try {
      const payload = delivFile
        ? delivFile
        : new Blob([workDesc.trim() + (workLinks ? `\nLinks:\n${workLinks}` : '')], { type: 'text/plain' });

      const res = await submitWork(boardJob.milestoneId, payload);
      const ipfsCID = res?.ipfsCID ?? null;
      if (ipfsCID) recordSubmission(boardJob.id, milestoneIdx, ipfsCID);

      toast({ title: 'Work submitted!', description: 'Starting AI verification…' });
      setShowSubmitDlg(false);
      setWorkDesc(''); setWorkLinks(''); setDelivFile(null); setSubmitCtx(null);

      if (ipfsCID) runVerification(boardJob, milestoneIdx, ipfsCID);
    } catch (err) {
      toast({ title: 'Submission failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Release payment for a milestone ───────────────────────────────────────
  const handleRelease = async (boardJob, milestoneIdx) => {
    const key = `${boardJob.id}_${milestoneIdx}`;
    setReleasing(key);
    try {
      await releasePayment(boardJob.milestoneId);
      releaseMilestonePayment(boardJob.id, milestoneIdx);
      const isFinal = milestoneIdx >= (boardJob.acceptanceCriteria?.paymentTerms?.length ?? 1) - 1;
      toast({
        title: isFinal ? 'All milestones complete!' : `Milestone ${milestoneIdx + 1} funds released`,
        description: isFinal ? 'The client will confirm final payment.' : 'Next milestone is now unlocked.',
      });
    } catch (err) {
      toast({ title: 'Release failed', description: err.message, variant: 'destructive' });
    } finally {
      setReleasing(null);
    }
  };

  const openSubmit = (boardJob, milestoneIdx) => {
    setSubmitCtx({ boardJob, milestoneIdx });
    setWorkDesc(''); setWorkLinks(''); setDelivFile(null);
    setShowSubmitDlg(true);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Active Contracts</h2>
        <p className="text-muted-foreground">Your accepted and in-progress jobs</p>
      </div>

      {activeItems.length === 0 ? (
        <EmptyState icon="milestone" title="No active contracts"
          description="Accept a job from the Find Jobs page to get started!" />
      ) : (
        <div className="grid gap-4">
          {activeItems.map(item => {
            const boardJob    = item._boardJob ?? (item._src.startsWith('board') ? item : null);
            const isChain     = item._src === 'chain' || item._src === 'chain_legacy';
            const itemId      = boardJob?.id ?? item.id;
            const title       = item.milestoneTitle ?? item.title ?? '—';
            const status      = item.status;
            const amount      = Number(item.amount ?? boardJob?.amount ?? 0);
            const deadline    = item.deadline;
            const meta        = item.acceptanceCriteria ?? boardJob?.acceptanceCriteria;
            const payTerms    = meta?.paymentTerms ?? [];
            const DeliverIcon = deliverableIcons[item.deliverableType ?? boardJob?.deliverableType] ?? FileText;
            const daysLeft    = deadline ? Math.ceil((new Date(deadline) - Date.now()) / 86400000) : null;

            // Board-level per-milestone data
            const mSubs    = boardJob?.milestoneSubmissions ?? {};
            const mVerifs  = boardJob?.milestoneVerifications ?? {};
            const released = boardJob?.releasedMilestones ?? [];
            const currentIdx = boardJob?.currentMilestoneIdx ?? 0;

            return (
              <div key={itemId} className="glass-card rounded-xl border border-border p-6 space-y-5">

                {/* ── Header ── */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <DeliverIcon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-foreground">{title}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">{item.description}</p>
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    {status === 'accepted'
                      ? <span className="text-xs font-semibold px-2.5 py-1 rounded-full border bg-amber-500/10 text-amber-500 border-amber-500/20">Awaiting Escrow</span>
                      : <StatusBadge status={status} />}
                  </div>
                </div>

                {/* ── Progress bar ── */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-medium">{getProgress(status)}%</span>
                  </div>
                  <Progress value={getProgress(status)} className="h-2" />
                </div>

                {/* ── Awaiting escrow funding notice ── */}
                {status === 'accepted' && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
                    <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Waiting for the client to fund the escrow. You can submit work once ETH is locked on-chain.
                    </p>
                  </div>
                )}

                {/* ── Payment milestone rows ── */}
                {payTerms.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Layers className="h-3 w-3" /> Payment Milestones
                    </p>

                    {payTerms.map((ms, idx) => {
                      // Keys & stored data
                      const key          = `${itemId}_${idx}`;
                      const sub          = mSubs[idx];
                      const boardVerif   = mVerifs[idx];
                      const liveVerif    = liveResults[key];
                      const verif        = liveVerif ?? boardVerif;
                      const isVerifying  = !!liveVerify[key];
                      const isReleased   = released.includes(idx);
                      const isCurrent    = idx === currentIdx;
                      const isFinal      = idx === payTerms.length - 1;

                      // The IPFS CID for this milestone — from board sub or chain item
                      const ipfsCID = sub?.ipfsCID ?? item.ipfsCID ?? null;

                      // What actions are available
                      const canSubmit    = isChain && status === 'funded' && isCurrent && !sub && !isReleased;
                      const verifyDone   = verif?.status === 'COMPLETED';
                      const verifyFailed = verif?.status === 'FAILED' || (verifyDone && !verif.isPassed);
                      const canReupload  = !isReleased && (verifyFailed || (!sub && isCurrent && isChain && status === 'funded'));
                      const isApproved   = verifyDone && verif.isPassed;

                      return (
                        <div key={idx} className={cn(
                          'rounded-lg border p-4 space-y-3 transition-colors',
                          isReleased
                            ? 'border-green-500/20 bg-green-500/5'
                            : isCurrent && isChain && status !== 'accepted'
                              ? 'border-primary/30 bg-primary/5'
                              : idx > currentIdx && !isReleased
                                ? 'border-border/50 bg-muted/10 opacity-60'
                                : 'border-border bg-muted/20'
                        )}>

                          {/* Milestone header */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="w-6 h-6 rounded-full bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center flex-shrink-0">{idx + 1}</span>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">{ms.name}</p>
                                {ms.description && <p className="text-xs text-muted-foreground truncate">{ms.description}</p>}
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-sm font-bold text-primary">{ms.percentage}%</p>
                              {amount > 0 && <p className="text-xs text-muted-foreground">{(amount * ms.percentage / 100).toFixed(4)} ETH</p>}
                            </div>
                          </div>

                          {/* Status row */}
                          <div className="flex flex-wrap items-center gap-2">
                            {isReleased && (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/10 text-green-600 border border-green-500/20">
                                <CheckCircle className="h-3 w-3" /> Released
                              </span>
                            )}
                            {!isReleased && ipfsCID && (
                              <a href={`https://gateway.pinata.cloud/ipfs/${ipfsCID}`}
                                target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                                <ExternalLink className="h-3 w-3" /> View Submission
                              </a>
                            )}
                            {!isReleased && (
                              <VerifPill v={verif} isRunning={isVerifying} />
                            )}
                            {idx > currentIdx && !isReleased && (
                              <span className="text-xs text-muted-foreground">🔒 Complete previous milestone first</span>
                            )}
                          </div>

                          {/* Verification details (collapsible) */}
                          {!isReleased && verif && <VerifDetails v={verif} />}

                          {/* ── Action buttons — always visible when relevant ── */}
                          <div className="flex flex-wrap gap-2 pt-1">

                            {/* Submit initial work */}
                            {canSubmit && !ipfsCID && (
                              <Button size="sm" onClick={() => openSubmit(boardJob, idx)}>
                                <Upload className="mr-2 h-4 w-4" /> Submit Work
                              </Button>
                            )}

                            {/* ── AI Verification button — shown whenever there's an IPFS CID ── */}
                            {ipfsCID && !isReleased && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={isVerifying}
                                onClick={() => runVerification(boardJob ?? { id: itemId, milestoneId: item.id, title, acceptanceCriteria: meta, deliverableType: item.deliverableType }, idx, ipfsCID)}
                              >
                                {isVerifying
                                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Verifying…</>
                                  : verifyDone
                                    ? <><RefreshCw className="mr-2 h-4 w-4" />Re-verify</>
                                    : <><Brain className="mr-2 h-4 w-4" />Run AI Verification</>}
                              </Button>
                            )}

                            {/* ── Re-upload button — shown when verification failed or rejected ── */}
                            {!isReleased && ipfsCID && verifyFailed && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
                                onClick={() => openSubmit(boardJob, idx)}
                              >
                                <Upload className="mr-2 h-4 w-4" /> Re-upload &amp; Resubmit
                              </Button>
                            )}

                            {/* No submission yet + no canSubmit (locked or not funded) */}
                            {!ipfsCID && !canSubmit && !isReleased && isCurrent && (
                              <span className="text-xs text-muted-foreground italic">
                                {status === 'accepted' ? 'Waiting for escrow funding' : 'Submit work to unlock verification'}
                              </span>
                            )}

                            {/* Get Funds — non-final milestone, AI approved */}
                            {isApproved && !isFinal && !isReleased && isChain && boardJob && (
                              <Button
                                size="sm"
                                className="bg-green-600 hover:bg-green-700 text-white gap-2"
                                disabled={releasing === key}
                                onClick={() => handleRelease(boardJob, idx)}
                              >
                                {releasing === key
                                  ? <><Loader2 className="h-4 w-4 animate-spin" />Releasing…</>
                                  : <><DollarSign className="h-4 w-4" />Get Funds</>}
                              </Button>
                            )}

                            {/* Final milestone approved — client must release */}
                            {isApproved && isFinal && !isReleased && isChain && (
                              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Clock className="h-3.5 w-3.5" />
                                AI approved — awaiting client to release final payment
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* No payment terms — simple meta row for legacy chain items */
                  <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                    {amount > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Wallet className="h-4 w-4 text-primary" />
                        <span className="font-semibold text-foreground">{amount.toFixed(4)} ETH</span>
                      </div>
                    )}
                    {daysLeft != null && (
                      <div className={cn("flex items-center gap-1.5", daysLeft < 0 ? "text-destructive" : daysLeft <= 3 ? "text-amber-500" : "")}>
                        <Clock className="h-4 w-4" />
                        <span>{daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d remaining`}</span>
                      </div>
                    )}
                    {item.ipfsCID && (
                      <a href={`https://gateway.pinata.cloud/ipfs/${item.ipfsCID}`}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-primary hover:underline">
                        <ExternalLink className="h-4 w-4" /> View Submission
                      </a>
                    )}
                  </div>
                )}

                {/* ── Card-level AI Verify button ──────────────────────────────── */}
                {/* Shown when there are no payment terms, OR as a fallback for any    */}
                {/* submitted job where the milestone row might not have the button.   */}
                {(() => {
                  const anyIpfs = item.ipfsCID ?? Object.values(boardJob?.milestoneSubmissions ?? {}).find(s => s?.ipfsCID)?.ipfsCID ?? null;
                  const hasSubmission = !!anyIpfs || status === 'submitted';
                  if (!hasSubmission || status === 'released') return null;
                  if (payTerms.length > 0 && boardJob) return null; // already shown in milestone rows
                  const cardKey = `${itemId}_0`;
                  const cardVerif  = liveResults[cardKey] ?? boardJob?.milestoneVerifications?.[0] ?? null;
                  const isRunning  = !!liveVerify[cardKey];
                  const verifyDone = cardVerif?.status === 'COMPLETED';
                  const fallbackJob = boardJob ?? { id: itemId, milestoneId: item.id, title, acceptanceCriteria: meta, deliverableType: item.deliverableType };
                  return (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {anyIpfs && (
                        <a href={`https://gateway.pinata.cloud/ipfs/${anyIpfs}`}
                          target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          <ExternalLink className="h-3 w-3" />View Submission
                        </a>
                      )}
                      <Button variant="outline" size="sm"
                        disabled={isRunning}
                        onClick={() => runVerification(fallbackJob, 0, anyIpfs)}>
                        {isRunning
                          ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Verifying…</>
                          : verifyDone
                            ? <><RefreshCw className="mr-2 h-4 w-4" />Re-verify</>
                            : <><Brain className="mr-2 h-4 w-4" />Run AI Verification</>}
                      </Button>
                      {cardVerif && <VerifPill v={cardVerif} isRunning={isRunning} />}
                    </div>
                  );
                })()}

                {/* Status badges for legacy no-board items */}
                {!boardJob && (
                  <div className="flex gap-2 flex-wrap">
                    {status === 'submitted' && <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary"><Clock className="mr-1 h-3 w-3" />Submitted — Awaiting Verification</Badge>}
                    {status === 'verified'  && <Badge variant="outline" className="border-green-500/30 bg-green-500/10 text-green-600"><CheckCircle className="mr-1 h-3 w-3" />Verified — Awaiting Release</Badge>}
                    {status === 'released'  && <Badge variant="outline" className="border-green-500/30 bg-green-500/10 text-green-600"><CheckCircle className="mr-1 h-3 w-3" />Payment Released ✓</Badge>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Submit / Re-upload dialog ── */}
      <Dialog open={showSubmitDlg} onOpenChange={setShowSubmitDlg}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {submitCtx && (() => {
                const term = submitCtx.boardJob?.acceptanceCriteria?.paymentTerms?.[submitCtx.milestoneIdx];
                const isResubmit = !!submitCtx.boardJob?.milestoneSubmissions?.[submitCtx.milestoneIdx];
                return isResubmit
                  ? `Re-upload — Milestone ${submitCtx.milestoneIdx + 1}`
                  : `Submit Work — Milestone ${submitCtx.milestoneIdx + 1}`;
              })()}
            </DialogTitle>
            <DialogDescription>
              {submitCtx && (() => {
                const term = submitCtx.boardJob?.acceptanceCriteria?.paymentTerms?.[submitCtx.milestoneIdx];
                return term ? `"${term.name}" — upload your revised deliverable for AI re-verification.` : 'Upload your deliverable for AI verification.';
              })()}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* File upload */}
            <div>
              <Label>Deliverable File <span className="text-muted-foreground text-xs">(recommended)</span></Label>
              {!delivFile ? (
                <div onClick={() => fileRef.current?.click()}
                  className="mt-2 flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 p-6 cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-colors">
                  <FileUp className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Click to attach deliverable</p>
                  <p className="text-xs text-muted-foreground">.py, .js, .zip, .pdf — any file</p>
                  <input ref={fileRef} type="file" onChange={e => setDelivFile(e.target.files?.[0] ?? null)} className="hidden" />
                </div>
              ) : (
                <div className="mt-2 flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
                  <FileUp className="h-5 w-5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{delivFile.name}</p>
                    <p className="text-xs text-muted-foreground">{(delivFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button type="button" onClick={() => setDelivFile(null)} className="text-muted-foreground hover:text-destructive">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <Label htmlFor="wdesc">Work Notes {!delivFile && <span className="text-destructive">*</span>}</Label>
              <Textarea id="wdesc" placeholder="Describe what you completed and any changes from previous submission…"
                value={workDesc} onChange={e => setWorkDesc(e.target.value)} rows={4} className="mt-2" />
            </div>

            {/* Links */}
            <div>
              <Label htmlFor="wlinks">Links</Label>
              <Input id="wlinks" placeholder="https://github.com/…" value={workLinks} onChange={e => setWorkLinks(e.target.value)} className="mt-2" />
            </div>

            {/* Requirements checklist */}
            {submitCtx?.boardJob?.acceptanceCriteria?.requirements?.length > 0 && (
              <div className="rounded-lg border border-border bg-muted/50 p-4">
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2"><CheckCircle className="h-4 w-4 text-primary" />Requirements</h4>
                <ul className="space-y-1.5">
                  {submitCtx.boardJob.acceptanceCriteria.requirements.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <CheckCircle className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />{r}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/20 p-3">
              <Brain className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                AI verification runs automatically after submission. You can collect milestone funds once it passes.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubmitDlg(false)} disabled={isSubmitting}>Cancel</Button>
            <Button onClick={handleSubmitWork} disabled={isSubmitting || (!workDesc.trim() && !delivFile)}>
              {isSubmitting
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Uploading to IPFS…</>
                : <><Upload className="mr-2 h-4 w-4" />Submit &amp; Verify</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
