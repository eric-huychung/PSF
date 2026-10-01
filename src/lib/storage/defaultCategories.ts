import type { Category } from '../types'

/** Seeded into a brand-new data folder so the app is usable before the user configures anything. */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'income', name: 'Income', description: 'Paychecks, deposits, refunds, and other money coming in' },
  { id: 'food', name: 'Food', description: 'Groceries, restaurants, cafes, food delivery' },
  { id: 'gifts', name: 'Gifts', description: 'Presents and charitable/personal giving' },
  { id: 'gym', name: 'Gym', description: 'Gym, fitness studio, or sports club memberships' },
  { id: 'rent', name: 'Rent', description: 'Recurring rent or mortgage payment for a home' },
  { id: 'transportation', name: 'Transportation', description: 'Gas, parking, transit, rideshare, car maintenance' },
  { id: 'personal', name: 'Personal', description: 'Catch-all for discretionary spending that has no better fit -- prefer a more specific category whenever the merchant type is clear' },
  { id: 'phone', name: 'Phone', description: 'Mobile phone service/carrier bill -- not any merchant whose listing happens to include a phone number' },
  { id: 'utilities', name: 'Utilities', description: 'Electricity, gas, water, trash for a home' },
  { id: 'wifi', name: 'Wifi', description: 'Home internet/cable service bill' },
  { id: 'debt', name: 'Debt', description: 'Loan or credit card payments/interest' },
  { id: 'pets', name: 'Pets', description: 'Pet food, vet, grooming, boarding' },
  { id: 'insurance', name: 'Insurance', description: 'Car, health/personal, home/renters, and other insurance premiums' },
  { id: 'transfer', name: 'Transfer', description: 'Internal money movement, e.g. paying off a credit card from checking -- not real spend', isTransfer: true },
]
