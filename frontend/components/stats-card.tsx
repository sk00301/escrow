'use client'

import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'

interface StatsCardProps {
  title: string
  value: string | number
  icon: LucideIcon
  trend?: {
    value: number
    positive: boolean
  }
  suffix?: string
  className?: string
}

export function StatsCard({ title, value, icon: Icon, trend, suffix, className }: StatsCardProps) {
  return (
    <div className={cn(
      'glass-card rounded-xl p-6 border border-border hover:border-primary/30 transition-all duration-200',
      className
    )}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-muted-foreground mb-1">{title}</p>
          <p className="text-2xl font-bold text-foreground">
            {typeof value === 'number' ? value.toLocaleString() : value}
            {suffix && <span className="text-lg text-muted-foreground ml-1">{suffix}</span>}
          </p>
          {trend && (
            <p className={cn(
              'text-xs mt-2',
              trend.positive ? 'text-[#10B981]' : 'text-[#EF4444]'
            )}>
              {trend.positive ? '+' : ''}{trend.value}% from last month
            </p>
          )}
        </div>
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
          <Icon className="h-6 w-6 text-primary" />
        </div>
      </div>
    </div>
  )
}
