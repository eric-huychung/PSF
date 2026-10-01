import type { ResolvedPdfAssignment } from '../llm/pdfExtractionSchema'
import type { PdfMaterializedDraft } from './pdf-normalize'
import type { PdfEvidenceWindow } from './pdfEvidence'

export type PdfValidationIssueKind = 'duplicate' | 'out-of-period' | 'page-continuity'

export interface PdfValidationIssue {
  kind: PdfValidationIssueKind
  windowIds: string[]
  pageNumber: number
  message: string
}

export interface PdfValidationResult {
  status: 'ready' | 'needs-review'
  issues: PdfValidationIssue[]
}

/** Overlapping evidence windows (see pdfEvidence.ts) can legally both resolve to the same real transaction. */
function findDuplicates(drafts: PdfMaterializedDraft[]): PdfValidationIssue[] {
  const groups = new Map<string, PdfMaterializedDraft[]>()
  for (const draft of drafts) {
    const key = `${draft.date}|${draft.amount}|${draft.description}`
    const group = groups.get(key)
    if (group) group.push(draft)
    else groups.set(key, [draft])
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      kind: 'duplicate' as const,
      windowIds: group.map((draft) => draft.windowId),
      pageNumber: group[0].pageNumber,
      message: `${group.length} evidence windows resolved to the same transaction (${group[0].date} ${group[0].description} ${group[0].amount})`,
    }))
}

function findOutOfPeriod(drafts: PdfMaterializedDraft[], statementYear: number): PdfValidationIssue[] {
  return drafts
    .filter((draft) => !draft.date.startsWith(`${statementYear}-`))
    .map((draft) => ({
      kind: 'out-of-period' as const,
      windowIds: [draft.windowId],
      pageNumber: draft.pageNumber,
      message: `Transaction date ${draft.date} falls outside the statement year ${statementYear}`,
    }))
}

/**
 * Evidence windows never span a page break (pdfEvidence.ts builds them per page), so a real
 * transaction whose date/amount landed on the next page can never be captured by any window on
 * this one. An `unresolved` window sitting on a page's last line is the one observable signal of
 * that gap -- flag it for review instead of silently treating the page boundary as a clean stop.
 */
function findPageContinuityGaps(resolved: ResolvedPdfAssignment[], windows: PdfEvidenceWindow[]): PdfValidationIssue[] {
  const windowById = new Map(windows.map((window) => [window.id, window]))
  const lastLineYByPage = new Map<number, number>()
  for (const window of windows) {
    const lastY = window.lines[window.lines.length - 1].y
    const current = lastLineYByPage.get(window.pageNumber)
    if (current === undefined || lastY < current) lastLineYByPage.set(window.pageNumber, lastY)
  }

  const issues: PdfValidationIssue[] = []
  for (const assignment of resolved) {
    if (assignment.status !== 'unresolved') continue
    const window = windowById.get(assignment.windowId)!
    const windowLastY = window.lines[window.lines.length - 1].y
    if (windowLastY === lastLineYByPage.get(assignment.pageNumber)) {
      issues.push({
        kind: 'page-continuity',
        windowIds: [assignment.windowId],
        pageNumber: assignment.pageNumber,
        message: `Unresolved evidence at the bottom of page ${assignment.pageNumber} may continue onto the next page`,
      })
    }
  }
  return issues
}

/**
 * Runs every reconciliation gate over a batch of materialized drafts. Any issue routes the whole
 * batch to `needs-review` -- nothing here repairs a draft or picks a winner among duplicates,
 * it only surfaces what needs a human look, linked back to the evidence/window that caused it.
 */
export function validatePdfExtraction(
  drafts: PdfMaterializedDraft[],
  resolved: ResolvedPdfAssignment[],
  windows: PdfEvidenceWindow[],
  statementYear: number,
): PdfValidationResult {
  const issues = [
    ...findDuplicates(drafts),
    ...findOutOfPeriod(drafts, statementYear),
    ...findPageContinuityGaps(resolved, windows),
  ]
  return { status: issues.length === 0 ? 'ready' : 'needs-review', issues }
}
