import type { BankAccount, StorageLayer, StoredTransaction } from '../lib/types'
import type { MonthRef } from './months'

export interface AccountRef {
  bank: string
  account: string
}

/**
 * Which (bank, account) pairs a filter selection covers. Empty bank/account means
 * "all" for that level -- this is what lets the dashboard and transactions list
 * default to every account instead of forcing one pick first.
 */
export function matchingAccounts(accounts: BankAccount[], bank: string, account: string): AccountRef[] {
  return accounts.flatMap((entry) => {
    if (bank && entry.bank !== bank) return []
    const names = account ? entry.accounts.filter((name) => name === account) : entry.accounts
    return names.map((name) => ({ bank: entry.bank, account: name }))
  })
}

/** Reads and flattens every (account, month) combination -- the only way to gather transactions, since storage has no listing capability. */
export async function loadTransactions(storage: StorageLayer, targets: AccountRef[], months: ReadonlyArray<MonthRef>): Promise<StoredTransaction[]> {
  const batches = await Promise.all(
    targets.flatMap((target) => months.map((month) => storage.readMonth(target.bank, target.account, month.year, month.month))),
  )
  return batches.flat()
}
