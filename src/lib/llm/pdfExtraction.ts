import type { PdfEvidenceWindow } from '../adapters/pdfEvidence'
import { createJevClient, type JevChoiceQuestion, type JevDecisionOptions } from './jevClient'

export {
  JEV_MODEL_SLUG,
  JevError,
  createJevClient,
  type JevBatchAnswers,
  type JevChoiceAnswer,
  type JevChoiceQuestion,
  type JevClient,
  type JevDecisionOptions,
  type JevErrorKind,
  type JevUsage,
} from './jevClient'

export type AssignmentStatus = 'accepted' | 'non-transaction' | 'unresolved'
export const ASSIGNMENT_STATUSES: AssignmentStatus[] = ['accepted', 'non-transaction', 'unresolved']

/**
 * (G3/G5) Bumps whenever the Choice questions asked per window, or the bundle shape
 * `pdfExtractionSchema.ts` assembles from their answers, changes -- recorded with every
 * extraction result so a shift in prompt behavior can be told apart from a shift in the model
 * itself.
 *
 * v2: Jev is a decision model (Choice/Score/Noul only) -- it cannot generate the free-form
 * `{assignments:[...]}` JSON array v1 asked for over chat/completions, which OpenRouter
 * rejects outright for this model. v2 instead asks four bounded Choice questions per window
 * (status, date evidence, amount evidence, amount role) over the Decisions API, batched across
 * windows into as few calls as possible. `descriptionEvidenceIds` is no longer something Jev
 * picks -- it's whatever evidence is left in the window once code removes the chosen date/amount
 * items, same as the rest of PSF's "code owns composition, Jev owns bounded selection" split.
 *
 * v3: v2 passed an empty shared `state` and relied on question naming alone to distinguish one
 * window's status/role question from another's -- since every window's status question then had
 * identical instructions and criteria, Jev had nothing to condition on and answered "unresolved"
 * for all of them on a real statement. v3 embeds each window's own text directly into every
 * question's `instructions`, so each of the many questions batched into one call is
 * self-contained.
 *
 * v4: dropped the `role` (debit/credit) question entirely. Credit-card and checking-account
 * statements print opposite sign conventions for a "debit" (a card charge is conventionally
 * positive; a checking withdrawal is conventionally negative), so no single hardcoded
 * role-to-sign formula can agree with both -- confirmed on real statements, where Jev's signs
 * matched a checking statement but were inverted on a credit-card one. `amountRole` also wasn't
 * independent of `status` in practice: two overlapping windows describing the same real
 * transaction sometimes came back with different role answers. The sign now comes from the same
 * source-text cues (trailing minus, parentheses) the deterministic parser already trusts, applied
 * in `pdf-normalize.ts` to whichever evidence item Jev pointed at -- one sign rule, used by both
 * paths, instead of two that can disagree.
 */
export const PDF_EXTRACTION_PROMPT_VERSION = 'pdf-extraction-prompt-v4'

/** Every window asks the same three bounded questions; this is Jev's raw pick for each, still unvalidated against the extraction rules. */
export interface WindowDecisionBundle {
  windowId: string
  status: string
  date: string
  amount: string
}

/** The `none` criterion offered on every evidence-picking question -- the cookbook's recommended explicit escape hatch so a Choice never has to guess. */
export const NO_EVIDENCE = 'none'

const STATUS_CRITERIA: Record<AssignmentStatus, string> = {
  accepted: 'This window is exactly one transaction row: a date, a description, and one amount.',
  'non-transaction': 'This window is not a transaction row -- a header, footer, total, balance, or continuation line.',
  unresolved: 'This window might be a transaction row, but the evidence here is too ambiguous or incomplete to decide.',
}

function windowEvidenceCriteria(window: PdfEvidenceWindow, none: string): Record<string, string> {
  const criteria: Record<string, string> = { [NO_EVIDENCE]: none }
  for (const line of window.lines) {
    for (const item of line.items) criteria[item.id] = item.text
  }
  return criteria
}

