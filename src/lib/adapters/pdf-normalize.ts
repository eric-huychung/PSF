import type { ResolvedPdfAssignment } from '../llm/pdfExtractionSchema'
import type { AccountType } from '../types'
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

/** `hasExplicitSign` is true when the text itself carried a minus/parens -- see materializeRow for why that matters. */
function parseAmount(value: string): { amount: number; hasExplicitSign: boolean } {
  const trailingMinus = value.endsWith('-')
  const parentheses = value.startsWith('(') && value.endsWith(')')
  const leadingMinus = value.startsWith('-')
  const numeric = value.replace(/[$(),-]/g, '').trim()
  if (!/^\d+(?:\.\d{2})?$/.test(numeric)) throw new Error(`invalid amount "${value}"`)
  const amount = Number(numeric)
  const hasExplicitSign = trailingMinus || parentheses || leadingMinus
  return { amount: hasExplicitSign ? -amount : amount, hasExplicitSign }
}

/**
 * Every US credit card statement is required (Truth in Lending Act / Reg Z) to print a minimum
 * payment disclosure -- a phrase that never appears on a checking/savings statement. That makes
 * it a deterministic signal for which sign convention the page is using, not a guess.
 *
 * Matches on "minimum payment" alone, not "minimum payment due" -- issuers don't all glue those
 * two words together. Wells Fargo prints "Minimum Payment" and "Payment Due Date" as two separate
 * fields, so the stricter phrase never matched a real Wells Fargo statement and every amount on
 * it kept the checking/savings sign convention. Checked against real Amex, Wells Fargo, and
 * Robinhood credit card statements and real BoA checking/savings statements: the looser phrase
 * still matches every credit card statement and still never appears on checking/savings.
 *
 * Credit card statements print a charge as a bare positive number and a payment/credit with an
 * explicit minus -- the opposite of our convention (positive = money in). Checking/savings
 * statements already print in our convention (a withdrawal is the one with the minus). So a
 * credit card statement's raw text sign needs flipping; a checking statement's doesn't.
 */
export function isCreditCardStatement(pages: ReadonlyArray<PdfTextPage>): boolean {
  return pages.some((page) => page.lines.some((line) => /minimum payment\b/i.test(line)))
}

/**
 * The account's declared type (set in Settings, see types.ts's AccountType) is the authoritative
 * sign-convention source -- isCreditCardStatement's text-sniff now only runs as a cross-check.
 * Disagreement is surfaced as a "please verify" flag rather than resolved silently: a legacy
 * account's guessed-from-name type (see normalizeAccounts.ts), or a statement dropped onto the
 * wrong account, should never flip every sign on a statement without the user noticing, the same
 * reasoning that already applies to the Jev extraction cross-check.
 */
export function resolveSignConvention(accountType: AccountType, pages: ReadonlyArray<PdfTextPage>): { isCreditCard: boolean; mismatch: boolean } {
  const isCreditCard = accountType === 'credit'
  return { isCreditCard, mismatch: isCreditCard !== isCreditCardStatement(pages) }
}

export interface StatementBalances {
  previousBalance: number
  newBalance: number
}

/**
 * Pulls the statement's own printed "Previous Balance" / "New Balance" pair -- the same two
 * numbers Reg Z requires every credit card statement to disclose -- so an import can be checked
 * against the issuer's own arithmetic instead of trusting the deterministic parser blindly.
 *
 * Some issuers (Amex Gold) print three of these pairs on one page: a "Pay In Full" sub-balance,
 * a "Pay Over Time" sub-balance, and the combined "Account Total". Rather than name-match a
 * heading (wording varies by issuer, and the card-level detail isn't needed here), this takes the
 * LAST pair in reading order -- checked against every real statement in test/bank pdfs, the
 * combined total always prints last. Each "Previous Balance" line opens a pending pair; the next
 * "New Balance" line (bare, or issuer-prefixed like "= New Balance") closes it, so a dangling,
 * unmatched label never produces a bogus pair.
 *
 * Column-merged lines (the Y-tolerant line grouper in pdf.ts joins same-row text across a page's
 * left and right columns into one string) mean a label can be followed by an unrelated field from
 * the other column, e.g. "Previous Balance $1,814.13 Total Credit Limit $5,000". The lazy
 * non-digit match right after the label stops at that label's own amount, before reaching the
 * next field's number.
 *
 * A balance can itself be a credit (the issuer owes the cardholder, e.g. after an overpayment) --
 * Robinhood prints that as a trailing minus on the amount itself, same convention as a transaction
 * amount elsewhere in this file ("$242.17-"), so it's captured and applied here too.
 */
function parseBalanceAmount(digits: string, trailingMinus: string | undefined): number {
  const amount = Number(digits.replace(/,/g, ''))
  return trailingMinus ? -amount : amount
}

export function extractStatementBalances(pages: ReadonlyArray<PdfTextPage>): StatementBalances | null {
  let pendingPrevious: number | undefined
  let result: StatementBalances | null = null
  for (const page of pages) {
    for (const line of page.lines) {
      const previousMatch = /previous balance\D*?\$?([\d,]+\.\d{2})(-)?/i.exec(line)
      if (previousMatch) pendingPrevious = parseBalanceAmount(previousMatch[1], previousMatch[2])
      const newMatch = /new balance\D*?\$?([\d,]+\.\d{2})(-)?/i.exec(line)
      if (newMatch && pendingPrevious !== undefined) {
        result = { previousBalance: pendingPrevious, newBalance: parseBalanceAmount(newMatch[1], newMatch[2]) }
        pendingPrevious = undefined
      }
    }
  }
  return result
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
  /** Which statement section the row came from, when known -- see PdfTransactionCandidate.section. */
  section?: 'credit' | 'charge'
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
 *
 * Some issuers (Wells Fargo) print every amount bare, with no minus/parens anywhere -- a charge
 * and a payment are textually identical, told apart only by which section of the statement they're
 * printed under. When that's the situation (credit card, no explicit sign in the text, and the
 * row's section is known), the section decides the sign instead of the blind per-statement flip:
 * a "credit" row (Payments) comes out positive, a "charge" row (Purchases/Fees/Interest/Cash
 * Advances) comes out negative. Whenever the text does carry an explicit sign, or the section
 * isn't known, nothing changes -- this only resolves a case that was otherwise ambiguous.
 */
function materializeRow(row: RawPdfRow, statementYear: number, isCreditCard: boolean): MaterializedRow {
  if (!row.description) throw new Error('missing description')
  const { amount: rawAmount, hasExplicitSign } = parseAmount(row.amountText)
  const amount = isCreditCard
    ? !hasExplicitSign && row.section
      ? row.section === 'credit' ? Math.abs(rawAmount) : -Math.abs(rawAmount)
      : -rawAmount
    : rawAmount
  return {
    date: parseDate(row.dateText, statementYear),
    amount,
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
        { dateText: candidate.dateText, amountText: candidate.amountText, description: descriptionFrom(candidate), sourceText: candidate.rawText, section: candidate.section },
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
 * judgment. `isCreditCard` is the one exception, and it's still not a judgment call: the caller
 * passes in the same account-type-derived flag (see `resolveSignConvention`) that the
 * deterministic path above uses -- so the two never disagree with each other over which
 * convention applies.
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
