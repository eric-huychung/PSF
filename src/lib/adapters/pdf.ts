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

const DATE_PREFIX = /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\*?)(?:\s|$)/
const AMOUNT_SUFFIX = /([+-]?\$?\d[\d,]*\.\d{2})(-)?(?:\s*[♦◆])?$/
const SECTION_LINE = /^(?:total|fees|interest|transactions|account|summary|payment|important|continued)\b/i

function candidateFromLines(pageNumber: number, lines: string[]): PdfTransactionCandidate | null {
  const rawText = lines.join(' ')
  const dateMatch = DATE_PREFIX.exec(rawText)
  const amountMatch = lines.map((line) => AMOUNT_SUFFIX.exec(line)).find(Boolean)
  if (!dateMatch || !amountMatch) return null
  return {
    pageNumber,
    dateText: dateMatch[1].replace('*', ''),
    amountText: `${amountMatch[1]}${amountMatch[2] ?? ''}`,
    rawText,
  }
}

/** Finds likely transaction rows while preserving source text for later validation. */
export function findPdfTransactionCandidates(pages: PdfTextPage[]): PdfTransactionCandidate[] {
  const candidates: PdfTransactionCandidate[] = []

  for (const page of pages) {
    let pending: string[] = []
    // Set once a SECTION_LINE boundary (a "Total ...", column header, etc.) turns up after the
    // pending row -- everything past that boundary is statement structure or disclosure text,
    // never a continuation of the row above it, even if it doesn't itself match SECTION_LINE.
    let closed = false
    const flush = () => {
      const candidate = candidateFromLines(page.pageNumber, pending)
      if (candidate) candidates.push(candidate)
      pending = []
      closed = false
    }

    for (const line of page.lines) {
      if (DATE_PREFIX.test(line)) {
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
