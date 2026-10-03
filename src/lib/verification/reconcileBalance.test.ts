import { describe, expect, it } from 'vitest'
import type { PdfTransactionDraft } from '../adapters/pdf-normalize'
import { reconcileCreditCardBalance } from './reconcileBalance'

function draft(amount: number): PdfTransactionDraft {
  return { date: '2026-07-01', amount, description: 'row', pageNumber: 1, sourceText: 'row' }
}

describe('reconcileCreditCardBalance', () => {
  it('matches when the parsed drafts sum to previousBalance - newBalance (Wells Fargo June statement)', () => {
    // Purchases 1681.95 + interest 41.47 = 1723.42 out; payment 400 in. Internal sum: 400 - 1723.42 = -1323.42.
    const drafts = [draft(400), draft(-1681.95), draft(-41.47)]
    const result = reconcileCreditCardBalance(drafts, { previousBalance: 1814.13, newBalance: 3137.55 })
    expect(result.matches).toBe(true)
    expect(result.expectedChange).toBeCloseTo(-1323.42, 2)
    expect(result.actualChange).toBeCloseTo(-1323.42, 2)
    expect(result.difference).toBeCloseTo(0, 3)
  })

  it('flags a mismatch and reports the exact dollar difference when a row is missing', () => {
    // Same statement, but the interest charge row never got parsed.
    const drafts = [draft(400), draft(-1681.95)]
    const result = reconcileCreditCardBalance(drafts, { previousBalance: 1814.13, newBalance: 3137.55 })
    expect(result.matches).toBe(false)
    expect(result.difference).toBeCloseTo(41.47, 2)
  })

  it('tolerates sub-cent floating point noise', () => {
    const drafts = [draft(0.1), draft(0.2)]
    const result = reconcileCreditCardBalance(drafts, { previousBalance: 0.3, newBalance: 0 })
    expect(result.matches).toBe(true)
  })

  it('matches on an empty statement with no balance change', () => {
    const result = reconcileCreditCardBalance([], { previousBalance: 0, newBalance: 0 })
    expect(result.matches).toBe(true)
  })
})
