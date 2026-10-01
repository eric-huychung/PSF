import type { CategorizationProvider, CategorizationResult, Categorizer, Category, NormalizedTransaction, Rule } from '../types'
import { lookupCategory } from './rulesCache'

/**
 * Cache -> one categorization pass for cache misses (PRD §3.4). No escalation tier: the provider
 * is a single already-chosen categorizer (see `categorizer.ts`) bound to one model/client, not a
 * per-call choice, so there's nothing to escalate to -- a low-confidence result is surfaced as-is
 * for the user to correct in Review, same as it always was, just without a second automatic pass.
 * Results come back in input order. Categorizer errors propagate to the caller.
 */
export async function categorize(
  transactions: NormalizedTransaction[],
  categories: Category[],
  rules: Rule[],
  categorizer: Categorizer,
  provider: CategorizationProvider,
): Promise<CategorizationResult[]> {
  const results = new Map<NormalizedTransaction, CategorizationResult>()
  const misses: NormalizedTransaction[] = []

  for (const transaction of transactions) {
    const categoryId = lookupCategory(transaction.description, rules)
    if (categoryId) results.set(transaction, { transaction, categoryId, confidence: 'cache', source: 'cache' })
    else misses.push(transaction)
  }

  if (misses.length > 0) {
    for (const r of await categorizer.categorizeBatch(misses, categories)) {
      results.set(r.transaction, { ...r, source: provider })
    }
  }

  return transactions.map((t) => results.get(t)!)
}
