/**
 * One-off data collector for the parser eval. Walks the real statement PDFs under
 * `test/bank pdfs/`, runs them through the exact deterministic path Upload.tsx uses
 * (extractPdfText -> findPdfTransactionCandidates -> normalizePdfCandidates), and writes one
 * promptfoo test case per candidate line so a judge model can check each parsed row against
 * its own source text.
 *
 * Only the transaction-level line text goes to the judge (same as what candidate.rawText
 * already is) -- never the full PDF, so this never sends anything beyond what already reaches
 * an LLM in production.
 *
 * Run: npx tsx evals/collect-parser.ts
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { extractPdfText, findPdfTransactionCandidates } from '../src/lib/adapters/pdf'
import { normalizePdfCandidates } from '../src/lib/adapters/pdf-normalize'

/**
 * pdf.ts points the pdf.js worker at `new URL('pdfjs-dist/build/...', import.meta.url)`, which
 * only resolves correctly under Vite's bundler-time rewrite. Plain Node has no such rewrite, so
 * the browser-only line resolves to a bogus path -- override the same (module-singleton)
 * GlobalWorkerOptions here instead of touching prod code just to make it runnable in Node.
 */
pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/build/pdf.worker.min.mjs')

const HERE = dirname(fileURLToPath(import.meta.url))
const STATEMENTS_DIR = join(HERE, '..', 'test', 'bank pdfs')
const OUT_FILE = join(HERE, 'data', 'parser-tests.json')
const YEAR_PATTERN = /(?:^|\D)(20\d{2})(?:\D|$)/

/** Cheap model for a first pass -- swap to a stronger judge (e.g. anthropic/claude-sonnet-5.5) once this looks right. */
const JUDGE_MODEL = 'openrouter:anthropic/claude-haiku-4.5'

const RUBRIC = `You are checking one row a bank-statement parser produced from one raw text line.
SOURCE is the raw line pulled from the PDF (date, description, amount all run together).
PARSED is the structured JSON the parser produced from it, or "REJECTED: <reason>" if the
parser decided the line wasn't a real transaction.

Some SOURCE dates include an explicit 2-digit year (e.g. "12/23/25") -- PARSED's year must match
that digit exactly, even if it differs from STATEMENT_YEAR (a statement's cycle can cross a
calendar-year boundary, so late-month rows legitimately belong to the prior year). Other SOURCE
dates have no year at all (e.g. "03/07") -- for those, PARSED is expected to fill in
STATEMENT_YEAR, and that is correct, not a bug. Only fail the year if it matches neither rule.

Pass if PARSED faithfully represents SOURCE: correct date by the rule above, same amount (value
and sign -- numeric value matters, not string formatting like trailing zeros), same
merchant/description, and a REJECTED row was rightly rejected (e.g. it's a header, total, or
disclosure line, not a transaction). Fail if PARSED has a wrong date/amount/description, or a
REJECTED row actually looks like a real transaction that got dropped.

STATEMENT_YEAR: {{statementYear}}

SOURCE:
{{sourceText}}

PARSED:
{{parsed}}`

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
  const pdfPaths = (await findPdfs(STATEMENTS_DIR)).sort()
  if (!pdfPaths.length) throw new Error(`No PDFs found under ${STATEMENTS_DIR}`)

  const tests: unknown[] = []

  for (const path of pdfPaths) {
    const label = relative(STATEMENTS_DIR, path)
    const year = Number(YEAR_PATTERN.exec(label)?.[1] ?? new Date().getFullYear())
    const buffer = await readFile(path)
    const blob = new Blob([buffer], { type: 'application/pdf' })
    const pages = await extractPdfText(blob)
    const candidates = findPdfTransactionCandidates(pages)
    const { drafts, rejected } = normalizePdfCandidates(candidates, year)

    for (const draft of drafts) {
      tests.push({
        vars: {
          file: label,
          sourceText: draft.sourceText,
          parsed: JSON.stringify({ date: draft.date, amount: draft.amount, description: draft.description }),
          statementYear: year,
        },
        assert: [{ type: 'llm-rubric', provider: JUDGE_MODEL, value: RUBRIC }],
      })
    }
    for (const { candidate, reason } of rejected) {
      tests.push({
        vars: {
          file: label,
          sourceText: candidate.rawText,
          parsed: `REJECTED: ${reason}`,
          statementYear: year,
        },
        assert: [{ type: 'llm-rubric', provider: JUDGE_MODEL, value: RUBRIC }],
      })
    }
    console.log(`${label}: ${drafts.length} parsed, ${rejected.length} rejected`)
  }

  await mkdir(join(HERE, 'data'), { recursive: true })
  await writeFile(OUT_FILE, JSON.stringify(tests, null, 2))
  console.log(`\nWrote ${tests.length} parser test cases (from ${pdfPaths.length} PDFs) to ${OUT_FILE}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
