import type { PdfTextPage } from '../adapters/pdf'
import type { PdfTransactionDraft } from '../adapters/pdf-normalize'
import { runPdfShadowExtraction } from '../adapters/pdfReview'
import { judgeExtraction, type JudgeOptions } from '../llm/judge'

const AMOUNT_EPSILON = 0.005

/**
 * Cross-checks the deterministic parser's drafts against Jev's independent read of the same PDF
 * (the same "shadow extraction" that used to sit behind an opt-in checkbox -- now run silently on
 * every PDF so this check has a second opinion to compare against). Where the two agree (same date
 * + amount), the row is trusted for free, no model call. Where they disagree, only that one row
 * goes to the cheap judge, so judge cost tracks how often the two extractors actually disagree,
 * not how many transactions are on the statement.
 *
 * Fails open at every step -- no API key, Jev unavailable, or a judge error all just mean "no
 * flags", same as if this check never ran. It only ever adds a "please verify" hint; it can never
 * block or change the deterministic import.
 */
export async function verifyExtraction(
  drafts: PdfTransactionDraft[],
  pages: PdfTextPage[],
  statementYear: number,
  options: JudgeOptions,
): Promise<Map<number, string>> {
  const flags = new Map<number, string>()
  if (!drafts.length) return flags

  let shadow
  try {
    shadow = await runPdfShadowExtraction(pages, statementYear, options)
  } catch {
    return flags
  }
  if (shadow.mode === 'unavailable') return flags

  const unmatchedJevRows = shadow.rows.filter((row) => row.status === 'accepted' && row.date !== undefined && row.amount !== undefined)

  await Promise.all(
    drafts.map(async (draft, index) => {
      const matchIndex = unmatchedJevRows.findIndex((row) => row.date === draft.date && Math.abs((row.amount ?? 0) - draft.amount) < AMOUNT_EPSILON)
      if (matchIndex !== -1) {
        unmatchedJevRows.splice(matchIndex, 1)
        return
      }
      try {
        const verdict = await judgeExtraction(draft.sourceText, { date: draft.date, amount: draft.amount, description: draft.description }, statementYear, options)
        if (verdict.verdict === 'fail') flags.set(index, verdict.reason ?? 'The deterministic parser and Jev disagreed on this row, and the judge flagged it too.')
      } catch {
        // fail open: a judge error is not a flag
      }
    }),
  )

  return flags
}
