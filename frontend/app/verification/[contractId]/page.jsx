'use client';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/navbar';
import { StatusBadge } from '@/components/status-badge';
import { useContracts } from '@/contexts/contract-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, CheckCircle, XCircle, AlertTriangle, FileCode, ExternalLink, Shield, Clock, Hash, Activity, ChevronRight, } from 'lucide-react';
import { format } from 'date-fns';
export default function VerificationPage({ params }) {
    const { contractId } = use(params);
    const router = useRouter();
    const { contracts, verificationResults } = useContracts();
    const contract = contracts.find(c => c.id === contractId);
    const result = verificationResults[contractId];
    if (!contract) {
        return (<div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex flex-col items-center justify-center pt-32 px-4">
          <div className="glass-card rounded-2xl p-12 text-center max-w-md border border-border">
            <AlertTriangle className="h-12 w-12 text-[#F59E0B] mx-auto mb-4"/>
            <h2 className="text-xl font-bold text-foreground mb-2">Contract Not Found</h2>
            <p className="text-muted-foreground mb-6">
              No contract found with ID: <span className="font-mono text-sm">{contractId}</span>
            </p>
            <Button onClick={() => router.back()}>
              <ArrowLeft className="mr-2 h-4 w-4"/>
              Go Back
            </Button>
          </div>
        </div>
      </div>);
    }
    const verdictColor = result?.verdict === 'approved'
        ? 'text-[#10B981]'
        : result?.verdict === 'rejected'
            ? 'text-[#EF4444]'
            : 'text-[#F59E0B]';
    const verdictBg = result?.verdict === 'approved'
        ? 'bg-[#10B981]/10 border-[#10B981]/30'
        : result?.verdict === 'rejected'
            ? 'bg-[#EF4444]/10 border-[#EF4444]/30'
            : 'bg-[#F59E0B]/10 border-[#F59E0B]/30';
    return (<div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16">
        {/* Back Button */}
        <Button variant="ghost" size="sm" className="mb-6 text-muted-foreground hover:text-foreground" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4"/>
          Back
        </Button>

        {/* Header */}
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
                  <span className="font-mono text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded">
                    {contract.id}
                  </span>
                  <Badge variant="outline" className="capitalize">
                    {contract.deliverableType}
                  </Badge>
                </div>
              </div>
            </div>
            <StatusBadge status={contract.status}/>
          </div>

          {/* Contract Details */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-border">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Amount</p>
              <p className="font-semibold text-foreground">{contract.amount.toFixed(4)} ETH</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Deadline</p>
              <p className="font-semibold text-foreground">
                {format(new Date(contract.deadline), 'dd MMM yyyy')}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Client</p>
              <p className="font-mono text-xs text-foreground">
                {contract.clientAddress.slice(0, 6)}...{contract.clientAddress.slice(-4)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Freelancer</p>
              <p className="font-mono text-xs text-foreground">
                {contract.freelancerAddress.slice(0, 6)}...{contract.freelancerAddress.slice(-4)}
              </p>
            </div>
          </div>
        </div>

        {/* Verification Result */}
        {result ? (<>
            {/* Verdict Banner */}
            <div className={`rounded-2xl border p-6 mb-6 ${verdictBg}`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  {result.verdict === 'approved' ? (<CheckCircle className="h-10 w-10 text-[#10B981] shrink-0"/>) : result.verdict === 'rejected' ? (<XCircle className="h-10 w-10 text-[#EF4444] shrink-0"/>) : (<AlertTriangle className="h-10 w-10 text-[#F59E0B] shrink-0"/>)}
                  <div>
                    <p className="text-sm text-muted-foreground">AI Verification Verdict</p>
                    <p className={`text-2xl font-bold capitalize ${verdictColor}`}>
                      {result.verdict}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Submitted {format(new Date(result.submissionTimestamp), 'dd MMM yyyy, HH:mm')}
                    </p>
                  </div>
                </div>
                <div className="text-center sm:text-right">
                  <p className="text-sm text-muted-foreground">Overall Score</p>
                  <p className={`text-5xl font-bold ${verdictColor}`}>{result.overallScore}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Confidence: {result.confidenceInterval[0]}–{result.confidenceInterval[1]}
                  </p>
                </div>
              </div>
            </div>

            {/* Score Breakdown */}
            <div className="glass-card rounded-2xl border border-border p-6 mb-6">
              <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary"/>
                Score Breakdown
              </h2>
              <div className="space-y-4">
                {Object.entries(result.breakdown).map(([key, value]) => (<div key={key}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm text-muted-foreground capitalize">
                        {key.replace(/([A-Z])/g, ' $1').trim()}
                      </span>
                      <span className={`text-sm font-semibold ${value >= 85 ? 'text-[#10B981]' :
                    value >= 65 ? 'text-[#F59E0B]' : 'text-[#EF4444]'}`}>
                        {value}%
                      </span>
                    </div>
                    <Progress value={value} className="h-2"/>
                  </div>))}
              </div>
            </div>

            {/* Passed / Failed Tests */}
            <div className="grid md:grid-cols-2 gap-6 mb-6">
              {/* Passed Tests */}
              <div className="glass-card rounded-2xl border border-border p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-[#10B981]"/>
                  Passed Tests ({result.passedTests.length})
                </h2>
                <div className="space-y-2">
                  {result.passedTests.map((test, i) => (<div key={i} className="flex items-start gap-2 text-sm">
                      <CheckCircle className="h-4 w-4 text-[#10B981] mt-0.5 shrink-0"/>
                      <span className="text-foreground">{test}</span>
                    </div>))}
                </div>
              </div>

              {/* Failed Tests */}
              <div className="glass-card rounded-2xl border border-border p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-[#EF4444]"/>
                  Failed Tests ({result.failedTests.length})
                </h2>
                {result.failedTests.length === 0 ? (<p className="text-sm text-muted-foreground">All tests passed.</p>) : (<div className="space-y-2">
                    {result.failedTests.map((test, i) => (<div key={i} className="flex items-start gap-2 text-sm">
                        <XCircle className="h-4 w-4 text-[#EF4444] mt-0.5 shrink-0"/>
                        <span className="text-foreground">{test}</span>
                      </div>))}
                  </div>)}

                {result.missingRequirements.length > 0 && (<div className="mt-4 pt-4 border-t border-border">
                    <p className="text-sm font-medium text-muted-foreground mb-2">Missing Requirements</p>
                    <div className="space-y-2">
                      {result.missingRequirements.map((req, i) => (<div key={i} className="flex items-start gap-2 text-sm">
                          <AlertTriangle className="h-4 w-4 text-[#F59E0B] mt-0.5 shrink-0"/>
                          <span className="text-foreground">{req}</span>
                        </div>))}
                    </div>
                  </div>)}
              </div>
            </div>

            {/* On-Chain Proof */}
            <div className="glass-card rounded-2xl border border-border p-6 mb-6">
              <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary"/>
                On-Chain Proof
              </h2>
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Hash className="h-4 w-4 text-muted-foreground shrink-0"/>
                    <span className="text-sm text-muted-foreground">File Hash</span>
                  </div>
                  <span className="font-mono text-xs text-foreground break-all">
                    {result.fileHash}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-muted-foreground shrink-0"/>
                    <span className="text-sm text-muted-foreground">Oracle Signature</span>
                  </div>
                  <span className="font-mono text-xs text-foreground break-all">
                    {result.oracleSignature}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground shrink-0"/>
                    <span className="text-sm text-muted-foreground">IPFS Link</span>
                  </div>
                  <a href={`https://ipfs.io/ipfs/${result.ipfsLink.replace('ipfs://', '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-mono text-xs text-primary hover:underline break-all">
                    {result.ipfsLink}
                    <ExternalLink className="h-3 w-3 shrink-0"/>
                  </a>
                </div>
              </div>
            </div>
          </>) : (
        /* No verification result yet */
        <div className="glass-card rounded-2xl border border-border p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
              <Clock className="h-8 w-8 text-muted-foreground"/>
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Awaiting Verification</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Work has not been submitted yet or is currently being verified by the AI oracle.
            </p>
          </div>)}

        {/* Acceptance Criteria */}
        <div className="glass-card rounded-2xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-primary"/>
            Acceptance Criteria
          </h2>
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-muted-foreground">Required Test Pass Rate</span>
            <span className="font-semibold text-foreground">{contract.acceptanceCriteria.testPassRate}%</span>
          </div>
          <div className="space-y-2">
            {contract.acceptanceCriteria.requirements.map((req, i) => (<div key={i} className="flex items-center gap-2 text-sm">
                <ChevronRight className="h-4 w-4 text-primary shrink-0"/>
                <span className="text-foreground">{req}</span>
              </div>))}
          </div>
        </div>
      </main>
    </div>);
}
