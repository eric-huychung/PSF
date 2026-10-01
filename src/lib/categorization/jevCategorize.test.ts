import { describe, expect, it, vi } from 'vitest'
import type { Category, NormalizedTransaction } from '../types'
import { createJevCategorizer } from './jevCategorize'

const categories: Category[] = [
  { id: 'groceries', name: 'Groceries' },
  { id: 'dining', name: 'Dining' },
]

const txns: NormalizedTransaction[] = [
  { date: '2025-11-02', amount: -54.12, description: 'WHOLE FOODS #123', bank: 'chase', account: 'acct-9981' },
  { date: '2025-11-03', amount: -18.5, description: 'CHIPOTLE 0456', bank: 'chase', account: 'acct-9981' },
]

function decisionResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('createJevCategorizer', () => {
  it('asks one bounded Choice question per transaction, with its own data embedded in the instructions', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      decisionResponse({
        answers: {
          t0: { type: 'choice', choice: 'groceries', confidence: 0.92 },
          t1: { type: 'choice', choice: 'dining', confidence: 0.6 },
        },
        usage: { input_tokens: 40, output_tokens: 6 },
      }),
    )
    const categorizer = createJevCategorizer({ apiKey: 'sk-test', fetch })

    const results = await categorizer.categorizeBatch(txns, categories)

    expect(results).toEqual([
      { transaction: txns[0], categoryId: 'groceries', confidence: 'high' },
      { transaction: txns[1], categoryId: 'dining', confidence: 'medium' },
    ])
    const sent = JSON.parse((fetch.mock.calls[0][1]?.body as string) ?? '{}')
    expect(sent.questions.t0.instructions).toContain('WHOLE FOODS #123')
    expect(sent.questions.t0.criteria).toEqual({ groceries: 'Groceries', dining: 'Dining' })
    expect(sent.questions.t1.instructions).not.toBe(sent.questions.t0.instructions)
  })

  it('never sends bank or account details to Jev', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      decisionResponse({ answers: { t0: { type: 'choice', choice: 'groceries' }, t1: { type: 'choice', choice: 'dining' } }, usage: { input_tokens: 1, output_tokens: 1 } }),
    )
    const categorizer = createJevCategorizer({ apiKey: 'sk-test', fetch })

    await categorizer.categorizeBatch(txns, categories)

    const body = fetch.mock.calls[0][1]?.body as string
    expect(body).not.toContain('acct-9981')
    expect(body).not.toContain('chase')
  })

  it('cannot return a category id outside the supplied list -- the shared client rejects it first', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      decisionResponse({ answers: { t0: { type: 'choice', choice: 'made-up' }, t1: { type: 'choice', choice: 'dining' } }, usage: { input_tokens: 1, output_tokens: 1 } }),
    )
    const categorizer = createJevCategorizer({ apiKey: 'sk-test', fetch })

    await expect(categorizer.categorizeBatch(txns, categories)).rejects.toMatchObject({ kind: 'parse' })
  })

  it('treats a missing confidence as low rather than guessing', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      decisionResponse({ answers: { t0: { type: 'choice', choice: 'groceries' } }, usage: { input_tokens: 1, output_tokens: 1 } }),
    )
    const categorizer = createJevCategorizer({ apiKey: 'sk-test', fetch })

    const results = await categorizer.categorizeBatch([txns[0]], categories)

    expect(results).toEqual([{ transaction: txns[0], categoryId: 'groceries', confidence: 'low' }])
  })
})
