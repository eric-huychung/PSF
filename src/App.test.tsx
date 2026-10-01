import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StorageLayer } from './lib/types'

const storage: StorageLayer = {
  readMonth: vi.fn().mockResolvedValue([]),
  writeMonth: vi.fn(),
  readCategories: vi.fn().mockResolvedValue([]),
  writeCategories: vi.fn().mockResolvedValue(undefined),
  categoriesFileExists: vi.fn().mockResolvedValue(true),
  readRules: vi.fn().mockResolvedValue([]),
  writeRules: vi.fn(),
  readBudgets: vi.fn().mockResolvedValue([]),
  writeBudgets: vi.fn(),
  readSettings: vi.fn().mockResolvedValue({ openRouterApiKey: 'sk-or-existing' }),
  writeSettings: vi.fn().mockResolvedValue(undefined),
  readAccounts: vi.fn().mockResolvedValue([]),
  writeAccounts: vi.fn().mockResolvedValue(undefined),
}

vi.mock('./lib/storage/handleStore', () => ({
  readStoredHandle: vi.fn().mockResolvedValue({}),
  storeHandle: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./lib/storage/storageLayer', () => ({
  createStorageLayer: vi.fn(() => storage),
}))
vi.mock('./lib/storage/useFileSystemSupport', () => ({
  useFileSystemSupport: vi.fn(() => true),
}))
vi.mock('./pages/Dashboard', () => ({ Dashboard: () => <div>Dashboard screen</div> }))
vi.mock('./pages/Setup', () => ({ Setup: ({ onReady }: { onReady?: (handle: FileSystemDirectoryHandle) => void }) => (
  <button type="button" onClick={() => onReady?.({} as FileSystemDirectoryHandle)}>Choose data folder</button>
) }))
vi.mock('./pages/Transactions', () => ({ Transactions: () => <div>Transactions screen</div> }))
vi.mock('./pages/Upload', () => ({ Upload: () => <div>Upload screen</div> }))
vi.mock('./pages/UnsupportedBrowser', () => ({ UnsupportedBrowser: () => <div>Unsupported screen</div> }))

import { DEFAULT_CATEGORIES } from './lib/storage/defaultCategories'
import App from './App'

describe('App settings navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('localStorage', { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn() })
    storage.categoriesFileExists = vi.fn().mockResolvedValue(true)
  })

  it('seeds default categories when the data folder has no categories.json yet', async () => {
    storage.categoriesFileExists = vi.fn().mockResolvedValue(false)

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Choose data folder' }))
    await screen.findByText('Dashboard screen')

    await waitFor(() => expect(storage.writeCategories).toHaveBeenCalledWith(DEFAULT_CATEGORIES))
    expect(storage.readCategories).not.toHaveBeenCalled()
  })

  it('stays on Settings after saving the OpenRouter key', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Choose data folder' }))
    await screen.findByText('Dashboard screen')
    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()

    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)
      await Promise.resolve()
    })

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })

  it('does not touch a restored folder until Setup confirms permission', async () => {
    render(<App />)

    expect(await screen.findByRole('button', { name: 'Choose data folder' })).toBeInTheDocument()
    expect(storage.readCategories).not.toHaveBeenCalled()
  })
})
