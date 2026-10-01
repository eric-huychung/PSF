import type { CategorySpend } from './spending-by-category'
import type { PeriodFlow } from './spending-over-time'
import type { CategoryTarget } from './category-target'

/** Fixture data for the living style guide (design-preview.tsx) — not used by real pages. */
export const categorySpendFixture: CategorySpend[] = [
  { category: 'Groceries', amount: 612.4 },
  { category: 'Rent', amount: 1850 },
  { category: 'Dining out', amount: 284.75 },
  { category: 'Transport', amount: 142.1 },
  { category: 'Utilities', amount: 196.32 },
  { category: 'Shopping', amount: 338.9 },
  { category: 'Subscriptions', amount: 64.97 },
  { category: 'Health', amount: 45 },
  { category: 'Travel', amount: 120 },
  { category: 'Gifts', amount: 38.5 },
]

export const periodFlowFixture: PeriodFlow[] = [
  { period: 'Apr', in: 5100, out: -3410.22 },
  { period: 'May', in: 5100, out: -3122.8 },
  { period: 'Jun', in: 5300, out: -3688.45 },
  { period: 'Jul', in: 5100, out: -4102.13 },
  { period: 'Aug', in: 5200, out: -3540.6 },
  { period: 'Sep', in: 5200, out: -3693.44 },
]

export const categoryTargetFixture: CategoryTarget[] = [
  { category: 'Rent', actual: 1850, target: 1850 },
  { category: 'Groceries', actual: 612.4, target: 400 },
  { category: 'Shopping', actual: 338.9, target: 200 },
  { category: 'Dining out', actual: 284.75, target: 150 },
  { category: 'Utilities', actual: 196.32, target: 220 },
  { category: 'Transport', actual: 142.1, target: 150 },
]
