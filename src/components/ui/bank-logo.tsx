import { findBankOption } from '../../lib/banks'
import { bankLogos } from '../../lib/bank-logos'
import { cn } from './cn'

export interface BankLogoProps {
  name: string
  /** `sm` fits inline next to text (the dropdown chip); `lg` is meant to anchor a card. */
  size?: 'sm' | 'lg'
  className?: string
}

const BANK_LOGO_SIZE = {
  sm: { badge: 'size-5 text-[9px]', img: 'size-3.5' },
  lg: { badge: 'size-11 text-sm', img: 'size-7' },
} as const

/** Real bank logo when known, otherwise a colored initials chip. Used anywhere a bank name needs a visual anchor. */
export function BankLogo({ name, size = 'sm', className }: BankLogoProps) {
  const option = findBankOption(name)
  const logo = option ? bankLogos[option.id] : undefined
  const initials = option?.initials ?? name.slice(0, 2).toUpperCase()
  const { badge, img } = BANK_LOGO_SIZE[size]

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-background font-bold',
        badge,
        className,
      )}
      style={option ? { color: `#${option.logoColor}` } : undefined}
      aria-hidden="true"
    >
      {logo ? <img src={logo} alt="" className={cn(img, 'object-contain')} /> : initials}
    </span>
  )
}
