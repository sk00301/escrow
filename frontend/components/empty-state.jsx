'use client';
import { cn } from '@/lib/utils';
export function EmptyState({ title, description, icon = 'contract', className }) {
    return (<div className={cn('flex flex-col items-center justify-center py-16 px-4 text-center', className)}>
      <div className="w-24 h-24 mb-6">
        {icon === 'contract' && (<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="20" y="10" width="60" height="80" rx="4" stroke="#1E3A5F" strokeWidth="2" fill="#112233"/>
            <path d="M30 30h40M30 45h40M30 60h25" stroke="#00B4D8" strokeWidth="2" strokeLinecap="round"/>
            <circle cx="70" cy="70" r="15" fill="#00B4D8" fillOpacity="0.2"/>
            <path d="M65 70l4 4 8-8" stroke="#00B4D8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>)}
        {icon === 'dispute' && (<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M50 10L90 85H10L50 10Z" stroke="#1E3A5F" strokeWidth="2" fill="#112233"/>
            <path d="M50 35v25" stroke="#F59E0B" strokeWidth="3" strokeLinecap="round"/>
            <circle cx="50" cy="70" r="3" fill="#F59E0B"/>
          </svg>)}
        {icon === 'milestone' && (<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="15" y="20" width="70" height="60" rx="4" stroke="#1E3A5F" strokeWidth="2" fill="#112233"/>
            <path d="M30 45h20M30 55h15" stroke="#1E3A5F" strokeWidth="2" strokeLinecap="round"/>
            <circle cx="65" cy="50" r="12" stroke="#00B4D8" strokeWidth="2" fill="#00B4D8" fillOpacity="0.1"/>
            <path d="M60 50h10M65 45v10" stroke="#00B4D8" strokeWidth="2" strokeLinecap="round"/>
          </svg>)}
        {icon === 'vote' && (<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="20" y="25" width="60" height="55" rx="4" stroke="#1E3A5F" strokeWidth="2" fill="#112233"/>
            <rect x="35" y="15" width="30" height="15" rx="2" stroke="#1E3A5F" strokeWidth="2" fill="#0D1B2A"/>
            <path d="M35 45l8 8 15-15" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M35 65h30" stroke="#1E3A5F" strokeWidth="2" strokeLinecap="round"/>
          </svg>)}
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm">{description}</p>
    </div>);
}
