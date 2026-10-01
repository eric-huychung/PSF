import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ChevronDown, Plus } from 'lucide-react'
import type { BankAccount, Category, Rule, StorageLayer, StoredTransaction } from '../lib/types'
import { Amount, BankLogo, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Modal, cn } from '../components/ui'
import { lookupCategory } from '../lib/categorization/rulesCache'
import { monthLabel, recentMonths } from './months'
import { loadTransactions, matchingAccounts } from './transactionSource'
import { useBankAccountSelection } from './useBankAccountSelection'

export interface TransactionsProps {
  storage: StorageLayer
  accounts: BankAccount[]
  /** Loaded and bootstrapped once by App -- reading it here directly would race the first-run default-categories write. */
  categories?: Category[]
  /** Routes to Settings' "Banks & accounts" section, e.g. from the "add a bank" card. */
  onAddBank: () => void
}

interface MonthGroup {
  /** "YYYY-MM", matches the leading slice of NormalizedTransaction.date. */
  key: string
  label: string
  transactions: StoredTransaction[]
  totalIn: number
  totalOut: number
}

/** Drill-down: pick a bank, then an account, then a statement. Mirrors `bank`/`account` from useBankAccountSelection directly, so no separate step state is needed. */
type Step = 'banks' | 'accounts' | 'statements'

// Stable reference so an un-passed `categories` prop doesn't produce a new array every render.
const EMPTY_CATEGORIES: Category[] = []

/** How far back to probe for statements. Storage has no "list all months" API, so this is a
 * bounded upfront fetch rather than an unbounded one -- see loadTransactions. */
const STATEMENT_HISTORY_MONTHS = 10 * 12

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The transactions could not be loaded.'
}

/** One card per statement month -- the natural unit here is "a month's worth of uploaded activity", not a single row. */
function groupByMonth(transactions: StoredTransaction[]): MonthGroup[] {
  const byKey = new Map<string, StoredTransaction[]>()
  for (const transaction of transactions) {
    const key = transaction.date.slice(0, 7)
    byKey.set(key, [...(byKey.get(key) ?? []), transaction])
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, items]) => {
      const [year, month] = key.split('-').map(Number)
      return {
        key,
        label: monthLabel({ year, month }),
        transactions: items,
        totalIn: items.reduce((total, t) => total + (t.amount > 0 ? t.amount : 0), 0),
        totalOut: items.reduce((total, t) => total + (t.amount < 0 ? t.amount : 0), 0),
      }
    })
}

function BankCard({ bank, onOpen }: { bank: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-3 rounded-card border border-card-border bg-card p-4 text-left text-card-foreground shadow-card transition-shadow duration-200 hover:shadow-popover"
    >
      <BankLogo name={bank} size="lg" />
      <span className="min-w-0 flex-1 truncate font-medium">{bank}</span>
    </button>
  )
}

function AddBankCard({ onAdd }: { onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="flex items-center justify-center gap-2 rounded-card border border-dashed border-card-border p-4 text-muted-foreground transition-colors hover:border-primary hover:text-primary"
    >
      <Plus size={18} aria-hidden="true" />
      <span className="font-medium">Add a bank</span>
    </button>
  )
}

function AccountCard({ bank, account, onOpen }: { bank: string; account: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-2 rounded-card border border-card-border bg-card p-4 text-left text-card-foreground shadow-card transition-shadow duration-200 hover:shadow-popover"
    >
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <BankLogo name={bank} />
        {bank}
      </span>
      <span className="font-medium">{account}</span>
    </button>
  )
}

function MonthCard({ group, onOpen }: { group: MonthGroup; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-2 rounded-card border border-card-border bg-card p-4 text-left text-card-foreground shadow-card transition-shadow duration-200 hover:shadow-popover"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-medium">{group.label}</span>
        <Amount value={group.totalIn + group.totalOut} className="shrink-0 font-semibold" />
      </div>
      <span className="text-sm text-muted-foreground">{group.transactions.length} transaction{group.transactions.length === 1 ? '' : 's'}</span>
    </button>
  )
}

function TransactionRow({ transaction, categoryName, expanded, onToggle }: { transaction: StoredTransaction; categoryName: string; expanded: boolean; onToggle: () => void }) {
  return (
    <li className="border-b border-border last:border-b-0">
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-accent">
        <span className="w-16 shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">{transaction.date.slice(5)}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{transaction.description}</span>
        <Amount value={transaction.amount} className="shrink-0 text-sm font-semibold" />
        <ChevronDown size={14} aria-hidden="true" className={cn('shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <div className="flex flex-wrap items-center gap-2 pb-3 text-sm text-muted-foreground">
          <span className="rounded-pill bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">{categoryName}</span>
          <span>{transaction.bank} · {transaction.account}</span>
        </div>
      )}
    </li>
  )
}

/** Statement drill-in as a modal instead of a page: a list of rows (not cards) that expand in place, so there's never a modal stacked on a modal. */
function StatementModal({ group, categoryNameFor, onClose }: { group: MonthGroup; categoryNameFor: (transaction: StoredTransaction) => string; onClose: () => void }) {
  const [expandedIndex, setExpandedIndex] = useState<number>()
  return (
    <Modal titleId="statement-title" title={group.label} onClose={onClose} className="max-w-xl">
      <p className="mb-2 text-sm text-muted-foreground">{group.transactions.length} transaction{group.transactions.length === 1 ? '' : 's'}</p>
      <ul className="flex flex-col">
        {group.transactions.map((transaction, index) => (
          <TransactionRow
            key={`${transaction.date}-${index}`}
            transaction={transaction}
            categoryName={categoryNameFor(transaction)}
            expanded={expandedIndex === index}
            onToggle={() => setExpandedIndex((current) => (current === index ? undefined : index))}
          />
        ))}
      </ul>
    </Modal>
  )
}

