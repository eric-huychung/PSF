import type { BankAccount, StorageLayer } from '../lib/types'
import { matchingAccounts } from './transactionSource'
import { monthKey, recentMonths, type MonthRef } from './months'

export interface AccountCoverage {
  bank: string
  account: string
  /** Months that already have an uploaded statement, most recent first. */
  months: MonthRef[]
}

const COVERAGE_YEARS = 10

/**
 * For each known (bank, account), which months in the last COVERAGE_YEARS years already have a
 * saved statement. Storage has no file-listing capability (see transactionSource.ts), so this
 * probes each month directly the same way the Transactions page does.
 */
export async function loadStatementCoverage(storage: StorageLayer, accounts: BankAccount[]): Promise<AccountCoverage[]> {
  const targets = matchingAccounts(accounts, '', '')
  const months = recentMonths(COVERAGE_YEARS * 12)

  return Promise.all(
    targets.map(async (target) => {
      const present = await Promise.all(
        months.map(async (month) => {
          const transactions = await storage.readMonth(target.bank, target.account, month.year, month.month)
          return transactions.length > 0 ? month : null
        }),
      )
      const uploaded = present.filter((month): month is MonthRef => month !== null)
      uploaded.sort((a, b) => monthKey(b).localeCompare(monthKey(a)))
      return { bank: target.bank, account: target.account, months: uploaded }
    }),
  )
}
