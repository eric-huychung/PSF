import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Categorizer, Category, ConfidenceLevel, NormalizedTransaction, Rule } from '../types'
import { resolveFlag, runImportPipeline } from './runImportPipeline'

vi.mock('../verification/verifyExtraction')
vi.mock('../llm/judge')

const { verifyExtraction } = await import('../verification/verifyExtraction')
const { judgeCategorization } = await import('../llm/judge')

beforeEach(() => {
  vi.clearAllMocks()
})

const categories: Category[] = [{ id: 'groceries', name: 'Groceries' }]
const rules: Rule[] = []

function txn(description: string, amount = -10): NormalizedTransaction {
  return { date: '2025-11-02', amount, description, bank: 'chase', account: 'checking' }
}

type Answer = { categoryId: string; confidence: ConfidenceLevel }

/** Same fake-categorizer shape as pipeline.test.ts -- answers by description, no cache/rule involvement. */
function fakeCategorizer(answers: Record<string, Answer>): Categorizer {
  return {
    async categorizeBatch(transactions) {
      return transactions.map((transaction) => {
        const answer = answers[transaction.description]
        if (!answer) throw new Error(`fake categorizer has no answer for ${transaction.description}`)
        return { transaction, ...answer }
      })
    },
  }
}

describe('resolveFlag', () => {
  it('prefers the category verdict when both the category judge and the extraction check fire', () => {
    const categoryVerdict = { flagged: true as const, flagReason: 'wrong category' }
    expect(resolveFlag(categoryVerdict, 'extraction disagreement')).toEqual(categoryVerdict)
  })

  it('falls back to the extraction reason when the category judge did not flag the row', () => {
    expect(resolveFlag(null, 'extraction disagreement')).toEqual({ flagged: true, flagReason: 'extraction disagreement' })
  })

  it('returns null when neither check flagged the row', () => {
    expect(resolveFlag(null, undefined)).toBeNull()
  })
})

describe('runImportPipeline -- no pdfContext (extraction never ran)', () => {
  it('never calls the extraction check when there is no pdfContext', async () => {
    const categorizer = fakeCategorizer({ coffee: { categoryId: 'groceries', confidence: 'high' } })
    await runImportPipeline({
      transactions: [txn('coffee')],
      categories,
      rules,
      categorizer,
      provider: 'jev',
      judgeOptions: { apiKey: 'k' },
      pdfContext: null,
    })
    expect(verifyExtraction).not.toHaveBeenCalled()
  })

  it('does not call the category judge on a high-confidence result, and the row stays unflagged', async () => {
    const categorizer = fakeCategorizer({ coffee: { categoryId: 'groceries', confidence: 'high' } })
    const { results } = await runImportPipeline({
      transactions: [txn('coffee')],
      categories,
      rules,
      categorizer,
      provider: 'jev',
      judgeOptions: { apiKey: 'k' },
      pdfContext: null,
    })
    expect(judgeCategorization).not.toHaveBeenCalled()
    expect(results[0].flagged).toBeUndefined()
  })

  it('flags a low-confidence result the category judge fails', async () => {
    vi.mocked(judgeCategorization).mockResolvedValue({ verdict: 'fail', reason: 'looks like dining, not groceries' })
    const categorizer = fakeCategorizer({ coffee: { categoryId: 'groceries', confidence: 'low' } })
    const { results } = await runImportPipeline({
      transactions: [txn('coffee')],
      categories,
      rules,
      categorizer,
      provider: 'jev',
      judgeOptions: { apiKey: 'k' },
      pdfContext: null,
    })
    expect(results[0]).toMatchObject({ flagged: true, flagReason: 'looks like dining, not groceries' })
  })

  it('fails open when the category judge throws -- no flag, no thrown error', async () => {
    vi.mocked(judgeCategorization).mockRejectedValue(new Error('network error'))
    const categorizer = fakeCategorizer({ coffee: { categoryId: 'groceries', confidence: 'low' } })
    const { results } = await runImportPipeline({
      transactions: [txn('coffee')],
      categories,
      rules,
      categorizer,
      provider: 'jev',
      judgeOptions: { apiKey: 'k' },
      pdfContext: null,
    })
    expect(results[0].flagged).toBeUndefined()
  })

  it('skips both judge calls when there is no OpenRouter key', async () => {
    const categorizer = fakeCategorizer({ coffee: { categoryId: 'groceries', confidence: 'low' } })
    const { results } = await runImportPipeline({
      transactions: [txn('coffee')],
      categories,
      rules,
      categorizer,
      provider: 'jev',
      judgeOptions: null,
      pdfContext: null,
    })
    expect(judgeCategorization).not.toHaveBeenCalled()
    expect(results[0].flagged).toBeUndefined()
  })
})

describe('runImportPipeline -- extraction merge rule', () => {
  const pdfContext = { pages: [], statementYear: 2025, drafts: [] }

  it('surfaces the extraction flag when the category judge did not also flag that row', async () => {
    vi.mocked(verifyExtraction).mockResolvedValue({ flags: new Map([[0, 'parser and Jev disagreed on this row']]), missingRowCount: 0 })
    const categorizer = fakeCategorizer({ coffee: { categoryId: 'groceries', confidence: 'high' } })
    const { results } = await runImportPipeline({
      transactions: [txn('coffee')],
      categories,
      rules,
      categorizer,
      provider: 'jev',
      judgeOptions: { apiKey: 'k' },
      pdfContext,
    })
    expect(results[0]).toMatchObject({ flagged: true, flagReason: 'parser and Jev disagreed on this row' })
  })

  it('lets the category verdict win over the extraction flag when both fire for the same row', async () => {
    vi.mocked(verifyExtraction).mockResolvedValue({ flags: new Map([[0, 'parser and Jev disagreed on this row']]), missingRowCount: 0 })
    vi.mocked(judgeCategorization).mockResolvedValue({ verdict: 'fail', reason: 'wrong category' })
    const categorizer = fakeCategorizer({ coffee: { categoryId: 'groceries', confidence: 'low' } })
    const { results } = await runImportPipeline({
      transactions: [txn('coffee')],
      categories,
      rules,
      categorizer,
      provider: 'jev',
      judgeOptions: { apiKey: 'k' },
      pdfContext,
    })
    expect(results[0]).toMatchObject({ flagged: true, flagReason: 'wrong category' })
  })

  it('fails open when verifyExtraction rejects -- treated as no extraction flags', async () => {
    vi.mocked(verifyExtraction).mockRejectedValue(new Error('shadow extraction unavailable'))
    const categorizer = fakeCategorizer({ coffee: { categoryId: 'groceries', confidence: 'high' } })
    const { results } = await runImportPipeline({
      transactions: [txn('coffee')],
      categories,
      rules,
      categorizer,
      provider: 'jev',
      judgeOptions: { apiKey: 'k' },
      pdfContext,
    })
    expect(results[0].flagged).toBeUndefined()
  })

  it('surfaces missingRowCount when Jev accepted rows have no matching deterministic draft', async () => {
    vi.mocked(verifyExtraction).mockResolvedValue({ flags: new Map(), missingRowCount: 2 })
    const categorizer = fakeCategorizer({ coffee: { categoryId: 'groceries', confidence: 'high' } })
    const { missingRowCount } = await runImportPipeline({
      transactions: [txn('coffee')],
      categories,
      rules,
      categorizer,
      provider: 'jev',
      judgeOptions: { apiKey: 'k' },
      pdfContext,
    })
    expect(missingRowCount).toBe(2)
  })
})
