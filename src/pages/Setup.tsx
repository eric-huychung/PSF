import { useEffect, useRef, useState } from 'react'
import { FolderOpen, LockKeyhole, ShieldCheck } from 'lucide-react'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui'
import { ensurePermission, pickFolder, queryPermission, StorageError } from '../lib/storage/fsAccess'

export interface SetupProps {
  /** A handle restored by the app shell, if this is a returning session. */
  existingHandle?: FileSystemDirectoryHandle | null
  /** Called once the folder is ready for the rest of the app to use. */
  onReady?: (handle: FileSystemDirectoryHandle) => void
}

type SetupState = 'checking' | 'ready' | 'first-run' | 'needs-permission' | 'error'

function errorMessage(error: unknown): string {
  if (error instanceof StorageError) return error.message
  if (error instanceof Error) return error.message
  return 'The data folder could not be opened. Try again.'
}

export function Setup({ existingHandle, onReady }: SetupProps) {
  const [state, setState] = useState<SetupState>(existingHandle ? 'checking' : 'first-run')
  const [message, setMessage] = useState<string | null>(null)
  const checkedHandle = useRef<FileSystemDirectoryHandle | null>(null)

  useEffect(() => {
    if (!existingHandle || checkedHandle.current === existingHandle) return
    checkedHandle.current = existingHandle

    void queryPermission(existingHandle)
      .then((permission) => {
        if (permission !== 'granted') {
          setState('needs-permission')
          setMessage('Click the button below to re-authorize this folder.')
          return
        }
        setState('ready')
        onReady?.(existingHandle)
      })
      .catch((error: unknown) => {
        setState(error instanceof StorageError && error.code === 'permission-denied' ? 'needs-permission' : 'error')
        setMessage(errorMessage(error))
      })
  }, [existingHandle, onReady])

  async function handlePickFolder() {
    setState('checking')
    setMessage(null)

    try {
      const handle = existingHandle ? existingHandle : await pickFolder()
      if (existingHandle) await ensurePermission(existingHandle)
      setState('ready')
      onReady?.(handle)
    } catch (error: unknown) {
      setState(error instanceof StorageError && error.code === 'permission-denied' ? 'needs-permission' : 'error')
      setMessage(errorMessage(error))
    }
  }

  const checking = state === 'checking'
  const returning = Boolean(existingHandle)

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <section className="w-full max-w-lg" aria-labelledby="setup-title">
        <div className="mb-8 text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">PSF</p>
          <h1 id="setup-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {returning ? 'Reconnect your data folder' : 'Choose your data folder'}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">
            Your finance data stays in a folder on this device. PSF never uploads it to a server.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{returning ? 'Check folder access' : 'Set up local storage'}</CardTitle>
              <CardDescription className="mt-1">
                {returning
                  ? 'Confirm that PSF can still read and write your existing data.'
                  : 'Select an existing folder or create a new one for your PSF data.'}
              </CardDescription>
            </div>
            <div className="rounded-full border border-card-border bg-secondary p-3 text-primary" aria-hidden="true">
              {returning ? <LockKeyhole className="size-5" /> : <FolderOpen className="size-5" />}
            </div>
          </CardHeader>

          <CardContent>
            <ul className="space-y-3 text-sm text-muted-foreground" aria-label="Storage details">
              <li className="flex gap-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>Read and write access is required to save transactions and settings.</span>
              </li>
              <li className="flex gap-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>You can change this folder later from Settings.</span>
              </li>
            </ul>

            {message && (
              <p className="rounded-lg border border-card-border bg-card p-3 text-sm text-destructive" role="alert">
                {message}
              </p>
            )}

            <Button className="w-full" size="lg" onClick={handlePickFolder} disabled={checking}>
              {checking ? 'Checking access...' : returning ? state === 'needs-permission' ? 'Re-authorize folder' : 'Choose a different folder' : 'Choose data folder'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              {state === 'needs-permission' ? 'Access was denied or revoked. Select the folder again to re-authorize it.' : 'Only this browser session can access the selected folder.'}
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}

export default Setup
