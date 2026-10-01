import { useEffect, useState } from 'react'
import type { BankAccount } from '../lib/types'

export interface BankAccountSelection {
  bank: string
  account: string
  setBank: (bank: string) => void
  setAccount: (account: string) => void
}

/**
 * Bank/account filter, defaulting to "All banks" / "All accounts" (empty strings) rather than
 * forcing a pick -- dashboard and transactions both read that as "don't narrow this level".
 * Only resets a pick that no longer exists in `accounts` (e.g. it was removed in Settings).
 */
export function useBankAccountSelection(accounts: BankAccount[]): BankAccountSelection {
  const [bank, setBank] = useState('')
  const [account, setAccount] = useState('')

  useEffect(() => {
    if (!bank) return
    const entry = accounts.find((item) => item.bank === bank)
    if (!entry) {
      setBank('')
      setAccount('')
      return
    }
    if (account && !entry.accounts.includes(account)) {
      setAccount('')
    }
  }, [accounts, bank, account])

  return { bank, account, setBank, setAccount }
}
