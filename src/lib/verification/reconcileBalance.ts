import type { StatementBalances } from '../adapters/pdf-normalize'
import type { PdfTransactionDraft } from '../adapters/pdf-normalize'

export interface BalanceReconciliation {
  /** previousBalance - newBalance, restated in our internal sign convention. */
  expectedChange: number
  /** Sum of the parsed drafts' amounts, already in our internal sign convention. */
  actualChange: number
  difference: number
  matches: boolean
}

const EPSILON = 0.005

/**
 * Checks the parsed transactions' sum against the statement's own Previous/New Balance -- pure
 * arithmetic against the issuer's own printed numbers, no guessing involved.
 *
 * Credit-card only. A charge raises the balance (money out, negative in our internal convention)
 * and a payment lowers it (money in, positive internally) -- the opposite of the balance's own
 * direction -- so the expected change is `previousBalance - newBalance`, not `newBalance -
 * previousBalance`. Checking/savings already shares our sign convention and would need the
 * un-flipped formula instead; deliberately not wired up yet.
 */
export function reconcileCreditCardBalance(drafts: PdfTransactionDraft[], balances: StatementBalances): BalanceReconciliation {
  const expectedChange = balances.previousBalance - balances.newBalance
  const actualChange = drafts.reduce((sum, draft) => sum + draft.amount, 0)
  const difference = actualChange - expectedChange
  return { expectedChange, actualChange, difference, matches: Math.abs(difference) < EPSILON }
}
