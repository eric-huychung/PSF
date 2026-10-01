import type { Categorizer, Category, ConfidenceLevel, NormalizedTransaction } from '../types'
import { createJevClient, type JevChoiceQuestion, type JevDecisionOptions } from '../llm/jevClient'

/**
 * Same conservative chunk size and reasoning as the PDF extraction path: TypeSafe doesn't
 * document a per-request question cap, so this is a starting point to tune once real traffic is
 * observed, not a hard limit. Category batches are typically much smaller than PDF evidence
 * windows, so this rarely produces more than one call in practice.
 */
const TRANSACTIONS_PER_DECISIONS_CALL = 25

function questionKey(index: number): string {
  return `t${index}`
}

/** Criterion text per category: name alone, or "name -- description" when the category has one. */
function categoryCriteria(categories: Category[]): Record<string, string> {
  return Object.fromEntries(
    categories.map((category) => [
      category.id,
      category.description ? `${category.name} -- ${category.description}` : category.name,
    ]),
  )
}

/**
 * Every transaction's own date/amount/description is embedded directly in its question's
 * `instructions`, not left to a shared `state` -- the same lesson learned from PDF extraction v3:
 * every question batched into one call must be self-contained, since Jev has nothing else to
 * distinguish one transaction's question from another's.
 */
function transactionQuestion(transaction: NormalizedTransaction, criteria: Record<string, string>): JevChoiceQuestion {
  return {
    type: 'choice',
    instructions: `Categorize this personal bank transaction. Date: ${transaction.date}. Amount: ${transaction.amount}. Description: "${transaction.description}". Pick the category id that best matches. Go by what the merchant/description actually is, not incidental text like a phone number or store number that happens to appear in it. Prefer the most specific matching category; only fall back to a general catch-all category when nothing specific fits.`,
    criteria,
  }
}

/**
 * Maps Jev's own calibrated top-choice probability onto the app's existing categorical
 * confidence levels, instead of asking a chat model to self-report a "high"/"medium"/"low" label
 * (which is just a string the model writes, not an actual probability). Placeholder thresholds --
 * tune once real review corrections show how often each band gets overridden.
 */
function confidenceLevel(probability: number | undefined): ConfidenceLevel {
  if (probability === undefined) return 'low'
  if (probability >= 0.75) return 'high'
  if (probability >= 0.4) return 'medium'
  return 'low'
}

/**
 * Categorizes via Jev's Choice primitive: one bounded question per transaction, criteria = the
 * caller's category list. Jev structurally cannot return a category id outside that list (the
 * shared client rejects any answer outside the criteria it offered), unlike a chat model's
 * free-text category id that has to be checked after the fact.
 */
export function createJevCategorizer(options: JevDecisionOptions): Categorizer {
  const client = createJevClient(options)

  return {
    async categorizeBatch(transactions, categories) {
      const criteria = categoryCriteria(categories)
      const results: Array<{ transaction: NormalizedTransaction; categoryId: string; confidence: ConfidenceLevel }> = []

      for (let start = 0; start < transactions.length; start += TRANSACTIONS_PER_DECISIONS_CALL) {
        const chunk = transactions.slice(start, start + TRANSACTIONS_PER_DECISIONS_CALL)
        const questions: Record<string, JevChoiceQuestion> = {}
        chunk.forEach((transaction, offset) => {
          questions[questionKey(start + offset)] = transactionQuestion(transaction, criteria)
        })

        const { answers } = await client.askChoices({}, questions)
        chunk.forEach((transaction, offset) => {
          const answer = answers[questionKey(start + offset)]
          results.push({ transaction, categoryId: answer.choice, confidence: confidenceLevel(answer.confidence) })
        })
      }

      return results
    },
  }
}
