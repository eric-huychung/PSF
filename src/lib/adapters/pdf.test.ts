import { describe, expect, it } from 'vitest'
import { groupTextItemsIntoLines } from './pdf'

describe('PDF text extraction', () => {
  it('reconstructs reading-order lines from positioned text items', () => {
    expect(groupTextItemsIntoLines([
      { str: '$41.97', transform: [1, 0, 0, 1, 300, 90] },
      { str: 'STEAMGAMES.COM', transform: [1, 0, 0, 1, 100, 90] },
      { str: '08/06', transform: [1, 0, 0, 1, 10, 90] },
      { str: 'Next page', transform: [1, 0, 0, 1, 10, 80] },
    ])).toEqual(['08/06 STEAMGAMES.COM $41.97', 'Next page'])
  })

  it('drops empty text items and collapses spacing', () => {
    expect(groupTextItemsIntoLines([
      { str: '  Account  ', transform: [1, 0, 0, 1, 10, 20] },
      { str: '', transform: [1, 0, 0, 1, 50, 20] },
      { str: 'Summary', transform: [1, 0, 0, 1, 60, 20] },
    ])).toEqual(['Account Summary'])
  })
})
