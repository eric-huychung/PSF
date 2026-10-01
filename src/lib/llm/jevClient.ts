/**
 * Generic TypeSafe Jev decisions client -- the bounded Choice primitive, with none of the PDF- or
 * categorization-specific question shapes. Shared by `pdfExtraction.ts` (evidence windows) and
 * `categorization/jevCategorize.ts` (category picks), so the transport/parsing logic (and its
 * bugs, and its fixes) live in exactly one place.
 *
 * Product decision (G1): this calls openrouter.ai directly from the browser with the user's own
 * BYOK key, same as `openrouter.ts`'s chat client -- no backend proxy. Same origin, same auth
 * model as the Task 0 CORS spike already validated, so no new CORS handling is needed. The key
 * stays in the user's local settings, never a repo/server secret. This is an explicit pilot-stage
 * tradeoff, not an oversight: a third-party-hosted model held with a browser key is a weaker
 * boundary than a server-held key, which is why production hardening (moving provider calls
 * behind a server) is its own later phase, not part of this pilot.
 */
const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions'

/**
 * Pinned per the OpenRouter Decisions API model page (permaslug typesafe/jev-1.13-20260917,
 * provider model id jev-1.13.0), confirmed 2026-09-29. Do not swap for the ~typesafe/jev-latest
 * alias -- G1 requires a pinned identifier so behavior doesn't shift under us.
 */
export const JEV_MODEL_SLUG = 'typesafe/jev-1.13'

export type JevErrorKind = 'network' | 'http' | 'parse' | 'unsupported'

/** Every failure from the Jev client is one of these -- never a silent fallback. */
export class JevError extends Error {
  readonly kind: JevErrorKind
  readonly status?: number

  constructor(kind: JevErrorKind, message: string, options?: { status?: number; cause?: unknown }) {
    super(message, { cause: options?.cause })
    this.name = 'JevError'
    this.kind = kind
    this.status = options?.status
  }
}

/** A bounded "which one of these?" question. `criteria` is the complete allowlist of possible answers. */
export interface JevChoiceQuestion {
  type: 'choice'
  instructions: string
  criteria: Record<string, string>
}

export interface JevChoiceAnswer {
  type: 'choice'
  /** Always one of the keys in the question's `criteria` -- validated below, never a model-invented value. */
  choice: string
  confidence?: number
  probabilities?: Record<string, number>
}

export interface JevUsage {
  inputTokens: number
  outputTokens: number
  cost?: number
}

export interface JevBatchAnswers {
  /** Keyed by the same names the questions were submitted under. */
  answers: Record<string, JevChoiceAnswer>
  usage: JevUsage
}

export interface JevDecisionOptions {
  apiKey: string
  /** Injectable for tests; defaults to the browser's fetch. */
  fetch?: typeof fetch
}

export interface JevClient {
  /** Submits one bounded Choice question over caller-supplied state and returns the typed answer. */
  askChoice(state: unknown, question: JevChoiceQuestion): Promise<{ answer: JevChoiceAnswer; usage: JevUsage }>
  /**
   * Submits many named bounded Choice questions in a single Decisions API call. Per TypeSafe's
   * own docs, questions in one request are evaluated independently against the same state and in
   * parallel -- one answer is never hidden context for another, so a question that depends on
   * another's answer must be asked unconditionally and resolved by the caller afterward, not
   * asked only when another answer implies it.
   */
  askChoices(state: unknown, questions: Record<string, JevChoiceQuestion>): Promise<JevBatchAnswers>
}

const SINGLE_QUESTION_NAME = 'decision'

export function createJevClient({ apiKey, fetch: fetchImpl = globalThis.fetch.bind(globalThis) }: JevDecisionOptions): JevClient {
  async function postDecisions(state: unknown, questions: Record<string, JevChoiceQuestion>): Promise<JevBatchAnswers> {
    let res: Response
    try {
      res = await fetchImpl(DECISIONS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: JEV_MODEL_SLUG, state, questions }),
      })
    } catch (cause) {
      throw new JevError('network', `Could not reach OpenRouter: ${String(cause)}`, { cause })
    }

    if (res.status === 404) {
      throw new JevError('unsupported', `Jev model/provider not available: ${await errorMessage(res)}`, { status: 404 })
    }
    if (!res.ok) {
      throw new JevError('http', `OpenRouter returned ${res.status}: ${await errorMessage(res)}`, { status: res.status })
    }

    const body = await res.json().catch(() => undefined)
    return parseBatchDecisionResponse(body, questions)
  }

  return {
    async askChoice(state, question) {
      const { answers, usage } = await postDecisions(state, { [SINGLE_QUESTION_NAME]: question })
      return { answer: answers[SINGLE_QUESTION_NAME], usage }
    },
    async askChoices(state, questions) {
      return postDecisions(state, questions)
    },
  }
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    return JSON.parse(text).error?.message ?? text
  } catch {
    return text || res.statusText
  }
}

interface RawDecisionResponse {
  answers?: Record<string, { type?: unknown; choice?: unknown; confidence?: unknown; probabilities?: unknown }>
  usage?: { input_tokens?: unknown; output_tokens?: unknown; cost?: unknown }
}

function parseBatchDecisionResponse(body: unknown, questions: Record<string, JevChoiceQuestion>): JevBatchAnswers {
  const parsed = body as RawDecisionResponse | undefined
  const answers: Record<string, JevChoiceAnswer> = {}

  for (const [name, question] of Object.entries(questions)) {
    const raw = parsed?.answers?.[name]
    if (!raw || raw.type !== 'choice' || typeof raw.choice !== 'string') {
      throw new JevError('parse', `Jev response is missing a valid "${name}" choice answer`)
    }
    if (!(raw.choice in question.criteria)) {
      throw new JevError('parse', `Jev chose "${raw.choice}" for "${name}", which is outside the supplied criteria`)
    }
    answers[name] = {
      type: 'choice',
      choice: raw.choice,
      confidence: typeof raw.confidence === 'number' ? raw.confidence : undefined,
      probabilities: isStringNumberRecord(raw.probabilities) ? raw.probabilities : undefined,
    }
  }

  const usageRaw = parsed?.usage
  if (typeof usageRaw?.input_tokens !== 'number' || typeof usageRaw?.output_tokens !== 'number') {
    throw new JevError('parse', 'Jev response is missing usage token counts')
  }

  return {
    answers,
    usage: {
      inputTokens: usageRaw.input_tokens,
      outputTokens: usageRaw.output_tokens,
      cost: typeof usageRaw.cost === 'number' ? usageRaw.cost : undefined,
    },
  }
}

function isStringNumberRecord(value: unknown): value is Record<string, number> {
  return !!value && typeof value === 'object' && Object.values(value).every((v) => typeof v === 'number')
}
