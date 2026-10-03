import { describe, expect, it } from 'vitest'
import type { ResolvedPdfAssignment } from '../llm/pdfExtractionSchema'
import type { PdfTextPage } from './pdf'
import { isCreditCardStatement, materializeAssignments, normalizePdfCandidates, resolveSignConvention } from './pdf-normalize'

describe('PDF candidate normalization', () => {
  it('normalizes full and inferred-year dates and bank amount signs', () => {
    expect(normalizePdfCandidates([
      { pageNumber: 1, dateText: '08/08', amountText: '27.63-', rawText: '08/08 08/08 STEAM CREDIT 27.63-' },
      { pageNumber: 3, dateText: '09/04/26', amountText: '-$43.99', rawText: '09/04/26 PURCHASE LinkedIn -$43.99' },
    ], 2026, false)).toEqual({
      drafts: [
        {
          date: '2026-08-08', amount: -27.63, description: '08/08 STEAM CREDIT', pageNumber: 1,
          sourceText: '08/08 08/08 STEAM CREDIT 27.63-',
        },
        {
          date: '2026-09-04', amount: -43.99, description: 'PURCHASE LinkedIn', pageNumber: 3,
          sourceText: '09/04/26 PURCHASE LinkedIn -$43.99',
        },
      ],
      rejected: [],
    })
  })

  it('tolerates a trailing posting-date footnote marker (Amex-style "07/10/26*")', () => {
    const result = normalizePdfCandidates(
      [{ pageNumber: 3, dateText: '07/10/26*', amountText: '-$9.93', rawText: '07/10/26* AUTOPAY PAYMENT RECEIVED -$9.93' }],
      2026,
      false,
    )
    expect(result.rejected).toEqual([])
    expect(result.drafts).toEqual([
      expect.objectContaining({ date: '2026-07-10', amount: -9.93 }),
    ])
  })

  it('rejects malformed rows instead of importing them', () => {
    const result = normalizePdfCandidates([
      { pageNumber: 1, dateText: '02/31/26', amountText: '10.00', rawText: '02/31/26 Invalid 10.00' },
      { pageNumber: 1, dateText: '09/01/26', amountText: 'ten', rawText: '09/01/26 Invalid ten' },
    ], 2026, false)
    expect(result.drafts).toEqual([])
    expect(result.rejected.map((item) => item.reason)).toEqual(['invalid date "02/31/26"', 'invalid amount "ten"'])
  })

  it('flips the sign on a credit card statement, where a charge prints bare positive and a payment prints with a minus', () => {
    const result = normalizePdfCandidates([
      { pageNumber: 1, dateText: '02/15', amountText: '15.01', rawText: '02/15 ARCO#00980 15.01' },
      { pageNumber: 1, dateText: '03/10', amountText: '-$366.32', rawText: '03/10 AUTOPAY PAYMENT RECEIVED -$366.32' },
    ], 2026, true)
    expect(result.drafts).toEqual([
      expect.objectContaining({ amount: -15.01 }),
      expect.objectContaining({ amount: 366.32 }),
    ])
  })

  it('leaves a checking/savings statement\'s sign untouched', () => {
    const result = normalizePdfCandidates(
      [{ pageNumber: 1, dateText: '02/15', amountText: '-15.01', rawText: '02/15 withdrawal -15.01' }],
      2026,
      false,
    )
    expect(result.drafts).toEqual([expect.objectContaining({ amount: -15.01 })])
  })

  it('uses the section to pick the sign when a credit card statement prints bare amounts with no sign at all (Wells Fargo)', () => {
    const result = normalizePdfCandidates([
      { pageNumber: 1, dateText: '06/16', amountText: '200.00', rawText: '06/16 ONLINE PAYMENT THANK YOU 200.00', section: 'credit' },
      { pageNumber: 1, dateText: '06/06', amountText: '8.00', rawText: '7942 06/06 SDOT PARKING 8.00', section: 'charge' },
    ], 2026, true)
    expect(result.drafts).toEqual([
      expect.objectContaining({ amount: 200 }),
      expect.objectContaining({ amount: -8 }),
    ])
  })

  it('falls back to the blind flip when the section is unknown, same as before the section-aware fix', () => {
    const result = normalizePdfCandidates(
      [{ pageNumber: 1, dateText: '06/16', amountText: '200.00', rawText: '06/16 UNSECTIONED ROW 200.00' }],
      2026,
      true,
    )
    expect(result.drafts).toEqual([expect.objectContaining({ amount: -200 })])
  })
})

