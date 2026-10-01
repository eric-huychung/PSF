import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipContentProps } from 'recharts'
import { formatAmount } from '../ui/format'
import { cn } from '../ui/cn'
import { ChartDataTable } from './chart-data-table'
import { TooltipCard } from './chart-tooltip'
import { axisTick, chartColors, formatCompact } from './chart-theme'

export interface CategoryTarget {
  category: string
  /** Money spent in this category, as a positive magnitude. */
  actual: number
  /** Monthly target for this category. 0 means no target was set. */
  target: number
}

export interface CategoryTargetChartProps {
  data: ReadonlyArray<CategoryTarget>
  className?: string
}

const BAR_SIZE = 18
const ROW_HEIGHT = 36

/**
 * Vertical tick at the target value -- a bullet-chart marker, not a second bar.
 * Renders nothing for a category with no target (instead of being filtered out of the
 * series' data, which desynced this series from `Bar`'s -- see CategoryTargetChart).
 * A surface-color halo sits behind the core line so it stays legible crossing a bar
 * edge or a bar fill of either tint, per the "2px surface ring" rule for overlapping marks.
 */
function TargetTick({ cx, cy, payload }: { cx?: number; cy?: number; payload?: CategoryTarget }) {
  if (cx === undefined || cy === undefined) return null
  if (!payload || payload.target <= 0) return null
  return (
    <g>
      <line x1={cx} x2={cx} y1={cy - 11} y2={cy + 11} stroke={chartColors.surface} strokeWidth={6} strokeLinecap="round" />
      <line x1={cx} x2={cx} y1={cy - 11} y2={cy + 11} stroke={chartColors.target} strokeWidth={2.5} strokeLinecap="round" />
    </g>
  )
}

function TargetTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload as CategoryTarget
  return (
    <TooltipCard label={row.category}>
      <div className="mt-1 flex flex-col gap-0.5">
        <div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">Spent</span><span className="font-semibold tabular-nums">{formatAmount(row.actual)}</span></div>
        {row.target > 0 && (
          <div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">Target</span><span className="font-medium tabular-nums">{formatAmount(row.target)}</span></div>
        )}
      </div>
    </TooltipCard>
  )
}

/** Same two navy tints as the money-in/money-out chart, not red/green -- darker once spend reaches the target. No target set -- the lighter tint, same as "under". */
function amountColor(row: CategoryTarget): string {
  if (row.target <= 0) return chartColors.flowIn
  return row.actual >= row.target ? chartColors.flowOut : chartColors.flowIn
}

function Legend() {
  const item = (color: string, label: string) => (
    <span className="flex items-center gap-1.5">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
      {label}
    </span>
  )
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {item(chartColors.flowIn, 'Under target')}
      {item(chartColors.flowOut, 'At or over target')}
      <span className="flex items-center gap-1.5">
        <svg width="10" height="10" aria-hidden="true"><line x1="5" x2="5" y1="0" y2="10" stroke={chartColors.target} strokeWidth="2" /></svg>
        Target
      </span>
    </div>
  )
}

/** Horizontal bars of actual spend, largest first, with a tick marking each category's monthly target. Hover a bar for exact figures. */
export function CategoryTargetChart({ data, className }: CategoryTargetChartProps) {
  const rows = [...data].sort((a, b) => b.actual - a.actual)
  const hasTargets = rows.some((r) => r.target > 0)
  const height = Math.max(rows.length, 1) * ROW_HEIGHT + 40

  if (rows.length === 0) {
    return <p className={cn('py-10 text-center text-sm text-muted-foreground', className)}>No spending this month yet.</p>
  }

  // Scaled to actual spend, not target -- an outlier target (e.g. a loose "Income" target far
  // above anything spent) would otherwise stretch the axis so far that every real bar flattens
  // into a sliver. allowDataOverflow clips a target tick past that range instead of re-expanding it.
  const maxActual = Math.max(rows[0]?.actual ?? 0, 1)

  return (
    <figure className={cn('w-full', className)}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid horizontal={false} stroke={chartColors.grid} strokeDasharray="3 3" />
          <XAxis type="number" domain={[0, maxActual]} allowDataOverflow orientation="bottom" tickLine={false} axisLine={false} tick={axisTick} tickFormatter={(v: number) => formatCompact(v)} />
          {/*
            interval={0}: recharts' default tick-thinning ("preserveEnd") estimates whether each
            label's measured size fits its row and silently drops/reorders ones it thinks would
            collide -- with 12+ short category names in generous 36px rows, that estimate is wrong
            and was dropping and scrambling labels. interval={0} renders every category, unthinned.
          */}
          <YAxis type="category" dataKey="category" width={120} interval={0} tickLine={false} axisLine={false} tick={axisTick} />
          <Tooltip cursor={{ fill: chartColors.grid, opacity: 0.4 }} content={<TargetTooltip />} />
          <Bar dataKey="actual" name="Spent" barSize={BAR_SIZE} radius={[0, 4, 4, 0]} minPointSize={3} isAnimationActive={false}>
            {rows.map((row) => <Cell key={row.category} fill={amountColor(row)} />)}
          </Bar>
          {/*
            No `data` prop here on purpose -- it inherits the chart-level `rows` from
            <BarChart>, the same array `Bar` uses. Giving this its own filtered array
            (categories with a target) used to hand recharts two different-length series
            on one shared categorical y-axis; it unioned both into the axis domain, which
            duplicated/misaligned the row ticks and broke hover for every row that didn't
            happen to still line up. TargetTick itself now skips categories with no target.
          */}
          {hasTargets && (
            <Scatter dataKey="target" name="Target" shape={<TargetTick />} legendType="line" isAnimationActive={false} />
          )}
        </BarChart>
      </ResponsiveContainer>
      <Legend />
      <ChartDataTable
        caption="Spending against target by category"
        columns={['Spent', 'Target']}
        rows={rows.map((r) => ({ label: r.category, values: [r.actual, r.target] }))}
      />
    </figure>
  )
}
