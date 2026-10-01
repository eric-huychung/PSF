import { ToggleGroup } from 'radix-ui'
import { cn } from './cn'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>
  value: T
  onValueChange: (value: T) => void
  /** Accessible name for the group, e.g. "Time range". */
  'aria-label': string
  size?: 'sm' | 'md'
  className?: string
}

/** Pill track with one selected pill — single-select, always has a value. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  size = 'md',
  className,
  ...props
}: SegmentedControlProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      // Radix emits "" when the active item is clicked again; keep the current value.
      onValueChange={(next) => next && onValueChange(next as T)}
      aria-label={props['aria-label']}
      data-slot="segmented-control"
      className={cn('inline-flex items-center gap-1 rounded-pill bg-segmented-track p-1', className)}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            'rounded-pill font-medium text-muted-foreground transition-colors hover:text-foreground',
            'data-[state=on]:bg-segmented-active data-[state=on]:text-segmented-active-foreground',
            size === 'sm' ? 'h-7 px-3 text-xs' : 'h-8 px-4 text-sm',
          )}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}
