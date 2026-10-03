import { describe, expect, it } from 'vitest'
import { findPdfTransactionCandidates } from './pdf'

describe('PDF transaction candidates', () => {
  it('finds signed and trailing-minus amounts across statement layouts', () => {
    expect(findPdfTransactionCandidates([
      {
        pageNumber: 1,
        lines: [
          '08/06 08/06 123 STEAMGAMES.COM 41.97',
          '08/08 08/08 456 STEAMGAMES.COM CREDIT 27.63-',
          '09/08/26 PURCHASE REFUND LinkedIn 43.99',
          '09/04/26 PURCHASE LinkedIn -43.99',
        ],
        items: [],
      },
    ])).toEqual([
      { pageNumber: 1, dateText: '08/06', amountText: '41.97', rawText: '08/06 08/06 123 STEAMGAMES.COM 41.97' },
      { pageNumber: 1, dateText: '08/08', amountText: '27.63-', rawText: '08/08 08/08 456 STEAMGAMES.COM CREDIT 27.63-' },
      { pageNumber: 1, dateText: '09/08/26', amountText: '43.99', rawText: '09/08/26 PURCHASE REFUND LinkedIn 43.99' },
      { pageNumber: 1, dateText: '09/04/26', amountText: '-43.99', rawText: '09/04/26 PURCHASE LinkedIn -43.99' },
    ])
  })

  it('keeps a wrapped description with its transaction row', () => {
    expect(findPdfTransactionCandidates([{
      pageNumber: 3,
      lines: ['07/25/26 AMAZON MARKETPLACE $31.46', 'MERCHANDISE', 'Total New Charges $31.46'],
      items: [],
    }])).toEqual([{
      pageNumber: 3,
      dateText: '07/25/26',
      amountText: '$31.46',
      rawText: '07/25/26 AMAZON MARKETPLACE $31.46 MERCHANDISE',
    }])
  })

  it('recognizes a row prefixed with a card-ending-digits column before the date (Wells Fargo layout)', () => {
    expect(findPdfTransactionCandidates([{
      pageNumber: 3,
      lines: ['7942 06/06 06/08 2449398HE6HD8G3B1 SDOT PAYBYPHONE PARKING WA 8.00'],
      items: [],
    }])).toEqual([{
      pageNumber: 3,
      dateText: '06/06',
      amountText: '8.00',
      rawText: '7942 06/06 06/08 2449398HE6HD8G3B1 SDOT PAYBYPHONE PARKING WA 8.00',
    }])
  })

  it('does not treat a non-digit leading word as a card-number column', () => {
    expect(findPdfTransactionCandidates([{
      pageNumber: 4,
      lines: ['Purchases 05/13/2026 28.49% (v) $0.00 $0.00', 'p. 7/9'],
      items: [],
    }])).toEqual([])
  })

  it('tags rows with the statement section named by the nearest header above them (Wells Fargo layout)', () => {
    expect(findPdfTransactionCandidates([{
      pageNumber: 3,
      lines: [
        'Payments',
        '06/16 06/16 7414718HP0XSLPLM9 ONLINE PAYMENT THANK YOU 200.00',
        'TOTAL PAYMENTS FOR THIS PERIOD $200.00',
        'Purchases, Balance Transfers & Other Charges',
        '7942 06/06 06/08 2449398HE6HD8G3B1 SDOT PARKING 8.00',
      ],
      items: [],
    }])).toEqual([
      expect.objectContaining({ dateText: '06/16', section: 'credit' }),
      expect.objectContaining({ dateText: '06/06', section: 'charge' }),
    ])
  })

  it('does not mistake a disclosure sentence that starts with "Payments:" for a section header', () => {
    const result = findPdfTransactionCandidates([{
      pageNumber: 2,
      lines: [
        'Payments: Your payment must be sent to the payment address shown on your statement.',
        '06/06 06/08 2449398HE6HD8G3B1 SDOT PARKING 8.00',
      ],
      items: [],
    }])
    expect(result).toHaveLength(1)
    expect(result[0].dateText).toBe('06/06')
    expect(result[0].section).toBeUndefined()
  })
})
