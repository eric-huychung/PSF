import { useEffect, useMemo, useState } from 'react'
import { CategoryTargetChart, SpendingByCategoryChart, SpendingOverTimeChart, type CategorySpend, type CategoryTarget, type PeriodFlow } from '../components/charts'
import { Amount, BankAccountSelect, Card, CardContent, CardDescription, CardHeader, CardTitle, SegmentedControl, StatTile, type SegmentedOption } from '../components/ui'
import { lookupCategory } from '../lib/categorization/rulesCache'
import type { BankAccount, Category, CategoryBudget, Rule, StorageLayer, StoredTransaction } from '../lib/types'
import { currentMonth, monthKey, monthLabel, recentMonths, shiftMonth, type MonthRef } from './months'
import { loadTransactions, matchingAccounts } from './transactionSource'
import { useBankAccountSelection } from './useBankAccountSelection'

export interface DashboardProps {
  storage: StorageLayer
  accounts: BankAccount[]
  /** Loaded and bootstrapped once by App -- reading it here directly would race the first-run default-categories write. */
  categories?: Category[]
  months?: ReadonlyArray<MonthRef>
}

interface DashboardData {
  periods: PeriodFlow[]
  categories: CategorySpend[]
  categoryTargets: CategoryTarget[]
  totalIn: number
  totalOut: number
  /** Months (within the loaded range) that had any data — the denominator for every average shown. */
  monthCount: number
  transactionCount: number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The dashboard data could not be loaded.'
}

// Stable reference so an un-passed `categories` prop doesn't produce a new array every render --
// that would re-trigger the data-loading effect below on every render, forever.
const EMPTY_CATEGORIES: Category[] = []

const DEFAULT_PERIOD = '12'
const PERIOD_OPTIONS: ReadonlyArray<SegmentedOption<string>> = [
  { value: '1', label: 'Last month' },
  { value: '3', label: '3 months' },
  { value: '6', label: '6 months' },
  { value: '12', label: '12 months' },
]

function buildDashboardData(
  months: ReadonlyArray<MonthRef>,
  transactions: StoredTransaction[],
  categories: Category[],
  rules: Rule[],
  budgets: CategoryBudget[],
): DashboardData {
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]))
  const targetByCategory = new Map(budgets.map((budget) => [budget.categoryId, budget.monthlyTarget]))
  const transferCategoryIds = new Set(categories.filter((category) => category.isTransfer).map((category) => category.id))

  // Trusts the transaction's saved category first (kept current by Settings' "Recheck
  // categories"), falling back to rules only when it's missing/invalid -- same source of truth
  // everywhere, so a transfer can't count as spend in one view and not another.
  const resolveCategoryId = (t: StoredTransaction): string => {
    if (categoryNames.has(t.categoryId)) return t.categoryId
    const looked = lookupCategory(t.description, rules)
    return looked && categoryNames.has(looked) ? looked : ''
  }
  const isTransfer = (t: StoredTransaction) => transferCategoryIds.has(resolveCategoryId(t))

  const periods = months.map((month) => {
    const key = monthKey(month)
    const inMonth = transactions.filter((t) => t.date.startsWith(key) && !isTransfer(t))
    return {
      period: monthLabel(month, { month: 'short', year: 'numeric' }),
      in: inMonth.reduce((total, t) => total + (t.amount > 0 ? t.amount : 0), 0),
      out: inMonth.reduce((total, t) => total + (t.amount < 0 ? t.amount : 0), 0),
    }
  })

  // Averages only count months that actually have data. An empty month almost always means no
  // statement was uploaded yet, not zero spending, so counting it would understate every average.
  // The current (in-progress) month is excluded for the same reason: it's a partial month.
  const currentKey = monthKey(currentMonth())
  const transactionsByMonth = new Map<string, StoredTransaction[]>()
  for (const t of transactions) {
    const key = t.date.slice(0, 7)
    const bucket = transactionsByMonth.get(key)
    if (bucket) bucket.push(t)
    else transactionsByMonth.set(key, [t])
  }
  const monthsWithData = months.filter((month) => {
    const key = monthKey(month)
    return key !== currentKey && (transactionsByMonth.get(key)?.length ?? 0) > 0
  })
  const monthCount = Math.max(monthsWithData.length, 1)
  const monthsWithDataKeys = new Set(monthsWithData.map(monthKey))
  const averagingTransactions = transactions.filter((t) => monthsWithDataKeys.has(t.date.slice(0, 7)))

  const categoryTotals = new Map<string, number>()
  for (const t of averagingTransactions) {
    // Income is money coming in, not spend -- this map (and everything it feeds, below)
    // is a "spending by category" view, so income never belongs in it regardless of sign.
    if (t.amount >= 0) continue
    const categoryId = resolveCategoryId(t)
    if (categoryId === 'income' || transferCategoryIds.has(categoryId)) continue
    categoryTotals.set(categoryId, (categoryTotals.get(categoryId) ?? 0) + Math.abs(t.amount))
  }

  const categoryAverages = [...categoryTotals].map(([categoryId, total]) => ({
    category: categoryId ? (categoryNames.get(categoryId) ?? 'Uncategorized') : 'Uncategorized',
    amount: total / monthCount,
  }))

  const categoryTargets = categories
    .filter((category) => category.id !== 'income' && !category.isTransfer)
    .map((category) => ({
      category: category.name,
      actual: (categoryTotals.get(category.id) ?? 0) / monthCount,
      target: targetByCategory.get(category.id) ?? 0,
    }))
    .filter((row) => row.actual > 0 || row.target > 0)

  const spendTransactions = averagingTransactions.filter((t) => !isTransfer(t))

  return {
    periods,
    categories: categoryAverages,
    categoryTargets,
    totalIn: spendTransactions.reduce((total, t) => total + (t.amount > 0 ? t.amount : 0), 0),
    totalOut: spendTransactions.reduce((total, t) => total + (t.amount < 0 ? t.amount : 0), 0),
    monthCount,
    transactionCount: transactions.length,
  }
}