describe('isCreditCardStatement', () => {
  function pageWithLines(lines: string[]): PdfTextPage {
    return { pageNumber: 1, lines, items: [] }
  }

  it('recognizes the required "Minimum Payment Due" disclosure as a credit card statement', () => {
    expect(isCreditCardStatement([pageWithLines(['New Balance $18.21', 'Minimum Payment Due $18.21'])])).toBe(true)
  })

  it('is case-insensitive and matches on any page', () => {
    expect(isCreditCardStatement([pageWithLines(['intro']), pageWithLines(['minimum payment due $25.00'])])).toBe(true)
  })

  it('does not flag a checking/savings statement', () => {
    expect(isCreditCardStatement([pageWithLines(['Beginning balance on April 18, 2026', 'Deposits and other additions'])])).toBe(false)
  })

  it('recognizes Wells Fargo-style statements that print "Minimum Payment" and "Payment Due Date" as separate fields', () => {
    expect(isCreditCardStatement([pageWithLines(['Payment Due Date 08/02/2026', 'Minimum Payment $73.00', 'New Balance $3,137.55'])])).toBe(true)
  })
})

describe('resolveSignConvention', () => {
  function pageWithLines(lines: string[]): PdfTextPage {
    return { pageNumber: 1, lines, items: [] }
  }
  const creditCardPages = [pageWithLines(['New Balance $18.21', 'Minimum Payment Due $18.21'])]
  const checkingPages = [pageWithLines(['Beginning balance on April 18, 2026', 'Deposits and other additions'])]

  it('trusts the account type over the text-sniff when they agree', () => {
    expect(resolveSignConvention('credit', creditCardPages)).toEqual({ isCreditCard: true, mismatch: false })
    expect(resolveSignConvention('checking', checkingPages)).toEqual({ isCreditCard: false, mismatch: false })
  })

  it('still decides by account type, but flags a mismatch, when the statement text disagrees with the account type', () => {
    expect(resolveSignConvention('checking', creditCardPages)).toEqual({ isCreditCard: false, mismatch: true })
    expect(resolveSignConvention('credit', checkingPages)).toEqual({ isCreditCard: true, mismatch: true })
  })
})

function accepted(overrides: Partial<ResolvedPdfAssignment>): ResolvedPdfAssignment {
  return {
    windowId: 'w-1',
    pageNumber: 1,
    status: 'accepted',
    dateText: '08/06',
    amountText: '$41.97',
    descriptionText: 'STEAMGAMES.COM',
    ...overrides,
  }
}

describe('materializeAssignments', () => {
  it('reads the sign from the resolved amount text, the same way the deterministic path does, when not a credit card statement', () => {
    const result = materializeAssignments(
      [
        accepted({ windowId: 'w-charge', amountText: '$41.97' }),
        accepted({ windowId: 'w-credit', amountText: '27.63-', descriptionText: 'STEAM CREDIT' }),
        accepted({ windowId: 'w-payment', amountText: '-$263.61', descriptionText: 'PAYMENT - THANK YOU' }),
      ],
      2026,
      false,
    )
    expect(result.drafts).toEqual([
      expect.objectContaining({ windowId: 'w-charge', amount: 41.97 }),
      expect.objectContaining({ windowId: 'w-credit', amount: -27.63 }),
      expect.objectContaining({ windowId: 'w-payment', amount: -263.61 }),
    ])
  })

  it('flips every amount on a credit card statement, regardless of description -- no per-row semantic judgment', () => {
    const result = materializeAssignments(
      [accepted({ windowId: 'w-1', amountText: '$100.00' }), accepted({ windowId: 'w-2', amountText: '$100.00', descriptionText: 'same magnitude, still a charge' })],
      2026,
      true,
    )
    expect(result.drafts.map((d) => d.amount)).toEqual([-100, -100])
  })

  it('only materializes accepted assignments', () => {
    const result = materializeAssignments(
      [
        { windowId: 'w-header', pageNumber: 1, status: 'non-transaction', descriptionText: '' },
        { windowId: 'w-gap', pageNumber: 1, status: 'unresolved', descriptionText: '' },
      ],
      2026,
      false,
    )
    expect(result.drafts).toEqual([])
    expect(result.rejected).toEqual([])
  })

  it('rejects an accepted window with no description evidence instead of importing a blank transaction', () => {
    const result = materializeAssignments([accepted({ descriptionText: '' })], 2026, false)
    expect(result.drafts).toEqual([])
    expect(result.rejected).toEqual([{ windowId: 'w-1', pageNumber: 1, reason: 'missing description' }])
  })

  it('rejects an unparseable amount instead of guessing', () => {
    const result = materializeAssignments([accepted({ amountText: 'illegible' })], 2026, false)
    expect(result.rejected).toEqual([{ windowId: 'w-1', pageNumber: 1, reason: 'invalid amount "illegible"' }])
  })

  it('tolerates a trailing posting-date footnote marker in Jev-resolved evidence too', () => {
    const result = materializeAssignments([accepted({ dateText: '07/10/26*' })], 2026, false)
    expect(result.rejected).toEqual([])
    expect(result.drafts).toEqual([expect.objectContaining({ date: '2026-07-10' })])
  })
})
