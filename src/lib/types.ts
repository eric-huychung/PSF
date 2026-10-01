/** A transaction after bank-specific parsing, in a common shape every downstream module uses. */
export interface NormalizedTransaction {
  date: string // ISO 8601 (YYYY-MM-DD)
  amount: number // positive = money in, negative = money out
  description: string
  bank: string
  account: string
}

/** A transaction as saved to (and read from) a month file -- categorized, unlike the raw parse output above. */
export interface StoredTransaction extends NormalizedTransaction {
  categoryId: string
}

/**
 * A user-defined spending/income category. Flat list, no subcategories (see PRD).
 * `description` is optional -- set on the built-in defaults (see defaultCategories.ts) to steer
 * the categorizer, but never required. A category a user adds through Settings is just a name,
 * same as today; the categorizer prompt is written to work fine off the name alone.
 */
export interface Category {
  id: string
  name: string
  description?: string
  /** Internal money movement (e.g. paying off a credit card from checking), not real spend -- excluded from dashboard totals so it isn't double-counted alongside the purchases it pays for. */
  isTransfer?: boolean
}

/** A bank the user has set up, with the accounts they hold there. `bank`/`accounts` double as the storage keys used in `readMonth`/`writeMonth` -- no separate ids. */
export interface BankAccount {
  bank: string
  accounts: string[]
}

/** A merchant-description -> category mapping learned from user corrections. */
export interface Rule {
  descriptionPattern: string
  categoryId: string
}

/** A user-set monthly spending target for one category. Categories with no entry here have no target (treated as 0). */
export interface CategoryBudget {
  categoryId: string
  monthlyTarget: number
}

export type ConfidenceLevel = 'cache' | 'low' | 'medium' | 'high'

/** Which model answers a cache miss. `jev` is the default -- see `categorization/categorizer.ts`. */
export type CategorizationProvider = 'jev' | 'haiku' | 'sonnet' | 'gpt5nano'

/** Output of the categorization pipeline for one transaction. */
export interface CategorizationResult {
  transaction: NormalizedTransaction
  categoryId: string
  confidence: ConfidenceLevel
  source: 'cache' | CategorizationProvider
  /** Set by the runtime QA judge (extraction cross-check or low/medium-confidence category check) -- never by the categorizer itself. */
  flagged?: boolean
  /** Human-readable reason, only present when `flagged` is true. */
  flagReason?: string
}

export interface AppSettings {
  openRouterApiKey: string
}

/** Local persistence, backed by a real folder via the File System Access API. */
export interface StorageLayer {
  readMonth(bank: string, account: string, year: number, month: number): Promise<StoredTransaction[]>
  writeMonth(bank: string, account: string, year: number, month: number, transactions: StoredTransaction[]): Promise<void>
  readCategories(): Promise<Category[]>
  writeCategories(categories: Category[]): Promise<void>
  /** True once categories.json exists, even if it holds an empty list -- distinguishes "never set up" from "user deleted all categories". */
  categoriesFileExists(): Promise<boolean>
  readRules(): Promise<Rule[]>
  writeRules(rules: Rule[]): Promise<void>
  readBudgets(): Promise<CategoryBudget[]>
  writeBudgets(budgets: CategoryBudget[]): Promise<void>
  readSettings(): Promise<AppSettings | null>
  writeSettings(settings: AppSettings): Promise<void>
  readAccounts(): Promise<BankAccount[]>
  writeAccounts(accounts: BankAccount[]): Promise<void>
}

/**
 * Thin wrapper around an OpenRouter chat-completions model call, one model per call. Kept
 * separate from `Categorizer` (below) so switching `CATEGORIZATION_PROVIDER` away from `'jev'` to
 * try a specific model doesn't touch this shape at all.
 */
export interface LLMClient {
  categorizeBatch(
    transactions: NormalizedTransaction[],
    categories: Category[],
    model: 'haiku' | 'sonnet' | 'gpt5nano',
  ): Promise<Array<{ transaction: NormalizedTransaction; categoryId: string; confidence: ConfidenceLevel }>>
}

/**
 * One already-chosen categorization provider, bound to whichever model/client it needs at
 * construction -- the pipeline never asks which model to use per call. Implemented by
 * `jevCategorize.ts` (Jev) and by adapting `LLMClient` to one fixed model (`categorizer.ts`).
 */
export interface Categorizer {
  categorizeBatch(
    transactions: NormalizedTransaction[],
    categories: Category[],
  ): Promise<Array<{ transaction: NormalizedTransaction; categoryId: string; confidence: ConfidenceLevel }>>
}