export function Dashboard({ storage, accounts, categories = EMPTY_CATEGORIES, months }: DashboardProps) {
  const { bank, account, setBank, setAccount } = useBankAccountSelection(accounts)
  const [period, setPeriod] = useState(DEFAULT_PERIOD)
  const [data, setData] = useState<DashboardData>()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string>()

  // `months` lets tests pin an exact range; otherwise the period filter below picks it.
  const effectiveMonths = useMemo(() => months ?? recentMonths(Number(period), shiftMonth(currentMonth(), -1)), [months, period])

  useEffect(() => {
    let active = true
    setStatus('loading')
    setError(undefined)
    const targets = matchingAccounts(accounts, bank, account)
    Promise.all([
      loadTransactions(storage, targets, effectiveMonths),
      storage.readRules(),
      storage.readBudgets(),
    ]).then(([transactions, rules, budgets]) => {
      if (!active) return
      setData(buildDashboardData(effectiveMonths, transactions, categories, rules, budgets))
      setStatus('ready')
    }).catch((reason: unknown) => {
      if (!active) return
      setError(errorMessage(reason))
      setStatus('error')
    })
    return () => { active = false }
  }, [accounts, account, bank, categories, effectiveMonths, storage])

  const net = (data?.totalIn ?? 0) + (data?.totalOut ?? 0)
  const periodCount = data?.monthCount ?? 1

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 sm:p-10" aria-labelledby="dashboard-title">
      <header className="flex flex-col gap-4">
        <div>
          <h1 id="dashboard-title" className="mt-1 text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-2 text-sm text-muted-foreground">A view of your stored spending activity, across every bank and account by default.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {accounts.length > 0 && <BankAccountSelect accounts={accounts} bank={bank} account={account} onBankChange={setBank} onAccountChange={setAccount} />}
          <SegmentedControl options={PERIOD_OPTIONS} value={period} onValueChange={setPeriod} size="sm" aria-label="Time range" />
        </div>
      </header>

      {accounts.length === 0 && (
        <Card><CardContent><p className="py-8 text-center text-sm text-muted-foreground">Add a bank and account in Settings first.</p></CardContent></Card>
      )}
      {status === 'loading' && <p className="py-12 text-center text-sm text-muted-foreground" role="status">Loading dashboard...</p>}
      {status === 'error' && <p className="rounded-card border border-card-border bg-card p-6 text-sm text-destructive" role="alert">{error}</p>}
      {status === 'ready' && data && accounts.length > 0 && (
        <>
          <section className="grid gap-4 sm:grid-cols-3" aria-label="Summary">
            <StatTile label="Average in" value={data.totalIn / periodCount} tone="signed" hideSign />
            <StatTile label="Average out" value={data.totalOut / periodCount} tone="signed" hideSign />
            <StatTile label="Average net" value={net / periodCount} tone="signed" />
          </section>
          {data.transactionCount === 0 ? (
            <Card><CardContent><p className="py-8 text-center text-sm text-muted-foreground">No stored transactions were found in this range.</p></CardContent></Card>
          ) : (
            <>
              <Card>
                <CardHeader><div><CardTitle>Money in vs. money out</CardTitle><CardDescription>By month, with net as a line</CardDescription></div></CardHeader>
                <CardContent><SpendingOverTimeChart data={data.periods} /></CardContent>
              </Card>
              <section className="grid gap-6 lg:grid-cols-2" aria-label="Category breakdowns">
                <Card>
                  <CardHeader><div><CardTitle>Spending by category</CardTitle><CardDescription>Average monthly spend, rules-backed categories across this range</CardDescription></div></CardHeader>
                  <CardContent><SpendingByCategoryChart data={data.categories} /></CardContent>
                </Card>
                <Card>
                  <CardHeader><div><CardTitle>Category targets</CardTitle><CardDescription>Average monthly spend vs. each category's monthly target</CardDescription></div></CardHeader>
                  <CardContent><CategoryTargetChart data={data.categoryTargets} /></CardContent>
                </Card>
              </section>
            </>
          )}
          <p className="sr-only">Net for the selected range is <Amount value={net} tone="neutral" />.</p>
        </>
      )}
    </main>
  )
}

export default Dashboard
