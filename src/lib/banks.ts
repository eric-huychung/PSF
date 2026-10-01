export interface BankOption {
  id: string
  name: string
  shortName: string
  logoColor: string
  initials: string
  /** Other common shorthand this bank gets typed as (e.g. an account added before its canonical name was picked). Matched case-insensitively. */
  aliases?: string[]
}

/** Major US consumer banks, used to show a logo/initials chip next to accounts configured in Settings. */
export const bankOptions: BankOption[] = [
  { id: 'chase', name: 'Chase', shortName: 'Chase', logoColor: '117ACA', initials: 'C' },
  { id: 'boa', name: 'Bank of America', shortName: 'Bank of America', logoColor: '012169', initials: 'B', aliases: ['BoA', 'BofA'] },
  { id: 'amex', name: 'American Express', shortName: 'American Express', logoColor: '2E77BC', initials: 'A' },
  { id: 'robinhood', name: 'Robinhood', shortName: 'Robinhood', logoColor: '00C805', initials: 'R' },
  { id: 'wells-fargo', name: 'Wells Fargo', shortName: 'Wells Fargo', logoColor: 'D71E28', initials: 'W' },
  { id: 'citi', name: 'Citi', shortName: 'Citi', logoColor: '255BE3', initials: 'C' },
  { id: 'us-bank', name: 'U.S. Bank', shortName: 'U.S. Bank', logoColor: '001E79', initials: 'US' },
  { id: 'capital-one', name: 'Capital One', shortName: 'Capital One', logoColor: 'CC2427', initials: '1' },
  { id: 'goldman-sachs', name: 'Goldman Sachs', shortName: 'Goldman Sachs', logoColor: '7399C6', initials: 'GS' },
  { id: 'pnc', name: 'PNC', shortName: 'PNC', logoColor: 'F58025', initials: 'PNC' },
  { id: 'truist', name: 'Truist', shortName: 'Truist', logoColor: '2D1A47', initials: 'T' },
  { id: 'td-bank', name: 'TD Bank', shortName: 'TD Bank', logoColor: '54B948', initials: 'TD' },
  { id: 'discover', name: 'Discover', shortName: 'Discover', logoColor: 'FF6000', initials: 'D' },
]

/** Matches a freeform bank name (as typed in Settings) to a known logo, case-insensitively. */
export function findBankOption(bankName: string): BankOption | undefined {
  const normalized = bankName.trim().toLowerCase()
  return bankOptions.find(
    (option) =>
      option.name.toLowerCase() === normalized ||
      option.shortName.toLowerCase() === normalized ||
      option.aliases?.some((alias) => alias.toLowerCase() === normalized),
  )
}
