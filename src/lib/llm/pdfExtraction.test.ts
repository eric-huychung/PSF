import { describe, expect, it, vi } from 'vitest'
import type { PdfEvidenceWindow } from '../adapters/pdfEvidence'
import { createJevClient, JEV_MODEL_SLUG, JevError, requestWindowDecisions, type JevChoiceQuestion } from './pdfExtraction'

const question: JevChoiceQuestion = {
  type: 'choice',
  instructions: 'Which evidence item is the transaction date?',
  criteria: { 'p3-i42': 'first date-shaped token on the row', none: 'no reliable date evidence' },
}

function decisionResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function fakeFetch(response: Response | Error) {
  return vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response
    return response
  })
}

const goodBody = {
  model: JEV_MODEL_SLUG,
  answers: { decision: { type: 'choice', choice: 'p3-i42', confidence: 0.91, probabilities: { 'p3-i42': 0.91, none: 0.09 } } },
  usage: { input_tokens: 120, output_tokens: 4, cost: 0.000005 },
}

describe('Jev decisions client', () => {
  it('returns the typed choice and usage from a well-formed response', async () => {
    const client = createJevClient({ apiKey: 'sk-test', fetch: fakeFetch(decisionResponse(goodBody)) })

    const { answer, usage } = await client.askChoice({ page: 3 }, question)

    expect(answer).toEqual({ type: 'choice', choice: 'p3-i42', confidence: 0.91, probabilities: { 'p3-i42': 0.91, none: 0.09 } })
    expect(usage).toEqual({ inputTokens: 120, outputTokens: 4, cost: 0.000005 })
  })

  it('calls the Decisions API with the pinned model and bounded question', async () => {
    const fetch = fakeFetch(decisionResponse(goodBody))
    const client = createJevClient({ apiKey: 'sk-test', fetch })

    await client.askChoice({ page: 3 }, question)

    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer sk-test')
    const sent = JSON.parse(init?.body as string)
    expect(sent.model).toBe(JEV_MODEL_SLUG)
    expect(sent.questions.decision).toEqual(question)
  })

  it('surfaces a network failure as a JevError of kind "network"', async () => {
    const client = createJevClient({ apiKey: 'sk-test', fetch: fakeFetch(new TypeError('Failed to fetch')) })

    await expect(client.askChoice({}, question)).rejects.toMatchObject({ name: 'JevError', kind: 'network' })
  })

  it('surfaces a 404 as a JevError of kind "unsupported", not a generic http error', async () => {
    const res = decisionResponse({ error: { code: 404, message: 'model not found' } }, 404)
    const client = createJevClient({ apiKey: 'sk-test', fetch: fakeFetch(res) })

    await expect(client.askChoice({}, question)).rejects.toMatchObject({ kind: 'unsupported', status: 404 })
  })

  it('surfaces a non-2xx response as a JevError of kind "http" with the status', async () => {
    const res = decisionResponse({ error: { code: 429, message: 'rate limited' } }, 429)
    const client = createJevClient({ apiKey: 'sk-test', fetch: fakeFetch(res) })

    const err = await client.askChoice({}, question).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(JevError)
    expect(err).toMatchObject({ kind: 'http', status: 429 })
    expect((err as Error).message).toContain('rate limited')
  })

  it('rejects a response missing the decision answer as a "parse" error', async () => {
    const client = createJevClient({ apiKey: 'sk-test', fetch: fakeFetch(decisionResponse({ answers: {}, usage: { input_tokens: 1, output_tokens: 1 } })) })

    await expect(client.askChoice({}, question)).rejects.toMatchObject({ kind: 'parse' })
  })

  it('rejects a choice outside the supplied criteria as a "parse" error, never trusting an invented value', async () => {
    const body = { ...goodBody, answers: { decision: { type: 'choice', choice: 'p9-i99' } } }
    const client = createJevClient({ apiKey: 'sk-test', fetch: fakeFetch(decisionResponse(body)) })

    await expect(client.askChoice({}, question)).rejects.toMatchObject({ kind: 'parse' })
  })

  it('rejects a response missing usage token counts as a "parse" error', async () => {
    const body = { answers: goodBody.answers, usage: {} }
    const client = createJevClient({ apiKey: 'sk-test', fetch: fakeFetch(decisionResponse(body)) })

    await expect(client.askChoice({}, question)).rejects.toMatchObject({ kind: 'parse' })
  })

  it('answers several named questions from one batched call', async () => {
    const body = {
      answers: {
        a: { type: 'choice', choice: 'yes' },
        b: { type: 'choice', choice: 'no' },
      },
      usage: { input_tokens: 10, output_tokens: 2 },
    }
    const client = createJevClient({ apiKey: 'sk-test', fetch: fakeFetch(decisionResponse(body)) })

    const { answers } = await client.askChoices(
      {},
      {
        a: { type: 'choice', instructions: 'a?', criteria: { yes: 'yes', no: 'no' } },
        b: { type: 'choice', instructions: 'b?', criteria: { yes: 'yes', no: 'no' } },
      },
    )

    expect(answers.a.choice).toBe('yes')
    expect(answers.b.choice).toBe('no')
  })

  it('rejects a batch response missing one of the named answers', async () => {
    const body = { answers: { a: { type: 'choice', choice: 'yes' } }, usage: { input_tokens: 1, output_tokens: 1 } }
    const client = createJevClient({ apiKey: 'sk-test', fetch: fakeFetch(decisionResponse(body)) })

    await expect(
      client.askChoices({}, {
        a: { type: 'choice', instructions: 'a?', criteria: { yes: 'yes' } },
        b: { type: 'choice', instructions: 'b?', criteria: { yes: 'yes' } },
      }),
    ).rejects.toMatchObject({ kind: 'parse' })
  })
})

