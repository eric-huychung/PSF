import { Select as SelectPrimitive } from 'radix-ui'
import { Check, ChevronDown, Landmark, Pencil } from 'lucide-react'
import { bankOptions } from '../../lib/banks'
import { BankLogo } from './bank-logo'

/** Sentinel for "not one of the known banks" -- lets the caller reveal a freeform name field. */
export const OTHER_BANK = '__other__'

export interface BankPickerProps {
  /** Canonical bank name, `OTHER_BANK`, or '' for unpicked. */
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

/** Dropdown of known banks (real logo + name) so a new entry always matches a logo, with an "Other" escape hatch for anything not listed. */
export function BankPicker({ value, onChange, disabled }: BankPickerProps) {
  return (
    <SelectPrimitive.Root value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        aria-label="Bank"
        className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none data-[placeholder]:text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        {value === OTHER_BANK ? <Pencil size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" /> : value ? <BankLogo name={value} /> : <Landmark size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate text-left">
          <SelectPrimitive.Value placeholder="Choose a bank" />
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-popover"
        >
          <SelectPrimitive.Viewport>
            {bankOptions.map((option) => (
              <SelectPrimitive.Item
                key={option.id}
                value={option.name}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent"
              >
                <BankLogo name={option.name} />
                <SelectPrimitive.ItemText>{option.name}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="ml-auto"><Check size={14} aria-hidden="true" /></SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
            <SelectPrimitive.Separator className="my-1 h-px bg-border" />
            <SelectPrimitive.Item
              value={OTHER_BANK}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent"
            >
              <Pencil size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
              <SelectPrimitive.ItemText>Other</SelectPrimitive.ItemText>
              <SelectPrimitive.ItemIndicator className="ml-auto"><Check size={14} aria-hidden="true" /></SelectPrimitive.ItemIndicator>
            </SelectPrimitive.Item>
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
