import { describe, expect, it } from 'vitest'
import { normalizeAccounts } from './normalizeAccounts'

describe('normalizeAccounts', () => {
  it('upgrades legacy plain-string accounts, guessing a type from the name', () => {
    expect(normalizeAccounts([
      { bank: 'BoA', accounts: ['Checking', 'Saving'] },
      { bank: 'Wells Fargo', accounts: ['Credit Card'] },
    ])).toEqual([
      { bank: 'BoA', accounts: [{ name: 'Checking', type: 'checking' }, { name: 'Saving', type: 'savings' }] },
      { bank: 'Wells Fargo', accounts: [{ name: 'Credit Card', type: 'credit' }] },
    ])
  })

  it('passes already-typed accounts through untouched', () => {
    const accounts = [{ bank: 'Chase', accounts: [{ name: 'Checking', type: 'checking' as const }] }]
    expect(normalizeAccounts(accounts)).toEqual(accounts)
  })

  it('returns an empty list for anything that is not an array', () => {
    expect(normalizeAccounts(null)).toEqual([])
    expect(normalizeAccounts(undefined)).toEqual([])
    expect(normalizeAccounts('not an array')).toEqual([])
  })
})
