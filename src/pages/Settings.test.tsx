import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Settings } from './Settings'
import type { StorageLayer } from '../lib/types'

function createStorage(writeSettings: StorageLayer['writeSettings'], overrides: Partial<StorageLayer> = {}): StorageLayer {
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
    readSettings: vi.fn().mockResolvedValue({ openRouterApiKey: 'sk-or-existing' }),
    writeSettings,
    readAccounts: vi.fn().mockResolvedValue([]),
    writeAccounts: vi.fn(),
    ...overrides,
  }
}

describe('Settings OpenRouter key', () => {
  it('keeps the settings context and confirms a successful save', async () => {
    const writeSettings = vi.fn().mockResolvedValue(undefined)
    render(<Settings storage={createStorage(writeSettings)} />)

    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)
      await Promise.resolve()
    })

    expect(writeSettings).toHaveBeenCalledWith({ openRouterApiKey: 'sk-or-existing' })
    expect(screen.getByRole('dialog')).toHaveTextContent('OpenRouter API key saved.')
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })

  it('shows a failure dialog when the local settings write fails', async () => {
    const writeSettings = vi.fn().mockRejectedValue(new Error('Disk is full'))
    render(<Settings storage={createStorage(writeSettings)} />)

    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)
      await Promise.resolve()
    })

    expect(await screen.findByRole('dialog')).toHaveTextContent('Disk is full')
  })
})

describe('Settings sections', () => {
  it('shows the API key section by default and switches to categories on demand', async () => {
    render(<Settings storage={createStorage(vi.fn())} />)

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByRole('heading', { name: 'OpenRouter key' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Categories' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Categories' }))

    expect(screen.getByRole('heading', { name: 'Categories' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'OpenRouter key' })).not.toBeInTheDocument()
  })
})

async function pickBank(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('combobox', { name: 'Bank' }))
    fireEvent.click(await screen.findByRole('option', { name }))
    await Promise.resolve()
  })
}

describe('Settings banks & accounts', () => {
  it('adds a bank, then adds an account under it', async () => {
    const writeAccounts = vi.fn().mockResolvedValue(undefined)
    const readAccounts = vi.fn().mockResolvedValue([])
    const first = render(<Settings storage={createStorage(vi.fn(), { readAccounts, writeAccounts })} />)

    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Banks & accounts' }))

    await pickBank('Chase')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add bank' }))
      await Promise.resolve()
    })
    expect(writeAccounts).toHaveBeenCalledWith([{ bank: 'Chase', accounts: [] }])
    first.unmount()

    readAccounts.mockResolvedValue([{ bank: 'Chase', accounts: [] }])
    render(<Settings storage={createStorage(vi.fn(), { readAccounts, writeAccounts })} />)
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Banks & accounts' }))

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Add an account, e.g. Checking'), { target: { value: 'Checking' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add account' }))
      await Promise.resolve()
    })
    expect(writeAccounts).toHaveBeenCalledWith([{ bank: 'Chase', accounts: [{ name: 'Checking', type: 'checking' }] }])
  })

  it('tags the account with the type picked before adding it', async () => {
    const writeAccounts = vi.fn().mockResolvedValue(undefined)
    const readAccounts = vi.fn().mockResolvedValue([{ bank: 'Chase', accounts: [] }])
    render(<Settings storage={createStorage(vi.fn(), { readAccounts, writeAccounts })} />)
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Banks & accounts' }))

    fireEvent.change(screen.getByPlaceholderText('Add an account, e.g. Checking'), { target: { value: 'Freedom Unlimited' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Credit card' }))
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add account' }))
      await Promise.resolve()
    })
    expect(writeAccounts).toHaveBeenCalledWith([{ bank: 'Chase', accounts: [{ name: 'Freedom Unlimited', type: 'credit' }] }])
  })

  it('rejects a duplicate bank name', async () => {
    const readAccounts = vi.fn().mockResolvedValue([{ bank: 'Chase', accounts: [] }])
    const writeAccounts = vi.fn().mockResolvedValue(undefined)
    render(<Settings storage={createStorage(vi.fn(), { readAccounts, writeAccounts })} />)

    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Banks & accounts' }))

    await pickBank('Chase')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add bank' }))
      await Promise.resolve()
    })

    expect(screen.getByRole('alert')).toHaveTextContent('That bank has already been added.')
    expect(writeAccounts).not.toHaveBeenCalled()
  })

  it('adds a custom bank via the Other option', async () => {
    const writeAccounts = vi.fn().mockResolvedValue(undefined)
    const readAccounts = vi.fn().mockResolvedValue([])
    render(<Settings storage={createStorage(vi.fn(), { readAccounts, writeAccounts })} />)

    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Banks & accounts' }))

    await pickBank('Other')
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Bank name'), { target: { value: 'My Local Credit Union' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add bank' }))
      await Promise.resolve()
    })

    expect(writeAccounts).toHaveBeenCalledWith([{ bank: 'My Local Credit Union', accounts: [] }])
  })
})
