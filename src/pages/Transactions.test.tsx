import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Transactions } from './Transactions'
import type { BankAccount, StorageLayer, StoredTransaction } from '../lib/types'

function createStorage(overrides: Partial<StorageLayer> = {}): StorageLayer {
  return {
    readMonth: vi.fn().mockResolvedValue([]),
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
    ...overrides,
  }
}

const accounts: BankAccount[] = [{ bank: 'chase', accounts: [{ name: 'checking', type: 'checking' }] }]

async function drillToStatements() {
  fireEvent.click(screen.getByRole('button', { name: /chase/ }))
  fireEvent.click(screen.getByRole('button', { name: /checking/ }))
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

describe('Transactions', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-15'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts on a bank card per configured bank, plus an add-bank card', () => {
    render(<Transactions storage={createStorage()} accounts={accounts} onAddBank={vi.fn()} />)
    expect(screen.getByRole('button', { name: /chase/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a bank' })).toBeInTheDocument()
  })

  it('routes to Settings when the add-bank card is clicked', () => {
    const onAddBank = vi.fn()
    render(<Transactions storage={createStorage()} accounts={accounts} onAddBank={onAddBank} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add a bank' }))
    expect(onAddBank).toHaveBeenCalledOnce()
  })

  it('shows account cards after picking a bank', () => {
    render(<Transactions storage={createStorage()} accounts={accounts} onAddBank={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /chase/ }))
    expect(screen.getByRole('button', { name: /checking/ })).toBeInTheDocument()
  })

  it('groups stored transactions into one statement card per month instead of one per transaction', async () => {
    const september: StoredTransaction[] = [
      { date: '2026-09-05', amount: -12.5, description: 'Coffee', bank: 'chase', account: 'checking', categoryId: '' },
      { date: '2026-09-20', amount: -40, description: 'Groceries', bank: 'chase', account: 'checking', categoryId: '' },
    ]
    const august: StoredTransaction[] = [
      { date: '2026-08-10', amount: 2000, description: 'Payroll', bank: 'chase', account: 'checking', categoryId: '' },
    ]
    const readMonth: StorageLayer['readMonth'] = vi.fn().mockImplementation((_bank, _account, year, month) => {
      if (year === 2026 && month === 9) return Promise.resolve(september)
      if (year === 2026 && month === 8) return Promise.resolve(august)
      return Promise.resolve([])
    })

    render(<Transactions storage={createStorage({ readMonth })} accounts={accounts} onAddBank={vi.fn()} />)
    await drillToStatements()

    expect(screen.queryByText('Coffee')).not.toBeInTheDocument()
    expect(screen.getByText('2 transactions')).toBeInTheDocument()
    expect(screen.getByText('1 transaction')).toBeInTheDocument()
  })

  it('opens a statement as a modal with a transaction list, expanding a row for its detail', async () => {
    const september: StoredTransaction[] = [
      { date: '2026-09-05', amount: -12.5, description: 'Coffee', bank: 'chase', account: 'checking', categoryId: '' },
    ]
    const readMonth: StorageLayer['readMonth'] = vi.fn().mockImplementation((_bank, _account, year, month) => {
      return Promise.resolve(year === 2026 && month === 9 ? september : [])
    })

    render(<Transactions storage={createStorage({ readMonth })} accounts={accounts} onAddBank={vi.fn()} />)
    await drillToStatements()

    fireEvent.click(screen.getByRole('button', { name: /1 transaction/ }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Coffee')

    fireEvent.click(screen.getByText('Coffee'))
    expect(dialog).toHaveTextContent('Uncategorized')
    expect(dialog).toHaveTextContent('chase · checking')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the category stored on the transaction itself, with no matching rule needed', async () => {
    const september: StoredTransaction[] = [
      { date: '2026-09-05', amount: -12.5, description: 'Coffee', bank: 'chase', account: 'checking', categoryId: 'dining' },
    ]
    const readMonth: StorageLayer['readMonth'] = vi.fn().mockImplementation((_bank, _account, year, month) => {
      return Promise.resolve(year === 2026 && month === 9 ? september : [])
    })
    render(<Transactions storage={createStorage({ readMonth })} accounts={accounts} categories={[{ id: 'dining', name: 'Dining' }]} onAddBank={vi.fn()} />)
    await drillToStatements()

    fireEvent.click(screen.getByRole('button', { name: /1 transaction/ }))
    fireEvent.click(screen.getByText('Coffee'))

    expect(screen.getByRole('dialog')).toHaveTextContent('Dining')
  })

  it('paginates statement cards by year once more than one year has activity', async () => {
    const september2026: StoredTransaction[] = [
      { date: '2026-09-05', amount: -12.5, description: 'Coffee', bank: 'chase', account: 'checking', categoryId: '' },
    ]
    const march2025: StoredTransaction[] = [
      { date: '2025-03-10', amount: -40, description: 'Groceries', bank: 'chase', account: 'checking', categoryId: '' },
    ]
    const readMonth: StorageLayer['readMonth'] = vi.fn().mockImplementation((_bank, _account, year, month) => {
      if (year === 2026 && month === 9) return Promise.resolve(september2026)
      if (year === 2025 && month === 3) return Promise.resolve(march2025)
      return Promise.resolve([])
    })

    render(<Transactions storage={createStorage({ readMonth })} accounts={accounts} onAddBank={vi.fn()} />)
    await drillToStatements()

    expect(screen.getByText('September 2026')).toBeInTheDocument()
    expect(screen.queryByText('March 2025')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '2025' }))

    expect(await screen.findByText('March 2025')).toBeInTheDocument()
    expect(screen.queryByText('September 2026')).not.toBeInTheDocument()
  })

  it('goes back from statements to accounts to banks', async () => {
    render(<Transactions storage={createStorage()} accounts={accounts} onAddBank={vi.fn()} />)
    await drillToStatements()

    fireEvent.click(screen.getByRole('button', { name: /Back to accounts/ }))
    expect(screen.getByRole('button', { name: /checking/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Back to banks/ }))
    expect(screen.getByRole('button', { name: 'Add a bank' })).toBeInTheDocument()
  })
})
