import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAsyncAction } from './useAsyncAction'

describe('useAsyncAction', () => {
  it('clears status and tracks pending for the duration of a successful action', async () => {
    const onError = vi.fn()
    const clearStatus = vi.fn()
    const { result } = renderHook(() => useAsyncAction(onError, clearStatus))

    let resolveAction!: () => void
    await act(async () => {
      void result.current.run(() => new Promise<void>((resolve) => { resolveAction = resolve }))
    })

    expect(clearStatus).toHaveBeenCalledOnce()
    expect(result.current.pending).toBe(true)

    await act(async () => resolveAction())

    expect(result.current.pending).toBe(false)
    expect(onError).not.toHaveBeenCalled()
  })

  it('reports a thrown Error\'s message through onError and still clears pending', async () => {
    const onError = vi.fn()
    const { result } = renderHook(() => useAsyncAction(onError, vi.fn()))

    await act(async () => {
      await result.current.run(() => Promise.reject(new Error('disk is full')))
    })

    expect(onError).toHaveBeenCalledWith('disk is full')
    expect(result.current.pending).toBe(false)
  })

  it('falls back to a generic message when the thrown value is not an Error', async () => {
    const onError = vi.fn()
    const { result } = renderHook(() => useAsyncAction(onError, vi.fn()))

    await act(async () => {
      await result.current.run(() => Promise.reject('nope'))
    })

    expect(onError).toHaveBeenCalledWith('Something went wrong. Please try again.')
  })
})
