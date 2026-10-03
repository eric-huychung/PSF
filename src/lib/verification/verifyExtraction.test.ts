import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdfTextPage } from '../adapters/pdf'
import type { PdfTransactionDraft } from '../adapters/pdf-normalize'
import type { PdfShadowResult, PdfShadowRow } from '../adapters/pdfReview'
import { verifyExtraction } from './verifyExtraction'

vi.mock('../adapters/pdfReview')
vi.mock('../llm/judge')

const { runPdfShadowExtraction } = await import('../adapters/pdfReview')
const { judgeExtraction } = await import('../llm/judge')

beforeEach(() => {
  vi.clearAllMocks()
})

const pages: PdfTextPage[] = []
const options = { apiKey: 'k' }

function shadowRow(overrides: Partial<PdfShadowRow> = {}): PdfShadowRow {
  return { windowId: 'w', pageNumber: 1, status: 'accepted', date: '2026-06-06', amount: -8, description: 'row', ...overrides }
}

function shadow(rows: PdfShadowRow[]): PdfShadowResult {
  return { mode: 'ready', rows, metrics: { modelId: 'm', promptVersion: 'v', candidateRecall: 1, falsePositiveRate: 0, unresolvedRate: 0, reconciliationPassRate: 1 } }
}

function draft(overrides: Partial<PdfTransactionDraft> = {}): PdfTransactionDraft {
  return { date: '2026-06-06', amount: -8, description: 'row', pageNumber: 1, sourceText: 'row', ...overrides }
}

describe('verifyExtraction -- missing rows', () => {
  it('reports zero missing rows when every Jev row matches a draft', async () => {
    vi.mocked(runPdfShadowExtraction).mockResolvedValue(shadow([shadowRow()]))
    const result = await verifyExtraction([draft()], pages, 2026, options, false)
    expect(result.missingRowCount).toBe(0)
  })

  it('counts a Jev-accepted row with no matching draft as missing, instead of discarding it', async () => {
    vi.mocked(runPdfShadowExtraction).mockResolvedValue(shadow([
      shadowRow(),
      shadowRow({ windowId: 'w2', date: '2026-06-07', amount: -47 }),
    ]))
    const result = await verifyExtraction([draft()], pages, 2026, options, false)
    expect(result.missingRowCount).toBe(1)
  })

  it('does not count a rejected/non-transaction Jev row as missing', async () => {
    vi.mocked(runPdfShadowExtraction).mockResolvedValue(shadow([
      shadowRow(),
      shadowRow({ windowId: 'w2', status: 'non-transaction', date: undefined, amount: undefined }),
    ]))
    const result = await verifyExtraction([draft()], pages, 2026, options, false)
    expect(result.missingRowCount).toBe(0)
  })

  it('reports zero missing rows when Jev is unavailable, same as today', async () => {
    vi.mocked(runPdfShadowExtraction).mockResolvedValue({ mode: 'unavailable', rows: [], metrics: shadow([]).metrics })
    const result = await verifyExtraction([draft()], pages, 2026, options, false)
    expect(result.missingRowCount).toBe(0)
    expect(judgeExtraction).not.toHaveBeenCalled()
  })
})
