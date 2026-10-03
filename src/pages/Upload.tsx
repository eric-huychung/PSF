import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, Check, FileUp, LoaderCircle } from 'lucide-react'
import { extractPdfText, findPdfTransactionCandidates, type PdfTextPage } from '../lib/adapters/pdf'
import { resolveSignConvention, normalizePdfCandidates, type PdfTransactionDraft } from '../lib/adapters/pdf-normalize'
import { createCategorizer } from '../lib/categorization/categorizer'
import { runImportPipeline } from '../lib/import/runImportPipeline'
import type { BankAccount, CategorizationResult, Category, StorageLayer } from '../lib/types'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { BankAccountSelect } from '../components/ui/bank-account-select'
import { BankLogo } from '../components/ui/bank-logo'
import { Modal } from '../components/ui/modal'
import { MonthYearSelect } from '../components/ui/month-year-select'
import { currentMonth, monthLabel, type MonthRef } from './months'
import { ReviewModal } from './ReviewModal'
import { loadStatementCoverage, type AccountCoverage } from './statementCoverage'
import { useBankAccountSelection } from './useBankAccountSelection'

export interface UploadProps {
  storage: StorageLayer
  accounts: BankAccount[]
  /** Pass an already-built categorizer for tests. Otherwise one is created from the stored OpenRouter key. */
  categorizer?: ReturnType<typeof createCategorizer>
  categories?: Category[]
}

type Status = 'idle' | 'categorizing' | 'error' | 'ready'