export function Transactions({ storage, accounts, categories = EMPTY_CATEGORIES, onAddBank }: TransactionsProps) {
  const { bank, account, setBank, setAccount } = useBankAccountSelection(accounts)
  const [transactions, setTransactions] = useState<StoredTransaction[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string>()
  const [openMonthKey, setOpenMonthKey] = useState<string>()
  const [reloadToken, setReloadToken] = useState(0)
  const [yearPage, setYearPage] = useState(0)

  const step: Step = !bank ? 'banks' : !account ? 'accounts' : 'statements'

  useEffect(() => { setYearPage(0); setOpenMonthKey(undefined) }, [bank, account])

  useEffect(() => {
    if (step !== 'statements') return
    let active = true
    setStatus('loading')
    setError(undefined)
    const targets = matchingAccounts(accounts, bank, account)
    Promise.all([
      loadTransactions(storage, targets, recentMonths(STATEMENT_HISTORY_MONTHS)),
      storage.readRules(),
    ]).then(([items, storedRules]) => {
      if (!active) return
      setTransactions([...items].sort((a, b) => b.date.localeCompare(a.date)))
      setRules(storedRules)
      setStatus('ready')
    }).catch((reason: unknown) => {
      if (!active) return
      setError(errorMessage(reason))
      setStatus('error')
    })
    return () => { active = false }
  }, [accounts, account, bank, reloadToken, step, storage])

  const categoryNames = new Map(categories.map((category) => [category.id, category.name]))
  const categoryNameFor = (transaction: StoredTransaction) => categoryNames.get(transaction.categoryId) ?? categoryNames.get(lookupCategory(transaction.description, rules) ?? '') ?? 'Uncategorized'
  const monthGroups = groupByMonth(transactions)
  const oldestMonthLabel = monthGroups.at(-1)?.label
  const years = useMemo(() => Array.from(new Set(monthGroups.map((group) => Number(group.key.slice(0, 4))))).sort((a, b) => b - a), [monthGroups])
  const selectedYear = years[yearPage] ?? years[0]
  const yearGroups = monthGroups.filter((group) => Number(group.key.slice(0, 4)) === selectedYear)
  const openGroup = monthGroups.find((group) => group.key === openMonthKey)
  const accountsForBank = accounts.find((entry) => entry.bank === bank)?.accounts ?? []

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 sm:p-10" aria-labelledby="transactions-title">
      <header>
        <h1 id="transactions-title" className="mt-1 text-3xl font-semibold tracking-tight">Transactions</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {step === 'banks' && 'Pick a bank to browse its statements.'}
          {step === 'accounts' && `Pick an account at ${bank}.`}
          {step === 'statements' && 'Pick a statement, then a transaction, for details.'}
        </p>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            {step !== 'banks' && (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label={`Back to ${step === 'accounts' ? 'banks' : 'accounts'}`}
                onClick={() => (step === 'accounts' ? setBank('') : setAccount(''))}
              >
                <ArrowLeft size={14} aria-hidden="true" />
              </Button>
            )}
            <div>
              <CardTitle>
                {step === 'banks' && 'Banks'}
                {step === 'accounts' && bank}
                {step === 'statements' && (openGroup ? openGroup.label : `${bank} · ${account}`)}
              </CardTitle>
              <CardDescription>
                {step === 'banks' && (accounts.length === 0 ? 'No banks yet' : `${accounts.length} bank${accounts.length === 1 ? '' : 's'}`)}
                {step === 'accounts' && (accountsForBank.length === 0 ? 'No accounts yet' : `${accountsForBank.length} account${accountsForBank.length === 1 ? '' : 's'}`)}
                {step === 'statements' && (status !== 'ready' ? 'Stored activity' : monthGroups.length === 0 ? 'Stored activity' : `${monthGroups.length} month${monthGroups.length === 1 ? '' : 's'} with activity since ${oldestMonthLabel}`)}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {step === 'banks' && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {accounts.map((entry) => <BankCard key={entry.bank} bank={entry.bank} onOpen={() => setBank(entry.bank)} />)}
              <AddBankCard onAdd={onAddBank} />
            </div>
          )}

          {step === 'accounts' && (
            accountsForBank.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No accounts yet. Add one in Settings.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {accountsForBank.map((name) => <AccountCard key={name} bank={bank} account={name} onOpen={() => setAccount(name)} />)}
              </div>
            )
          )}

          {step === 'statements' && (
            <>
              {status === 'loading' && <p className="py-10 text-center text-sm text-muted-foreground" role="status">Loading transactions...</p>}
              {status === 'error' && (
                <div className="flex flex-col items-center gap-3 py-10 text-center" role="alert">
                  <p className="text-sm text-destructive">{error}</p>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setReloadToken((token) => token + 1)}>Try again</Button>
                </div>
              )}
              {status === 'ready' && monthGroups.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No transactions are stored in this range.</p>}

              {status === 'ready' && monthGroups.length > 0 && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {yearGroups.map((group) => <MonthCard key={group.key} group={group} onOpen={() => setOpenMonthKey(group.key)} />)}
                  </div>
                  {years.length > 1 && (
                    <div className="mt-6 flex items-center justify-center gap-1">
                      {years.map((year, index) => (
                        <Button
                          key={year}
                          type="button"
                          variant={index === yearPage ? 'primary' : 'ghost'}
                          size="sm"
                          onClick={() => setYearPage(index)}
                          aria-current={index === yearPage ? 'page' : undefined}
                        >
                          {year}
                        </Button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {openGroup && <StatementModal group={openGroup} categoryNameFor={categoryNameFor} onClose={() => setOpenMonthKey(undefined)} />}
    </main>
  )
}

export default Transactions
