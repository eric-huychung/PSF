import { useEffect, useState } from 'react'
import { AlertCircle, Check, LoaderCircle } from 'lucide-react'
import type { CategorizationResult, Category, Rule, StorageLayer } from '../lib/types'
import type { StatementBalances } from '../lib/adapters/pdf-normalize'
import type { BalanceReconciliation } from '../lib/verification/reconcileBalance'
import { addRule } from '../lib/categorization/rulesCache'
import { Amount } from '../components/ui/amount'
import { Button } from '../components/ui/button'
import { formatAmount } from '../components/ui/format'
import { SegmentedControl } from '../components/ui/segmented-control'
import { StatTile } from '../components/ui/stat-tile'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { monthLabel } from './months'

export interface ReviewModalProps {
  results: CategorizationResult[]
  categories: Category[]
  storage: StorageLayer
  bank: string
  account: string
  year: number
  month: number
  /** Jev found accepted rows the deterministic parser has no draft for -- see runImportPipeline's missingRowCount. */
  warning?: string
  /** Credit-card-only statement-level check (see reconcileBalance.ts) -- undefined for checking/savings, which this isn't wired up for yet. Adds a second tab when present. */
  balanceCheck?: { balances: StatementBalances | null; reconciliation: BalanceReconciliation | null }
  /** Object URL for the original PDF, shown in the balance-check tab for a quick visual compare. */
  pdfPreviewUrl?: string | null
  onClose: () => void
  onSaved: () => void
}

type ReviewSection = 'transactions' | 'balance'

/** Pure math against the statement's own printed numbers -- see reconcileBalance.ts. Never blocks the save, just warns louder than a row-level flag when the statement's own math doesn't check out. */
function BalanceCheckPanel({ balanceCheck, pdfPreviewUrl }: { balanceCheck: { balances: StatementBalances | null; reconciliation: BalanceReconciliation | null }; pdfPreviewUrl?: string | null }) {
  const { balances, reconciliation } = balanceCheck
  if (!balances) {
    return <p className="text-sm text-muted-foreground">Could not find a Previous Balance / New Balance on this statement to check against -- nothing to verify here.</p>
  }
  return (
    <div className="flex flex-col gap-4">
      {reconciliation && !reconciliation.matches && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          This statement's own numbers don't add up to what was imported -- double check against the original below before saving. This never blocks the save.
        </p>
      )}
      {reconciliation?.matches && (
        <p className="inline-flex w-fit items-center gap-1 rounded-pill border border-card-border bg-secondary px-2.5 py-1 text-xs font-medium text-positive">
          <Check size={13} aria-hidden="true" /> Matches the statement's own math
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <StatTile
          label="Statement balance"
          value={balances.newBalance}
          delta={reconciliation?.expectedChange}
          deltaLabel={`from ${formatAmount(balances.previousBalance)} previous balance`}
        />
        <StatTile
          label="Imported transactions"
          value={reconciliation?.actualChange ?? 0}
          tone="signed"
          delta={reconciliation?.difference}
          deltaLabel={reconciliation?.matches ? 'matches the statement' : 'off from the statement'}
        />
      </div>
      {pdfPreviewUrl && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Original statement</p>
          <iframe src={pdfPreviewUrl} title="Original statement PDF" className="h-96 w-full rounded-lg border border-border" />
        </div>
      )}
    </div>
  )
}

type SaveState = 'idle' | 'saving' | 'error'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

