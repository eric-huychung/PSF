import type { PdfTextItem, PdfTextPage } from './pdf'

/** Bump when the item->line->window construction changes, so old extraction results can be told apart from new ones. */
export const PDF_EVIDENCE_EXTRACTOR_VERSION = 'pdf-evidence-v1'

/** One stable, source-traceable unit of extracted text. IDs come from PDF.js item order on one page of one uploaded PDF -- application code assigns them, never the model. */
export interface PdfEvidenceItem {
  id: string
  pageNumber: number
  text: string
  x: number
  y: number
}

/** Text items on one visual row, grouped by y-coordinate and ordered by x -- same grouping the deterministic parser uses, but evidence-preserving instead of collapsed to a plain string. */
export interface PdfEvidenceLine {
  pageNumber: number
  y: number
  items: PdfEvidenceItem[]
  text: string
}

/**
 * A broad, recall-oriented span of consecutive lines that might contain a transaction.
 * Deliberately not filtered by any date/amount shape -- headers, totals, and other
 * non-transaction lines are windows too. Nothing here decides what's a transaction;
 * that's for a later stage (Jev selection, validation) to resolve or reject explicitly.
 */
export interface PdfEvidenceWindow {
  id: string
  pageNumber: number
  lines: PdfEvidenceLine[]
  extractorVersion: string
}

const Y_TOLERANCE = 2
/** Wrapped descriptions in the current sample statements run at most 2-3 lines; 3 covers them with room to spare. */
const MAX_WINDOW_SPAN = 3

function buildEvidenceItems(pageNumber: number, items: PdfTextItem[]): PdfEvidenceItem[] {
  return items.map((item, index) => ({
    id: `p${pageNumber}-i${index}`,
    pageNumber,
    text: item.str,
    x: item.transform[4] ?? 0,
    y: item.transform[5] ?? 0,
  }))
}

function groupEvidenceIntoLines(pageNumber: number, items: PdfEvidenceItem[]): PdfEvidenceLine[] {
  const lines: PdfEvidenceLine[] = []

  for (const item of items) {
    if (!item.text.trim()) continue
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= Y_TOLERANCE)
    if (!line) {
      line = { pageNumber, y: item.y, items: [], text: '' }
      lines.push(line)
    }
    line.items.push(item)
  }

  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x)
    line.text = line.items.map((i) => i.text.trim()).join(' ').replace(/\s+/g, ' ').trim()
  }

  return lines.sort((a, b) => b.y - a.y)
}

/** Every window of 1..MAX_WINDOW_SPAN consecutive lines on one page. Overlapping on purpose: this is recall, later stages narrow it down. */
function buildWindowsForPage(pageNumber: number, lines: PdfEvidenceLine[]): PdfEvidenceWindow[] {
  const windows: PdfEvidenceWindow[] = []
  for (let start = 0; start < lines.length; start++) {
    for (let span = 1; span <= MAX_WINDOW_SPAN && start + span <= lines.length; span++) {
      windows.push({
        id: `p${pageNumber}-w${start}-${span}`,
        pageNumber,
        lines: lines.slice(start, start + span),
        extractorVersion: PDF_EVIDENCE_EXTRACTOR_VERSION,
      })
    }
  }
  return windows
}

/**
 * Matches the account-identifying lines PSF's own product requirements say must never leave the
 * browser (description/amount/date only, "never raw statement text or account numbers"). This evidence
 * ledger is the only thing that gets sent to Jev/OpenRouter, so it's the one place that boundary
 * has to be enforced -- the deterministic parser never sees this module at all, and a transaction
 * row never legitimately contains an account label or a 12+ digit card/account number, so nothing
 * real is lost by dropping lines that do.
 */
const ACCOUNT_LABEL_PATTERN = /account\s*(number|no\.?|#)/i
const MASKED_NUMBER_PATTERN = /(?:[X*•]{2,}[\s-]?){2,}\d{2,4}/i
const LONG_DIGIT_RUN_PATTERN = /\b\d{12,19}\b/

function isAccountIdentifyingLine(text: string): boolean {
  return ACCOUNT_LABEL_PATTERN.test(text) || MASKED_NUMBER_PATTERN.test(text) || LONG_DIGIT_RUN_PATTERN.test(text)
}

/**
 * Builds a stable, recall-oriented evidence ledger from already-extracted PDF.js pages.
 * Keeps item IDs, coordinates, and raw text instead of reducing straight to flattened
 * lines, and keeps every line representable -- including headers and totals -- rather
 * than discarding anything up front. Runs alongside `findPdfTransactionCandidates`
 * (unchanged) rather than replacing it; the narrow deterministic path stays available.
 *
 * Account-identifying lines (an "Account Number" label, a masked card/account number, or a bare
 * long account/card number) are dropped before windows are built from them, so they can never
 * appear in a window sent to Jev -- this also removes whatever else shares that line (e.g. the
 * cardholder's name printed next to the account number on the same header row) without needing
 * separate name detection.
 */
export function buildPdfEvidence(pages: PdfTextPage[]): PdfEvidenceWindow[] {
  return pages.flatMap((page) => {
    const items = buildEvidenceItems(page.pageNumber, page.items)
    const lines = groupEvidenceIntoLines(page.pageNumber, items).filter((line) => !isAccountIdentifyingLine(line.text))
    return buildWindowsForPage(page.pageNumber, lines)
  })
}
