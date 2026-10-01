const DATABASE_NAME = 'psf'
const STORE_NAME = 'handles'
const HANDLE_KEY = 'data-folder'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open local storage.'))
  })
}

/** Persists the user's directory handle so returning Chromium sessions can reconnect it. */
export async function readStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(HANDLE_KEY)
    request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null)
    request.onerror = () => reject(request.error ?? new Error('Could not restore the data folder.'))
  })
}

export async function storeHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(handle, HANDLE_KEY)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Could not remember the data folder.'))
  })
}
