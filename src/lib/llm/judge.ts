import type { Category, NormalizedTransaction } from '../types'
import { MODEL_SLUGS } from './openrouter'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Cheap pass/fail check run only on flagged output -- gpt-5-nano, not the categorizer/extractor
 * model itself. Callers only send the small minority of transactions that already look risky
 * (extraction disagreements, low/medium confidence categorizations), never the full batch, so this
 * stays close to free. Any failure here (network, bad JSON, whatever) throws -- callers are
 * expected to fail open (treat a thrown error as "no flag") rather than block an import on a QA
 * step.
 */
export interface JudgeOptions {
  apiKey: string
  /** Injectable for tests; defaults to the browser's fetch. */
  fetch?: typeof fetch
}

export interface JudgeVerdict {
  verdict: 'pass' | 'fail'
  /** Only set when verdict is 'fail'. */
  reason?: string
}

async function askJudge(systemPrompt: string, userPrompt: string, { apiKey, fetch: fetchImpl = globalThis.fetch.bind(globalThis) }: JudgeOptions): Promise<JudgeVerdict> {
  let res: Response
  try {
    res = await fetchImpl(OPENROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL_SLUGS.gpt5nano,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    })
  } catch (cause) {
    throw new Error(`Could not reach the judge model: ${String(cause)}`)
  }
  if (!res.ok) throw new Error(`Judge model returned ${res.status}`)

  const content = await res
    .json()
    .then((body: { choices?: Array<{ message?: { content?: string } }> }) => body.choices?.[0]?.message?.content)
    .catch(() => undefined)
  if (typeof content !== 'string') throw new Error('Judge model response had no content')

  const json = content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1)
  let parsed: { verdict?: unknown; reason?: unknown }
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error(`Judge model reply was not valid JSON: ${content.slice(0, 200)}`)
  }
  if (parsed.verdict !== 'pass' && parsed.verdict !== 'fail') throw new Error(`Judge model gave an invalid verdict: ${json}`)
  return { verdict: parsed.verdict, reason: typeof parsed.reason === 'string' ? parsed.reason : undefined }
}

const EXTRACTION_SYSTEM_PROMPT = [
  'You are checking one row a bank-statement parser produced from one raw text line.',
  'SOURCE is the raw line pulled from the PDF (date, description, amount all run together).',
  'PARSED is the structured data the parser produced from it.',
  'Pass if PARSED faithfully represents SOURCE: correct date, same amount (value and sign), same merchant/description.',
  'Fail if PARSED has a wrong date, wrong amount, or a clearly wrong description.',
  'Reply with JSON only, no prose: {"verdict":"pass"|"fail","reason":"<short reason, only if fail>"}',
].join('\n')

/** Checks one deterministic-parser row against its own source text (same check as evals/collect-parser.ts's rubric, run live). */
export async function judgeExtraction(
  sourceText: string,
  parsed: { date: string; amount: number; description: string },
  statementYear: number,
  options: JudgeOptions,
): Promise<JudgeVerdict> {
  const userPrompt = `STATEMENT_YEAR: ${statementYear}\n\nSOURCE:\n${sourceText}\n\nPARSED:\n${JSON.stringify(parsed)}`
  return askJudge(EXTRACTION_SYSTEM_PROMPT, userPrompt, options)
}

const CATEGORIZATION_SYSTEM_PROMPT = [
  'You are checking one category a personal-finance categorizer assigned to one bank transaction.',
  'AVAILABLE_CATEGORIES is the full allowed list; the pick must be from it.',
  'Pass if the category is a reasonable fit -- allow real judgment calls (e.g. a grocery charge going to "food" is fine even if "personal" is also arguable).',
  'Fail only when the pick is clearly wrong for the description (e.g. a gym membership categorized as rent).',
  'Reply with JSON only, no prose: {"verdict":"pass"|"fail","reason":"<short reason, only if fail>"}',
].join('\n')

/** Checks one low/medium-confidence category pick (same check as evals/collect-categorize.ts's rubric, run live). */
export async function judgeCategorization(
  transaction: NormalizedTransaction,
  categoryId: string,
  categories: Category[],
  options: JudgeOptions,
): Promise<JudgeVerdict> {
  const categoryList = categories.map((c) => `${c.id}: ${c.name}`).join(', ')
  const userPrompt = `TRANSACTION: ${transaction.date} | ${transaction.description} | amount ${transaction.amount}\nAVAILABLE_CATEGORIES: ${categoryList}\nASSIGNED_CATEGORY: ${categoryId}`
  return askJudge(CATEGORIZATION_SYSTEM_PROMPT, userPrompt, options)
}