function makeWindow(id: string, items: { id: string; text: string }[]): PdfEvidenceWindow {
  return {
    id,
    pageNumber: 3,
    extractorVersion: 'pdf-evidence-v1',
    lines: [{ pageNumber: 3, y: 90, text: items.map((i) => i.text).join(' '), items: items.map((i) => ({ ...i, pageNumber: 3, x: 0, y: 90 })) }],
  }
}

function answerFor(windowId: string, question: string, choice: string) {
  return [`${windowId}::${question}`, { type: 'choice', choice }] as const
}

describe('requestWindowDecisions', () => {
  const window = makeWindow('w-1', [
    { id: 'p3-i42', text: '08/06' },
    { id: 'p3-i43', text: 'STEAMGAMES.COM' },
    { id: 'p3-i44', text: '$41.97' },
  ])

  it('sends the pinned model and asks one batched Decisions call for the window', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      decisionResponse({
        answers: Object.fromEntries([
          answerFor('w-1', 'status', 'accepted'),
          answerFor('w-1', 'date', 'p3-i42'),
          answerFor('w-1', 'amount', 'p3-i44'),
        ]),
        usage: { input_tokens: 50, output_tokens: 8 },
      }),
    )

    const bundles = await requestWindowDecisions({ apiKey: 'sk-test', fetch }, [window])

    expect(bundles.get('w-1')).toEqual({ windowId: 'w-1', status: 'accepted', date: 'p3-i42', amount: 'p3-i44' })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions')
    const sent = JSON.parse(init?.body as string)
    expect(sent.model).toBe(JEV_MODEL_SLUG)
    expect(Object.keys(sent.questions)).toEqual(['w-1::status', 'w-1::date', 'w-1::amount'])
    expect(sent.questions['w-1::date'].criteria).toMatchObject({ none: expect.any(String), 'p3-i42': '08/06' })
  })

  it("embeds each window's own text in its status instructions, so two windows batched into one call are not asked the same question", async () => {
    const other = makeWindow('w-2', [{ id: 'p3-i50', text: 'ACCOUNT SUMMARY' }])
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      decisionResponse({
        answers: Object.fromEntries([
          answerFor('w-1', 'status', 'accepted'),
          answerFor('w-1', 'date', 'p3-i42'),
          answerFor('w-1', 'amount', 'p3-i44'),
          answerFor('w-2', 'status', 'non-transaction'),
          answerFor('w-2', 'date', 'none'),
          answerFor('w-2', 'amount', 'none'),
        ]),
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    )

    await requestWindowDecisions({ apiKey: 'sk-test', fetch }, [window, other])

    const sent = JSON.parse((fetch.mock.calls[0][1]?.body as string) ?? '{}')
    expect(sent.questions['w-1::status'].instructions).toContain('STEAMGAMES.COM')
    expect(sent.questions['w-2::status'].instructions).toContain('ACCOUNT SUMMARY')
    expect(sent.questions['w-1::status'].instructions).not.toBe(sent.questions['w-2::status'].instructions)
  })

  it('surfaces a network failure as a JevError of kind "network"', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(requestWindowDecisions({ apiKey: 'sk-test', fetch }, [window])).rejects.toMatchObject({ kind: 'network' })
  })

  it('surfaces a 404 as "unsupported"', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}', { status: 404 }))
    await expect(requestWindowDecisions({ apiKey: 'sk-test', fetch }, [window])).rejects.toMatchObject({ kind: 'unsupported' })
  })

  it('surfaces a non-2xx response as "http" with the status', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{"error":{"message":"rate limited"}}', { status: 429 }))
    await expect(requestWindowDecisions({ apiKey: 'sk-test', fetch }, [window])).rejects.toMatchObject({ kind: 'http', status: 429 })
  })

  it('batches more windows than the per-call chunk size into multiple Decisions calls', async () => {
    const windows = Array.from({ length: 30 }, (_, i) =>
      makeWindow(`w-${i}`, [{ id: `p3-i${i}`, text: `item-${i}` }]),
    )
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const sent = JSON.parse((init?.body as string) ?? '{}')
      const answers = Object.fromEntries(
        Object.keys(sent.questions).map((key) => [key, { type: 'choice', choice: key.endsWith('::status') ? 'non-transaction' : Object.keys(sent.questions[key].criteria)[0] }]),
      )
      return decisionResponse({ answers, usage: { input_tokens: 1, output_tokens: 1 } })
    })

    const bundles = await requestWindowDecisions({ apiKey: 'sk-test', fetch }, windows)

    expect(fetch.mock.calls.length).toBeGreaterThan(1)
    expect(bundles.size).toBe(30)
  })
})
