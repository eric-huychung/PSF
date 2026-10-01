import { describe, expect, it, vi } from 'vitest'
import type { PdfTextItem, PdfTextPage } from './pdf'
import { runPdfShadowExtraction } from './pdfReview'

function item(str: string, x: number, y: number): PdfTextItem {
  return { str, transform: [1, 0, 0, 1, x, y] }
}

/**
 * One page: a header line, then one real transaction row split into three evidence items.
 * buildPdfEvidence assigns evidence ids positionally (p{page}-i{index in this items array}),
 * never from anything the caller supplies -- so the row items land at p1-i3, p1-i4, p1-i5.
 */
function page(rowItems?: PdfTextItem[]): PdfTextPage {
  const headerItems = [item('Date', 10, 100), item('Description', 100, 100), item('Amount', 300, 100)]
  return {
    pageNumber: 1,
    lines: ['Date Description Amount', '08/06 STEAMGAMES.COM $41.97'],
    items: [...headerItems, ...(rowItems ?? [item('08/06', 10, 90), item('STEAMGAMES.COM', 100, 90), item('$41.97', 300, 90)])],
  }
}

function decisionsResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

/**
 * buildPdfEvidence ids are deterministic: p{page}-w{startLine}-{span}. A 2-line page produces
 * three overlapping windows (span 1 and 2), all of which requestWindowDecisions asks a status
 * for -- header (line 0), the header+row span (line 0-1), and the real row (line 1).
 */
const HEADER_WINDOW = 'p1-w0-1'
const SPANNING_WINDOW = 'p1-w0-2'
const ROW_WINDOW = 'p1-w1-1'

/** Answers every question requestWindowDecisions asks for the fixture's three windows in one batched Decisions call. */
function batchAnswers(overrides: {
  row?: { status?: string; date?: string; amount?: string }
} = {}) {
  const row = { status: 'accepted', date: 'p1-i3', amount: 'p1-i5', ...overrides.row }
  const nonTransaction = (windowId: string) => ({
    [`${windowId}::status`]: { type: 'choice', choice: 'non-transaction' },
    [`${windowId}::date`]: { type: 'choice', choice: 'none' },
    [`${windowId}::amount`]: { type: 'choice', choice: 'none' },
  })

  return {
    answers: {
      ...nonTransaction(HEADER_WINDOW),
      ...nonTransaction(SPANNING_WINDOW),
      [`${ROW_WINDOW}::status`]: { type: 'choice', choice: row.status },
      [`${ROW_WINDOW}::date`]: { type: 'choice', choice: row.date },
      [`${ROW_WINDOW}::amount`]: { type: 'choice', choice: row.amount },
    },
    usage: { input_tokens: 200, output_tokens: 20 },
  }
}

describe('runPdfShadowExtraction', () => {
  it('produces a ready shadow result when Jev accepts a clean row', async () => {
    const pages = [page()]
    const fetch = vi.fn<typeof globalThis.fetch>(async () => decisionsResponse(batchAnswers()))

    const result = await runPdfShadowExtraction(pages, 2026, { apiKey: 'sk-test', fetch })

    expect(result.mode).toBe('ready')
    expect(result.rows).toContainEqual(
      expect.objectContaining({ windowId: ROW_WINDOW, status: 'accepted', date: '2026-08-06', amount: 41.97, description: 'STEAMGAMES.COM' }),
    )
    expect(result.metrics.modelId).toBeTruthy()
    expect(result.metrics.promptVersion).toBeTruthy()
    expect(result.metrics.reconciliationPassRate).toBe(1)
  })

  it('never writes anything to storage -- it only returns a comparison result', async () => {
    const pages = [page()]
    const fetch = vi.fn<typeof globalThis.fetch>(async () => decisionsResponse(batchAnswers()))

    await runPdfShadowExtraction(pages, 2026, { apiKey: 'sk-test', fetch })

    // The only side effect available to this function is the injected fetch -- nothing else was touched.
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('falls back to "unavailable" without retrying when the model response is missing an answer', async () => {
    const pages = [page()]
    const fetch = vi.fn<typeof globalThis.fetch>(async () => decisionsResponse({ answers: {}, usage: { input_tokens: 1, output_tokens: 1 } }))

    const result = await runPdfShadowExtraction(pages, 2026, { apiKey: 'sk-test', fetch })

    expect(result.mode).toBe('unavailable')
    expect(result.rows).toEqual([])
    expect(result.fallbackReason).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retries once on a transient 503, then succeeds', async () => {
    const pages = [page()]
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(decisionsResponse(batchAnswers()))

    const result = await runPdfShadowExtraction(pages, 2026, { apiKey: 'sk-test', fetch })

    expect(result.mode).toBe('ready')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('gives up after the bounded retry limit and falls back', async () => {
    const pages = [page()]
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}', { status: 503 }))

    const result = await runPdfShadowExtraction(pages, 2026, { apiKey: 'sk-test', fetch })

    expect(result.mode).toBe('unavailable')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('routes a materialization failure to needs-review instead of silently dropping it', async () => {
    // Amount evidence text is not a parseable amount -- materializeAssignments must reject it,
    // and that rejection must surface as a review row, not vanish.
    const pages = [page([item('08/06', 10, 90), item('STEAMGAMES.COM', 100, 90), item('TBD', 300, 90)])]
    const fetch = vi.fn<typeof globalThis.fetch>(async () => decisionsResponse(batchAnswers()))

    const result = await runPdfShadowExtraction(pages, 2026, { apiKey: 'sk-test', fetch })

    expect(result.mode).toBe('needs-review')
    expect(result.rows).toContainEqual(expect.objectContaining({ windowId: ROW_WINDOW, status: 'rejected' }))
  })

  it('demotes one self-contradictory window (accepted with no date evidence) to unresolved instead of voiding the whole result', async () => {
    // This is the real failure seen on a live statement: one window answered "accepted" but
    // "none" for date, and used to fail the entire batch even though every other window was fine.
    const pages = [page()]
    const fetch = vi.fn<typeof globalThis.fetch>(async () => decisionsResponse(batchAnswers({ row: { status: 'accepted', date: 'none' } })))

    const result = await runPdfShadowExtraction(pages, 2026, { apiKey: 'sk-test', fetch })

    expect(result.mode).not.toBe('unavailable')
    expect(result.rows).toContainEqual(expect.objectContaining({ windowId: ROW_WINDOW, status: 'unresolved' }))
  })
})
