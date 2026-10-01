import { useState } from 'react'
import { isSupported } from './fsAccess'

/**
 * Whether this browser can run the app at all. Computed synchronously on the first render
 * (no effect), so the unsupported-browser screen shows without a flash of app content.
 */
export function useFileSystemSupport(): boolean {
  const [supported] = useState(isSupported)
  return supported
}
