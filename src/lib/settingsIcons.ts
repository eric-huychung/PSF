import type { LucideIcon } from 'lucide-react'
import type { AccountType } from './types'
import {
  Baby,
  Briefcase,
  Car,
  Coffee,
  CreditCard,
  Film,
  Fuel,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  PawPrint,
  ArrowLeftRight,
  PiggyBank,
  Plane,
  Receipt,
  ShoppingBag,
  Smartphone,
  Tag,
  User,
  Utensils,
  Wallet,
  Wifi,
  Zap,
} from 'lucide-react'

const CATEGORY_ICON_RULES: Array<{ icon: LucideIcon; keywords: string[] }> = [
  { icon: Utensils, keywords: ['food', 'grocer', 'dining', 'restaurant'] },
  { icon: Coffee, keywords: ['coffee', 'cafe'] },
  { icon: Gift, keywords: ['gift'] },
  { icon: Home, keywords: ['rent', 'mortgage', 'housing'] },
  { icon: Zap, keywords: ['utilit', 'electric', 'power'] },
  { icon: Wifi, keywords: ['wifi', 'internet'] },
  { icon: Smartphone, keywords: ['phone', 'mobile', 'cell'] },
  { icon: Fuel, keywords: ['gas', 'fuel'] },
  { icon: Car, keywords: ['car', 'auto', 'transport', 'uber', 'lyft', 'parking'] },
  { icon: Plane, keywords: ['travel', 'flight', 'vacation', 'trip'] },
  { icon: PawPrint, keywords: ['pet', 'dog', 'cat'] },
  { icon: ShoppingBag, keywords: ['shop', 'clothes', 'clothing', 'apparel'] },
  { icon: Film, keywords: ['entertain', 'movie', 'streaming', 'subscription'] },
  { icon: GraduationCap, keywords: ['education', 'school', 'tuition', 'student'] },
  { icon: HeartPulse, keywords: ['health', 'medical', 'doctor', 'insurance', 'gym', 'fitness'] },
  { icon: CreditCard, keywords: ['debt', 'loan', 'credit'] },
  { icon: PiggyBank, keywords: ['saving', 'invest'] },
  { icon: Briefcase, keywords: ['work', 'business'] },
  { icon: Baby, keywords: ['kid', 'child', 'baby'] },
  { icon: Receipt, keywords: ['bill'] },
  { icon: User, keywords: ['personal'] },
  { icon: ArrowLeftRight, keywords: ['transfer'] },
]

/** Decorative-only: matches a category name to a representative icon, no data stored. Unmatched names fall back to a plain tag. */
export function getCategoryIcon(name: string): LucideIcon {
  const lower = name.toLowerCase()
  const match = CATEGORY_ICON_RULES.find((rule) => rule.keywords.some((keyword) => lower.includes(keyword)))
  return match?.icon ?? Tag
}

const ACCOUNT_TYPE_ICONS: Record<AccountType, LucideIcon> = {
  checking: Wallet,
  savings: PiggyBank,
  credit: CreditCard,
}

/** Decorative-only: one icon per account type. */
export function getAccountIcon(type: AccountType): LucideIcon {
  return ACCOUNT_TYPE_ICONS[type]
}
