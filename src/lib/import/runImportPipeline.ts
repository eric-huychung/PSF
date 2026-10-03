import type { Category, CategorizationProvider, CategorizationResult, Categorizer, NormalizedTransaction, Rule } from '../types'
import type { PdfTextPage } from '../adapters/pdf'
import type { PdfTransactionDraft } from '../adapters/pdf-normalize'
import { categorize } from '../categorization/pipeline'
import { verifyExtraction } from '../verification/verifyExtraction'
import { judgeCategorization, type JudgeOptions } from '../llm/judge'

export interface PdfImportContext {
  pages: PdfTextPage[]
  statementYear: number
  drafts: PdfTransactionDraft[]
  /** Same account-type-derived flag used to materialize `drafts` -- see resolveSignConvention. */
  isCreditCard: boolean
}

export interface ImportPipelineInput {
  transactions: NormalizedTransaction[]
  categories: Category[]
  rules: Rule[]
  categorizer: Categorizer
  provider: CategorizationProvider
  /** Null when there's no OpenRouter key -- both the extraction check and the category judge are skipped. */
  judgeOptions: JudgeOptions | null
  /** Null skips the extraction cross-check (no OpenRouter key, or extraction never ran). */
  pdfContext: PdfImportContext | null
}

type Flag = { flagged: true; flagReason: string }

export interface ImportPipelineResult {
  results: CategorizationResult[]
  /** Jev found this many extra accepted rows the deterministic parser has no matching draft for -- see verifyExtraction. */
  missingRowCount: number
}

/**
 * A row can get flagged by two independent QA checks: the extraction cross-check (parser vs.
 * Jev disagreed) and the category judge (the assigned category itself looks wrong). When both
 * fire for the same row, the category verdict wins -- it names the more specific, actionable
 * problem ("this category is probably wrong") over the generic one ("verify this row"), so the
 * extraction flag is only surfaced when the category judge didn't already flag it.
 */
export function resolveFlag(categoryVerdict: Flag | null, extractionReason: string | undefined): Flag | null {
  if (categoryVerdict) return categoryVerdict
  if (extractionReason) return { flagged: true, flagReason: extractionReason }
  return null
}

/**
 * Runs the categorization + QA pipeline for one import: cache/categorizer pass, then both flag
 * sources (extraction cross-check, category judge on low/medium confidence), merged via
 * `resolveFlag`. Both judge calls fail open -- a thrown error is treated as "no flag", never as
 * a blocked import.
 */
export async function runImportPipeline(input: ImportPipelineInput): Promise<ImportPipelineResult> {
  const { transactions, categories, rules, categorizer, provider, judgeOptions, pdfContext } = input

  const { flags: extractionFlags, missingRowCount } =
    pdfContext && judgeOptions
      ? await verifyExtraction(pdfContext.drafts, pdfContext.pages, pdfContext.statementYear, judgeOptions, pdfContext.isCreditCard).catch(() => ({ flags: new Map<number, string>(), missingRowCount: 0 }))
      : { flags: new Map<number, string>(), missingRowCount: 0 }

  const categorized = await categorize(transactions, categories, rules, categorizer, provider)

  const results = await Promise.all(
    categorized.map(async (result, index): Promise<CategorizationResult> => {
      let categoryVerdict: Flag | null = null
      if (judgeOptions && (result.confidence === 'low' || result.confidence === 'medium')) {
        try {
          const verdict = await judgeCategorization(result.transaction, result.categoryId, categories, judgeOptions)
          if (verdict.verdict === 'fail') categoryVerdict = { flagged: true, flagReason: verdict.reason ?? 'The category may be wrong -- please check.' }
        } catch {
          // fail open: a judge error is not a flag
        }
      }
      const flag = resolveFlag(categoryVerdict, extractionFlags.get(index))
      return flag ? { ...result, ...flag } : result
    }),
  )

  return { results, missingRowCount }
}