function questionKey(windowId: string, question: string): string {
  return `${windowId}::${question}`
}

/**
 * Every window's raw text, joined so the model can read it as one line. Every one of the ~100
 * questions batched into one Decisions call must carry this itself: the request has one shared
 * `state`, but a named question's `instructions` is the only thing distinguishing it from every
 * other window's otherwise-identical question -- passing an empty/shared `state` and relying on
 * naming alone left every window's status/role question indistinguishable from every other's, so
 * Jev had no basis to answer anything but "unresolved" for all of them.
 */
function windowText(window: PdfEvidenceWindow): string {
  return window.lines.map((line) => line.text).join(' / ')
}

function windowQuestions(window: PdfEvidenceWindow): Record<string, JevChoiceQuestion> {
  const text = windowText(window)
  return {
    [questionKey(window.id, 'status')]: {
      type: 'choice',
      instructions: `Classify this evidence window from a bank/card statement PDF. Window text: "${text}"`,
      criteria: STATUS_CRITERIA,
    },
    [questionKey(window.id, 'date')]: {
      type: 'choice',
      instructions: `Which evidence item, if any, is this window's transaction date? Window text: "${text}"`,
      criteria: windowEvidenceCriteria(window, 'No reliable date evidence in this window.'),
    },
    [questionKey(window.id, 'amount')]: {
      type: 'choice',
      instructions: `Which evidence item, if any, is this window's transaction amount? Window text: "${text}"`,
      criteria: windowEvidenceCriteria(window, 'No reliable amount evidence in this window.'),
    },
  }
}

/**
 * Windows overlap on purpose for recall (every 1..3-line span), so one page can carry well over a
 * hundred windows -- at three questions each, batching every window into one call could mean
 * hundreds of named questions per request. TypeSafe's docs don't state a per-request question
 * cap (only a 255-option cap per individual Choice, which a 1..3-line window's evidence never
 * approaches), so this chunk size is a conservative starting point to tune once real traffic is
 * observed, not a documented limit.
 */
const WINDOWS_PER_DECISIONS_CALL = 25

export interface PdfExtractionRequestOptions {
  apiKey: string
  /** Injectable for tests; defaults to the browser's fetch. */
  fetch?: typeof fetch
}

/**
 * (G3/G5) Asks Jev to classify every evidence window via bounded Choice questions over the
 * Decisions API, chunked across as few calls as `WINDOWS_PER_DECISIONS_CALL` allows. Returns one
 * raw answer bundle per window -- callers assemble and validate these with
 * `pdfExtractionSchema.ts`'s `buildAssignments` before trusting anything in them.
 */
export async function requestWindowDecisions(
  { apiKey, fetch: fetchImpl = globalThis.fetch.bind(globalThis) }: PdfExtractionRequestOptions,
  windows: PdfEvidenceWindow[],
): Promise<Map<string, WindowDecisionBundle>> {
  const client = createJevClient({ apiKey, fetch: fetchImpl } satisfies JevDecisionOptions)
  const bundles = new Map<string, WindowDecisionBundle>()

  for (let start = 0; start < windows.length; start += WINDOWS_PER_DECISIONS_CALL) {
    const chunk = windows.slice(start, start + WINDOWS_PER_DECISIONS_CALL)
    const questions: Record<string, JevChoiceQuestion> = {}
    for (const window of chunk) Object.assign(questions, windowQuestions(window))

    const { answers } = await client.askChoices({}, questions)
    for (const window of chunk) {
      bundles.set(window.id, {
        windowId: window.id,
        status: answers[questionKey(window.id, 'status')].choice,
        date: answers[questionKey(window.id, 'date')].choice,
        amount: answers[questionKey(window.id, 'amount')].choice,
      })
    }
  }

  return bundles
}
