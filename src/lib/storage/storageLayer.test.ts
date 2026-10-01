import { beforeEach, describe, expect, it } from 'vitest'
import type { AppSettings, BankAccount, Category, CategoryBudget, Rule, StoredTransaction } from '../types'
import { StorageError } from './fsAccess'
import { createStorageLayer } from './storageLayer'
import { FakeDirectoryHandle } from './testing/fakeFileSystem'

let folder: FakeDirectoryHandle

beforeEach(() => {
  folder = new FakeDirectoryHandle('finances')
})

describe('categories', () => {
  it('reads an empty list on first run, when categories.json does not exist yet', async () => {
    const storage = createStorageLayer(folder.asHandle())

    await expect(storage.readCategories()).resolves.toEqual([])
  })

  it('reads back exactly the categories that were written', async () => {
    const storage = createStorageLayer(folder.asHandle())
    const categories: Category[] = [
      { id: 'groceries', name: 'Groceries' },
      { id: 'rent', name: 'Rent' },
    ]

    await storage.writeCategories(categories)

    await expect(storage.readCategories()).resolves.toEqual(categories)
  })

  it('reports the categories file as missing on first run', async () => {
    const storage = createStorageLayer(folder.asHandle())

    await expect(storage.categoriesFileExists()).resolves.toBe(false)
  })

  it('reports the categories file as present once it has been written, even as an empty list', async () => {
    const storage = createStorageLayer(folder.asHandle())

    await storage.writeCategories([])

    await expect(storage.categoriesFileExists()).resolves.toBe(true)
  })
})

describe('rules', () => {
  it('reads an empty list on first run', async () => {
    await expect(createStorageLayer(folder.asHandle()).readRules()).resolves.toEqual([])
  })

  it('reads back exactly the rules that were written', async () => {
    const storage = createStorageLayer(folder.asHandle())
    const rules: Rule[] = [{ descriptionPattern: 'TRADER JOE', categoryId: 'groceries' }]

    await storage.writeRules(rules)

    await expect(storage.readRules()).resolves.toEqual(rules)
  })
})

describe('budgets', () => {
  it('reads an empty list on first run', async () => {
    await expect(createStorageLayer(folder.asHandle()).readBudgets()).resolves.toEqual([])
  })

  it('reads back exactly the budgets that were written', async () => {
    const storage = createStorageLayer(folder.asHandle())
    const budgets: CategoryBudget[] = [{ categoryId: 'groceries', monthlyTarget: 400 }]

    await storage.writeBudgets(budgets)

    await expect(storage.readBudgets()).resolves.toEqual(budgets)
  })
})

describe('settings', () => {
  it('reads null on first run, before the user has entered any settings', async () => {
    await expect(createStorageLayer(folder.asHandle()).readSettings()).resolves.toBeNull()
  })

  it('reads back exactly the settings that were written', async () => {
    const storage = createStorageLayer(folder.asHandle())
    const settings: AppSettings = { openRouterApiKey: 'sk-or-test' }

    await storage.writeSettings(settings)

    await expect(storage.readSettings()).resolves.toEqual(settings)
  })
})

describe('accounts', () => {
  it('reads an empty list on first run, when accounts.json does not exist yet', async () => {
    await expect(createStorageLayer(folder.asHandle()).readAccounts()).resolves.toEqual([])
  })

  it('reads back exactly the banks and accounts that were written', async () => {
    const storage = createStorageLayer(folder.asHandle())
    const accounts: BankAccount[] = [
      { bank: 'chase', accounts: ['checking', 'savings'] },
      { bank: 'amex', accounts: ['checking'] },
    ]

    await storage.writeAccounts(accounts)

    await expect(storage.readAccounts()).resolves.toEqual(accounts)
  })
})

describe('months', () => {
  const november: StoredTransaction[] = [
    { date: '2025-11-03', amount: -42.17, description: 'TRADER JOE #123', bank: 'chase', account: 'checking', categoryId: 'groceries' },
    { date: '2025-11-15', amount: 2500, description: 'PAYROLL', bank: 'chase', account: 'checking', categoryId: 'income' },
  ]

  it('reads an empty list for a month that has never been stored', async () => {
    await expect(createStorageLayer(folder.asHandle()).readMonth('chase', 'checking', 2025, 11)).resolves.toEqual([])
  })

  it('reads back exactly the transactions that were written for that month', async () => {
    const storage = createStorageLayer(folder.asHandle())

    await storage.writeMonth('chase', 'checking', 2025, 11, november)

    await expect(storage.readMonth('chase', 'checking', 2025, 11)).resolves.toEqual(november)
  })

  it('keeps each bank, account, and month separate', async () => {
    const storage = createStorageLayer(folder.asHandle())

    await storage.writeMonth('chase', 'checking', 2025, 11, november)

    await expect(storage.readMonth('chase', 'checking', 2025, 12)).resolves.toEqual([])
    await expect(storage.readMonth('chase', 'savings', 2025, 11)).resolves.toEqual([])
    await expect(storage.readMonth('amex', 'checking', 2025, 11)).resolves.toEqual([])
  })

  it('writes one JSON file per bank-account-month under transactions/, per the PRD layout', async () => {
    await createStorageLayer(folder.asHandle()).writeMonth('chase', 'checking', 2025, 1, november)

    const written = folder.directories.get('transactions')?.files.get('chase-checking-2025-01.json')
    expect(JSON.parse(written ?? 'null')).toEqual(november)
  })
})

describe('corrupt files', () => {
  it('throws a corrupt-file StorageError naming the file when it is not valid JSON, and leaves it untouched', async () => {
    folder.files.set('categories.json', '[{"id": "groceries",')

    const error = await createStorageLayer(folder.asHandle()).readCategories().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(StorageError)
    expect(error).toMatchObject({ code: 'corrupt-file' })
    expect((error as Error).message).toContain('categories.json')
    expect(folder.files.get('categories.json')).toBe('[{"id": "groceries",')
  })

  it('throws a corrupt-file StorageError when a list file does not hold a list', async () => {
    folder.files.set('rules.json', '{"descriptionPattern": "TRADER JOE"}')

    await expect(createStorageLayer(folder.asHandle()).readRules()).rejects.toMatchObject({ code: 'corrupt-file' })
  })

  it('throws a corrupt-file StorageError naming the month file when it is not valid JSON', async () => {
    const transactions = await folder.getDirectoryHandle('transactions', { create: true })
    transactions.files.set('chase-checking-2025-11.json', 'garbage')

    await expect(createStorageLayer(folder.asHandle()).readMonth('chase', 'checking', 2025, 11)).rejects.toMatchObject({
      code: 'corrupt-file',
      message: expect.stringContaining('transactions/chase-checking-2025-11.json'),
    })
  })
})

describe('revoked folder access', () => {
  it('throws a permission-denied StorageError on read and write instead of a raw browser error', async () => {
    const storage = createStorageLayer(folder.asHandle())
    folder.revoked = true

    await expect(storage.readCategories()).rejects.toMatchObject({ name: 'StorageError', code: 'permission-denied' })
    await expect(storage.writeMonth('chase', 'checking', 2025, 11, [])).rejects.toMatchObject({
      name: 'StorageError',
      code: 'permission-denied',
    })
  })
})
