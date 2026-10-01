import { Select as SelectPrimitive } from 'radix-ui'
import { Check, ChevronDown } from 'lucide-react'

export interface MonthYearValue {
  year: number
  month: number
}

export interface MonthYearSelectProps {
  value: MonthYearValue
  onChange: (value: MonthYearValue) => void
  disabled?: boolean
  /** How many years back from the current year to offer. */
  yearsBack?: number
}

const MONTH_NAMES = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat(undefined, { month: 'long' }).format(new Date(2000, index, 1)),
)

const CURRENT_YEAR = new Date().getFullYear()

function SelectField({
  'aria-label': ariaLabel,
  value,
  onChange,
  disabled,
  options,
}: {
  'aria-label': string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  options: ReadonlyArray<{ value: string; label: string }>
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none data-[placeholder]:text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="min-w-0 flex-1 truncate text-left">
          <SelectPrimitive.Value />
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

/** Plain month + year dropdowns, styled to match the app's other form selects (e.g. BankPicker) instead of a calendar popup. */
export function MonthYearSelect({ value, onChange, disabled, yearsBack = 6 }: MonthYearSelectProps) {
  const years = Array.from({ length: yearsBack + 1 }, (_, index) => CURRENT_YEAR - index)

  return (
    <div className="flex gap-2">
      <SelectField
        aria-label="Statement month"
        value={String(value.month)}
        onChange={(next) => onChange({ ...value, month: Number(next) })}
        disabled={disabled}
        options={MONTH_NAMES.map((name, index) => ({ value: String(index + 1), label: name }))}
      />
      <SelectField
        aria-label="Statement year"
        value={String(value.year)}
        onChange={(next) => onChange({ ...value, year: Number(next) })}
        disabled={disabled}
        options={years.map((year) => ({ value: String(year), label: String(year) }))}
      />
    </div>
  )
}
