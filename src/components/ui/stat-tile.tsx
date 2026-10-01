import type { ReactNode } from 'react'
import { Amount } from './amount'
import { Card } from './card'
import { cn } from './cn'

export interface StatTileProps {
  label: string
  value: number
  currency?: string
  /** `neutral` (default) for totals/balances; `signed` colors the headline by sign, e.g. for a flow like an average. */
  tone?: 'signed' | 'neutral'
  /** With `tone="signed"`, keeps the color but drops the leading +/- — use when the label already says the direction (e.g. "Average out"). */
  hideSign?: boolean
  /** Optional signed change shown under the value, colored by sign. */
  delta?: number
  /** Context for the delta, e.g. "vs last month". */
  deltaLabel?: string
  /** Extra content (icon, action) in the top-right corner. */
  aside?: ReactNode
  className?: string
}

export function StatTile({ label, value, currency, tone = 'neutral', hideSign, delta, deltaLabel, aside, className }: StatTileProps) {
  return (
    <Card data-slot="stat-tile" className={cn('gap-3', className)}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
        {aside}
      </div>
      <Amount value={value} currency={currency} tone={tone} hideSign={hideSign} className="text-3xl font-semibold tracking-tight" />
      {delta !== undefined && (
        <div className="flex items-center gap-1.5 text-sm">
          <Amount value={delta} currency={currency} className="font-medium" />
          {deltaLabel && <span className="text-muted-foreground">{deltaLabel}</span>}
        </div>
      )}
    </Card>
  )
}
