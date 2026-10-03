import type { ReactNode } from 'react'
import { Select as SelectPrimitive } from 'radix-ui'
import { Check, ChevronDown, Landmark } from 'lucide-react'
import type { BankAccount } from '../../lib/types'
import { BankLogo } from './bank-logo'

export interface BankAccountSelectProps {
  accounts: BankAccount[]
  bank: string
  account: string
  onBankChange: (bank: string) => void
  onAccountChange: (account: string) => void
  disabled?: boolean
  /** No "All banks"/"All accounts" option -- both pickers force a real choice. For flows (e.g. Upload) where "all" has no meaning. */
  required?: boolean
}

/** Empty string ("all") isn't a legal Radix Select item value, so it's swapped for this sentinel at the edge. */
const ALL = '__all__'

interface FilterSelectProps {
  'aria-label': string
  placeholder: string
  icon: ReactNode
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  options: ReadonlyArray<{ value: string; label: string }>
  /** No "All X" item, and no sentinel swap -- an empty value just shows the placeholder. Used where a concrete pick is mandatory (e.g. Upload). */
  required?: boolean
}

/** Minimal pill dropdown — trigger shows the current pick (or placeholder), no label chrome around it. Fixed width + truncation so it doesn't resize as the picked name/logo changes. */
function FilterSelect({ placeholder, icon, value, onChange, disabled, options, required, ...props }: FilterSelectProps) {
  return (
    <SelectPrimitive.Root
      value={required ? value : value || ALL}
      onValueChange={(next) => onChange(required ? next : next === ALL ? '' : next)}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        aria-label={props['aria-label']}
        className="flex h-9 w-44 items-center gap-1.5 rounded-pill border border-border bg-card px-3.5 text-sm font-medium outline-none data-[placeholder]:text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate text-left">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="z-50 max-h-64 min-w-[var(--radix-select-trigger-width)] overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-popover"
        >
          <SelectPrimitive.Viewport>
            {!required && (
              <SelectPrimitive.Item
                value={ALL}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent"
              >
                <SelectPrimitive.ItemText>{placeholder}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator><Check size={14} aria-hidden="true" /></SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            )}
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator><Check size={14} aria-hidden="true" /></SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

/** Cascading bank -> account filter, sourced from the list managed in Settings. Empty values mean "all", unless `required`. */
export function BankAccountSelect({ accounts, bank, account, onBankChange, onAccountChange, disabled, required }: BankAccountSelectProps) {
  const accountsForBank = accounts.find((entry) => entry.bank === bank)?.accounts ?? []

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterSelect
        aria-label="Bank"
        placeholder={required ? 'Choose a bank' : 'All banks'}
        icon={bank ? <BankLogo name={bank} className="size-4 text-[8px]" /> : <Landmark size={14} className="text-muted-foreground" aria-hidden="true" />}
        value={bank}
        onChange={onBankChange}
        disabled={disabled}
        required={required}
        options={accounts.map((entry) => ({ value: entry.bank, label: entry.bank }))}
      />
      <FilterSelect
        aria-label="Account"
        placeholder={required ? 'Choose an account' : 'All accounts'}
        icon={null}
        value={account}
        onChange={onAccountChange}
        disabled={disabled || !bank}
        required={required}
        options={accountsForBank.map((item) => ({ value: item.name, label: item.name }))}
      />
    </div>
  )
}
