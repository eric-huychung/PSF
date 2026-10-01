import type { StorageLayer } from '../types'
import { StorageError, toStorageError } from './fsAccess'

const TRANSACTIONS_DIR = 'transactions'

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError'
}

function monthFileName(bank: string, account: string, year: number, month: number): string {
  return `${bank}-${account}-${year}-${String(month).padStart(2, '0')}.json`
}

/**
 * Reads and parses one JSON file. Missing file -> `fallback` (first run).
 * Unparseable content, or a non-list where a list is expected, -> corrupt-file error; the file is never overwritten here.
 */
async function readJson<T>(folder: FileSystemDirectoryHandle, fileName: string, fallback: T, path = fileName): Promise<T> {
  let file: File
  try {
    file = await (await folder.getFileHandle(fileName)).getFile()
  } catch (error) {
    if (isNotFound(error)) return fallback
    throw error
  }
  let data: unknown
  try {
    data = JSON.parse(await file.text())
  } catch (error) {
    throw new StorageError('corrupt-file', `${path} is not valid JSON. Fix or remove it to continue.`, { cause: error })
  }
  if (Array.isArray(fallback) && !Array.isArray(data)) {
    throw new StorageError('corrupt-file', `${path} should contain a list. Fix or remove it to continue.`)
  }
  return data as T
}

async function writeJson(folder: FileSystemDirectoryHandle, fileName: string, data: unknown): Promise<void> {
  try {
    const writable = await (await folder.getFileHandle(fileName, { create: true })).createWritable()
    await writable.write(JSON.stringify(data, null, 2))
    await writable.close()
  } catch (error) {
    throw toStorageError(error)
  }
}

/** Wraps a storage call so permission failures (e.g. access revoked mid-session) surface as typed StorageErrors. */
function withTypedErrors<A extends unknown[], R>(fn: (...args: A) => Promise<R>, onError?: (error: StorageError) => void): (...args: A) => Promise<R> {
  return async (...args) => {
    try {
      return await fn(...args)
    } catch (error) {
      const typedError = toStorageError(error)
      if (typedError instanceof StorageError) onError?.(typedError)
      throw typedError
    }
  }
}

/** StorageLayer backed by flat JSON files in the user's picked folder (layout: PRD §3.2). */
export function createStorageLayer(folder: FileSystemDirectoryHandle, onError?: (error: StorageError) => void): StorageLayer {
  return {
    readMonth: withTypedErrors(async (bank, account, year, month) => {
      let transactions: FileSystemDirectoryHandle
      try {
        transactions = await folder.getDirectoryHandle(TRANSACTIONS_DIR)
      } catch (error) {
        if (isNotFound(error)) return []
        throw error
      }
      const fileName = monthFileName(bank, account, year, month)
      return readJson(transactions, fileName, [], `${TRANSACTIONS_DIR}/${fileName}`)
    }, onError),
    writeMonth: withTypedErrors(async (bank, account, year, month, data) => {
      const transactions = await folder.getDirectoryHandle(TRANSACTIONS_DIR, { create: true })
      await writeJson(transactions, monthFileName(bank, account, year, month), data)
    }, onError),
    readCategories: withTypedErrors(() => readJson(folder, 'categories.json', []), onError),
    writeCategories: withTypedErrors((categories) => writeJson(folder, 'categories.json', categories), onError),
    categoriesFileExists: withTypedErrors(async () => {
      try {
        await folder.getFileHandle('categories.json')
        return true
      } catch (error) {
        if (isNotFound(error)) return false
        throw error
      }
    }, onError),
    readRules: withTypedErrors(() => readJson(folder, 'rules.json', []), onError),
    writeRules: withTypedErrors((rules) => writeJson(folder, 'rules.json', rules), onError),
    readBudgets: withTypedErrors(() => readJson(folder, 'budgets.json', []), onError),
    writeBudgets: withTypedErrors((budgets) => writeJson(folder, 'budgets.json', budgets), onError),
    readSettings: withTypedErrors(() => readJson(folder, 'settings.json', null), onError),
    writeSettings: withTypedErrors((settings) => writeJson(folder, 'settings.json', settings), onError),
    readAccounts: withTypedErrors(() => readJson(folder, 'accounts.json', []), onError),
    writeAccounts: withTypedErrors((accounts) => writeJson(folder, 'accounts.json', accounts), onError),
  }
}
