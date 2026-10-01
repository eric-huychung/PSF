import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipContentProps } from 'recharts'
import { formatAmount } from '../ui/format'
import { cn } from '../ui/cn'
import { ChartDataTable } from './chart-data-table'
import { TooltipCard } from './chart-tooltip'
import { axisTick, chartColors, formatCompact } from './chart-theme'

export interface PeriodFlow {
  /** Display label for the period, e.g. "Mar" or "Mar 2026". */
  period: string
  /** Money in, as a positive magnitude. */
  in: number
  /** Money out, as a negative magnitude (matches NormalizedTransaction's sign convention). */
  out: number
}

export interface SpendingOverTimeChartProps {
  data: ReadonlyArray<PeriodFlow>
  height?: number
  className?: string
}

function withNet(data: ReadonlyArray<PeriodFlow>) {
  return data.map((d) => ({ ...d, out: Math.abs(d.out), net: d.in + d.out }))
}

function FlowTooltip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const byKey = new Map(payload.map((entry) => [entry.dataKey, entry.value]))
  return (
    <TooltipCard label={label}>
      <dl className="mt-1 flex flex-col gap-0.5">
        <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">In</dt><dd className="font-medium tabular-nums">{formatAmount(Number(byKey.get('in') ?? 0))}</dd></div>
        <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Out</dt><dd className="font-medium tabular-nums">{formatAmount(Number(byKey.get('out') ?? 0))}</dd></div>
        <div className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">Net</dt><dd className="font-semibold tabular-nums">{formatAmount(Number(byKey.get('net') ?? 0))}</dd></div>
      </dl>
    </TooltipCard>
  )
}

/** Grouped in/out bars per period (two navy tints, no red/green), with a net line on top. */
export function SpendingOverTimeChart({ data, height = 280, className }: SpendingOverTimeChartProps) {
  if (data.length === 0) {
    return <p className={cn('py-10 text-center text-sm text-muted-foreground', className)}>No activity history yet.</p>
  }
  const rows = withNet(data)

  return (
    <figure className={cn('w-full', className)}>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={chartColors.grid} strokeDasharray="3 3" />
          <XAxis dataKey="period" tickLine={false} axisLine={false} tick={axisTick} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} tick={axisTick} width={56} tickFormatter={(v: number) => formatCompact(v)} />
          <Tooltip cursor={{ fill: chartColors.grid, opacity: 0.4 }} content={<FlowTooltip />} />
          <Legend
            verticalAlign="top"
            align="right"
            height={28}
            formatter={(value) => <span className="text-xs text-muted-foreground">{value}</span>}
          />
          <Bar dataKey="in" name="In" fill={chartColors.flowIn} radius={[3, 3, 0, 0]} barSize={14} isAnimationActive={false} />
          <Bar dataKey="out" name="Out" fill={chartColors.flowOut} radius={[3, 3, 0, 0]} barSize={14} isAnimationActive={false} />
          <Line type="monotone" dataKey="net" name="Net" stroke={chartColors.series} strokeWidth={2} dot={false} activeDot={{ r: 5, fill: chartColors.series, stroke: chartColors.surface, strokeWidth: 2 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <ChartDataTable
        caption="Money in, money out, and net by period"
        columns={['Money in', 'Money out', 'Net']}
        rows={rows.map((r) => ({ label: r.period, values: [r.in, r.out, r.net] }))}
      />
    </figure>
  )
}
