import { fireEvent, render, screen, waitForElementToBeRemoved, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BankAccount, Categorizer, StorageLayer, StoredTransaction } from '../lib/types'
import { Upload } from './Upload'

vi.mock('../lib/adapters/pdf', async () => {
  const actual = await vi.importActual<typeof import('../lib/adapters/pdf')>('../lib/adapters/pdf')
  return { ...actual, extractPdfText: vi.fn() }
})
const { extractPdfText } = await import('../lib/adapters/pdf')

const accounts: BankAccount[] = [
  { bank: 'chase', accounts: [{ name: 'checking', type: 'checking' }] },
  { bank: 'amex', accounts: [{ name: 'gold', type: 'credit' }, { name: 'platinum', type: 'credit' }] },
]

function makeStorage(overrides: Partial<StorageLayer> = {}): StorageLayer {
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
    readAccounts: vi.fn().mockResolvedValue(accounts),
    writeAccounts: vi.fn(),
    ...overrides,
  }
}

describe('Upload bank/account filter', () => {
  it('never offers "All banks" or "All accounts" -- a concrete pick is mandatory to upload into', async () => {
    render(<Upload storage={makeStorage()} accounts={accounts} />)

    fireEvent.click(screen.getByRole('combobox', { name: 'Bank' }))
    const bankListbox = await screen.findByRole('listbox')
    expect(within(bankListbox).queryByText('All banks')).not.toBeInTheDocument()
    expect(within(bankListbox).getByText('chase')).toBeInTheDocument()
    fireEvent.click(within(bankListbox).getByText('chase'))

    fireEvent.click(screen.getByRole('combobox', { name: 'Account' }))
    const accountListbox = await screen.findByRole('listbox')
    expect(within(accountListbox).queryByText('All accounts')).not.toBeInTheDocument()
    expect(within(accountListbox).getByText('checking')).toBeInTheDocument()
  })
})

function pdfFile(): File {
  return new File([new Uint8Array([1, 2, 3])], 'chase-jan.pdf', { type: 'application/pdf' })
}

beforeEach(() => {
  vi.mocked(extractPdfText).mockResolvedValue([
    { pageNumber: 1, lines: ['01/02/2026 Coffee shop -4.50'], items: [] },
  ])
})

