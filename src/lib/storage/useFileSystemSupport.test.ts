import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useFileSystemSupport } from './useFileSystemSupport'

const win = window as unknown as Record<string, unknown>

afterEach(() => {
  delete win.showDirectoryPicker
})

describe('useFileSystemSupport', () => {
  it('returns false on the very first render in a browser without the File System Access API', () => {
    const renders: boolean[] = []

    renderHook(() => {
      const supported = useFileSystemSupport()
      renders.push(supported)
      return supported
    })

    expect(renders[0]).toBe(false)
    expect(renders.every((supported) => supported === false)).toBe(true)
  })

  it('returns true on the first render in a supporting browser', () => {
    win.showDirectoryPicker = () => Promise.resolve()
    const renders: boolean[] = []

    renderHook(() => {
      const supported = useFileSystemSupport()
      renders.push(supported)
      return supported
    })

    expect(renders[0]).toBe(true)
  })
})
