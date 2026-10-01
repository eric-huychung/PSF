import type { Category, ConfidenceLevel, LLMClient, NormalizedTransaction } from '../types'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

/** OpenRouter slugs, verified against https://openrouter.ai/api/v1/models on 2026-09-28. */
export const MODEL_SLUGS = {
  haiku: 'anthropic/claude-haiku-4.5',
  sonnet: 'anthropic/claude-sonnet-5.5',
  gpt5nano: 'openai/gpt-5-nano',
} as const

export type LLMErrorKind = 'network' | 'http' | 'parse'

/** Every failure from the OpenRouter client is one of these — never a silent fallback. */
export class LLMError extends Error {
  readonly kind: LLMErrorKind
  readonly status?: number

  constructor(kind: LLMErrorKind, message: string, options?: { status?: number; cause?: unknown }) {
    super(message, { cause: options?.cause })
    this.name = 'LLMError'
    this.kind = kind
    this.status = options?.status
  }
}

export interface OpenRouterOptions {
  apiKey: string
  /** Injectable for tests; defaults to the browser's fetch. */
  fetch?: typeof fetch
}

const LLM_CONFIDENCE: ConfidenceLevel[] = ['low', 'medium', 'high']

export function createOpenRouterClient({ apiKey, fetch: fetchImpl = globalThis.fetch.bind(globalThis) }: OpenRouterOptions): LLMClient {
  return {
    async categorizeBatch(transactions, categories, model) {
      let res: Response
      try {
        res = await fetchImpl(OPENROUTER_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODEL_SLUGS[model],
            temperature: 0,
            messages: [
              { role: 'system', content: systemPrompt(categories) },
              { role: 'user', content: userPrompt(transactions) },
            ],
          }),
        })
      } catch (cause) {
        throw new LLMError('network', `Could not reach OpenRouter: ${String(cause)}`, { cause })
      }

      if (!res.ok) {
        throw new LLMError('http', `OpenRouter returned ${res.status}: ${await errorMessage(res)}`, { status: res.status })
      }

      const content = await res
        .json()
        .then((body: { choices?: Array<{ message?: { content?: string } }> }) => body.choices?.[0]?.message?.content)
        .catch(() => undefined)
      if (typeof content !== 'string') throw new LLMError('parse', 'OpenRouter response had no message content')

      return parseResults(content, transactions, categories)
    },
  }
}

function systemPrompt(categories: Category[]): string {
  const list = categories.map((c) => `- ${c.id}: ${c.name}`).join('\n')
  return [
    'You categorize personal bank transactions.',
    'Allowed categories (use the id before the colon):',
    list,
    'For each transaction, pick exactly one category id from the list and rate your confidence as "high", "medium" or "low".',
    'Use "low" when the merchant is ambiguous or unfamiliar.',
    'Reply with JSON only, no prose, in this shape:',
    '{"results":[{"index":0,"categoryId":"<id>","confidence":"high"}]}',
  ].join('\n')
}

/** Only description, amount and date leave the browser (PRD §3.5). */
function userPrompt(transactions: NormalizedTransaction[]): string {
  const rows = transactions.map((t, index) => ({ index, date: t.date, amount: t.amount, description: t.description }))
  return JSON.stringify(rows)
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    return JSON.parse(text).error?.message ?? text
  } catch {
    return text || res.statusText
  }
}

function parseResults(content: string, transactions: NormalizedTransaction[], categories: Category[]) {
  const json = content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1)
  let parsed: { results?: Array<{ index?: unknown; categoryId?: unknown; confidence?: unknown }> }
  try {
    parsed = JSON.parse(json)
  } catch (cause) {
    throw new LLMError('parse', `Model reply was not valid JSON: ${content.slice(0, 200)}`, { cause })
  }

  const validIds = new Set(categories.map((c) => c.id))
  const byIndex = new Map((parsed.results ?? []).map((r) => [r.index, r]))

  return transactions.map((transaction, index) => {
    const r = byIndex.get(index)
    if (!r) throw new LLMError('parse', `Model reply is missing transaction ${index}`)
    if (typeof r.categoryId !== 'string' || !validIds.has(r.categoryId)) {
      throw new LLMError('parse', `Model picked unknown category "${String(r.categoryId)}" for transaction ${index}`)
    }
    if (!LLM_CONFIDENCE.includes(r.confidence as ConfidenceLevel)) {
      throw new LLMError('parse', `Model gave invalid confidence "${String(r.confidence)}" for transaction ${index}`)
    }
    return { transaction, categoryId: r.categoryId, confidence: r.confidence as ConfidenceLevel }
  })
}