describe('Upload file picker', () => {
  it('is disabled until a bank and account are chosen, and enables once both are picked', () => {
    const { container } = render(<Upload storage={makeStorage()} accounts={accounts} />)
    const input = () => container.querySelector('input[type="file"]') as HTMLInputElement

    expect(input().disabled).toBe(true)

    fireEvent.click(screen.getByRole('combobox', { name: 'Bank' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('chase'))
    expect(input().disabled).toBe(true) // bank only, no account yet

    fireEvent.click(screen.getByRole('combobox', { name: 'Account' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('checking'))
    expect(input().disabled).toBe(false)
  })
})

describe('Upload confirmation modal', () => {
  it('parses the file into a confirm step and only categorizes once the user confirms', async () => {
    const storage = makeStorage()
    const { container } = render(<Upload storage={storage} accounts={accounts} />)

    fireEvent.click(screen.getByRole('combobox', { name: 'Bank' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('chase'))
    fireEvent.click(screen.getByRole('combobox', { name: 'Account' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('checking'))

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [pdfFile()] } })

    const modal = await screen.findByRole('dialog', { name: 'Confirm statement import' })
    expect(within(modal).getByText('chase-jan.pdf')).toBeInTheDocument()
    expect(within(modal).getByText('checking')).toBeInTheDocument()
    expect(storage.readCategories).not.toHaveBeenCalled()

    fireEvent.click(within(modal).getByRole('button', { name: /confirm/i }))
    await screen.findByText('Add at least one category in Settings before importing.')
    expect(storage.readCategories).toHaveBeenCalledTimes(1)
  })

  it('warns when the account is tagged credit card but the statement text does not look like one', async () => {
    const { container } = render(<Upload storage={makeStorage()} accounts={accounts} />)

    fireEvent.click(screen.getByRole('combobox', { name: 'Bank' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('amex'))
    fireEvent.click(screen.getByRole('combobox', { name: 'Account' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('gold'))

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [pdfFile()] } })

    const modal = await screen.findByRole('dialog', { name: 'Confirm statement import' })
    expect(within(modal).getByText(/doesn't look like/)).toBeInTheDocument()
  })
})

describe('Upload confirmation modal -- existing statement warning', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-15'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('warns and switches to "Overwrite" wording when a statement already exists for the picked bank/account/month', async () => {
    const readMonth = vi.fn().mockImplementation((bank: string, account: string, year: number, month: number) =>
      Promise.resolve(bank === 'chase' && account === 'checking' && year === 2026 && month === 9
        ? [{ date: '2026-09-01', amount: 1, description: 'existing', bank, account, categoryId: '' }, { date: '2026-09-02', amount: 2, description: 'existing 2', bank, account, categoryId: '' }]
        : []),
    )
    const { container } = render(<Upload storage={makeStorage({ readMonth })} accounts={accounts} />)

    fireEvent.click(screen.getByRole('combobox', { name: 'Bank' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('chase'))
    fireEvent.click(screen.getByRole('combobox', { name: 'Account' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('checking'))

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [pdfFile()] } })

    const modal = await screen.findByRole('dialog', { name: /Confirm statement import/ })
    await within(modal).findByTitle('This will overwrite 2 existing transactions already saved for chase / checking, September 2026.')
    expect(within(modal).getByRole('button', { name: 'Overwrite & import' })).toBeInTheDocument()
  })

  it('shows no warning when nothing is saved yet for that bank/account/month', async () => {
    const { container } = render(<Upload storage={makeStorage()} accounts={accounts} />)

    fireEvent.click(screen.getByRole('combobox', { name: 'Bank' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('chase'))
    fireEvent.click(screen.getByRole('combobox', { name: 'Account' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('checking'))

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [pdfFile()] } })

    const modal = await screen.findByRole('dialog', { name: /Confirm statement import/ })
    expect(within(modal).queryByRole('button', { name: 'Overwrite & import' })).not.toBeInTheDocument()
    expect(within(modal).getByRole('button', { name: 'Confirm & import' })).toBeInTheDocument()
  })
})

describe('Upload -> review -> save', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-15'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('closes the review modal on save without a separate Close click, and the coverage list picks up the new statement', async () => {
    const saved = new Map<string, StoredTransaction[]>()
    const storage = makeStorage({
      readMonth: vi.fn().mockImplementation((bank: string, account: string, year: number, month: number) =>
        Promise.resolve(saved.get(`${bank}|${account}|${year}-${month}`) ?? [])),
      writeMonth: vi.fn().mockImplementation((bank: string, account: string, year: number, month: number, transactions: StoredTransaction[]) => {
        saved.set(`${bank}|${account}|${year}-${month}`, transactions)
        return Promise.resolve()
      }),
    })
    const categorizer: Categorizer = {
      categorizeBatch: (transactions) => Promise.resolve(transactions.map((transaction) => ({ transaction, categoryId: 'food', confidence: 'high' as const }))),
    }

    const { container } = render(
      <Upload
        storage={storage}
        accounts={accounts}
        categories={[{ id: 'food', name: 'Food' }]}
        categorizer={{ categorizer, provider: 'jev' }}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: 'Bank' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('chase'))
    fireEvent.click(screen.getByRole('combobox', { name: 'Account' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('checking'))

    expect(screen.queryByText('Sep 2026')).not.toBeInTheDocument()

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [pdfFile()] } })

    const importModal = await screen.findByRole('dialog', { name: 'Confirm statement import' })
    fireEvent.click(within(importModal).getByRole('button', { name: /confirm/i }))

    const reviewModal = await screen.findByRole('dialog', { name: 'Confirm transactions' })
    fireEvent.click(within(reviewModal).getByRole('button', { name: 'Confirm & save' }))

    await waitForElementToBeRemoved(() => screen.queryByRole('dialog', { name: 'Confirm transactions' }))
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()

    expect(await screen.findByText('Sep 2026')).toBeInTheDocument()

    const [written] = [...saved.values()]
    expect(written?.every((transaction) => transaction.categoryId === 'food')).toBe(true)
  })
})

describe('Upload statement coverage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-15'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lists every bank/account and marks which recent months already have a statement', async () => {
    const readMonth = vi.fn().mockImplementation((bank: string, account: string, year: number, month: number) =>
      Promise.resolve(bank === 'chase' && account === 'checking' && year === 2026 && month === 8 ? [{ date: '2026-08-01', amount: 1, description: 'x', bank, account, categoryId: '' }] : []),
    )
    render(<Upload storage={makeStorage({ readMonth })} accounts={accounts} />)

    await screen.findByText('Statement coverage')
    expect(await screen.findByText('Aug 2026')).toBeInTheDocument()
    expect(screen.getAllByText('No statements uploaded yet').length).toBeGreaterThan(0)
  })

  it('paginates statements by year once more than one year has uploads', async () => {
    const readMonth = vi.fn().mockImplementation((bank: string, account: string, year: number, month: number) =>
      Promise.resolve(
        bank === 'chase' && account === 'checking' && year === 2026 && month === 9 ? [{ date: '2026-09-01', amount: 1, description: 'x', bank, account, categoryId: '' }]
        : bank === 'chase' && account === 'checking' && year === 2025 && month === 3 ? [{ date: '2025-03-01', amount: 1, description: 'x', bank, account, categoryId: '' }]
        : [],
      ),
    )
    render(<Upload storage={makeStorage({ readMonth })} accounts={accounts} />)

    await screen.findByText('Statement coverage')
    expect(await screen.findByText('Sep 2026')).toBeInTheDocument()
    expect(screen.queryByText('Mar 2025')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '2025' }))

    expect(await screen.findByText('Mar 2025')).toBeInTheDocument()
    expect(screen.queryByText('Sep 2026')).not.toBeInTheDocument()
  })
})
