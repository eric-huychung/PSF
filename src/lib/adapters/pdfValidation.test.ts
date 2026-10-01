import { describe, expect, it } from 'vitest'
import type { ResolvedPdfAssignment } from '../llm/pdfExtractionSchema'
import type { PdfMaterializedDraft } from './pdf-normalize'
import type { PdfEvidenceWindow } from './pdfEvidence'
import { validatePdfExtraction } from './pdfValidation'

function draft(overrides: Partial<PdfMaterializedDraft>): PdfMaterializedDraft {
  return {
    windowId: 'w-1',
    pageNumber: 1,
    date: '2026-08-06',
    amount: -41.97,
    description: 'STEAMGAMES.COM',
    sourceText: '08/06 STEAMGAMES.COM $41.97',
    ...overrides,
  }
}

function window(overrides: Partial<PdfEvidenceWindow> & { id: string; pageNumber: number; y: number }): PdfEvidenceWindow {
  const { id, pageNumber, y, ...rest } = overrides
  return {
    id,
    pageNumber,
    extractorVersion: 'pdf-evidence-v1',
    lines: [{ pageNumber, y, items: [], text: '' }],
    ...rest,
  }
}

describe('validatePdfExtraction', () => {
  it('is ready when there are no issues', () => {
    const drafts = [draft({})]
    const windows = [window({ id: 'w-1', pageNumber: 1, y: 90 })]
    const result = validatePdfExtraction(drafts, [], windows, 2026)
    expect(result).toEqual({ status: 'ready', issues: [] })
  })

  it('flags overlapping windows that resolved to the same transaction as a duplicate', () => {
    const drafts = [draft({ windowId: 'w-1' }), draft({ windowId: 'w-2' })]
    const windows = [window({ id: 'w-1', pageNumber: 1, y: 90 }), window({ id: 'w-2', pageNumber: 1, y: 90 })]
    const result = validatePdfExtraction(drafts, [], windows, 2026)
    expect(result.status).toBe('needs-review')
    expect(result.issues).toEqual([expect.objectContaining({ kind: 'duplicate', windowIds: ['w-1', 'w-2'] })])
  })

  it('flags a transaction dated outside the statement year', () => {
    const drafts = [draft({ date: '2025-12-31' })]
    const windows = [window({ id: 'w-1', pageNumber: 1, y: 90 })]
    const result = validatePdfExtraction(drafts, [], windows, 2026)
    expect(result.status).toBe('needs-review')
    expect(result.issues).toEqual([expect.objectContaining({ kind: 'out-of-period', windowIds: ['w-1'] })])
  })

  it('flags an unresolved window at the bottom of a page as a possible split row', () => {
    const windows = [
      window({ id: 'w-top', pageNumber: 1, y: 90 }),
      window({ id: 'w-bottom', pageNumber: 1, y: 10 }),
    ]
    const resolved: ResolvedPdfAssignment[] = [
      { windowId: 'w-top', pageNumber: 1, status: 'non-transaction', descriptionText: '' },
      { windowId: 'w-bottom', pageNumber: 1, status: 'unresolved', descriptionText: '' },
    ]
    const result = validatePdfExtraction([], resolved, windows, 2026)
    expect(result.status).toBe('needs-review')
    expect(result.issues).toEqual([expect.objectContaining({ kind: 'page-continuity', windowIds: ['w-bottom'] })])
  })

  it('does not flag an ordinary unresolved window that is not at the bottom of the page', () => {
    const windows = [
      window({ id: 'w-top', pageNumber: 1, y: 90 }),
      window({ id: 'w-bottom', pageNumber: 1, y: 10 }),
    ]
    const resolved: ResolvedPdfAssignment[] = [
      { windowId: 'w-top', pageNumber: 1, status: 'unresolved', descriptionText: '' },
      { windowId: 'w-bottom', pageNumber: 1, status: 'non-transaction', descriptionText: '' },
    ]
    const result = validatePdfExtraction([], resolved, windows, 2026)
    expect(result).toEqual({ status: 'ready', issues: [] })
  })
})
