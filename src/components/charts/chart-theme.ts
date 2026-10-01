/**
 * Chart colors as CSS variable references. SVG fill/stroke accept var(), so a
 * theme switch repaints charts with no re-render. Never pass hex values here.
 */
export const chartColors = {
  series: 'var(--chart-series)',
  grid: 'var(--chart-grid)',
  axis: 'var(--chart-axis)',
  cursor: 'var(--chart-cursor)',
  surface: 'var(--background)',
  label: 'var(--foreground)',
  /** Money in/out only (matches Amount) -- never used as a plain categorical series color. */
  positive: 'var(--positive)',
  negative: 'var(--negative)',
  /** A target/reference marker, not a flow -- darkest navy step (not recessive): it must
   *  read on top of every bar tint it can land on, so it needs more contrast than the
   *  marks it overlaps, not less. Pair with a surface-color halo where it's drawn. */
  target: 'var(--chart-target)',
  /** Category pie ramp, darkest first -- rank order (biggest category = darkest), not identity. */
  categorical: ['var(--chart-cat-1)', 'var(--chart-cat-2)', 'var(--chart-cat-3)', 'var(--chart-cat-4)'] as string[],
  categoricalOther: 'var(--chart-cat-other)',
  /** Money in/out bars -- two navy tints, deliberately not positive/negative. */
  flowIn: 'var(--chart-flow-in)',
  flowOut: 'var(--chart-flow-out)',
} as const

export const axisTick = { fill: chartColors.axis, fontSize: 12 }

const compact = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatCompact(value: number) {
  return compact.format(value)
}

const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })

/** `share` is a 0..1 fraction. */
export function formatPercent(share: number) {
  return percent.format(share)
}
