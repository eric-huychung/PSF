import { describe, expect, it } from 'vitest'
import type { Rule } from '../types'
import { addRule, compactRules, lookupCategory } from './rulesCache'

const rules: Rule[] = [
  { descriptionPattern: 'WHOLE FOODS MARKET', categoryId: 'groceries' },
  { descriptionPattern: 'AMAZON MKTPLACE PMTS*2K4LM1 AMZN.COM/BILL WA', categoryId: 'shopping' },
  { descriptionPattern: 'NETFLIX.COM', categoryId: 'subscriptions' },
]

describe('rules cache', () => {
  it('returns the category for an exact description match', () => {
    expect(lookupCategory('WHOLE FOODS MARKET', rules)).toBe('groceries')
  })

  it('ignores case and extra whitespace', () => {
    expect(lookupCategory('  whole   foods market ', rules)).toBe('groceries')
  })

  it('matches despite a different trailing transaction id', () => {
    expect(lookupCategory('AMAZON MKTPLACE PMTS*9X8YZ2 AMZN.COM/BILL WA', rules)).toBe('shopping')
  })

  it('matches despite a store number and date suffix', () => {
    const withStore: Rule[] = [{ descriptionPattern: 'STARBUCKS STORE 01234 11/02', categoryId: 'coffee' }]
    expect(lookupCategory('STARBUCKS STORE 98765 11/19', withStore)).toBe('coffee')
  })

  it('returns undefined for an unknown merchant', () => {
    expect(lookupCategory('SHELL OIL 57442', rules)).toBeUndefined()
  })

  it('does not fuzzy-match on digits alone', () => {
    const numeric: Rule[] = [{ descriptionPattern: '000123', categoryId: 'transfer' }]
    expect(lookupCategory('999999', numeric)).toBeUndefined()
  })

  it('prefers an exact match over a fuzzy one', () => {
    const both: Rule[] = [
      { descriptionPattern: 'UBER 1111', categoryId: 'transport' },
      { descriptionPattern: 'UBER 2222', categoryId: 'dining' },
    ]
    expect(lookupCategory('UBER 2222', both)).toBe('dining')
  })

  it('adds a new correction so it is found next time', () => {
    const updated = addRule(rules, 'SHELL OIL 57442', 'fuel')

    expect(lookupCategory('SHELL OIL 57442', updated)).toBe('fuel')
    expect(updated).toHaveLength(rules.length + 1)
  })

  it('replaces an existing rule when the same description is corrected again', () => {
    const updated = addRule(rules, 'whole foods market', 'dining')

    expect(lookupCategory('WHOLE FOODS MARKET', updated)).toBe('dining')
    expect(updated).toHaveLength(rules.length)
  })

  it('lets the latest correction win for future variants of the same merchant', () => {
    const updated = addRule(rules, 'AMAZON MKTPLACE PMTS*7QQ111 AMZN.COM/BILL WA', 'household')

    expect(lookupCategory('AMAZON MKTPLACE PMTS*0ZZ999 AMZN.COM/BILL WA', updated)).toBe('household')
  })

  it('does not mutate the input rules', () => {
    const before = structuredClone(rules)
    addRule(rules, 'SHELL OIL 57442', 'fuel')
    expect(rules).toEqual(before)
  })
})

describe('compactRules', () => {
  it('keeps only the newest rule per merchant key', () => {
    const bloated: Rule[] = [
      { descriptionPattern: 'AMAZON MKTPLACE PMTS*1111 AMZN.COM/BILL WA', categoryId: 'shopping' },
      { descriptionPattern: 'AMAZON MKTPLACE PMTS*2222 AMZN.COM/BILL WA', categoryId: 'household' },
    ]
    const compacted = compactRules(bloated)
    expect(compacted).toHaveLength(1)
    expect(compacted[0].categoryId).toBe('household')
  })

  it('leaves distinct merchants untouched', () => {
    expect(compactRules(rules)).toHaveLength(rules.length)
  })

  it('does not mutate the input', () => {
    const before = structuredClone(rules)
    compactRules(rules)
    expect(rules).toEqual(before)
  })
})
