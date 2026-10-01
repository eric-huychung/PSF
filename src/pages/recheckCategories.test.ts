import { describe, expect, it, vi } from 'vitest'
import type { BankAccount, Rule, StorageLayer, StoredTransaction } from '../lib/types'
import { currentMonth } from './months'
import { recheckCategories } from './recheckCategories'

const accounts: BankAccount[] = [{ bank: 'chase', accounts: ['checking'] }]
const rules: Rule[] = [{ descriptionPattern: 'Trader Joes', categoryId: 'groceries' }]

function txn(description: string, categoryId: string): StoredTransaction {
  return { date: '2025-11-02', amount: -10, description, bank: 'chase', account: 'checking', categoryId }
}

function fakeStorage(monthTransactions: StoredTransaction[]): { storage: StorageLayer; writeMonth: ReturnType<typeof vi.fn> } {
  const writeMonth = vi.fn().mockResolvedValue(undefined)
  const storage = {
    readRules: vi.fn().mockResolvedValue(rules),
    readMonth: vi.fn().mockImplementation((_bank: string, _account: string, year: number, month: number) => {
      const { year: thisYear, month: thisMonth } = currentMonth()
      return Promise.resolve(year === thisYear && month === thisMonth ? monthTransactions : [])
    }),
    writeMonth,
  } as unknown as StorageLayer
  return { storage, writeMonth }
}

describe('recheckCategories', () => {
  it('recategorizes a transaction a rule now covers, and reports the count', async () => {
    const { storage, writeMonth } = fakeStorage([txn('Trader Joes #412', 'dining')])

    const changed = await recheckCategories(storage, accounts, 1)

    expect(changed).toBe(1)
    expect(writeMonth).toHaveBeenCalledTimes(1)
    const [, , , , written] = writeMonth.mock.calls[0]
    expect(written).toEqual([txn('Trader Joes #412', 'groceries')])
  })

  it('leaves a transaction alone, and never writes, when its category already matches the current rules', async () => {
    const { storage, writeMonth } = fakeStorage([txn('Trader Joes #412', 'groceries')])

    const changed = await recheckCategories(storage, accounts, 1)

    expect(changed).toBe(0)
    expect(writeMonth).not.toHaveBeenCalled()
  })

  it('leaves a transaction alone when no rule matches its description', async () => {
    const { storage, writeMonth } = fakeStorage([txn('Unmatched Merchant', 'dining')])

    const changed = await recheckCategories(storage, accounts, 1)

    expect(changed).toBe(0)
    expect(writeMonth).not.toHaveBeenCalled()
  })

  it('skips empty months without writing', async () => {
    const { storage, writeMonth } = fakeStorage([])

    const changed = await recheckCategories(storage, accounts, 3)

    expect(changed).toBe(0)
    expect(writeMonth).not.toHaveBeenCalled()
  })

  it('only writes the one month that actually changed, and counts just the changed rows in it', async () => {
    const monthTransactions = [txn('Trader Joes #412', 'dining'), txn('Unmatched Merchant', 'dining')]
    const { storage, writeMonth } = fakeStorage(monthTransactions)

    const changed = await recheckCategories(storage, accounts, 1)

    expect(changed).toBe(1)
    expect(writeMonth).toHaveBeenCalledTimes(1)
  })
})
