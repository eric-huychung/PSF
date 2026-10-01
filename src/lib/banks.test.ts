import { describe, expect, it } from 'vitest'
import { findBankOption } from './banks'

describe('findBankOption', () => {
  it('matches by canonical name, case-insensitively', () => {
    expect(findBankOption('bank of america')?.id).toBe('boa')
  })

  it('matches a known shorthand alias', () => {
    expect(findBankOption('BoA')?.id).toBe('boa')
    expect(findBankOption('bofa')?.id).toBe('boa')
  })

  it('returns undefined for an unrecognized name', () => {
    expect(findBankOption('My Local Credit Union')).toBeUndefined()
  })
})
