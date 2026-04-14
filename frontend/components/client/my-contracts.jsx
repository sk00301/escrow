'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { EmptyState } from '@/components/empty-state';
import { useContracts } from '@/contexts/contract-context';
import { ChevronDown, ChevronUp, Code, FileText, Palette, Calendar, Eye } from 'lucide-react';
import { format } from 'date-fns';
import Link from 'next/link';
import { cn } from '@/lib/utils';
export function MyContracts() {
    const { contracts } = useContracts();
    const [filter, setFilter] = useState('all');
    const [expandedId, setExpandedId] = useState(null);
    const filteredContracts = filter === 'all'
        ? contracts
        : contracts.filter(c => c.status === filter);
    const truncateAddress = (address) => {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    };
    const deliverableIcons = {
        code: Code,
        document: FileText,
        design: Palette
    };
    const statusFilters = [
        { value: 'all', label: 'All' },
        { value: 'funded', label: 'Funded' },
        { value: 'submitted', label: 'Submitted' },
        { value: 'verified', label: 'Verified' },
        { value: 'disputed', label: 'Disputed' },
        { value: 'released', label: 'Released' },
    ];
    return (<div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2">My Contracts</h1>
        <p className="text-muted-foreground">View and manage all your contracts</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {statusFilters.map((status) => (<Button key={status.value} variant="outline" size="sm" className={cn('border-border', filter === status.value
                ? 'bg-primary/10 text-primary border-primary/30'
                : 'bg-muted/30 hover:bg-muted/50')} onClick={() => setFilter(status.value)}>
            {status.label}
            {status.value !== 'all' && (<span className="ml-2 text-xs text-muted-foreground">
                ({contracts.filter(c => c.status === status.value).length})
              </span>)}
          </Button>))}
      </div>

      {/* Contract List */}
      {filteredContracts.length === 0 ? (<EmptyState icon="contract" title="No contracts found" description="You don't have any contracts matching this filter yet."/>) : (<div className="space-y-4">
          {filteredContracts.map((contract) => {
                const DeliverableIcon = deliverableIcons[contract.deliverableType];
                const isExpanded = expandedId === contract.id;
                return (<div key={contract.id} className="glass-card rounded-xl border border-border overflow-hidden">
                {/* Contract Header */}
                <div className="p-6 cursor-pointer hover:bg-muted/20 transition-colors" onClick={() => setExpandedId(isExpanded ? null : contract.id)}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                        <DeliverableIcon className="h-6 w-6 text-primary"/>
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">
                          {contract.milestoneTitle}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {truncateAddress(contract.freelancerAddress)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="text-right hidden sm:block">
                        <p className="font-semibold text-foreground">
                          {contract.amount.toFixed(4)} ETH
                        </p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                          <Calendar className="h-3 w-3"/>
                          {format(new Date(contract.deadline), 'dd MMM yyyy')}
                        </p>
                      </div>
                      <StatusBadge status={contract.status}/>
                      <Button variant="ghost" size="icon">
                        {isExpanded ? (<ChevronUp className="h-5 w-5 text-muted-foreground"/>) : (<ChevronDown className="h-5 w-5 text-muted-foreground"/>)}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (<div className="px-6 pb-6 border-t border-border pt-6 animate-fade-in">
                    <div className="grid md:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Description</p>
                          <p className="text-sm text-foreground">{contract.description}</p>
                        </div>

                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Freelancer Address</p>
                          <p className="text-sm font-mono text-foreground">
                            {contract.freelancerAddress}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Created</p>
                          <p className="text-sm text-foreground">
                            {format(new Date(contract.createdAt), 'dd MMM yyyy HH:mm')}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <p className="text-xs text-muted-foreground mb-2">Acceptance Criteria</p>
                          <div className="glass rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm text-muted-foreground">Test Pass Rate</span>
                              <span className="text-sm font-medium text-foreground">
                                {contract.acceptanceCriteria.testPassRate}%
                              </span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-2">
                              <div className="bg-primary rounded-full h-2" style={{ width: `${contract.acceptanceCriteria.testPassRate}%` }}/>
                            </div>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs text-muted-foreground mb-2">Requirements</p>
                          <ul className="space-y-1">
                            {contract.acceptanceCriteria.requirements.map((req, i) => (<li key={i} className="text-sm text-foreground flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-primary"/>
                                {req}
                              </li>))}
                          </ul>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end mt-6 gap-3">
                      <Link href={`/verification/${contract.id}`}>
                        <Button variant="outline" className="border-border gap-2">
                          <Eye className="h-4 w-4"/>
                          View Details
                        </Button>
                      </Link>
                    </div>
                  </div>)}
              </div>);
            })}
        </div>)}
    </div>);
}