export function Upload({ storage, accounts, categorizer: suppliedCategorizer, categories: suppliedCategories }: UploadProps) {
  const { bank, account, setBank, setAccount } = useBankAccountSelection(accounts)
  const [period, setPeriod] = useState<MonthRef>(currentMonth())
  const [fileName, setFileName] = useState('')
  const [transactions, setTransactions] = useState<import('../lib/types').NormalizedTransaction[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  /**
   * Kept only to feed the silent extraction QA check in handleCategorize (parser-vs-Jev
   * agreement) -- never shown to the user and never used to change what gets imported.
   */
  const [pdfContext, setPdfContext] = useState<{ pages: PdfTextPage[]; statementYear: number; drafts: PdfTransactionDraft[]; isCreditCard: boolean } | null>(null)
  const [review, setReview] = useState<{ results: CategorizationResult[]; categories: Category[]; bank: string; account: string; year: number; month: number; warning?: string } | null>(null)
  const [coverage, setCoverage] = useState<AccountCoverage[]>([])
  const [coverageStatus, setCoverageStatus] = useState<'loading' | 'ready'>('loading')
  const [coverageReloadToken, setCoverageReloadToken] = useState(0)
  const [coverageYearPage, setCoverageYearPage] = useState(0)
  /** Whether a statement is already saved for the picked bank/account/month -- checked as soon as all three are chosen, so the confirm modal can warn before extraction/categorization even runs. */
  const [existingCount, setExistingCount] = useState<number | null>(null)

  useEffect(() => {
    if (accounts.length === 0) {
      setCoverage([])
      setCoverageStatus('ready')
      return
    }
    let active = true
    setCoverageStatus('loading')
    loadStatementCoverage(storage, accounts).then((result) => {
      if (active) {
        setCoverage(result)
        setCoverageStatus('ready')
      }
    })
    return () => { active = false }
  }, [accounts, storage, coverageReloadToken])

  useEffect(() => {
    if (!bank || !account) {
      setExistingCount(null)
      return
    }
    let active = true
    storage.readMonth(bank, account, period.year, period.month)
      .then((existing) => { if (active) setExistingCount(existing.length) })
      .catch(() => { if (active) setExistingCount(null) })
    return () => { active = false }
  }, [storage, bank, account, period.year, period.month, coverageReloadToken])

  const handleFile = async (file: File | undefined) => {
    if (!file || !bank || !account) return
    try {
      const pages = await extractPdfText(file)
      const candidates = findPdfTransactionCandidates(pages)
      const statementYear = Number(/(?:^|\D)(20\d{2})(?:\D|$)/.exec(file.name)?.[1] ?? new Date().getFullYear())
      const accountType = accounts.find((entry) => entry.bank === bank)?.accounts.find((item) => item.name === account)?.type ?? 'checking'
      const { isCreditCard, mismatch } = resolveSignConvention(accountType, pages)
      const normalized = normalizePdfCandidates(candidates, statementYear, isCreditCard)
      const parsed = normalized.drafts.map((draft) => ({
        date: draft.date,
        amount: draft.amount,
        description: draft.description,
        bank: 'pdf',
        account: '',
      }))
      setTransactions(parsed)
      setFileName(file.name)
      setStatus('ready')
      const rejectedMessage = normalized.rejected.length
        ? `${normalized.rejected.length} row${normalized.rejected.length === 1 ? '' : 's'} rejected during extraction.`
        : ''
      const mismatchMessage = mismatch
        ? `This statement's text doesn't look like what a ${accountType === 'credit' ? 'credit card' : 'checking/savings'} statement usually prints, but ${account} is tagged ${accountType === 'credit' ? 'credit card' : accountType} -- double check the transaction signs before saving.`
        : ''
      setMessage(parsed.length ? [rejectedMessage, mismatchMessage].filter(Boolean).join(' ') : 'No transaction candidates were found in this PDF.')
      setPdfContext({ pages, statementYear, drafts: normalized.drafts, isCreditCard })
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'Could not read this statement.')
    }
  }

  const handleCategorize = async () => {
    if (!transactions.length) return
    if (!bank || !account) {
      setMessage('Choose a bank and account before categorizing.')
      return
    }
    setStatus('categorizing')
    setMessage('Checking learned rules, then asking the model about anything new...')
    try {
      const categories = suppliedCategories ?? (await storage.readCategories())
      if (!categories.length) throw new Error('Add at least one category in Settings before importing.')
      const rules = await storage.readRules()
      const settings = await storage.readSettings()
      let categorizer = suppliedCategorizer
      if (!categorizer) {
        if (!settings?.openRouterApiKey) throw new Error('Add an OpenRouter API key in Settings before categorizing.')
        categorizer = createCategorizer({ apiKey: settings.openRouterApiKey })
      }

      // Quiet QA pass, not shown to the user as a step: cross-checks extraction against Jev, then
      // spot-checks any low/medium-confidence category pick. Both fail open -- an error here never
      // blocks categorizing, it just means fewer "please verify" hints below.
      const judgeOptions = settings?.openRouterApiKey ? { apiKey: settings.openRouterApiKey } : null
      const input = transactions.map((transaction) => ({ ...transaction, bank, account }))
      const { results, missingRowCount } = await runImportPipeline({
        transactions: input,
        categories,
        rules,
        categorizer: categorizer.categorizer,
        provider: categorizer.provider,
        judgeOptions,
        pdfContext,
      })

      setStatus('ready')
      setMessage('')
      const warning = missingRowCount > 0
        ? `Jev found ${missingRowCount} transaction${missingRowCount === 1 ? '' : 's'} on this statement that the parser didn't pick up -- double check the total against your statement before saving.`
        : undefined
      setReview({ results, categories, bank, account, year: period.year, month: period.month, warning })
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'Categorization failed.')
    }
  }

  const resetUpload = () => {
    setFileName('')
    setTransactions([])
    setMessage('')
    setStatus('idle')
    setPdfContext(null)
    setCoverageReloadToken((token) => token + 1)
  }

  const coverageYears = useMemo(() => {
    const years = new Set<number>([currentMonth().year])
    coverage.forEach((entry) => entry.months.forEach((month) => years.add(month.year)))
    return Array.from(years).sort((a, b) => b - a)
  }, [coverage])
  const selectedCoverageYear = coverageYears[coverageYearPage] ?? coverageYears[0]

  const canPickFile = Boolean(bank && account)
  const readyToConfirm = transactions.length > 0 && !review
  const hasExistingStatement = Boolean(existingCount)
  const existingStatementDetail = hasExistingStatement
    ? `This will overwrite ${existingCount} existing transaction${existingCount === 1 ? '' : 's'} already saved for ${bank} / ${account}, ${monthLabel(period)}.`
    : ''

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 sm:p-10">
      <header>
        <p className="text-sm text-muted-foreground">Import a monthly statement</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Upload statement</h1>
      </header>

      <Card>
        <CardHeader>
          <div>
              <CardTitle>Choose a PDF statement</CardTitle>
              <CardDescription>PDF text is extracted locally. Only confirmed transaction details reach the categorization model.</CardDescription>
          </div>
          <FileUp className="text-muted-foreground" aria-hidden="true" />
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
              Add a bank and account in Settings before uploading a statement.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <BankAccountSelect accounts={accounts} bank={bank} account={account} onBankChange={setBank} onAccountChange={setAccount} required />
                <label className="flex flex-col gap-2 text-sm font-medium">
                  Statement month and year
                  <MonthYearSelect value={period} onChange={setPeriod} />
                </label>
              </div>

              <label
                className={`flex min-h-28 flex-col items-center justify-center rounded-card border border-dashed border-border px-4 text-center text-sm transition-colors focus-within:ring-2 focus-within:ring-ring ${
                  canPickFile ? 'cursor-pointer bg-secondary/50 hover:bg-secondary' : 'cursor-not-allowed bg-secondary/20 opacity-60'
                }`}
              >
                <span className="font-medium">Select PDF</span>
                <span className="mt-1 text-xs text-muted-foreground">
                  {canPickFile ? 'One statement at a time' : 'Choose a bank and account above first'}
                </span>
                <input
                  className="sr-only"
                  type="file"
                  accept=".pdf,application/pdf"
                  disabled={!canPickFile}
                  onChange={(event) => void handleFile(event.target.files?.[0])}
                />
              </label>
              {fileName && <p className="text-sm text-muted-foreground">{fileName}</p>}

              {message && !readyToConfirm && (
                <p role={status === 'error' ? 'alert' : 'status'} className={`flex items-center gap-2 text-sm ${status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {status === 'error' ? <AlertCircle size={16} aria-hidden="true" /> : status === 'ready' && transactions.length ? <Check size={16} aria-hidden="true" /> : null}
                  {message}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {accounts.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Statement coverage</CardTitle>
              <CardDescription>Months already uploaded per account, {selectedCoverageYear}.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {accounts.map((entry) => (
              <div key={entry.bank} className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <BankLogo name={entry.bank} />
                  {entry.bank}
                </div>
                <div className="flex flex-col gap-2 pl-7">
                  {entry.accounts.map((account) => {
                    const accountName = account.name
                    const months = (coverage.find((item) => item.bank === entry.bank && item.account === accountName)?.months ?? [])
                      .filter((month) => month.year === selectedCoverageYear)
                    return (
                      <div key={accountName} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="w-32 shrink-0 truncate text-muted-foreground">{accountName}</span>
                        {coverageStatus === 'loading' ? (
                          <span className="text-xs text-muted-foreground">Checking...</span>
                        ) : months.length > 0 ? (
                          months.map((month) => (
                            <span key={monthLabel(month)} className="rounded-pill bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                              {monthLabel(month, { month: 'short', year: 'numeric' })}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">No statements uploaded yet</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            {coverageYears.length > 1 && (
              <div className="flex items-center justify-center gap-1 border-t border-border pt-4">
                {coverageYears.map((year, index) => (
                  <Button
                    key={year}
                    type="button"
                    variant={index === coverageYearPage ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={() => setCoverageYearPage(index)}
                    aria-current={index === coverageYearPage ? 'page' : undefined}
                  >
                    {year}
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {readyToConfirm && (
        <Modal
          titleId="confirm-upload-title"
          title={
            <span className="flex items-center gap-2">
              Confirm statement import
              {hasExistingStatement && (
                <span title={existingStatementDetail} className="inline-flex text-destructive">
                  <AlertTriangle size={16} aria-hidden="true" />
                </span>
              )}
            </span>
          }
          onClose={() => { if (status !== 'categorizing') resetUpload() }}
          className="max-w-md"
        >
          <div className="flex flex-col gap-4">
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">File</dt>
                <dd className="min-w-0 truncate text-right font-medium">{fileName}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Bank</dt>
                <dd className="flex items-center gap-1.5 font-medium"><BankLogo name={bank} />{bank}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Account</dt>
                <dd className="font-medium">{account}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Statement month</dt>
                <dd className="font-medium">{monthLabel(period)}</dd>
              </div>
            </dl>

            {message && (
              <p role={status === 'error' ? 'alert' : 'status'} className={`flex items-center gap-2 text-sm ${status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                {status === 'error' && <AlertCircle size={16} aria-hidden="true" />}
                {message}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={resetUpload} disabled={status === 'categorizing'}>Cancel</Button>
              <Button type="button" onClick={() => void handleCategorize()} disabled={status === 'categorizing'}>
                {status === 'categorizing' && <LoaderCircle className="animate-spin" />}
                {status === 'categorizing' ? 'Extracting and categorizing...' : hasExistingStatement ? 'Overwrite & import' : 'Confirm & import'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {review && (
        <ReviewModal
          results={review.results}
          categories={review.categories}
          storage={storage}
          bank={review.bank}
          account={review.account}
          year={review.year}
          month={review.month}
          warning={review.warning}
          onClose={() => setReview(null)}
          onSaved={resetUpload}
        />
      )}
    </main>
  )
}

export default Upload
