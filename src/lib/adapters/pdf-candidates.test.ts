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
})
