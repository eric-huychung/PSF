import { useState } from 'react'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

/**
 * The save/error/pending wrapper repeated across Settings: clear any previous status, run the
 * action, track pending for disabling controls, and report a failure through `onError`. Success
 * reporting (a banner notice, a modal, whatever) stays inside `action` itself since that varies
 * per call site -- this hook only owns what's identical across all of them.
 */
export function useAsyncAction(onError: (message: string) => void, clearStatus: () => void) {
  const [pending, setPending] = useState(false)

  async function run(action: () => Promise<void>): Promise<void> {
    clearStatus()
    setPending(true)
    try {
      await action()
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return { pending, run }
}
