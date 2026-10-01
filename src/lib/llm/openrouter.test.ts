import { describe, expect, it, vi } from 'vitest'
import type { Category, NormalizedTransaction } from '../types'
import { createOpenRouterClient, LLMError, MODEL_SLUGS } from './openrouter'

const categories: Category[] = [
  { id: 'groceries', name: 'Groceries' },
  { id: 'dining', name: 'Dining' },
]

const txns: NormalizedTransaction[] = [
  { date: '2025-11-02', amount: -54.12, description: 'WHOLE FOODS #123', bank: 'chase', account: 'acct-9981' },
  { date: '2025-11-03', amount: -18.5, description: 'CHIPOTLE 0456', bank: 'chase', account: 'acct-9981' },
]

function chatResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status })
}

function fakeFetch(response: Response | Error) {
  return vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response
    return response
  })
}

const goodContent = JSON.stringify({
  results: [
    { index: 0, categoryId: 'groceries', confidence: 'high' },
    { index: 1, categoryId: 'dining', confidence: 'low' },
  ],
})

describe('OpenRouter LLM client', () => {
  it('parses category + confidence per transaction from the model response', async () => {
    const client = createOpenRouterClient({ apiKey: 'sk-test', fetch: fakeFetch(chatResponse(goodContent)) })

    const results = await client.categorizeBatch(txns, categories, 'haiku')

    expect(results).toEqual([
      { transaction: txns[0], categoryId: 'groceries', confidence: 'high' },
      { transaction: txns[1], categoryId: 'dining', confidence: 'low' },
    ])
  })

  it('calls OpenRouter directly with the key and the selected model', async () => {
    const fetch = fakeFetch(chatResponse(goodContent))
    const client = createOpenRouterClient({ apiKey: 'sk-test', fetch })

    await client.categorizeBatch(txns, categories, 'sonnet')

    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer sk-test')
    expect(JSON.parse(init?.body as string).model).toBe(MODEL_SLUGS.sonnet)
  })

  it('never sends bank or account details to the model', async () => {
    const fetch = fakeFetch(chatResponse(goodContent))
    const client = createOpenRouterClient({ apiKey: 'sk-test', fetch })

    await client.categorizeBatch(txns, categories, 'haiku')

    const body = fetch.mock.calls[0][1]?.body as string
    expect(body).toContain('WHOLE FOODS #123')
    expect(body).not.toContain('acct-9981')
    expect(body).not.toContain('chase')
  })

  it('accepts JSON wrapped in a markdown code fence', async () => {
    const fenced = '```json\n' + goodContent + '\n```'
    const client = createOpenRouterClient({ apiKey: 'sk-test', fetch: fakeFetch(chatResponse(fenced)) })

    const results = await client.categorizeBatch(txns, categories, 'haiku')

    expect(results.map((r) => r.categoryId)).toEqual(['groceries', 'dining'])
  })

  it('surfaces a network failure as an LLMError of kind "network"', async () => {
    const client = createOpenRouterClient({ apiKey: 'sk-test', fetch: fakeFetch(new TypeError('Failed to fetch')) })

    await expect(client.categorizeBatch(txns, categories, 'haiku')).rejects.toMatchObject({
      name: 'LLMError',
      kind: 'network',
    })
  })

  it('surfaces a non-2xx API response as an LLMError of kind "http" with the status', async () => {
    const res = new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 })
    const client = createOpenRouterClient({ apiKey: 'bad', fetch: fakeFetch(res) })

    const err = await client.categorizeBatch(txns, categories, 'haiku').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LLMError)
    expect(err).toMatchObject({ kind: 'http', status: 401 })
    expect((err as Error).message).toContain('Invalid API key')
  })

  it('surfaces unparseable model output as an LLMError of kind "parse"', async () => {
    const client = createOpenRouterClient({ apiKey: 'sk-test', fetch: fakeFetch(chatResponse('Sorry, I cannot help.')) })

    await expect(client.categorizeBatch(txns, categories, 'haiku')).rejects.toMatchObject({ kind: 'parse' })
  })

  it('rejects a response that uses a category id not in the list', async () => {
    const content = JSON.stringify({
      results: [
        { index: 0, categoryId: 'groceries', confidence: 'high' },
        { index: 1, categoryId: 'made-up', confidence: 'high' },
      ],
    })
    const client = createOpenRouterClient({ apiKey: 'sk-test', fetch: fakeFetch(chatResponse(content)) })

    await expect(client.categorizeBatch(txns, categories, 'haiku')).rejects.toMatchObject({ kind: 'parse' })
  })

  it('rejects a response that skips a transaction', async () => {
    const content = JSON.stringify({ results: [{ index: 0, categoryId: 'groceries', confidence: 'high' }] })
    const client = createOpenRouterClient({ apiKey: 'sk-test', fetch: fakeFetch(chatResponse(content)) })

    await expect(client.categorizeBatch(txns, categories, 'haiku')).rejects.toMatchObject({ kind: 'parse' })
  })
})
