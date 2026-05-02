'use client';
import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { TransactionModal } from '@/components/transaction-modal';
import { useContracts } from '@/contexts/contract-context';
import { useWallet } from '@/contexts/wallet-context';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import {
  Code, FileText, Palette, Calendar, Wallet, Upload, X, FileCheck,
  Loader2, Plus, Trash2, AlertCircle, CheckCircle2, Layers,
} from 'lucide-react';

// ── Default milestone payment terms ─────────────────────────────────────────
const defaultMilestoneTerms = [
  { id: 1, name: 'Initial Deliverable', percentage: 50, description: '' },
  { id: 2, name: 'Final Deliverable',   percentage: 50, description: '' },
];

export function PostMilestone() {
  const { createMilestone, uploadToIPFS } = useContracts();
  const {
    walletAddress, isConnected, isCorrectNetwork,
    connectWallet, switchToSepolia, isConnecting,
  } = useWallet();
  const { toast } = useToast();

  const [showTxModal, setShowTxModal]         = useState(false);
  const [srsFile, setSrsFile]                 = useState(null);
  const [srsUpload, setSrsUpload]             = useState(null);
  const [isUploadingSrs, setIsUploadingSrs]   = useState(false);
  const fileInputRef = useRef(null);

  // ── Job payment milestones ────────────────────────────────────────────────
  const [milestoneTerms, setMilestoneTerms] = useState(defaultMilestoneTerms);
  const [nextId, setNextId] = useState(3);

  const totalPct = milestoneTerms.reduce((s, m) => s + m.percentage, 0);
  const pctValid = totalPct === 100;

  const addMilestoneTerm = () => {
    if (milestoneTerms.length >= 10) return;
    const remaining = Math.max(1, 100 - totalPct);
    setMilestoneTerms(prev => [
      ...prev,
      { id: nextId, name: `Milestone ${nextId}`, percentage: remaining, description: '' },
    ]);
    setNextId(n => n + 1);
  };

  const removeMilestoneTerm = (id) => {
    if (milestoneTerms.length <= 1) return;
    setMilestoneTerms(prev => prev.filter(m => m.id !== id));
  };

  const updateMilestoneTerm = (id, field, value) => {
    setMilestoneTerms(prev => prev.map(m =>
      m.id === id ? { ...m, [field]: value } : m
    ));
  };

  const [formData, setFormData] = useState({
    title:              '',
    description:        '',
    amount:             '',
    deadline:           '',
    deliverableType:    'code',
    acceptanceCriteria: '{\n  "requirements": [\n    "Unit tests passing",\n    "Code documentation"\n  ]\n}',
    testPassRate:       90,
  });

  // ── SRS upload ─────────────────────────────────────────────────────────────
  const handleSrsFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const extOk = /\.(md|pdf|txt)$/i.test(file.name);
    if (!extOk) {
      toast({ title: 'Invalid file type', description: 'SRS must be a .md, .pdf, or .txt file.', variant: 'destructive' });
      return;
    }
    setSrsFile(file);
    setSrsUpload(null);
    setIsUploadingSrs(true);
    try {
      const result = await uploadToIPFS(file);
      setSrsUpload(result);
      toast({ title: 'SRS uploaded to IPFS', description: `CID: ${result.cid.slice(0, 20)}…` });
    } catch (err) {
      setSrsFile(null);
      toast({ title: 'SRS upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsUploadingSrs(false);
    }
  };

  const removeSrsFile = () => {
    setSrsFile(null);
    setSrsUpload(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Form submit ────────────────────────────────────────────────────────────
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isConnected) {
      toast({ title: 'Wallet not connected', description: 'Please connect your MetaMask wallet first.', variant: 'destructive' });
      return;
    }
    if (!isCorrectNetwork) {
      toast({ title: 'Wrong network', description: 'Please switch to Sepolia testnet.', variant: 'destructive' });
      return;
    }
    if (!formData.title || !formData.amount || !formData.deadline) {
      toast({ title: 'Validation Error', description: 'Please fill in all required fields.', variant: 'destructive' });
      return;
    }
    if (!pctValid) {
      toast({ title: 'Payment Terms Error', description: `Milestone percentages must add up to exactly 100% (currently ${totalPct}%).`, variant: 'destructive' });
      return;
    }
    if (isUploadingSrs) {
      toast({ title: 'Please wait', description: 'SRS document is still uploading…', variant: 'destructive' });
      return;
    }
    setShowTxModal(true);
  };

  const handleConfirmTransaction = async () => {
    let requirements = [];
    try { requirements = JSON.parse(formData.acceptanceCriteria).requirements || []; } catch { /* ignore */ }

    // Freelancer address is blank — auto-filled when a freelancer accepts the job.
    const PLACEHOLDER_FREELANCER = '0x0000000000000000000000000000000000000001';

    const result = await createMilestone({
      freelancerAddress: PLACEHOLDER_FREELANCER,
      clientAddress:     walletAddress || '',
      milestoneTitle:    formData.title,
      description:       formData.description,
      amount:            parseFloat(formData.amount),
      deliverableType:   formData.deliverableType,
      deadline:          new Date(formData.deadline),
      acceptanceCriteria: {
        testPassRate:   formData.testPassRate,
        requirements,
        srsCID:         srsUpload?.cid         ?? null,
        srsContentHash: srsUpload?.contentHash  ?? null,
        paymentTerms:   milestoneTerms.map(({ id: _id, ...rest }) => rest),
      },
    });

    if (result.success) {
      toast({
        title:       'Job Posted Successfully',
        description: `Job #${result.milestoneId} is live with ${milestoneTerms.length} payment milestone${milestoneTerms.length > 1 ? 's' : ''}${srsUpload ? ' — SRS pinned to IPFS' : ''}.`,
      });
      setFormData({
        title: '', description: '', amount: '', deadline: '',
        deliverableType: 'code',
        acceptanceCriteria: '{\n  "requirements": [\n    "Unit tests passing",\n    "Code documentation"\n  ]\n}',
        testPassRate: 90,
      });
      setMilestoneTerms(defaultMilestoneTerms);
      setNextId(3);
      setSrsFile(null);
      setSrsUpload(null);
    }
    return result;
  };

  const deliverableIcons = { code: Code, document: FileText, design: Palette };
  const DeliverableIcon  = deliverableIcons[formData.deliverableType];
  const totalEth         = formData.amount ? parseFloat(formData.amount) : 0;
  const escrowFee        = totalEth * 0.02;
  const grandTotal       = totalEth + escrowFee;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Post New Job</h1>
        <p className="text-muted-foreground">
          Define the job, set custom payment milestones, and fund the escrow.
          A freelancer will accept the job from the marketplace — their wallet is linked automatically.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* ── Form ── */}
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Job Details card */}
          <div className="glass-card rounded-xl border border-border p-6 space-y-6">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> Job Details
            </h2>

            <div className="space-y-2">
              <Label htmlFor="title" className="text-accent">Job Title *</Label>
              <Input id="title" placeholder="e.g., Smart Contract Development"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="bg-muted/50 border-border focus:border-primary" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-accent">Description</Label>
              <Textarea id="description" placeholder="Describe the work to be completed…" rows={3}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="bg-muted/50 border-border focus:border-primary resize-none" />
            </div>

            {/* SRS upload */}
            <div className="space-y-2">
              <Label className="text-accent">
                SRS / Specification Document
                <span className="ml-1 text-xs text-muted-foreground font-normal">(optional — .md, .pdf, .txt)</span>
              </Label>
              {!srsFile ? (
                <div onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 p-6 cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-colors">
                  <Upload className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Click to upload SRS</p>
                  <input ref={fileInputRef} type="file" accept=".md,.pdf,.txt"
                    onChange={handleSrsFileChange} className="hidden" />
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
                  {isUploadingSrs
                    ? <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                    : <FileCheck className="h-5 w-5 text-primary shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{srsFile.name}</p>
                    {isUploadingSrs && <p className="text-xs text-muted-foreground">Uploading to IPFS…</p>}
                    {srsUpload && <p className="text-xs text-muted-foreground font-mono truncate">CID: {srsUpload.cid}</p>}
                  </div>
                  {!isUploadingSrs && (
                    <button type="button" onClick={removeSrsFile}
                      className="text-muted-foreground hover:text-destructive transition-colors">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="amount" className="text-accent">Total Budget (ETH) *</Label>
                <div className="relative">
                  <Input id="amount" type="number" step="0.0001" min="0" placeholder="0.0000"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    className="bg-muted/50 border-border focus:border-primary pl-10" />
                  <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="deadline" className="text-accent">Final Deadline *</Label>
                <div className="relative">
                  <Input id="deadline" type="date"
                    value={formData.deadline}
                    onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                    className="bg-muted/50 border-border focus:border-primary pl-10" />
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="deliverableType" className="text-accent">Deliverable Type</Label>
              <Select value={formData.deliverableType}
                onValueChange={(v) => setFormData({ ...formData, deliverableType: v })}>
                <SelectTrigger className="bg-muted/50 border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="glass-card border-border">
                  <SelectItem value="code">Code</SelectItem>
                  <SelectItem value="document">Document</SelectItem>
                  <SelectItem value="design">Design</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="criteria" className="text-accent">Acceptance Criteria (JSON)</Label>
              <Textarea id="criteria" rows={5}
                value={formData.acceptanceCriteria}
                onChange={(e) => setFormData({ ...formData, acceptanceCriteria: e.target.value })}
                className="bg-muted/50 border-border focus:border-primary resize-none font-mono text-sm" />
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-accent">Required Test Pass Rate</Label>
                <span className="text-sm font-medium text-foreground">{formData.testPassRate}%</span>
              </div>
              <Slider value={[formData.testPassRate]}
                onValueChange={(v) => setFormData({ ...formData, testPassRate: v[0] })}
                max={100} min={0} step={5} className="w-full" />
            </div>
          </div>

          {/* Payment Milestones card */}
          <div className="glass-card rounded-xl border border-border p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" /> Payment Milestones
              </h2>
              <div className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full transition-colors ${
                pctValid
                  ? 'bg-green-500/10 text-green-500'
                  : 'bg-amber-500/10 text-amber-500'
              }`}>
                {pctValid
                  ? <><CheckCircle2 className="h-3 w-3" />100%</>
                  : <><AlertCircle className="h-3 w-3" />{totalPct}% / 100%</>}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Split the total budget across payment milestones. Each milestone's funds unlock only after
              the corresponding deliverable is verified by the AI oracle.
            </p>

            <div className="space-y-3">
              {milestoneTerms.map((ms, idx) => {
                const ethShare = totalEth > 0 ? (totalEth * ms.percentage / 100) : 0;
                return (
                  <div key={ms.id} className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                        {idx + 1}
                      </span>
                      <Input
                        value={ms.name}
                        onChange={(e) => updateMilestoneTerm(ms.id, 'name', e.target.value)}
                        placeholder={`Milestone ${idx + 1} name`}
                        className="bg-muted/50 border-border focus:border-primary h-8 text-sm flex-1" />
                      {milestoneTerms.length > 1 && (
                        <button type="button" onClick={() => removeMilestoneTerm(ms.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    <Input
                      value={ms.description}
                      onChange={(e) => updateMilestoneTerm(ms.id, 'description', e.target.value)}
                      placeholder="Brief description of this deliverable (optional)"
                      className="bg-muted/50 border-border focus:border-primary h-8 text-sm" />

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Budget share</span>
                        <span className="font-semibold text-foreground">
                          {ms.percentage}%
                          {totalEth > 0 && (
                            <span className="ml-1 text-muted-foreground font-normal">
                              ({ethShare.toFixed(4)} ETH)
                            </span>
                          )}
                        </span>
                      </div>
                      <Slider
                        value={[ms.percentage]}
                        onValueChange={([v]) => updateMilestoneTerm(ms.id, 'percentage', v)}
                        min={1} max={100} step={1} className="w-full" />
                    </div>
                  </div>
                );
              })}
            </div>

            {milestoneTerms.length < 10 && (
              <button type="button" onClick={addMilestoneTerm}
                className="w-full flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-3 text-sm text-muted-foreground hover:border-primary/60 hover:text-primary hover:bg-primary/5 transition-colors">
                <Plus className="h-4 w-4" /> Add Payment Milestone
              </button>
            )}

            {!pctValid && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
                <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Percentages must add up to exactly 100%.
                  Currently {totalPct}% — {totalPct < 100
                    ? `add ${100 - totalPct}% more`
                    : `reduce by ${totalPct - 100}%`}.
                </p>
              </div>
            )}
          </div>

          {/* Freelancer notice */}
          <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Wallet className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No freelancer address required</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                This job will be listed on the freelancer marketplace. When a freelancer accepts it,
                their wallet address is automatically linked to the escrow contract.
              </p>
            </div>
          </div>

          {/* Wallet connection guard */}
          {!isConnected ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Wallet not connected</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    You need to connect MetaMask to post a job and fund the escrow.
                  </p>
                </div>
              </div>
              <Button type="button" onClick={() => connectWallet()} disabled={isConnecting}
                className="w-full bg-amber-500 hover:bg-amber-600 text-white h-10">
                {isConnecting
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Connecting…</>
                  : <><Wallet className="mr-2 h-4 w-4" />Connect MetaMask</>}
              </Button>
            </div>
          ) : !isCorrectNetwork ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Wrong network</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    The escrow contract is deployed on Sepolia testnet. Please switch networks.
                  </p>
                </div>
              </div>
              <Button type="button" onClick={switchToSepolia}
                className="w-full bg-amber-500 hover:bg-amber-600 text-white h-10">
                Switch to Sepolia
              </Button>
            </div>
          ) : (
            <Button type="submit" disabled={isUploadingSrs || !pctValid}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-12 text-lg">
              {isUploadingSrs
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Uploading SRS…</>
                : 'Post Job & Fund Escrow'}
            </Button>
          )}
        </form>

        {/* ── Preview ── */}
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-foreground">Job Preview</h2>

          <div className="glass-card rounded-xl border border-border p-6 space-y-6">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0 pr-4">
                <h3 className="text-xl font-bold text-foreground mb-1">{formData.title || 'Job Title'}</h3>
                <p className="text-sm text-muted-foreground">{formData.description || 'No description provided'}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <DeliverableIcon className="h-6 w-6 text-primary" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="glass rounded-lg p-4">
                <p className="text-xs text-muted-foreground mb-1">Total Budget</p>
                <p className="text-lg font-bold text-foreground">
                  {totalEth > 0 ? `${totalEth.toFixed(4)} ETH` : '-- ETH'}
                </p>
              </div>
              <div className="glass rounded-lg p-4">
                <p className="text-xs text-muted-foreground mb-1">Final Deadline</p>
                <p className="text-lg font-bold text-foreground">
                  {formData.deadline ? format(new Date(formData.deadline), 'dd MMM yyyy') : '-- --- ----'}
                </p>
              </div>
            </div>

            {/* Freelancer placeholder */}
            <div className="glass rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-2">Assigned Freelancer</p>
              <p className="text-sm text-muted-foreground italic">
                Pending — auto-assigned when a freelancer accepts this job
              </p>
            </div>

            {/* Payment schedule */}
            <div className="glass rounded-lg p-4 space-y-3">
              <p className="text-xs text-muted-foreground mb-1">
                Payment Schedule ({milestoneTerms.length} milestone{milestoneTerms.length > 1 ? 's' : ''})
              </p>
              <div className="space-y-3">
                {milestoneTerms.map((ms, idx) => {
                  const ethShare = totalEth > 0 ? (totalEth * ms.percentage / 100) : 0;
                  return (
                    <div key={ms.id} className="flex items-start gap-3">
                      <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-xs font-medium text-foreground truncate">
                            {ms.name || `Milestone ${idx + 1}`}
                          </span>
                          <span className="text-xs font-bold text-primary flex-shrink-0">{ms.percentage}%</span>
                        </div>
                        <div className="bg-muted rounded-full h-1.5 mb-1">
                          <div className="bg-primary rounded-full h-1.5 transition-all duration-300"
                            style={{ width: `${ms.percentage}%` }} />
                        </div>
                        {totalEth > 0 && (
                          <p className="text-[10px] text-muted-foreground">{ethShare.toFixed(4)} ETH</p>
                        )}
                        {ms.description && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{ms.description}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {!pctValid && (
                <p className="text-[11px] text-amber-500 flex items-center gap-1 mt-1">
                  <AlertCircle className="h-3 w-3" /> Must total 100% ({totalPct}% currently)
                </p>
              )}
            </div>

            {srsUpload && (
              <div className="glass rounded-lg p-4">
                <p className="text-xs text-muted-foreground mb-2">SRS on IPFS</p>
                <a href={`https://gateway.pinata.cloud/ipfs/${srsUpload.cid}`}
                  target="_blank" rel="noopener noreferrer"
                  className="font-mono text-xs text-primary hover:underline break-all">
                  {srsUpload.cid}
                </a>
              </div>
            )}

            <div className="glass rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-2">Quality Requirements</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-muted rounded-full h-2">
                  <div className="bg-primary rounded-full h-2 transition-all duration-300"
                    style={{ width: `${formData.testPassRate}%` }} />
                </div>
                <span className="text-sm font-medium text-foreground">{formData.testPassRate}% pass rate</span>
              </div>
            </div>

            <div className="pt-4 border-t border-border space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Budget ({milestoneTerms.length} milestones)</span>
                <span className="text-foreground">{totalEth > 0 ? `${totalEth.toFixed(4)} ETH` : '-- ETH'}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Escrow Fee (2%)</span>
                <span className="text-foreground">{totalEth > 0 ? `${escrowFee.toFixed(4)} ETH` : '-- ETH'}</span>
              </div>
              <div className="flex items-center justify-between text-sm pt-2 border-t border-border/50">
                <span className="text-muted-foreground font-medium">Total to Fund</span>
                <span className="text-lg font-bold text-primary">
                  {grandTotal > 0 ? `${grandTotal.toFixed(4)} ETH` : '-- ETH'}
                </span>
              </div>
            </div>
          </div>

          {/* Where are funds stored card */}
          <div className="glass-card rounded-xl border border-border p-5 space-y-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Where are funds stored?
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Your ETH is locked inside the{' '}
              <span className="text-foreground font-medium">EscrowContract</span>{' '}
              smart contract on Sepolia testnet. No third party or external wallet holds your funds —
              the contract itself is the non-custodial escrow vault. Funds are only released when
              an AI-verified deliverable is approved, or refunded to you if the deadline passes
              without submission.
            </p>
            <a
              href="https://sepolia.etherscan.io/address/0xb5aF1CAC332013DeF97d6863FC12ED104CB94b13"
              target="_blank" rel="noopener noreferrer"
              className="text-xs text-primary hover:underline font-mono break-all">
              EscrowContract: 0xb5aF1CAC332013DeF97d6863FC12ED104CB94b13 ↗
            </a>
          </div>
        </div>
      </div>

      <TransactionModal
        open={showTxModal}
        onOpenChange={setShowTxModal}
        action="Post Job & Fund Escrow"
        amount={grandTotal > 0 ? grandTotal : undefined}
        onConfirm={handleConfirmTransaction}
      />
    </div>
  );
}