/** Confirmation modal: nothing is written to the transaction month until "Confirm & save" runs. */
export function ReviewModal({ results: initialResults, categories, storage, bank, account, year, month, warning, balanceCheck, pdfPreviewUrl, onClose, onSaved }: ReviewModalProps) {
  const [results, setResults] = useState(initialResults)
  const [existingCount, setExistingCount] = useState<number | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [message, setMessage] = useState('')
  const [section, setSection] = useState<ReviewSection>('transactions')

  useEffect(() => {
    let active = true
    storage.readMonth(bank, account, year, month)
      .then((existing) => { if (active) setExistingCount(existing.length) })
      .catch(() => { if (active) setExistingCount(null) })
    return () => { active = false }
  }, [storage, bank, account, year, month])

  const updateCategory = async (index: number, categoryId: string) => {
    const current = results[index]
    if (!current || current.categoryId === categoryId) return
    const nextResults = results.map((result, resultIndex) => resultIndex === index ? { ...result, categoryId, confidence: 'cache' as const, source: 'cache' as const } : result)
    let currentRules: Rule[]
    try {
      currentRules = await storage.readRules()
    } catch (error) {
      setSaveState('error')
      setMessage(errorMessage(error))
      return
    }
    const nextRules = addRule(currentRules, current.transaction.description, categoryId)
    setResults(nextResults)
    try {
      await storage.writeRules(nextRules)
    } catch (error) {
      setSaveState('error')
      setMessage(errorMessage(error))
    }
  }

  const confirmSave = async () => {
    setSaveState('saving')
    setMessage('')
    try {
      await storage.writeMonth(bank, account, year, month, results.map((result) => ({ ...result.transaction, categoryId: result.categoryId })))
      onSaved()
      onClose()
    } catch (error) {
      setSaveState('error')
      setMessage(errorMessage(error))
    }
  }

  const needsReview = results.filter((result) => result.confidence === 'low' || result.flagged).length
  const period = monthLabel({ year, month })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-modal-title"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-card border border-card-border bg-card text-card-foreground shadow-popover"
      >
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-card-border p-5">
          <div>
            <p className="text-sm text-muted-foreground">{bank} / {account} · {period}</p>
            <h2 id="review-modal-title" className="mt-1 text-xl font-semibold tracking-tight">Confirm transactions</h2>
            <p className="mt-1 text-sm text-muted-foreground">{results.length} rows{needsReview ? ` · ${needsReview} need a closer look` : ''}</p>
          </div>
          {saveState === 'saving' && <LoaderCircle className="animate-spin text-muted-foreground" aria-label="Saving" />}
        </header>

        {balanceCheck && (
          <div className="flex flex-wrap items-center gap-3 border-b border-card-border px-5 py-3">
            <SegmentedControl
              aria-label="Review section"
              size="sm"
              value={section}
              onValueChange={setSection}
              options={[{ value: 'transactions', label: 'Transactions' }, { value: 'balance', label: 'Balance check' }]}
            />
            {balanceCheck.reconciliation && !balanceCheck.reconciliation.matches && (
              <button
                type="button"
                onClick={() => setSection('balance')}
                className="flex items-center gap-1 rounded-pill bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/20"
              >
                <AlertCircle size={12} aria-hidden="true" /> Off by {formatAmount(Math.abs(balanceCheck.reconciliation.difference))}
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5">
          {section === 'balance' && balanceCheck ? (
            <BalanceCheckPanel balanceCheck={balanceCheck} pdfPreviewUrl={pdfPreviewUrl} />
          ) : (
            <>
              {existingCount !== null && existingCount > 0 && (
                <p role="alert" className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle size={16} aria-hidden="true" />
                  This replaces {existingCount} existing transaction{existingCount === 1 ? '' : 's'} already stored for {bank} / {account}, {period}.
                </p>
              )}
              {warning && (
                <p role="alert" className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle size={16} aria-hidden="true" />
                  {warning}
                </p>
              )}
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead>Category</TableHead><TableHead>Confidence</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                <TableBody>
                  {results.map((result, index) => (
                    <TableRow key={`${result.transaction.date}-${result.transaction.description}-${index}`}>
                      <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">{result.transaction.date}</TableCell>
                      <TableCell className="max-w-xs font-medium">{result.transaction.description}</TableCell>
                      <TableCell>
                        <label className="sr-only" htmlFor={`category-${index}`}>Category for {result.transaction.description}</label>
                        <select id={`category-${index}`} value={result.categoryId} onChange={(event) => void updateCategory(index, event.target.value)} disabled={saveState === 'saving'} className="h-9 max-w-44 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
                          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                        </select>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className={`rounded-pill px-2.5 py-1 text-xs font-medium ${result.confidence === 'low' ? 'bg-accent text-accent-foreground' : 'bg-secondary text-secondary-foreground'}`}>{result.confidence}</span>
                          {result.flagged && (
                            <span title={result.flagReason ?? 'Please double-check this one'} className="flex items-center gap-1 rounded-pill bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">
                              <AlertCircle size={12} aria-hidden="true" /> Verify
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right"><Amount value={result.transaction.amount} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
          {message && <p role={saveState === 'error' ? 'alert' : 'status'} className={`mt-4 flex items-center gap-2 text-sm ${saveState === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}><AlertCircle size={16} aria-hidden="true" />{message}</p>}
        </div>

        <footer className="flex justify-end gap-3 border-t border-card-border p-5">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saveState === 'saving'}>Cancel</Button>
          <Button type="button" onClick={() => void confirmSave()} disabled={saveState === 'saving'}>
            {saveState === 'saving' && <LoaderCircle className="animate-spin" />}
            {existingCount ? 'Overwrite & save' : 'Confirm & save'}
          </Button>
        </footer>
      </div>
    </div>
  )
}

export default ReviewModal
