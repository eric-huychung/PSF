import { describe, expect, it, vi } from 'vitest'
import type { BankAccount, StorageLayer } from '../lib/types'
import { loadTransactions, matchingAccounts } from './transactionSource'

const accounts: BankAccount[] = [
  { bank: 'chase', accounts: [{ name: 'checking', type: 'checking' }, { name: 'savings', type: 'savings' }] },
  { bank: 'amex', accounts: [{ name: 'checking', type: 'checking' }] },
]

describe('matchingAccounts', () => {
  it('returns every bank/account pair when nothing is picked', () => {
    expect(matchingAccounts(accounts, '', '')).toEqual([
      { bank: 'chase', account: 'checking' },
      { bank: 'chase', account: 'savings' },
      { bank: 'amex', account: 'checking' },
    ])
  })

  it('narrows to one bank when only the bank is picked', () => {
    expect(matchingAccounts(accounts, 'chase', '')).toEqual([
      { bank: 'chase', account: 'checking' },
      { bank: 'chase', account: 'savings' },
    ])
  })

  it('narrows to one bank/account pair when both are picked', () => {
    expect(matchingAccounts(accounts, 'chase', 'savings')).toEqual([{ bank: 'chase', account: 'savings' }])
  })
})

describe('loadTransactions', () => {
  it('reads every target/month combination and flattens the results', async () => {
    const readMonth: StorageLayer['readMonth'] = vi.fn().mockResolvedValue([])
    const targets = [{ bank: 'chase', account: 'checking' }, { bank: 'amex', account: 'checking' }]
    const months = [{ year: 2025, month: 11 }, { year: 2025, month: 12 }]

    await loadTransactions({ readMonth } as unknown as StorageLayer, targets, months)

    expect(readMonth).toHaveBeenCalledTimes(4)
  })
})
