import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

export interface PdfTextItem {
  str: string
  transform: number[]
}

export interface PdfTextPage {
  pageNumber: number
  lines: string[]
  /** Raw items backing `lines`, kept for evidence-preserving extraction (see pdfEvidence.ts). Not used by the deterministic line-based parser below. */
  items: PdfTextItem[]
}

export interface PdfTransactionCandidate {
  pageNumber: number
  dateText: string
  amountText: string
  rawText: string
  /**
   * Which statement section this row was found under, when the statement has section headers
   * that say so ("Payments" vs "Purchases ... & Other Charges" / "Fees Charged" / "Interest
   * Charged" / "Cash Advances"). Undefined when no such header was seen -- some issuers print an
   * explicit +/- on every amount and never need this. See pdf-normalize.ts for why it matters:
   * an issuer that prints bare, unsigned amounts (Wells Fargo) can only be told apart by section.
   */
  section?: 'credit' | 'charge'
}

function isTextItem(value: unknown): value is PdfTextItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<PdfTextItem>
  return typeof item.str === 'string' && Array.isArray(item.transform)
}

/** Reconstructs visual text lines without interpreting bank-specific content. */
export function groupTextItemsIntoLines(items: PdfTextItem[], yTolerance = 2): string[] {
  const lines: Array<{ y: number; items: Array<{ x: number; text: string }> }> = []

  for (const item of items) {
    const x = item.transform[4] ?? 0
    const y = item.transform[5] ?? 0
    let line = lines.find((candidate) => Math.abs(candidate.y - y) <= yTolerance)
    if (!line) {
      line = { y, items: [] }
      lines.push(line)
    }
    line.items.push({ x, text: item.str })
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => line.items
      .sort((a, b) => a.x - b.x)
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean)
}

/**
 * The date is normally the first thing on a transaction line, but some issuers (Wells Fargo)
 * print a card-ending-digits column before it on every row, e.g. "7942 06/06 06/08 ...". The
 * second alternative allows exactly one short all-digit leading token (a card/account suffix,
 * never more than a handful of digits) before the date, so a row isn't missed just because of
 * that column. It deliberately does NOT accept an arbitrary leading word -- that was tried and
 * caught real false positives elsewhere (an Amex interest-rate table row like
 * "Purchases 05/13/2026 28.49% ...", and page footers like "p. 7/9" both have a date-shaped
 * second token but aren't transactions; digits-only avoids both).
 */
const DATE_PREFIX = /^(?:(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\*?)|\d{1,6}\s+(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\*?))(?:\s|$)/
const AMOUNT_SUFFIX = /([+-]?\$?\d[\d,]*\.\d{2})(-)?(?:\s*[♦◆])?$/
const SECTION_LINE = /^(?:total|fees|interest|transactions|account|summary|payment|important|continued)\b/i

/**
 * Credit card section headers that tell rows under them apart when the amounts themselves carry
 * no sign -- see the `section` field on PdfTransactionCandidate. Anchored to match the WHOLE
 * line, not just its start: a loose `^payments\b` also matched Amex's boilerplate disclosure
 * sentence "Payments: Your payment must be sent to..." wherever it appears in the document,
 * mis-tagging every real charge row that came after it for the rest of the statement. A real
 * section header is a short standalone label, never a sentence, so requiring the full line to be
 * just the header rules that out.
 */
const CREDIT_SECTION_HEADER = /^payments$/i
const CHARGE_SECTION_HEADER = /^(?:purchases, balance transfers & other charges|fees charged|interest charged|cash advances)$/i

function candidateFromLines(pageNumber: number, lines: string[], section: 'credit' | 'charge' | undefined): PdfTransactionCandidate | null {
  const rawText = lines.join(' ')
  const dateMatch = DATE_PREFIX.exec(rawText)
  const amountMatch = lines.map((line) => AMOUNT_SUFFIX.exec(line)).find(Boolean)
  if (!dateMatch || !amountMatch) return null
  const dateText = dateMatch[1] ?? dateMatch[2]
  return {
    pageNumber,
    dateText: dateText.replace('*', ''),
    amountText: `${amountMatch[1]}${amountMatch[2] ?? ''}`,
    rawText,
    ...(section ? { section } : {}),
  }
}

/** Finds likely transaction rows while preserving source text for later validation. */
export function findPdfTransactionCandidates(pages: PdfTextPage[]): PdfTransactionCandidate[] {
  const candidates: PdfTransactionCandidate[] = []
  // Persists across pages -- a statement section can continue onto the next page without
  // repeating its header.
  let currentSection: 'credit' | 'charge' | undefined

  for (const page of pages) {
    let pending: string[] = []
    // Set once a SECTION_LINE boundary (a "Total ...", column header, etc.) turns up after the
    // pending row -- everything past that boundary is statement structure or disclosure text,
    // never a continuation of the row above it, even if it doesn't itself match SECTION_LINE.
    let closed = false
    const flush = () => {
      const candidate = candidateFromLines(page.pageNumber, pending, currentSection)
      if (candidate) candidates.push(candidate)
      pending = []
      closed = false
    }

    for (const line of page.lines) {
      if (CREDIT_SECTION_HEADER.test(line)) {
        flush()
        currentSection = 'credit'
        closed = true
      } else if (CHARGE_SECTION_HEADER.test(line)) {
        flush()
        currentSection = 'charge'
        closed = true
      } else if (DATE_PREFIX.test(line)) {
        flush()
        pending = [line]
      } else if (SECTION_LINE.test(line)) {
        closed = true
      } else if (!closed && pending.length > 0 && pending.length < 3) {
        pending.push(line)
      }
    }
    flush()
  }

  return candidates
}

/** Extracts text locally. This intentionally does not infer transactions or call an LLM. */
export async function extractPdfText(file: Blob): Promise<PdfTextPage[]> {
  const data = new Uint8Array(await file.arrayBuffer())
  const document = await pdfjs.getDocument({ data }).promise
  const pages: PdfTextPage[] = []

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const items = content.items.filter(isTextItem) as PdfTextItem[]
      pages.push({ pageNumber, lines: groupTextItemsIntoLines(items), items })
    }
    return pages
  } finally {
    await document.cleanup()
  }
}
