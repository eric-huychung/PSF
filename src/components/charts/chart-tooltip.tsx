import type { ReactNode } from 'react'

/** Styled shell shared by every chart tooltip. Each chart supplies its own body content. */
export function TooltipCard({ label, children }: { label?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-popover">
      {label !== undefined && <div className="text-xs text-muted-foreground">{label}</div>}
      {children}
    </div>
  )
}
