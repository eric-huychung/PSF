import { lookupCategory } from '../lib/categorization/rulesCache'
import type { BankAccount, StorageLayer } from '../lib/types'
import { recentMonths } from './months'
import { matchingAccounts } from './transactionSource'

/**
 * Rules learned from corrections only apply going forward (`categorize` in pipeline.ts caches at
 * import time) -- already-imported transactions keep whatever categoryId they got then, even
 * after a rule that would now categorize them differently is added. This re-reads every stored
 * month within `monthsBack` of today and re-runs lookupCategory against the current rules,
 * fixing any transaction a rule now covers that it didn't at import time. Returns how many
 * transactions actually changed.
 */
export async function recheckCategories(storage: StorageLayer, accounts: BankAccount[], monthsBack: number): Promise<number> {
  const currentRules = await storage.readRules()
  const targets = matchingAccounts(accounts, '', '')
  const months = recentMonths(monthsBack)
  let changed = 0

  for (const target of targets) {
    for (const month of months) {
      const monthTransactions = await storage.readMonth(target.bank, target.account, month.year, month.month)
      if (monthTransactions.length === 0) continue

      let fileChanged = false
      const nextTransactions = monthTransactions.map((transaction) => {
        const matched = lookupCategory(transaction.description, currentRules)
        if (!matched || matched === transaction.categoryId) return transaction
        fileChanged = true
        return { ...transaction, categoryId: matched }
      })

      if (fileChanged) {
        await storage.writeMonth(target.bank, target.account, month.year, month.month, nextTransactions)
        changed += nextTransactions.filter((transaction, index) => transaction.categoryId !== monthTransactions[index].categoryId).length
      }
    }
  }

  return changed
}
