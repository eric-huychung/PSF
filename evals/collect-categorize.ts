/**
 * One-off data collector for the categorization eval. Walks the same real statement PDFs as
 * collect-parser.ts, parses them with the deterministic path, then runs the actual production
 * categorizer (Jev, via `createCategorizer`) against every transaction -- rules are passed in
 * empty so nothing is answered from the cache, every row is a real model call. Writes one
 * promptfoo test case per transaction for a judge model to grade.
 *
 * Needs OPENROUTER_API_KEY in the environment (same key you use in the app's Settings page) and
 * CATEGORIES_FILE pointing at your real categories.json, so the categorizer sees the same
 * category list it does in prod, not a stand-in.
 *
 * Run: CATEGORIES_FILE=/path/to/your/data/categories.json npx tsx evals/collect-categorize.ts
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { extractPdfText, findPdfTransactionCandidates } from '../src/lib/adapters/pdf'
import { normalizePdfCandidates } from '../src/lib/adapters/pdf-normalize'
import { categorize } from '../src/lib/categorization/pipeline'
import { createCategorizer } from '../src/lib/categorization/categorizer'
import type { Category, NormalizedTransaction } from '../src/lib/types'

/** See collect-parser.ts -- same Vite-only worker path issue, same fix. */
pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/build/pdf.worker.min.mjs')

const HERE = dirname(fileURLToPath(import.meta.url))
const STATEMENTS_DIR = join(HERE, '..', 'test', 'bank pdfs')
const OUT_FILE = join(HERE, 'data', 'categorize-tests.json')
const YEAR_PATTERN = /(?:^|\D)(20\d{2})(?:\D|$)/

/** Cheap model for a first pass -- swap to a stronger judge (e.g. anthropic/claude-sonnet-5.5) once this looks right. */
const JUDGE_MODEL = 'openrouter:anthropic/claude-haiku-4.5'

/** Path to your real data folder's categories.json -- same file Settings reads/writes. */
const CATEGORIES_FILE = process.env.CATEGORIES_FILE

const RUBRIC = `You are checking one category a personal-finance categorizer assigned to one bank
transaction. AVAILABLE_CATEGORIES is the full allowed list; the model must have picked from it.

Pass if ASSIGNED_CATEGORY is a reasonable pick for this transaction -- allow real judgment calls
(e.g. a grocery store charge going to "food" is fine even if "personal" is also arguable). Fail
only when the pick is clearly wrong for the description (e.g. a gym membership charge categorized
as "rent").

TRANSACTION: {{date}} | {{description}} | amount {{amount}}
AVAILABLE_CATEGORIES: {{categoryList}}
ASSIGNED_CATEGORY: {{categoryId}} (model confidence: {{confidence}})`

async function findPdfs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await findPdfs(full)))
    else if (entry.name.toLowerCase().endsWith('.pdf')) files.push(full)
  }
  return files
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('Set OPENROUTER_API_KEY in the environment first.')
  if (!CATEGORIES_FILE) throw new Error('Set CATEGORIES_FILE to the path of your real categories.json first.')

  const categories: Category[] = JSON.parse(await readFile(CATEGORIES_FILE, 'utf-8'))
  if (!categories.length) throw new Error(`${CATEGORIES_FILE} has no categories.`)
  const categoryList = categories.map((c) => `${c.id}: ${c.name}`).join(', ')

  const pdfPaths = (await findPdfs(STATEMENTS_DIR)).sort()
  if (!pdfPaths.length) throw new Error(`No PDFs found under ${STATEMENTS_DIR}`)

  const { categorizer, provider } = createCategorizer({ apiKey })
  const tests: unknown[] = []

  for (const path of pdfPaths) {
    const label = relative(STATEMENTS_DIR, path)
    const [bank, account] = label.split('/')
    const year = Number(YEAR_PATTERN.exec(label)?.[1] ?? new Date().getFullYear())
    const buffer = await readFile(path)
    const blob = new Blob([buffer], { type: 'application/pdf' })
    const pages = await extractPdfText(blob)
    const candidates = findPdfTransactionCandidates(pages)
    const { drafts } = normalizePdfCandidates(candidates, year)
    if (!drafts.length) continue

    const transactions: NormalizedTransaction[] = drafts.map((draft) => ({
      date: draft.date,
      amount: draft.amount,
      description: draft.description,
      bank,
      account,
    }))

    const results = await categorize(transactions, categories, [], categorizer, provider)
    for (const result of results) {
      tests.push({
        vars: {
          file: label,
          date: result.transaction.date,
          amount: result.transaction.amount,
          description: result.transaction.description,
          categoryId: result.categoryId,
          confidence: result.confidence,
          categoryList,
        },
        assert: [{ type: 'llm-rubric', provider: JUDGE_MODEL, value: RUBRIC }],
      })
    }
    console.log(`${label}: categorized ${results.length}`)
  }

  await mkdir(join(HERE, 'data'), { recursive: true })
  await writeFile(OUT_FILE, JSON.stringify(tests, null, 2))
  console.log(`\nWrote ${tests.length} categorize test cases (from ${pdfPaths.length} PDFs) to ${OUT_FILE}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
