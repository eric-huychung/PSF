import type { ResolvedPdfAssignment } from '../llm/pdfExtractionSchema'
import type { PdfTextPage, PdfTransactionCandidate } from './pdf'

export interface PdfTransactionDraft {
  date: string
  amount: number
  description: string
  pageNumber: number
  sourceText: string
}

export interface RejectedPdfCandidate {
  candidate: PdfTransactionCandidate
  reason: string
}

export interface PdfNormalizationResult {
  drafts: PdfTransactionDraft[]
  rejected: RejectedPdfCandidate[]
}

/**
 * Some issuers glue a footnote marker onto the posting date itself (Amex: `07/10/26*` with a
 * "*Indicates posting date" footnote elsewhere on the page) -- PDF.js emits that as one fused
 * text item, so Jev's evidence-item selection can't cherry-pick just the digits out of it the
 * way a laxer regex over a whole line can. Stripping a trailing footnote glyph here fixes both
 * paths at once, since they share this function.
 */
function parseDate(value: string, statementYear: number): string {
  const cleaned = value.trim().replace(/[*†‡]+$/, '')
  const match = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(cleaned)
  if (!match) throw new Error(`invalid date "${value}"`)
  const month = Number(match[1])
  const day = Number(match[2])
  const year = match[3] ? (match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])) : statementYear
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`invalid date "${value}"`)
  }
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

function parseAmount(value: string): number {
  const trailingMinus = value.endsWith('-')
  const parentheses = value.startsWith('(') && value.endsWith(')')
  const leadingMinus = value.startsWith('-')
  const numeric = value.replace(/[$(),-]/g, '').trim()
  if (!/^\d+(?:\.\d{2})?$/.test(numeric)) throw new Error(`invalid amount "${value}"`)
  const amount = Number(numeric)
  return trailingMinus || parentheses || leadingMinus ? -amount : amount
}

/**
 * Every US credit card statement is required (Truth in Lending Act / Reg Z) to print a
 * "Minimum Payment Due" -- a phrase that never appears on a checking/savings statement. That
 * makes it a deterministic signal for which sign convention the page is using, not a guess.
 *
 * Credit card statements print a charge as a bare positive number and a payment/credit with an
 * explicit minus -- the opposite of our convention (positive = money in). Checking/savings
 * statements already print in our convention (a withdrawal is the one with the minus). So a
 * credit card statement's raw text sign needs flipping; a checking statement's doesn't.
 */
export function isCreditCardStatement(pages: ReadonlyArray<PdfTextPage>): boolean {
  return pages.some((page) => page.lines.some((line) => /minimum payment due/i.test(line)))
}

function descriptionFrom(candidate: PdfTransactionCandidate): string {
  return candidate.rawText
    .replace(candidate.dateText, '')
    .replace(candidate.amountText, '')
    .replace(/\s+/g, ' ')
    .trim()
}

interface RawPdfRow {
  dateText: string
  amountText: string
  description: string
  sourceText: string
}

interface MaterializedRow {
  date: string
  amount: number
  description: string
  sourceText: string
}

/**
 * The one piece of conversion logic shared by both draft-materialization paths below: parse the
 * date and amount out of their raw text, flip the sign for a credit card statement, and reject a
 * row with no description or an unparseable date/amount instead of guessing. Both paths feed it
 * their own raw text (a whole candidate line vs. Jev's resolved evidence fields) and attach their
 * own identifying fields (windowId, pageNumber) to the result themselves.
 */
function materializeRow(row: RawPdfRow, statementYear: number, isCreditCard: boolean): MaterializedRow {
  if (!row.description) throw new Error('missing description')
  const rawAmount = parseAmount(row.amountText)
  return {
    date: parseDate(row.dateText, statementYear),
    amount: isCreditCard ? -rawAmount : rawAmount,
    description: row.description,
    sourceText: row.sourceText,
  }
}

/** Converts candidate rows to safe drafts and reports malformed rows explicitly. */
export function normalizePdfCandidates(
  candidates: PdfTransactionCandidate[],
  statementYear: number,
  isCreditCard: boolean,
): PdfNormalizationResult {
  const drafts: PdfTransactionDraft[] = []
  const rejected: RejectedPdfCandidate[] = []

  for (const candidate of candidates) {
    try {
      const row = materializeRow(
        { dateText: candidate.dateText, amountText: candidate.amountText, description: descriptionFrom(candidate), sourceText: candidate.rawText },
        statementYear,
        isCreditCard,
      )
      drafts.push({ ...row, pageNumber: candidate.pageNumber })
    } catch (error) {
      rejected.push({ candidate, reason: error instanceof Error ? error.message : 'invalid candidate' })
    }
  }

  return { drafts, rejected }
}

export interface PdfMaterializedDraft {
  windowId: string
  pageNumber: number
  date: string
  amount: number
  description: string
  sourceText: string
}

export interface RejectedPdfAssignment {
  windowId: string
  pageNumber: number
  reason: string
}

export interface PdfMaterializationResult {
  drafts: PdfMaterializedDraft[]
  rejected: RejectedPdfAssignment[]
}

/**
 * Converts Jev's accepted evidence references into normalized transaction drafts. Only
 * `status: 'accepted'` assignments materialize -- `unresolved`/`non-transaction` windows are
 * not transactions and are left to the validation stage (page-continuity) to reason about.
 * Date/amount parsing happens here, in code, from the resolved evidence text -- never from
 * anything the model said about the value.
 *
 * The sign comes from `parseAmount`'s own text cues (trailing minus, parentheses), the exact
 * function the deterministic path above already trusts -- not from Jev's semantic debit/credit
 * judgment. `isCreditCard` is the one exception, and it's still not a judgment call: it's
 * `isCreditCardStatement`'s deterministic read of the statement's own required "Minimum Payment
 * Due" disclosure, the same flag the deterministic path above uses -- so the two never disagree
 * with each other over which convention applies.
 */
export function materializeAssignments(
  resolved: ResolvedPdfAssignment[],
  statementYear: number,
  isCreditCard: boolean,
): PdfMaterializationResult {
  const drafts: PdfMaterializedDraft[] = []
  const rejected: RejectedPdfAssignment[] = []

  for (const assignment of resolved) {
    if (assignment.status !== 'accepted') continue
    try {
      // dateText/amountText are required for 'accepted' -- reaching here without one of them is
      // a buildAssignments bug, not a real-world input to guard.
      const row = materializeRow(
        {
          dateText: assignment.dateText!,
          amountText: assignment.amountText!,
          description: assignment.descriptionText,
          sourceText: `${assignment.dateText} ${assignment.descriptionText} ${assignment.amountText}`,
        },
        statementYear,
        isCreditCard,
      )
      drafts.push({ ...row, windowId: assignment.windowId, pageNumber: assignment.pageNumber })
    } catch (error) {
      rejected.push({
        windowId: assignment.windowId,
        pageNumber: assignment.pageNumber,
        reason: error instanceof Error ? error.message : 'invalid assignment',
      })
    }
  }

  return { drafts, rejected }
}
