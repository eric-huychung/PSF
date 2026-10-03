import {
  JEV_MODEL_SLUG,
  JevError,
  PDF_EXTRACTION_PROMPT_VERSION,
  requestWindowDecisions,
  type PdfExtractionRequestOptions,
  type WindowDecisionBundle,
} from '../llm/pdfExtraction'
import {
  buildAssignments,
  resolveAssignments,
  type ResolvedPdfAssignment,
} from '../llm/pdfExtractionSchema'
import { findPdfTransactionCandidates, type PdfTextPage } from './pdf'
import { materializeAssignments, type PdfMaterializedDraft, type RejectedPdfAssignment } from './pdf-normalize'
import { buildPdfEvidence, type PdfEvidenceWindow } from './pdfEvidence'
import { validatePdfExtraction, type PdfValidationResult } from './pdfValidation'

/** A failed transient call is retried once before giving up -- never indefinitely. */
const MAX_ATTEMPTS = 2
const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504])

export type PdfShadowMode = 'ready' | 'needs-review' | 'unavailable'
export type PdfShadowRowStatus = 'accepted' | 'needs-review' | 'rejected' | 'non-transaction' | 'unresolved'

export interface PdfShadowRow {
  windowId: string
  pageNumber: number
  status: PdfShadowRowStatus
  date?: string
  amount?: number
  description: string
  reason?: string
}

/** Un-ground-truthed proxies against the deterministic baseline and this batch's own validation -- see G5. */
export interface PdfShadowMetrics {
  modelId: string
  promptVersion: string
  candidateRecall: number
  falsePositiveRate: number
  unresolvedRate: number
  reconciliationPassRate: number
}

export interface PdfShadowResult {
  mode: PdfShadowMode
  rows: PdfShadowRow[]
  metrics: PdfShadowMetrics
  /** Set only when mode is 'unavailable' -- why Jev's result was not used at all. */
  fallbackReason?: string
}

/**
 * Retries only transient failures (network hiccups, 429/5xx) up to MAX_ATTEMPTS. A semantic
 * failure -- malformed/invalid model output (JevError 'parse', or the schema validator rejecting
 * the response) or an unsupported model/provider -- is never retried: more attempts wouldn't fix
 * a model that answered badly, and retrying would just delay the fallback these represent (G6).
 */
async function requestWithRetry(options: PdfExtractionRequestOptions, windows: PdfEvidenceWindow[]): Promise<Map<string, WindowDecisionBundle>> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await requestWindowDecisions(options, windows)
    } catch (error) {
      const retryable = error instanceof JevError && (error.kind === 'network' || (error.kind === 'http' && RETRYABLE_HTTP_STATUSES.has(error.status ?? 0)))
      if (!retryable || attempt >= MAX_ATTEMPTS) throw error
    }
  }
}

function buildShadowRows(
  resolved: ResolvedPdfAssignment[],
  drafts: PdfMaterializedDraft[],
  rejected: RejectedPdfAssignment[],
  validation: PdfValidationResult,
): PdfShadowRow[] {
  const draftByWindow = new Map(drafts.map((draft) => [draft.windowId, draft]))
  const rejectionByWindow = new Map(rejected.map((item) => [item.windowId, item]))
  const issuesByWindow = new Map<string, string[]>()
  for (const issue of validation.issues) {
    for (const windowId of issue.windowIds) {
      issuesByWindow.set(windowId, [...(issuesByWindow.get(windowId) ?? []), issue.message])
    }
  }

  return resolved.map((assignment): PdfShadowRow => {
    const draft = draftByWindow.get(assignment.windowId)
    const issues = issuesByWindow.get(assignment.windowId)

    if (draft) {
      return {
        windowId: assignment.windowId,
        pageNumber: assignment.pageNumber,
        status: issues ? 'needs-review' : 'accepted',
        date: draft.date,
        amount: draft.amount,
        description: draft.description,
        reason: issues?.join('; '),
      }
    }

    const rejection = rejectionByWindow.get(assignment.windowId)
    if (rejection) {
      return {
        windowId: assignment.windowId,
        pageNumber: assignment.pageNumber,
        status: 'rejected',
        description: assignment.descriptionText,
        reason: rejection.reason,
      }
    }

    return {
      windowId: assignment.windowId,
      pageNumber: assignment.pageNumber,
      status: assignment.status as 'non-transaction' | 'unresolved',
      description: assignment.descriptionText,
      reason: issues?.join('; '),
    }
  })
}

/**
 * Runs Jev alongside the existing deterministic extractor without persisting anything (G5).
 * Never writes to storage, never repairs a low-confidence result -- it only produces a
 * comparison view and metrics for a human (or G6's rollout gate) to judge Jev's output by.
 * On any non-retryable Jev failure, returns mode 'unavailable' so the caller keeps using its
 * existing deterministic-only path untouched (G6's required fallback).
 */
export async function runPdfShadowExtraction(
  pages: PdfTextPage[],
  statementYear: number,
  options: PdfExtractionRequestOptions,
  /** Same account-type-derived flag the deterministic path uses -- see resolveSignConvention. */
  isCreditCard: boolean,
): Promise<PdfShadowResult> {
  const deterministicCandidateCount = findPdfTransactionCandidates(pages).length
  const windows = buildPdfEvidence(pages)
  const baseMetrics: PdfShadowMetrics = {
    modelId: JEV_MODEL_SLUG,
    promptVersion: PDF_EXTRACTION_PROMPT_VERSION,
    candidateRecall: 0,
    falsePositiveRate: 0,
    unresolvedRate: 0,
    reconciliationPassRate: 0,
  }

  let resolved: ResolvedPdfAssignment[]
  try {
    const bundles = await requestWithRetry(options, windows)
    resolved = resolveAssignments(windows, buildAssignments(windows, bundles))
  } catch (error) {
    return {
      mode: 'unavailable',
      rows: [],
      metrics: baseMetrics,
      fallbackReason: error instanceof Error ? error.message : 'Jev extraction failed',
    }
  }

  const { drafts, rejected } = materializeAssignments(resolved, statementYear, isCreditCard)
  const validation = validatePdfExtraction(drafts, resolved, windows, statementYear)
  const flaggedWindowIds = new Set(validation.issues.flatMap((issue) => issue.windowIds))
  const flaggedDraftCount = drafts.filter((draft) => flaggedWindowIds.has(draft.windowId)).length
  const jevAcceptedCount = resolved.filter((assignment) => assignment.status === 'accepted').length
  const jevUnresolvedCount = resolved.filter((assignment) => assignment.status === 'unresolved').length
  const falsePositiveCount = rejected.length + flaggedDraftCount

  const metrics: PdfShadowMetrics = {
    ...baseMetrics,
    candidateRecall: deterministicCandidateCount === 0 ? 1 : drafts.length / deterministicCandidateCount,
    falsePositiveRate: jevAcceptedCount === 0 ? 0 : falsePositiveCount / jevAcceptedCount,
    unresolvedRate: windows.length === 0 ? 0 : jevUnresolvedCount / windows.length,
    reconciliationPassRate: drafts.length === 0 ? 1 : (drafts.length - flaggedDraftCount) / drafts.length,
  }

  return {
    mode: rejected.length > 0 || validation.status === 'needs-review' ? 'needs-review' : 'ready',
    rows: buildShadowRows(resolved, drafts, rejected, validation),
    metrics,
  }
}
