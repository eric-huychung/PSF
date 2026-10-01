import { describe, expect, it } from 'vitest'
import type { Categorizer, Category, ConfidenceLevel, NormalizedTransaction, Rule } from '../types'
import { categorize } from './pipeline'

const categories: Category[] = [
  { id: 'groceries', name: 'Groceries' },
  { id: 'dining', name: 'Dining' },
  { id: 'shopping', name: 'Shopping' },
]

function txn(description: string): NormalizedTransaction {
  return { date: '2025-11-02', amount: -10, description, bank: 'chase', account: 'checking' }
}

type Answer = { categoryId: string; confidence: ConfidenceLevel }

/** Fake categorizer: answers from a description -> answer table, and records every call. */
function fakeCategorizer(answers: Record<string, Answer>) {
  const calls: string[][] = []
  const categorizer: Categorizer = {
    async categorizeBatch(transactions) {
      calls.push(transactions.map((t) => t.description))
      return transactions.map((transaction) => {
        const answer = answers[transaction.description]
        if (!answer) throw new Error(`fake categorizer has no answer for ${transaction.description}`)
        return { transaction, ...answer }
      })
    },
  }
  return { categorizer, calls }
}

const rules: Rule[] = [{ descriptionPattern: 'WHOLE FOODS MARKET', categoryId: 'groceries' }]

describe('categorize', () => {
  it('uses the rules cache and never calls the categorizer when every transaction hits', async () => {
    const { categorizer, calls } = fakeCategorizer({})
    const t = txn('WHOLE FOODS MARKET')

    const results = await categorize([t], categories, rules, categorizer, 'jev')

    expect(results).toEqual([{ transaction: t, categoryId: 'groceries', confidence: 'cache', source: 'cache' }])
    expect(calls).toEqual([])
  })

  it('sends only cache misses to the categorizer, in one batch, tagged with the given provider', async () => {
    const { categorizer, calls } = fakeCategorizer({
      CHIPOTLE: { categoryId: 'dining', confidence: 'high' },
      TARGET: { categoryId: 'shopping', confidence: 'medium' },
    })
    const [hit, a, b] = [txn('WHOLE FOODS MARKET'), txn('CHIPOTLE'), txn('TARGET')]

    const results = await categorize([hit, a, b], categories, rules, categorizer, 'jev')

    expect(calls).toEqual([['CHIPOTLE', 'TARGET']])
    expect(results).toEqual([
      { transaction: hit, categoryId: 'groceries', confidence: 'cache', source: 'cache' },
      { transaction: a, categoryId: 'dining', confidence: 'high', source: 'jev' },
      { transaction: b, categoryId: 'shopping', confidence: 'medium', source: 'jev' },
    ])
  })

  it('tags results with whichever provider was actually used, not a hardcoded name', async () => {
    const { categorizer } = fakeCategorizer({ CHIPOTLE: { categoryId: 'dining', confidence: 'high' } })

    const results = await categorize([txn('CHIPOTLE')], categories, [], categorizer, 'gpt5nano')

    expect(results).toEqual([{ transaction: expect.anything(), categoryId: 'dining', confidence: 'high', source: 'gpt5nano' }])
  })

  it('does not run a second pass -- there is no escalation tier', async () => {
    const { categorizer, calls } = fakeCategorizer({
      CHIPOTLE: { categoryId: 'dining', confidence: 'low' },
      TARGET: { categoryId: 'shopping', confidence: 'low' },
    })

    await categorize([txn('CHIPOTLE'), txn('TARGET')], categories, [], categorizer, 'jev')

    expect(calls).toHaveLength(1)
  })
})
