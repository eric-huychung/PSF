import { useEffect, useState } from 'react'
import { AlertCircle, ArrowLeftRight, Check, ChevronLeft, ChevronRight, Eye, EyeOff, KeyRound, Landmark, LockKeyhole, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Modal } from '../components/ui/modal'
import { SegmentedControl } from '../components/ui/segmented-control'
import { BankLogo } from '../components/ui/bank-logo'
import { BankPicker, OTHER_BANK } from '../components/ui/bank-picker'
import { findBankOption } from '../lib/banks'
import { getAccountIcon, getCategoryIcon } from '../lib/settingsIcons'
import { compactRules } from '../lib/categorization/rulesCache'
import type { Account, AccountType, BankAccount, Category, CategoryBudget, Rule, StorageLayer } from '../lib/types'
import { recheckCategories } from './recheckCategories'
import { useAsyncAction } from './useAsyncAction'

// Stable reference so an un-passed `categories` prop doesn't produce a new array every render --
// that would re-trigger the seeding effect below on every render, forever.
const EMPTY_CATEGORIES: Category[] = []

const MAX_CATEGORY_NAME_LENGTH = 80
const MAX_ACCOUNT_NAME_LENGTH = 80
const RULES_PER_PAGE = 10
/** How far back to re-check statements against current rules. Storage has no "list all months"
 * API, so this is a bounded probe -- mirrors STATEMENT_HISTORY_MONTHS in Transactions.tsx. */
const CATEGORY_RECHECK_MONTHS = 10 * 12
type KeyFeedback = { kind: 'success' | 'error'; message: string } | null
type PendingDelete = { title: string; description: string; confirmLabel: string; onConfirm: () => void } | null
export type SettingsSection = 'key' | 'categories' | 'budgets' | 'accounts' | 'rules'
const SECTIONS: Array<{ value: SettingsSection; label: string }> = [
  { value: 'key', label: 'API key' },
  { value: 'categories', label: 'Categories' },
  { value: 'rules', label: 'Rules' },
  { value: 'budgets', label: 'Budgets' },
  { value: 'accounts', label: 'Banks & accounts' },
]

