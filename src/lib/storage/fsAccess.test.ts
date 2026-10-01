import { afterEach, describe, expect, it } from 'vitest'
import { StorageError, ensurePermission, isSupported, pickFolder, queryPermission } from './fsAccess'

const win = window as unknown as Record<string, unknown>

afterEach(() => {
  delete win.showDirectoryPicker
})

describe('isSupported', () => {
  it('returns false when showDirectoryPicker does not exist', () => {
    expect(isSupported()).toBe(false)
  })

  it('returns true when showDirectoryPicker exists', () => {
    win.showDirectoryPicker = () => Promise.resolve()
    expect(isSupported()).toBe(true)
  })
})

describe('pickFolder', () => {
  it('returns the directory handle the user picked, requesting read-write access', async () => {
    const handle = { kind: 'directory', name: 'finances' }
    let options: unknown
    win.showDirectoryPicker = (opts: unknown) => {
      options = opts
      return Promise.resolve(handle)
    }

    await expect(pickFolder()).resolves.toBe(handle)
    expect(options).toEqual({ mode: 'readwrite' })
  })

  it('throws an unsupported StorageError when the API does not exist', async () => {
    await expect(pickFolder()).rejects.toMatchObject({ name: 'StorageError', code: 'unsupported' })
  })

  it('throws a cancelled StorageError when the user dismisses the picker', async () => {
    win.showDirectoryPicker = () => Promise.reject(new DOMException('The user aborted a request.', 'AbortError'))

    const error = await pickFolder().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StorageError)
    expect(error).toMatchObject({ code: 'cancelled' })
  })

  it('throws a permission-denied StorageError when the browser refuses access', async () => {
    win.showDirectoryPicker = () => Promise.reject(new DOMException('Not allowed', 'NotAllowedError'))

    await expect(pickFolder()).rejects.toMatchObject({ code: 'permission-denied' })
  })
})

type PermissionState = 'granted' | 'denied' | 'prompt'

function handleWithPermission(queried: PermissionState, requested: PermissionState = queried) {
  const calls: string[] = []
  const handle = {
    kind: 'directory',
    name: 'finances',
    queryPermission: (opts: unknown) => {
      calls.push(`query ${JSON.stringify(opts)}`)
      return Promise.resolve(queried)
    },
    requestPermission: (opts: unknown) => {
      calls.push(`request ${JSON.stringify(opts)}`)
      return Promise.resolve(requested)
    },
  }
  return { handle: handle as unknown as FileSystemDirectoryHandle, calls }
}

describe('ensurePermission', () => {
  it('queries a restored handle without requesting permission', async () => {
    const { handle, calls } = handleWithPermission('prompt')

    await expect(queryPermission(handle)).resolves.toBe('prompt')
    expect(calls).toEqual(['query {"mode":"readwrite"}'])
  })

  it('resolves without prompting when read-write access is still granted', async () => {
    const { handle, calls } = handleWithPermission('granted')

    await expect(ensurePermission(handle)).resolves.toBeUndefined()
    expect(calls).toEqual(['query {"mode":"readwrite"}'])
  })

  it('asks the user again when access needs a prompt, and resolves if they allow it', async () => {
    const { handle, calls } = handleWithPermission('prompt', 'granted')

    await expect(ensurePermission(handle)).resolves.toBeUndefined()
    expect(calls).toEqual(['query {"mode":"readwrite"}', 'request {"mode":"readwrite"}'])
  })

  it('throws a permission-denied StorageError when the user refuses the prompt', async () => {
    const { handle } = handleWithPermission('prompt', 'denied')

    await expect(ensurePermission(handle)).rejects.toMatchObject({ name: 'StorageError', code: 'permission-denied' })
  })

  it('throws a permission-denied StorageError when access was revoked', async () => {
    const { handle } = handleWithPermission('denied')

    await expect(ensurePermission(handle)).rejects.toMatchObject({ code: 'permission-denied' })
  })
})

describe('storage error mapping', () => {
  it('maps a full disk response to a typed disk-full error', async () => {
    win.showDirectoryPicker = () => Promise.reject(new DOMException('No space left', 'QuotaExceededError'))

    await expect(pickFolder()).rejects.toMatchObject({ name: 'StorageError', code: 'disk-full' })
  })
})
