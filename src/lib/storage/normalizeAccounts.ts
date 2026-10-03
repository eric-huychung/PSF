import type { Account, AccountType, BankAccount } from '../types'

/** Same heuristic settingsIcons.ts used for the account icon before account type existed. */
const TYPE_KEYWORDS: Array<{ type: AccountType; keywords: string[] }> = [
  { type: 'credit', keywords: ['credit'] },
  { type: 'savings', keywords: ['saving'] },
]

function guessType(name: string): AccountType {
  const lower = name.toLowerCase()
  return TYPE_KEYWORDS.find((rule) => rule.keywords.some((keyword) => lower.includes(keyword)))?.type ?? 'checking'
}

function normalizeAccount(account: unknown): Account | null {
  if (typeof account === 'string') return { name: account, type: guessType(account) }
  if (account && typeof account === 'object' && 'name' in account && typeof (account as { name: unknown }).name === 'string') {
    return account as Account
  }
  return null
}

/**
 * accounts.json written before account types existed stored each account as a plain name
 * string, e.g. `{ bank: "Wells Fargo", accounts: ["Credit Card"] }`. Upgrades that on read so
 * the rest of the app only ever sees the current `Account[]` shape -- guessing a type from the
 * name (the same heuristic the account icon used to use) rather than defaulting everything to
 * "checking", which would mislabel every pre-existing credit card account. The guess is a
 * one-time migration default, not an ongoing behavior; already-typed accounts pass through
 * untouched.
 */
export function normalizeAccounts(raw: unknown): BankAccount[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry): BankAccount[] => {
    if (!entry || typeof entry !== 'object' || typeof (entry as { bank?: unknown }).bank !== 'string') return []
    const rawAccounts = (entry as { accounts?: unknown }).accounts
    const accounts = Array.isArray(rawAccounts) ? rawAccounts.map(normalizeAccount).filter((a): a is Account => a !== null) : []
    return [{ bank: (entry as { bank: string }).bank, accounts }]
  })
}
