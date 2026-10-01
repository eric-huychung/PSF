import { describe, expect, it } from 'vitest'
import type { PdfEvidenceWindow } from '../adapters/pdfEvidence'
import type { WindowDecisionBundle } from './pdfExtraction'
import { buildAssignments, resolveAssignments } from './pdfExtractionSchema'

const windows: PdfEvidenceWindow[] = [
  {
    id: 'w-transaction',
    pageNumber: 3,
    extractorVersion: 'pdf-evidence-v1',
    lines: [
      {
        pageNumber: 3,
        y: 90,
        text: '08/06 STEAMGAMES.COM $41.97',
        items: [
          { id: 'p3-i42', pageNumber: 3, text: '08/06', x: 10, y: 90 },
          { id: 'p3-i43', pageNumber: 3, text: 'STEAMGAMES.COM', x: 100, y: 90 },
          { id: 'p3-i44', pageNumber: 3, text: '$41.97', x: 300, y: 90 },
        ],
      },
    ],
  },
  {
    id: 'w-header',
    pageNumber: 3,
    extractorVersion: 'pdf-evidence-v1',
    lines: [
      {
        pageNumber: 3,
        y: 100,
        text: 'Date Description Amount',
        items: [
          { id: 'p3-i10', pageNumber: 3, text: 'Date', x: 10, y: 100 },
          { id: 'p3-i11', pageNumber: 3, text: 'Description', x: 100, y: 100 },
          { id: 'p3-i12', pageNumber: 3, text: 'Amount', x: 300, y: 100 },
        ],
      },
    ],
  },
]

const acceptedBundle: WindowDecisionBundle = { windowId: 'w-transaction', status: 'accepted', date: 'p3-i42', amount: 'p3-i44' }
const headerBundle: WindowDecisionBundle = { windowId: 'w-header', status: 'non-transaction', date: 'none', amount: 'none' }

function bundles(...entries: WindowDecisionBundle[]): Map<string, WindowDecisionBundle> {
  return new Map(entries.map((b) => [b.windowId, b]))
}

describe('buildAssignments', () => {
  it('accepts a fully covered, well-formed set of bundles', () => {
    const result = buildAssignments(windows, bundles(acceptedBundle, headerBundle))
    expect(result.assignments).toHaveLength(2)
  })

  it('computes descriptionEvidenceIds in code -- whatever is left after date/amount are removed', () => {
    const result = buildAssignments(windows, bundles(acceptedBundle, headerBundle))
    const txn = result.assignments.find((a) => a.windowId === 'w-transaction')!
    expect(txn.descriptionEvidenceIds).toEqual(['p3-i43'])
  })

  it('uses every window evidence id as the description for a non-accepted window', () => {
    const result = buildAssignments(windows, bundles(acceptedBundle, headerBundle))
    const header = result.assignments.find((a) => a.windowId === 'w-header')!
    expect(header.descriptionEvidenceIds).toEqual(['p3-i10', 'p3-i11', 'p3-i12'])
  })

  it('demotes a window with no bundle to unresolved instead of throwing', () => {
    const result = buildAssignments(windows, bundles(acceptedBundle))
    expect(result.assignments.find((a) => a.windowId === 'w-header')?.status).toBe('unresolved')
    expect(result.assignments).toHaveLength(2)
  })

  it('demotes an invalid status to unresolved instead of throwing', () => {
    const bad = { ...headerBundle, status: 'probably-fine' }
    const result = buildAssignments(windows, bundles(acceptedBundle, bad))
    expect(result.assignments.find((a) => a.windowId === 'w-header')?.status).toBe('unresolved')
  })

  it('demotes an accepted window that picked "none" for date to unresolved, not to a half-trusted accept', () => {
    const bad = { ...acceptedBundle, date: 'none' }
    const result = buildAssignments(windows, bundles(bad, headerBundle))
    const txn = result.assignments.find((a) => a.windowId === 'w-transaction')!
    expect(txn.status).toBe('unresolved')
    expect(txn.dateEvidenceId).toBeUndefined()
  })

  it('demotes an accepted window that picked "none" for amount to unresolved', () => {
    const bad = { ...acceptedBundle, amount: 'none' }
    const result = buildAssignments(windows, bundles(bad, headerBundle))
    expect(result.assignments.find((a) => a.windowId === 'w-transaction')?.status).toBe('unresolved')
  })

  it('demotes an accepted window that used the same evidence id for date and amount', () => {
    const bad = { ...acceptedBundle, amount: acceptedBundle.date }
    const result = buildAssignments(windows, bundles(bad, headerBundle))
    expect(result.assignments.find((a) => a.windowId === 'w-transaction')?.status).toBe('unresolved')
  })

  it('one inconsistent window never affects any other window in the same batch', () => {
    const bad = { ...acceptedBundle, date: 'none' }
    const result = buildAssignments(windows, bundles(bad, headerBundle))
    expect(result.assignments.find((a) => a.windowId === 'w-header')?.status).toBe('non-transaction')
  })

  it('accepts an explicitly unresolved window instead of requiring a guess', () => {
    const unresolved = { ...headerBundle, status: 'unresolved' }
    const result = buildAssignments(windows, bundles(acceptedBundle, unresolved))
    expect(result.assignments.find((a) => a.windowId === 'w-header')?.status).toBe('unresolved')
  })
})

describe('resolveAssignments', () => {
  it('resolves evidence ids back to their real source text', () => {
    const result = buildAssignments(windows, bundles(acceptedBundle, headerBundle))
    const resolved = resolveAssignments(windows, result)

    const txn = resolved.find((r) => r.windowId === 'w-transaction')!
    expect(txn.dateText).toBe('08/06')
    expect(txn.amountText).toBe('$41.97')
    expect(txn.descriptionText).toBe('STEAMGAMES.COM')
    expect(txn.pageNumber).toBe(3)
  })

  it('never surfaces model-produced text -- only evidence looked up from the supplied windows', () => {
    const result = buildAssignments(windows, bundles(acceptedBundle, headerBundle))
    const resolved = resolveAssignments(windows, result)

    const header = resolved.find((r) => r.windowId === 'w-header')!
    expect(header.dateText).toBeUndefined()
    expect(header.amountText).toBeUndefined()
    expect(header.descriptionText).toBe('Date Description Amount')
  })
})
