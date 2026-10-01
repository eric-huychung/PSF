import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { TooltipContentProps } from 'recharts'
import { formatAmount } from '../ui/format'
import { cn } from '../ui/cn'
import { ChartDataTable } from './chart-data-table'
import { TooltipCard } from './chart-tooltip'
import { chartColors, formatPercent } from './chart-theme'

export interface CategorySpend {
  category: string
  /** Money spent, as a positive magnitude. */
  amount: number
}

export interface SpendingByCategoryChartProps {
  data: ReadonlyArray<CategorySpend>
  /** Categories past this count fold into "Other". */
  maxCategories?: number
  className?: string
}

function prepare(data: ReadonlyArray<CategorySpend>, max: number): CategorySpend[] {
  const sorted = [...data].filter((d) => d.amount > 0).sort((a, b) => b.amount - a.amount)
  if (sorted.length <= max) return sorted
  const head = sorted.slice(0, max - 1)
  const other = sorted.slice(max - 1).reduce((sum, d) => sum + d.amount, 0)
  return [...head, { category: 'Other', amount: other }]
}

/** Darkest = biggest category; "Other" always gets the same recessive tint. */
function colorFor(index: number, isOther: boolean) {
  if (isOther) return chartColors.categoricalOther
  return chartColors.categorical[index] ?? chartColors.categoricalOther
}

function ShareTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload as CategorySpend & { share: number }
  return (
    <TooltipCard label={point.category}>
      <div className="flex items-baseline gap-2">
        <span className="font-semibold tabular-nums">{formatAmount(point.amount)}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{formatPercent(point.share)}</span>
      </div>
    </TooltipCard>
  )
}

/** Donut with a centered total and a percentage legend — built for "what share went where". */
export function SpendingByCategoryChart({ data, maxCategories = 5, className }: SpendingByCategoryChartProps) {
  const rows = prepare(data, maxCategories)
  const total = rows.reduce((sum, r) => sum + r.amount, 0)

  if (rows.length === 0) {
    return <p className={cn('py-10 text-center text-sm text-muted-foreground', className)}>No spending in this period.</p>
  }

  const withShare = rows.map((r) => ({ ...r, share: total > 0 ? r.amount / total : 0 }))

  return (
    <figure className={cn('flex flex-col items-center gap-6 sm:flex-row', className)}>
      <div className="relative size-52 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<ShareTooltip />} />
            <Pie
              data={withShare}
              dataKey="amount"
              nameKey="category"
              innerRadius={64}
              outerRadius={96}
              paddingAngle={2}
              stroke={chartColors.surface}
              strokeWidth={2}
              isAnimationActive={false}
            >
              {withShare.map((row, index) => (
                <Cell key={row.category} fill={colorFor(index, row.category === 'Other')} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-muted-foreground">Total</span>
          <span className="text-xl font-semibold tracking-tight tabular-nums">{formatAmount(total)}</span>
        </div>
      </div>
      <ul className="flex w-full flex-1 flex-col gap-2.5">
        {withShare.map((row, index) => (
          <li key={row.category} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full border border-border"
                style={{ background: colorFor(index, row.category === 'Other') }}
                aria-hidden="true"
              />
              <span className="truncate">{row.category}</span>
            </span>
            <span className="flex shrink-0 items-baseline gap-2">
              <span className="font-semibold tabular-nums">{formatPercent(row.share)}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{formatAmount(row.amount)}</span>
            </span>
          </li>
        ))}
      </ul>
      <ChartDataTable
        caption="Spending by category"
        columns={['Amount', 'Share']}
        rows={withShare.map((r) => ({ label: r.category, values: [r.amount, formatPercent(r.share)] }))}
      />
    </figure>
  )
}
