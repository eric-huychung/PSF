import { useEffect, useMemo, useState } from 'react'
import { BarChart3, List, Settings as SettingsIcon, Upload as UploadIcon } from 'lucide-react'
import { Dashboard } from './pages/Dashboard'
import { Landing } from './pages/Landing'
import { Settings, type SettingsSection } from './pages/Settings'
import { Setup } from './pages/Setup'
import { Transactions } from './pages/Transactions'
import { UnsupportedBrowser } from './pages/UnsupportedBrowser'
import { Upload } from './pages/Upload'
import { ErrorState, SidebarNav } from './components/ui'
import { DEFAULT_CATEGORIES } from './lib/storage/defaultCategories'
import { createStorageLayer } from './lib/storage/storageLayer'
import { readStoredHandle, storeHandle } from './lib/storage/handleStore'
import { useFileSystemSupport } from './lib/storage/useFileSystemSupport'
import type { BankAccount, Category, StorageLayer } from './lib/types'

type Screen = 'dashboard' | 'upload' | 'transactions' | 'settings'

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: <BarChart3 aria-hidden="true" /> },
  { id: 'upload', label: 'Upload', icon: <UploadIcon aria-hidden="true" /> },
  { id: 'transactions', label: 'Transactions', icon: <List aria-hidden="true" /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon aria-hidden="true" /> },
] as const

function App() {
  const supported = useFileSystemSupport()
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [permissionReady, setPermissionReady] = useState(false)
  const [restoring, setRestoring] = useState(true)
  const [appError, setAppError] = useState<string | null>(null)
  const [screen, setScreen] = useState<Screen>('dashboard')
  const [settingsSection, setSettingsSection] = useState<SettingsSection>()
  const [landingDismissed, setLandingDismissed] = useState(() => localStorage.getItem('psf-landing-seen') === 'true')
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts] = useState<BankAccount[]>([])

  useEffect(() => {
    if (!supported) return
    void readStoredHandle()
      .then((storedHandle) => setHandle(storedHandle))
      .catch((error: unknown) => setAppError(error instanceof Error ? error.message : 'Could not restore the data folder.'))
      .finally(() => setRestoring(false))
  }, [supported])

  const storage = useMemo<StorageLayer | null>(
    () =>
      handle && permissionReady
        ? createStorageLayer(handle, (error) => {
            if (error.code === 'permission-denied') setAppError(error.message)
          })
        : null,
    [handle, permissionReady],
  )

  useEffect(() => {
    if (!storage) return
    void storage
      .categoriesFileExists()
      .then((exists) => (exists ? storage.readCategories() : storage.writeCategories(DEFAULT_CATEGORIES).then(() => DEFAULT_CATEGORIES)))
      .then(setCategories)
      .catch((error: unknown) => {
        setAppError(error instanceof Error ? error.message : 'Could not load categories from the data folder.')
      })
    void storage
      .readAccounts()
      .then(setAccounts)
      .catch((error: unknown) => {
        setAppError(error instanceof Error ? error.message : 'Could not load banks and accounts from the data folder.')
      })
  }, [storage])

  if (!supported) return <UnsupportedBrowser />
  if (appError) {
    return <ErrorState title="Your local data needs attention" message={appError} actionLabel="Choose another folder" onAction={() => {
      setAppError(null)
      setHandle(null)
      setPermissionReady(false)
      setRestoring(false)
    }} />
  }
  if (restoring) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Opening PSF...</main>
  }
  if (handle && permissionReady && !storage) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Preparing your data folder...</main>
  }
  if (!handle && !landingDismissed) {
    return (
      <Landing
        onGetStarted={() => {
          localStorage.setItem('psf-landing-seen', 'true')
          setLandingDismissed(true)
        }}
      />
    )
  }
  if (!handle || !storage) {
    return <Setup existingHandle={handle} onReady={(nextHandle) => {
      void storeHandle(nextHandle).catch((error: unknown) => setAppError(error instanceof Error ? error.message : 'Could not remember the data folder.'))
      setHandle(nextHandle)
      setPermissionReady(true)
    }} />
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground md:flex-row">
      <SidebarNav
        className="h-auto w-full flex-row gap-3 overflow-x-auto border-b border-r-0 p-4 md:h-screen md:w-60 md:flex-col md:gap-8 md:border-b-0 md:border-r md:p-5"
        items={navItems}
        activeId={screen}
        onSelect={setScreen}
        header={
          <div className="hidden items-center text-lg font-semibold tracking-tight md:flex">
            PSF
          </div>
        }
      />
      <div className="min-w-0 flex-1">
        {screen === 'dashboard' && <Dashboard storage={storage} accounts={accounts} categories={categories} />}
        {screen === 'upload' && <Upload storage={storage} categories={categories} accounts={accounts} />}
        {screen === 'transactions' && (
          <Transactions
            storage={storage}
            accounts={accounts}
            categories={categories}
            onAddBank={() => {
              setSettingsSection('accounts')
              setScreen('settings')
            }}
          />
        )}
        {screen === 'settings' && (
          <Settings storage={storage} categories={categories} onCategoriesChanged={setCategories} onAccountsChanged={setAccounts} initialSection={settingsSection} />
        )}
      </div>
    </div>
  )
}

export default App
