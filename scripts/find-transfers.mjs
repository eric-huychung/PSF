#!/usr/bin/env node
// Audits a PSF data folder for likely internal transfers (money leaving one of your
// accounts and landing in another) that aren't tagged with a transfer category yet --
// the root cause of inflated dashboard totals (see AGENTS.md discussion / credit-card
// reconcile work). Read-only: prints findings, never writes.
//
// Usage: node scripts/find-transfers.mjs /path/to/your/data/folder
//
// Matching logic: an outflow (amount < 0) on one account is a confirmed transfer when
// there's an inflow (amount > 0) of the same absolute amount on a DIFFERENT account
// within 3 days. This is the same "is it actually a transfer" check as the live app's
// description-based rules, just verified by amount+date instead of guessed by keyword.
//
// Rerun this after importing new months to catch new transfer pairs before they
// inflate "Debt", "Average in/out", or any category total on the dashboard.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const DATA_DIR = process.argv[2]
if (!DATA_DIR) {
  console.error('Usage: node scripts/find-transfers.mjs /path/to/your/data/folder')
  process.exit(1)
}
const TX_DIR = path.join(DATA_DIR, 'transactions')

// Same logic as src/lib/categorization/rulesCache.ts -- kept in sync by hand since this
// script runs standalone in Node, outside the app's TypeScript build.
function normalize(description) {
  return description.trim().replace(/\s+/g, ' ').toLowerCase()
}
function merchantKey(description) {
  return normalize(description)
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !/\d/.test(token))
    .join(' ')
}

async function loadAllTransactions() {
  const files = await readdir(TX_DIR)
  const all = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const content = JSON.parse(await readFile(path.join(TX_DIR, file), 'utf8'))
    if (!Array.isArray(content)) continue
    for (const t of content) all.push({ ...t, file })
  }
  return all
}

function daysApart(a, b) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000
}

const accounts = JSON.parse(await readFile(path.join(DATA_DIR, 'accounts.json'), 'utf8'))
const validAccounts = new Set(accounts.flatMap((entry) => entry.accounts.map((account) => `${entry.bank}-${account}`)))

const all = (await loadAllTransactions()).filter((t) => validAccounts.has(`${t.bank}-${t.account}`))
const rules = JSON.parse(await readFile(path.join(DATA_DIR, 'rules.json'), 'utf8').catch(() => '[]'))

function currentCategoryFor(description) {
  const exact = normalize(description)
  const hit = rules.find((r) => normalize(r.descriptionPattern) === exact)
  if (hit) return hit.categoryId
  const key = merchantKey(description)
  if (!key) return undefined
  return rules.findLast((r) => merchantKey(r.descriptionPattern) === key)?.categoryId
}

const outflows = all.filter((t) => t.amount < 0)
const inflows = all.filter((t) => t.amount > 0)

const matches = []
for (const out of outflows) {
  const match = inflows.find(
    (inflow) =>
      (inflow.bank !== out.bank || inflow.account !== out.account) &&
      Math.abs(inflow.amount - Math.abs(out.amount)) < 0.01 &&
      daysApart(inflow.date, out.date) <= 3,
  )
  if (match) matches.push({ out, match })
}

console.log(`Confirmed transfer pairs (amount+date matched): ${matches.length}\n`)

const groups = new Map()
let newPatterns = 0
for (const { out, match } of matches) {
  for (const t of [out, match]) {
    const key = merchantKey(t.description)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }
}
for (const [key, items] of groups) {
  const alreadyTransfer = currentCategoryFor(items[0].description) === 'transfer'
  if (alreadyTransfer) continue
  newPatterns += 1
  console.log(`NEW pattern: "${key}"`)
  console.log(`  sample: "${items[0].description}"`)
  console.log(`  currently tagged: ${currentCategoryFor(items[0].description) ?? 'uncategorized'}`)
  console.log(`  covers ${items.length} transaction(s)\n`)
}

if (newPatterns === 0) {
  console.log('Nothing new -- every confirmed transfer pair already resolves to the transfer category.')
} else {
  console.log(`${newPatterns} pattern(s) need a rule pointed at your transfer category.`)
}

const totalImpact = matches
  .filter(({ out }) => currentCategoryFor(out.description) !== 'transfer')
  .reduce((sum, { out }) => sum + Math.abs(out.amount), 0)
if (totalImpact > 0) console.log(`\n$${totalImpact.toFixed(2)} still double-counted in totals.`)
