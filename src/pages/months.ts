export interface MonthRef {
  year: number
  month: number
}

export function currentMonth(): MonthRef {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

export function shiftMonth({ year, month }: MonthRef, offset: number): MonthRef {
  const date = new Date(year, month - 1 + offset, 1)
  return { year: date.getFullYear(), month: date.getMonth() + 1 }
}

export function monthKey({ year, month }: MonthRef): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function monthLabel({ year, month }: MonthRef, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, options ?? { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1))
}

export function recentMonths(count: number, anchor = currentMonth()): MonthRef[] {
  return Array.from({ length: count }, (_, index) => shiftMonth(anchor, index - count + 1))
}

export function parseMonth(value: string): MonthRef | undefined {
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const month = Number(match[2])
  if (month < 1 || month > 12) return undefined
  return { year: Number(match[1]), month }
}
