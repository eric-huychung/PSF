export type StorageErrorCode = 'unsupported' | 'cancelled' | 'permission-denied' | 'corrupt-file' | 'disk-full'

/** Every storage failure the UI must handle explicitly. Never swallowed, never replaced by a fallback. */
export class StorageError extends Error {
  readonly code: StorageErrorCode

  constructor(code: StorageErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StorageError'
    this.code = code
  }
}

// Chromium-only APIs missing from TypeScript's DOM lib.
type ShowDirectoryPicker = (options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>
type PermissionHandle = {
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
}

/** True when the browser implements the File System Access API (Chromium only). No fallback exists. */
export function isSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
}

/** Asks the user to pick the data folder, with read-write access. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  if (!isSupported()) {
    throw new StorageError('unsupported', 'This browser does not support the File System Access API. Use Chrome or Edge.')
  }
  const showDirectoryPicker = (window as unknown as { showDirectoryPicker: ShowDirectoryPicker }).showDirectoryPicker
  try {
    return await showDirectoryPicker({ mode: 'readwrite' })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new StorageError('cancelled', 'Folder selection was cancelled.', { cause: error })
    }
    throw toStorageError(error)
  }
}

/**
 * Confirms a previously picked folder still has read-write access, prompting if the browser allows.
 * Call from a user gesture (e.g. a click) so Chrome can show the prompt.
 */
export async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<void> {
  const permissions = handle as unknown as PermissionHandle
  let state = await queryPermission(handle)
  if (state === 'prompt') {
    state = await permissions.requestPermission({ mode: 'readwrite' })
  }
  if (state !== 'granted') {
    throw new StorageError('permission-denied', 'Permission to the data folder was denied or revoked.')
  }
}

/** Checks a restored handle without opening a permission prompt outside a user gesture. */
export function queryPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  const permissions = handle as unknown as PermissionHandle
  return permissions.queryPermission({ mode: 'readwrite' })
}

/** Maps a browser permission failure onto a typed StorageError; anything else is returned unchanged. */
export function toStorageError(error: unknown): unknown {
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
    return new StorageError('permission-denied', 'Permission to the data folder was denied or revoked.', { cause: error })
  }
  if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
    return new StorageError('disk-full', 'The data folder could not accept this change. Free disk space and try again.', { cause: error })
  }
  return error
}