interface SettingsProps {
  storage: StorageLayer
  /** Loaded and bootstrapped once by App -- reading it here directly would race the first-run default-categories write. */
  categories?: Category[]
  onCategoriesChanged?: (categories: Category[]) => void
  onAccountsChanged?: (accounts: BankAccount[]) => void
  /** Which section to land on, e.g. when another tab routes here to add a bank. Defaults to the API key section. */
  initialSection?: SettingsSection
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

function categoryId(name: string, categories: Category[]): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'category'
  const usedIds = new Set(categories.map((category) => category.id))
  let id = base
  let suffix = 2
  while (usedIds.has(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  return id
}

function validateCategoryName(name: string, categories: Category[], currentId?: string): string | null {
  const trimmedName = name.trim()
  if (!trimmedName) return 'Category name is required.'
  if (trimmedName.length > MAX_CATEGORY_NAME_LENGTH) {
    return `Category names must be ${MAX_CATEGORY_NAME_LENGTH} characters or fewer.`
  }
  if (
    categories.some(
      (category) => category.id !== currentId && category.name.trim().toLocaleLowerCase() === trimmedName.toLocaleLowerCase(),
    )
  ) {
    return 'Category names must be unique.'
  }
  return null
}

function validateBankName(name: string, accounts: BankAccount[]): string | null {
  const trimmedName = name.trim()
  if (!trimmedName) return 'Bank name is required.'
  if (trimmedName.length > MAX_ACCOUNT_NAME_LENGTH) return `Bank names must be ${MAX_ACCOUNT_NAME_LENGTH} characters or fewer.`
  if (accounts.some((entry) => entry.bank.toLocaleLowerCase() === trimmedName.toLocaleLowerCase())) {
    return 'That bank has already been added.'
  }
  return null
}

const ACCOUNT_TYPE_OPTIONS: Array<{ value: AccountType; label: string }> = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit', label: 'Credit card' },
]

function validateAccountName(name: string, existingAccounts: Account[]): string | null {
  const trimmedName = name.trim()
  if (!trimmedName) return 'Account name is required.'
  if (trimmedName.length > MAX_ACCOUNT_NAME_LENGTH) return `Account names must be ${MAX_ACCOUNT_NAME_LENGTH} characters or fewer.`
  if (existingAccounts.some((account) => account.name.toLocaleLowerCase() === trimmedName.toLocaleLowerCase())) {
    return 'That account already exists for this bank.'
  }
  return null
}

export function Settings({ storage, categories: categoriesProp = EMPTY_CATEGORIES, onCategoriesChanged, onAccountsChanged, initialSection }: SettingsProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection ?? 'key')
  const [categories, setCategories] = useState<Category[]>(categoriesProp)
  const [budgets, setBudgets] = useState<CategoryBudget[]>([])
  const [budgetDrafts, setBudgetDrafts] = useState<Record<string, string>>({})
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [rulesPage, setRulesPage] = useState(0)
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [hasSavedKey, setHasSavedKey] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [newBank, setNewBank] = useState('')
  const [bankChoice, setBankChoice] = useState('')
  const [newAccountByBank, setNewAccountByBank] = useState<Record<string, string>>({})
  const [newAccountTypeByBank, setNewAccountTypeByBank] = useState<Record<string, AccountType>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [keyFeedback, setKeyFeedback] = useState<KeyFeedback>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null)

  function clearStatus() {
    setError(null)
    setNotice(null)
  }

  const keyAction = useAsyncAction((message) => setKeyFeedback({ kind: 'error', message }), clearStatus)
  const categoriesAction = useAsyncAction(setError, clearStatus)
  const rulesAction = useAsyncAction(setError, clearStatus)
  const recheckAction = useAsyncAction(setError, clearStatus)
  const budgetsAction = useAsyncAction(setError, clearStatus)
  const accountsAction = useAsyncAction(setError, clearStatus)

  // Seeded from App's own bootstrapped categories state, not read here directly -- App owns the
  // first-run default-categories write, and reading the file straight from this effect would
  // race it on an empty folder. `onCategoriesChanged` below keeps App's copy (and so this prop)
  // in sync with edits made in this page.
  useEffect(() => {
    setCategories(categoriesProp)
  }, [categoriesProp])

  useEffect(() => {
    let active = true
    Promise.all([storage.readSettings(), storage.readAccounts(), storage.readBudgets(), storage.readRules()])
      .then(([settings, storedAccounts, storedBudgets, storedRules]) => {
        if (!active) return
        setApiKey(settings?.openRouterApiKey ?? '')
        setHasSavedKey(Boolean(settings?.openRouterApiKey))
        setAccounts(storedAccounts)
        setBudgets(storedBudgets)
        setRules(storedRules)
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [storage])

  async function saveKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedKey = apiKey.trim()
    if (!trimmedKey) {
      setKeyFeedback({ kind: 'error', message: 'Enter an OpenRouter API key before saving.' })
      return
    }
    await keyAction.run(async () => {
      await storage.writeSettings({ openRouterApiKey: trimmedKey })
      setApiKey(trimmedKey)
      setHasSavedKey(true)
      setKeyFeedback({ kind: 'success', message: 'OpenRouter API key saved.' })
    })
  }

  async function persistCategories(nextCategories: Category[], successMessage: string) {
    await categoriesAction.run(async () => {
      await storage.writeCategories(nextCategories)
      setCategories(nextCategories)
      onCategoriesChanged?.(nextCategories)
      setNotice(successMessage)
    })
  }

  async function addCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = newCategory.trim()
    const validationError = validateCategoryName(trimmedName, categories)
    if (validationError) {
      setError(validationError)
      return
    }
    await persistCategories([...categories, { id: categoryId(trimmedName, categories), name: trimmedName }], 'Category added.')
    setNewCategory('')
  }

  function beginRename(category: Category) {
    setEditingId(category.id)
    setEditingName(category.name)
    setError(null)
    setNotice(null)
  }

  async function renameCategory(event: React.FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault()
    const trimmedName = editingName.trim()
    const validationError = validateCategoryName(trimmedName, categories, id)
    if (validationError) {
      setError(validationError)
      return
    }
    const nextCategories = categories.map((category) => (category.id === id ? { ...category, name: trimmedName } : category))
    await persistCategories(nextCategories, 'Category renamed.')
    setEditingId(null)
    setEditingName('')
  }

  async function removeCategory(category: Category) {
    const nextCategories = categories.filter((item) => item.id !== category.id)
    await persistCategories(nextCategories, 'Category removed.')
  }

  function confirmRemoveCategory(category: Category) {
    setPendingDelete({
      title: `Remove ${category.name}?`,
      description: 'This category will no longer be available for review or budgets.',
      confirmLabel: 'Remove category',
      onConfirm: () => removeCategory(category),
    })
  }

  async function cleanUpRules() {
    await rulesAction.run(async () => {
      const compacted = compactRules(rules)
      const removed = rules.length - compacted.length
      await storage.writeRules(compacted)
      setRules(compacted)
      setNotice(removed > 0 ? `Removed ${removed} redundant rule${removed === 1 ? '' : 's'}.` : 'Rules are already clean -- nothing to remove.')
    })
  }

  async function removeRule(rule: Rule) {
    await rulesAction.run(async () => {
      const nextRules = rules.filter((item) => item.descriptionPattern !== rule.descriptionPattern)
      await storage.writeRules(nextRules)
      setRules(nextRules)
      setNotice('Rule removed.')
    })
  }

  function confirmRemoveRule(rule: Rule) {
    const categoryName = categories.find((category) => category.id === rule.categoryId)?.name ?? rule.categoryId
    setPendingDelete({
      title: 'Remove rule?',
      description: `"${rule.descriptionPattern}" will no longer auto-categorize as ${categoryName}.`,
      confirmLabel: 'Remove rule',
      onConfirm: () => removeRule(rule),
    })
  }

  async function handleRecheckCategories() {
    await recheckAction.run(async () => {
      const changed = await recheckCategories(storage, accounts, CATEGORY_RECHECK_MONTHS)
      setNotice(changed > 0 ? `Recategorized ${changed} transaction${changed === 1 ? '' : 's'} to match current rules.` : 'Every transaction already matches the current rules.')
    })
  }

  async function toggleTransfer(category: Category) {
    const nextCategories = categories.map((item) =>
      item.id === category.id ? { ...item, isTransfer: !item.isTransfer } : item,
    )
    await persistCategories(
      nextCategories,
      category.isTransfer ? 'Category now counts toward totals.' : 'Category excluded from totals as a transfer.',
    )
  }

  function budgetDraftValue(categoryId: string): string {
    if (budgetDrafts[categoryId] !== undefined) return budgetDrafts[categoryId]
    const target = budgets.find((budget) => budget.categoryId === categoryId)?.monthlyTarget
    return target ? String(target) : ''
  }

  async function commitBudget(categoryId: string) {
    const raw = budgetDrafts[categoryId]
    if (raw === undefined) return
    setBudgetDrafts((current) => { const { [categoryId]: _removed, ...rest } = current; return rest })
    const parsed = Number(raw)
    const nextTarget = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
    const currentTarget = budgets.find((budget) => budget.categoryId === categoryId)?.monthlyTarget ?? 0
    if (nextTarget === currentTarget) return
    const nextBudgets = nextTarget > 0
      ? [...budgets.filter((budget) => budget.categoryId !== categoryId), { categoryId, monthlyTarget: nextTarget }]
      : budgets.filter((budget) => budget.categoryId !== categoryId)
    await budgetsAction.run(async () => {
      await storage.writeBudgets(nextBudgets)
      setBudgets(nextBudgets)
      setNotice('Budget updated.')
    })
  }

  async function persistAccounts(nextAccounts: BankAccount[], successMessage: string) {
    await accountsAction.run(async () => {
      await storage.writeAccounts(nextAccounts)
      setAccounts(nextAccounts)
      onAccountsChanged?.(nextAccounts)
      setNotice(successMessage)
    })
  }

  function chooseBank(choice: string) {
    setBankChoice(choice)
    setNewBank(choice === OTHER_BANK ? '' : choice)
    setError(null)
  }

  async function addBank(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = newBank.trim()
    const validationError = validateBankName(trimmedName, accounts)
    if (validationError) {
      setError(validationError)
      return
    }
    await persistAccounts([...accounts, { bank: trimmedName, accounts: [] }], 'Bank added.')
    setNewBank('')
    setBankChoice('')
  }

  async function removeBank(bank: string) {
    await persistAccounts(accounts.filter((entry) => entry.bank !== bank), 'Bank removed.')
  }

  function confirmRemoveBank(bank: string) {
    setPendingDelete({
      title: `Remove ${bank}?`,
      description: 'This removes the bank and all of its accounts from your list.',
      confirmLabel: 'Remove bank',
      onConfirm: () => removeBank(bank),
    })
  }

  async function addAccount(event: React.FormEvent<HTMLFormElement>, bank: string) {
    event.preventDefault()
    const entry = accounts.find((item) => item.bank === bank)
    if (!entry) return
    const trimmedName = (newAccountByBank[bank] ?? '').trim()
    const validationError = validateAccountName(trimmedName, entry.accounts)
    if (validationError) {
      setError(validationError)
      return
    }
    const type = newAccountTypeByBank[bank] ?? 'checking'
    const nextAccounts = accounts.map((item) => (item.bank === bank ? { ...item, accounts: [...item.accounts, { name: trimmedName, type }] } : item))
    await persistAccounts(nextAccounts, 'Account added.')
    setNewAccountByBank((current) => ({ ...current, [bank]: '' }))
    setNewAccountTypeByBank((current) => ({ ...current, [bank]: 'checking' }))
  }

  async function removeAccount(bank: string, account: string) {
    const nextAccounts = accounts.map((item) => (item.bank === bank ? { ...item, accounts: item.accounts.filter((entry) => entry.name !== account) } : item))
    await persistAccounts(nextAccounts, 'Account removed.')
  }

  function confirmRemoveAccount(bank: string, account: string) {
    setPendingDelete({
      title: `Remove ${account}?`,
      description: `This removes the account from ${bank}.`,
      confirmLabel: 'Remove account',
      onConfirm: () => removeAccount(bank, account),
    })
  }

  async function runPendingDelete() {
    if (!pendingDelete) return
    const { onConfirm } = pendingDelete
    setPendingDelete(null)
    await onConfirm()
  }

  const rulesTotalPages = Math.max(1, Math.ceil(rules.length / RULES_PER_PAGE))
  const rulesPageIndex = Math.min(rulesPage, rulesTotalPages - 1)

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header>
        <p className="mb-2 text-sm font-medium text-muted-foreground">Preferences</p>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">Manage your AI connection and spending categories.</p>
      </header>

      <SegmentedControl aria-label="Settings section" value={section} onValueChange={setSection} options={SECTIONS} />

      {error && (
        <div role="alert" className="rounded-lg border border-card-border bg-card px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-lg border border-card-border bg-card px-4 py-3 text-sm text-muted-foreground">
          {notice}
        </div>
      )}

      {section === 'key' && (
      <Card>
        <CardHeader className="items-start">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-card-border bg-secondary text-primary" aria-hidden="true">
              <KeyRound size={16} />
            </span>
            <div>
              <CardTitle>OpenRouter key</CardTitle>
              <CardDescription className="mt-1">Used for transaction categorization. Never sent to PSF.</CardDescription>
            </div>
          </div>
          {hasSavedKey && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-pill border border-card-border bg-secondary px-2.5 py-1 text-xs font-medium text-positive">
              <Check size={13} aria-hidden="true" />
              Saved
            </span>
          )}
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={saveKey}>
            <div className="flex flex-col gap-2">
              <label htmlFor="openrouter-key" className="text-sm font-medium">
                API key
              </label>
              <div className="flex h-11 items-center gap-1 rounded-lg border border-input bg-background px-1">
                <input
                  id="openrouter-key"
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  autoComplete="new-password"
                  placeholder="sk-or-..."
                  disabled={loading || keyAction.pending}
                  className="min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  onClick={() => setShowApiKey((visible) => !visible)}
                  aria-label={showApiKey ? 'Hide OpenRouter API key' : 'Show OpenRouter API key'}
                  disabled={loading || keyAction.pending}
                >
                  {showApiKey ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <LockKeyhole size={14} aria-hidden="true" />
                Stored locally in <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">settings.json</code>
              </p>
              <Button type="submit" disabled={loading || keyAction.pending}>
                {keyAction.pending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      )}

      {keyFeedback && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="key-feedback-title"
            aria-describedby="key-feedback-message"
            className="w-full max-w-sm rounded-card border border-card-border bg-card p-5 text-card-foreground shadow-popover"
          >
            <div className="flex items-start gap-3">
              <span className={`flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary ${keyFeedback.kind === 'success' ? 'text-positive' : 'text-destructive'}`} aria-hidden="true">
                {keyFeedback.kind === 'success' ? <Check size={18} /> : <AlertCircle size={18} />}
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="key-feedback-title" className="font-semibold">
                  {keyFeedback.kind === 'success' ? 'Key saved' : 'Could not save key'}
                </h2>
                <p id="key-feedback-message" className="mt-1 text-sm text-muted-foreground">{keyFeedback.message}</p>
              </div>
              <button
                type="button"
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={() => setKeyFeedback(null)}
                aria-label="Close save result"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="mt-5 flex justify-end">
              <Button type="button" size="sm" onClick={() => setKeyFeedback(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <Modal titleId="confirm-delete-title" title={pendingDelete.title} onClose={() => setPendingDelete(null)}>
          <p className="text-sm text-muted-foreground">{pendingDelete.description}</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void runPendingDelete()}>
              {pendingDelete.confirmLabel}
            </Button>
          </div>
        </Modal>
      )}

      {section === 'categories' && (
      <Card>
        <CardHeader>
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>Categories</CardTitle>
              <span className="text-sm text-muted-foreground" aria-label={`${categories.length} categories`}>
                {categories.length}
              </span>
            </div>
            <CardDescription className="mt-1">Keep a flat list of categories for transaction review.</CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleRecheckCategories}
              disabled={recheckAction.pending || rules.length === 0}
              title="Re-apply current rules to already-imported transactions"
            >
              Recheck categories
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading settings...</p>
          ) : (
            <>
              <form className="flex flex-col gap-3 sm:flex-row" onSubmit={addCategory}>
                <label htmlFor="new-category" className="sr-only">
                  New category name
                </label>
                <input
                  id="new-category"
                  value={newCategory}
                  onChange={(event) => setNewCategory(event.target.value)}
                  placeholder="Add a category"
                  maxLength={MAX_CATEGORY_NAME_LENGTH}
                  disabled={categoriesAction.pending}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
                />
                <Button type="submit" variant="secondary" disabled={categoriesAction.pending}>
                  <Plus size={16} aria-hidden="true" />
                  Add category
                </Button>
              </form>

              {categories.length > 0 ? (
                <ul className="flex flex-col gap-0.5" aria-label="Categories">
                  {categories.map((category) => {
                    const CategoryIcon = getCategoryIcon(category.name)
                    return (
                      <li key={category.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                        <span
                          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-card-border bg-secondary text-primary"
                          aria-hidden="true"
                        >
                          <CategoryIcon size={16} />
                        </span>
                        {editingId === category.id ? (
                          <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={(event) => renameCategory(event, category.id)}>
                            <label htmlFor={`rename-${category.id}`} className="sr-only">
                              Rename {category.name}
                            </label>
                            <input
                              id={`rename-${category.id}`}
                              value={editingName}
                              onChange={(event) => setEditingName(event.target.value)}
                              maxLength={MAX_CATEGORY_NAME_LENGTH}
                              autoFocus
                              disabled={categoriesAction.pending}
                              className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
                            />
                            <Button type="submit" size="icon" variant="ghost" disabled={categoriesAction.pending} aria-label="Save name">
                              <Check size={16} aria-hidden="true" />
                            </Button>
                            <Button type="button" size="icon" variant="ghost" onClick={() => setEditingId(null)} disabled={categoriesAction.pending} aria-label="Cancel rename">
                              <X size={16} aria-hidden="true" />
                            </Button>
                          </form>
                        ) : (
                          <>
                            <span className="min-w-0 flex-1 break-words text-sm font-medium">
                              {category.name}
                              {category.isTransfer && (
                                <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">Transfer</span>
                              )}
                            </span>
                            <div className="flex shrink-0 gap-0.5">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => toggleTransfer(category)}
                                disabled={categoriesAction.pending}
                                aria-pressed={!!category.isTransfer}
                                aria-label={category.isTransfer ? `Stop excluding ${category.name} from totals` : `Exclude ${category.name} from totals as a transfer`}
                                title={category.isTransfer ? 'Transfer -- excluded from dashboard totals' : 'Mark as transfer (excluded from dashboard totals)'}
                                className={category.isTransfer ? 'text-primary' : undefined}
                              >
                                <ArrowLeftRight size={15} aria-hidden="true" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => beginRename(category)}
                                disabled={categoriesAction.pending}
                                aria-label={`Rename ${category.name}`}
                              >
                                <Pencil size={15} aria-hidden="true" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => confirmRemoveCategory(category)}
                                disabled={categoriesAction.pending}
                                aria-label={`Remove ${category.name}`}
                                className="hover:text-destructive"
                              >
                                <Trash2 size={15} aria-hidden="true" />
                              </Button>
                            </div>
                          </>
                        )}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
                  No categories yet.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
      )}

      {section === 'rules' && (
      <Card>
        <CardHeader>
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>Rules</CardTitle>
              <span className="text-sm text-muted-foreground" aria-label={`${rules.length} rules`}>
                {rules.length}
              </span>
            </div>
            <CardDescription className="mt-1">Merchant patterns learned from corrections, used to auto-categorize imports.</CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={cleanUpRules}
              disabled={rulesAction.pending || rules.length === 0}
              title="Remove redundant rules that match the same merchant"
            >
              Clean up rules
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading settings...</p>
          ) : rules.length > 0 ? (
            <>
              <ul className="flex flex-col gap-0.5" aria-label="Rules">
                {rules.slice(rulesPageIndex * RULES_PER_PAGE, rulesPageIndex * RULES_PER_PAGE + RULES_PER_PAGE).map((rule) => {
                  const categoryName = categories.find((category) => category.id === rule.categoryId)?.name ?? rule.categoryId
                  return (
                    <li key={rule.descriptionPattern} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{rule.descriptionPattern}</p>
                        <p className="truncate text-xs text-muted-foreground">{categoryName}</p>
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => confirmRemoveRule(rule)}
                        aria-label={`Remove rule for ${rule.descriptionPattern}`}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </Button>
                    </li>
                  )
                })}
              </ul>
              {rulesTotalPages > 1 && (
                <div className="mt-3 flex items-center justify-between">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setRulesPage((page) => page - 1)}
                    disabled={rulesPageIndex === 0}
                  >
                    <ChevronLeft size={15} aria-hidden="true" />
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {rulesPageIndex + 1} of {rulesTotalPages}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setRulesPage((page) => page + 1)}
                    disabled={rulesPageIndex >= rulesTotalPages - 1}
                  >
                    Next
                    <ChevronRight size={15} aria-hidden="true" />
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
              No rules yet.
            </p>
          )}
        </CardContent>
      </Card>
      )}

      {section === 'budgets' && (
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Budgets</CardTitle>
            <CardDescription className="mt-1">Set a monthly target per category. Leave a category at $0 for no target.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading settings...</p>
          ) : categories.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
              Add categories first, then set a target for each.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Category budgets">
              {categories.map((category) => (
                <li key={category.id} className="flex items-center justify-between gap-3 px-3 py-3">
                  <span className="min-w-0 break-words text-sm font-medium">{category.name}</span>
                  <label className="flex items-center gap-2 text-sm">
                    <span className="sr-only">Monthly target for {category.name}</span>
                    <span className="text-muted-foreground">$</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      placeholder="0"
                      value={budgetDraftValue(category.id)}
                      onChange={(event) => setBudgetDrafts((current) => ({ ...current, [category.id]: event.target.value }))}
                      onBlur={() => void commitBudget(category.id)}
                      disabled={budgetsAction.pending}
                      className="h-9 w-28 rounded-lg border border-input bg-background px-2 text-right text-sm text-foreground tabular-nums"
                    />
                    <span className="text-muted-foreground">/mo</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      )}

      {section === 'accounts' && (
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Banks & accounts</CardTitle>
            <CardDescription className="mt-1">Set up each bank and the accounts you hold there. Upload uses this list.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading settings...</p>
          ) : (
            <>
              <form className="flex flex-col gap-3 sm:flex-row" onSubmit={addBank}>
                <BankPicker value={bankChoice} onChange={chooseBank} disabled={accountsAction.pending} />
                {bankChoice === OTHER_BANK && (
                  <>
                    <label htmlFor="new-bank-other" className="sr-only">
                      Custom bank name
                    </label>
                    <input
                      id="new-bank-other"
                      value={newBank}
                      onChange={(event) => setNewBank(event.target.value)}
                      placeholder="Bank name"
                      maxLength={MAX_ACCOUNT_NAME_LENGTH}
                      disabled={accountsAction.pending}
                      autoFocus
                      className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
                    />
                  </>
                )}
                <Button type="submit" variant="secondary" disabled={accountsAction.pending}>
                  <Plus size={16} aria-hidden="true" />
                  Add bank
                </Button>
              </form>

              {accounts.length > 0 ? (
                <ul className="flex flex-col divide-y divide-border" aria-label="Banks">
                  {accounts.map((entry) => (
                    <li key={entry.bank} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                        <span
                          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-card-border bg-secondary"
                          aria-hidden="true"
                        >
                          {findBankOption(entry.bank) ? <BankLogo name={entry.bank} className="size-9 rounded-lg border-0 bg-transparent text-sm" /> : <Landmark size={16} className="text-primary" />}
                        </span>
                        <span className="min-w-0 flex-1 break-words text-sm font-semibold">{entry.bank}</span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => confirmRemoveBank(entry.bank)}
                          disabled={accountsAction.pending}
                          aria-label={`Remove ${entry.bank}`}
                          className="hover:text-destructive"
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </Button>
                      </div>

                      {entry.accounts.length > 0 && (
                        <ul className="flex flex-col gap-0.5 pl-9" aria-label={`${entry.bank} accounts`}>
                          {entry.accounts.map((account) => {
                            const AccountIcon = getAccountIcon(account.type)
                            return (
                              <li key={account.name} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                                <AccountIcon size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                                <span className="min-w-0 flex-1 break-words text-sm text-foreground">{account.name}</span>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => confirmRemoveAccount(entry.bank, account.name)}
                                  disabled={accountsAction.pending}
                                  aria-label={`Remove ${account.name}`}
                                  className="size-8 hover:text-destructive"
                                >
                                  <Trash2 size={14} aria-hidden="true" />
                                </Button>
                              </li>
                            )
                          })}
                        </ul>
                      )}

                      <form className="flex flex-col gap-2 pl-9 sm:flex-row" onSubmit={(event) => addAccount(event, entry.bank)}>
                        <label htmlFor={`new-account-${entry.bank}`} className="sr-only">
                          New account for {entry.bank}
                        </label>
                        <input
                          id={`new-account-${entry.bank}`}
                          value={newAccountByBank[entry.bank] ?? ''}
                          onChange={(event) => setNewAccountByBank((current) => ({ ...current, [entry.bank]: event.target.value }))}
                          placeholder="Add an account, e.g. Checking"
                          maxLength={MAX_ACCOUNT_NAME_LENGTH}
                          disabled={accountsAction.pending}
                          className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
                        />
                        <SegmentedControl
                          aria-label={`Account type for ${entry.bank}`}
                          size="sm"
                          value={newAccountTypeByBank[entry.bank] ?? 'checking'}
                          onValueChange={(type) => setNewAccountTypeByBank((current) => ({ ...current, [entry.bank]: type }))}
                          options={ACCOUNT_TYPE_OPTIONS}
                        />
                        <Button type="submit" size="sm" variant="secondary" disabled={accountsAction.pending}>
                          <Plus size={14} aria-hidden="true" />
                          Add account
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
                  No banks yet.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
      )}
    </main>
  )
}

export default Settings
