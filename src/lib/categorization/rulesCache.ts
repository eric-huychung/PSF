import type { Rule } from '../types'

/** Case/whitespace-insensitive form used for exact matching. */
function normalize(description: string): string {
  return description.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Merchant key used for fuzzy matching: alphanumeric tokens with any token
 * containing a digit dropped, so transaction ids, store numbers and dates
 * don't break a match ("STARBUCKS STORE 01234 11/02" -> "starbucks store").
 */
function merchantKey(description: string): string {
  return normalize(description)
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !/\d/.test(token))
    .join(' ')
}

/**
 * Category id for a description from learned rules, or undefined on a miss.
 * Exact match wins over fuzzy; among fuzzy matches the newest rule wins.
 */
export function lookupCategory(description: string, rules: Rule[]): string | undefined {
  const exact = normalize(description)
  const hit = rules.find((r) => normalize(r.descriptionPattern) === exact)
  if (hit) return hit.categoryId

  const key = merchantKey(description)
  if (!key) return undefined
  return rules.findLast((r) => merchantKey(r.descriptionPattern) === key)?.categoryId
}

/** Returns a new rule list with this correction added, replacing any rule for the same description. */
export function addRule(rules: Rule[], description: string, categoryId: string): Rule[] {
  const exact = normalize(description)
  return [...rules.filter((r) => normalize(r.descriptionPattern) !== exact), { descriptionPattern: description, categoryId }]
}

/**
 * Collapses rules that share a merchant key down to just the newest one -- same winner
 * `lookupCategory`'s fuzzy match would already pick, so this only removes redundant entries,
 * never changes categorization. Guards against unbounded growth from repeated corrections to the
 * same merchant (e.g. a reference number that varies in a way the merchant key doesn't strip).
 */
export function compactRules(rules: Rule[]): Rule[] {
  const byKey = new Map<string, Rule>()
  for (const rule of rules) {
    const key = merchantKey(rule.descriptionPattern) || normalize(rule.descriptionPattern)
    byKey.set(key, rule)
  }
  return [...byKey.values()]
}
