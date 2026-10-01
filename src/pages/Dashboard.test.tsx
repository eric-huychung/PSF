import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Dashboard } from './Dashboard'
import type { BankAccount, StorageLayer } from '../lib/types'

function createStorage(readMonth: StorageLayer['readMonth']): StorageLayer {
  return {
    readMonth,
    writeMonth: vi.fn(),
    readCategories: vi.fn().mockResolvedValue([]),
    writeCategories: vi.fn(),
    categoriesFileExists: vi.fn().mockResolvedValue(true),
    readRules: vi.fn().mockResolvedValue([]),
    writeRules: vi.fn(),
    readBudgets: vi.fn().mockResolvedValue([]),
    writeBudgets: vi.fn(),
    readSettings: vi.fn().mockResolvedValue(null),
    writeSettings: vi.fn(),
    readAccounts: vi.fn().mockResolvedValue([]),
    writeAccounts: vi.fn(),
  }
}

const accounts: BankAccount[] = [{ bank: 'chase', accounts: ['checking'] }]

describe('Dashboard', () => {
  it('loads the default month range once instead of reloading after each render', async () => {
    const readMonth = vi.fn().mockResolvedValue([])
    const storage = createStorage(readMonth)

    render(<Dashboard storage={storage} accounts={accounts} />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(readMonth).toHaveBeenCalledTimes(12)
  })
})
