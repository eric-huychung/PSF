import { describe, expect, it, vi } from 'vitest'
import type { Category, NormalizedTransaction } from '../types'
import { CATEGORIZATION_PROVIDER, createCategorizer } from './categorizer'

const categories: Category[] = [{ id: 'groceries', name: 'Groceries' }]
const txns: NormalizedTransaction[] = [{ date: '2025-11-02', amount: -10, description: 'WHOLE FOODS', bank: 'chase', account: 'checking' }]

function decisionResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function chatResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status })
}

describe('createCategorizer', () => {
  it('defaults to jev', () => {
    expect(CATEGORIZATION_PROVIDER).toBe('jev')
  })

  it('builds a Jev-backed categorizer by default, without needing to know its request shape', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      decisionResponse({ answers: { t0: { type: 'choice', choice: 'groceries', confidence: 0.9 } }, usage: { input_tokens: 1, output_tokens: 1 } }),
    )

    const { categorizer, provider } = createCategorizer({ apiKey: 'sk-test', fetch })
    const results = await categorizer.categorizeBatch(txns, categories)

    expect(provider).toBe('jev')
    expect(fetch.mock.calls[0][0]).toBe('https://openrouter.ai/api/alpha/decisions')
    expect(results).toEqual([{ transaction: txns[0], categoryId: 'groceries', confidence: 'high' }])
  })

  it('builds a single-model OpenRouter categorizer when overridden, with no escalation', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      chatResponse(JSON.stringify({ results: [{ index: 0, categoryId: 'groceries', confidence: 'medium' }] })),
    )

    const { categorizer, provider } = createCategorizer({ apiKey: 'sk-test', fetch }, 'gpt5nano')
    const results = await categorizer.categorizeBatch(txns, categories)

    expect(provider).toBe('gpt5nano')
    expect(fetch.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string).model).toBe('openai/gpt-5-nano')
    expect(results).toEqual([{ transaction: txns[0], categoryId: 'groceries', confidence: 'medium' }])
  })
})
