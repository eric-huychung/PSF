import type { ComponentProps } from 'react'
import { cn } from './cn'
import { formatAmount } from './format'

export interface AmountProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** Signed amount: positive = money in, negative = money out (matches NormalizedTransaction). */
  value: number
  currency?: string
  /**
   * `signed` colors by sign (green in / red out) and prefixes "+" on money in.
   * `neutral` renders plain text — use for totals/balances that aren't a flow.
   */
  tone?: 'signed' | 'neutral'
  /** With `tone="signed"`, keeps the color but drops the leading +/- — use when direction is already obvious from context (e.g. a tile labeled "Average out"). */
  hideSign?: boolean
}

/**
 * The only place money gets colored. Green/red come from here and nowhere else.
 */
export function Amount({ value, currency = 'USD', tone = 'signed', hideSign = false, className, ...props }: AmountProps) {
  const signed = tone === 'signed' && value !== 0
  const text = formatAmount(hideSign ? Math.abs(value) : value, currency)
  return (
    <span
      data-slot="amount"
      className={cn(
        'tabular-nums',
        signed && (value > 0 ? 'text-positive' : 'text-negative'),
        className,
      )}
      {...props}
    >
      {!hideSign && signed && value > 0 ? `+${text}` : text}
    </span>
  )
}
