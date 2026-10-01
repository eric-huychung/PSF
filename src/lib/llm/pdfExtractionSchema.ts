import type { PdfEvidenceWindow } from '../adapters/pdfEvidence'
import { ASSIGNMENT_STATUSES, NO_EVIDENCE, type AssignmentStatus, type WindowDecisionBundle } from './pdfExtraction'

export type { AssignmentStatus }

/**
 * What one evidence window resolved to. Deliberately has no free-text date/amount field --
 * only evidence ID references -- so a model-invented value has nowhere to go even by
 * construction. `descriptionEvidenceIds` may be empty (e.g. for non-transaction/unresolved).
 */
export interface PdfExtractionAssignment {
  windowId: string
  status: AssignmentStatus
  dateEvidenceId?: string
  amountEvidenceId?: string
  descriptionEvidenceIds: string[]
}

export interface PdfExtractionResult {
  assignments: PdfExtractionAssignment[]
}

/**
 * Assembles one `PdfExtractionAssignment` per window from Jev's raw per-window Choice answers.
 * Unlike the old free-JSON response, a hallucinated evidence id is structurally impossible here:
 * `pdfExtraction.ts` already rejects any Choice answer outside the criteria it offered.
 *
 * A window whose own answers don't hold together -- no bundle at all, an unrecognized status, or
 * "accepted" without a real date/amount to back it up -- is demoted to `unresolved` rather than
 * thrown as a batch-wide error. That's an honest label, not a guess (this is exactly what
 * "unresolved" already means elsewhere), and it means one inconsistent window out of hundreds
 * never voids every other window's otherwise-good answer -- which used to happen, and was the
 * whole extraction's only failure mode on a real statement where most windows were fine.
 */
export function buildAssignments(windows: PdfEvidenceWindow[], bundles: Map<string, WindowDecisionBundle>): PdfExtractionResult {
  return { assignments: windows.map((window) => buildAssignment(window, bundles.get(window.id))) }
}

function buildAssignment(window: PdfEvidenceWindow, bundle: WindowDecisionBundle | undefined): PdfExtractionAssignment {
  const allEvidenceIds = window.lines.flatMap((line) => line.items.map((item) => item.id))

  if (!bundle || !ASSIGNMENT_STATUSES.includes(bundle.status as AssignmentStatus)) {
    return { windowId: window.id, status: 'unresolved', descriptionEvidenceIds: allEvidenceIds }
  }
  const status = bundle.status as AssignmentStatus

  if (status !== 'accepted') {
    return { windowId: window.id, status, descriptionEvidenceIds: allEvidenceIds }
  }

  if (bundle.date === NO_EVIDENCE || bundle.amount === NO_EVIDENCE || bundle.date === bundle.amount) {
    return { windowId: window.id, status: 'unresolved', descriptionEvidenceIds: allEvidenceIds }
  }

  return {
    windowId: window.id,
    status: 'accepted',
    dateEvidenceId: bundle.date,
    amountEvidenceId: bundle.amount,
    descriptionEvidenceIds: allEvidenceIds.filter((id) => id !== bundle.date && id !== bundle.amount),
  }
}

export interface ResolvedPdfAssignment {
  windowId: string
  pageNumber: number
  status: AssignmentStatus
  /** Resolved only from the supplied evidence windows -- never from anything else in the model's response. */
  dateText?: string
  amountText?: string
  descriptionText: string
}

/** Converts evidence ID references back into their real source text. Ignores anything in the raw response other than IDs already confirmed to belong to these windows. */
export function resolveAssignments(windows: PdfEvidenceWindow[], result: PdfExtractionResult): ResolvedPdfAssignment[] {
  const windowById = new Map(windows.map((w) => [w.id, w]))

  return result.assignments.map((assignment) => {
    const window = windowById.get(assignment.windowId)!
    const itemsById = new Map(window.lines.flatMap((line) => line.items).map((item) => [item.id, item] as const))

    return {
      windowId: assignment.windowId,
      pageNumber: window.pageNumber,
      status: assignment.status,
      dateText: assignment.dateEvidenceId ? itemsById.get(assignment.dateEvidenceId)?.text : undefined,
      amountText: assignment.amountEvidenceId ? itemsById.get(assignment.amountEvidenceId)?.text : undefined,
      descriptionText: assignment.descriptionEvidenceIds
        .map((id) => itemsById.get(id)?.text ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    }
  })
}
