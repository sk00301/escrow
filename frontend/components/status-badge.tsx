'use client'

import { cn } from '@/lib/utils'

type Status = 'funded' | 'submitted' | 'verified' | 'disputed' | 'released' | 'active' | 'resolved' | 'pending' | 'approved' | 'rejected' | 'passed'

interface StatusBadgeProps {
  status: Status
  pulse?: boolean
  className?: string
}

const statusStyles: Record<Status, string> = {
  funded: 'bg-[#00B4D8]/20 text-[#00B4D8] border-[#00B4D8]/30',
  submitted: 'bg-[#F59E0B]/20 text-[#F59E0B] border-[#F59E0B]/30',
  verified: 'bg-[#10B981]/20 text-[#10B981] border-[#10B981]/30',
  disputed: 'bg-[#EF4444]/20 text-[#EF4444] border-[#EF4444]/30',
  released: 'bg-[#94A3B8]/20 text-[#94A3B8] border-[#94A3B8]/30',
  active: 'bg-[#00B4D8]/20 text-[#00B4D8] border-[#00B4D8]/30',
  resolved: 'bg-[#10B981]/20 text-[#10B981] border-[#10B981]/30',
  pending: 'bg-[#F59E0B]/20 text-[#F59E0B] border-[#F59E0B]/30',
  approved: 'bg-[#10B981]/20 text-[#10B981] border-[#10B981]/30',
  rejected: 'bg-[#EF4444]/20 text-[#EF4444] border-[#EF4444]/30',
  passed: 'bg-[#10B981]/20 text-[#10B981] border-[#10B981]/30'
}

const statusLabels: Record<Status, string> = {
  funded: 'Funded',
  submitted: 'Submitted',
  verified: 'Verified',
  disputed: 'Disputed',
  released: 'Released',
  active: 'Active',
  resolved: 'Resolved',
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  passed: 'Passed'
}

export function StatusBadge({ status, pulse, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
        statusStyles[status],
        pulse && 'animate-pulse-cyan',
        className
      )}
    >
      {(status === 'active' || status === 'pending') && (
        <span className={cn(
          'w-1.5 h-1.5 rounded-full',
          status === 'active' ? 'bg-[#00B4D8]' : 'bg-[#F59E0B]'
        )} />
      )}
      {statusLabels[status]}
    </span>
  )
}
