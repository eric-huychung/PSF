import { toStorageError } from '../storage/fsAccess'
import type { PdfShadowResult } from './pdfReview'

/** Debug-only output, never read back by the app -- kept out of the user's actual data folders (transactions/, categories.json, ...). */
const LOG_DIR_PARTS = ['debug', 'jev-vs-manual']

export interface DeterministicPdfLogEntry {
  date: string
  amount: number
  description: string
}

export interface DeterministicPdfLog {
  transactions: DeterministicPdfLogEntry[]
  rejectedCount: number
}

export interface JevComparisonLogEntry {
  fileName: string
  statementYear: number
  generatedAt: string
  deterministic: DeterministicPdfLog
  jev: PdfShadowResult | { error: string }
}

function safeFileNamePart(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, '_')
}

/**
 * Writes one side-by-side log per PDF upload -- the deterministic parser's rows next to Jev's
 * shadow-extraction rows -- so both can be opened and diffed directly on disk instead of only
 * skimming the Upload page's table. Purely a debug aid: nothing here is read back by the app, and
 * a failure to write it must never block or fail the upload it's describing.
 *
 * One file per source PDF name, not per run: re-uploading the same statement overwrites its
 * previous comparison rather than piling up timestamped copies, so there's always exactly one
 * current file at a predictable path for the same statement. `generatedAt` inside the JSON still
 * records when that file was last written.
 */
export async function writeJevComparisonLog(folder: FileSystemDirectoryHandle, entry: JevComparisonLogEntry): Promise<void> {
  let dir = folder
  for (const part of LOG_DIR_PARTS) {
    dir = await dir.getDirectoryHandle(part, { create: true })
  }

  const fileName = `${safeFileNamePart(entry.fileName)}.json`
  try {
    const writable = await (await dir.getFileHandle(fileName, { create: true })).createWritable()
    await writable.write(JSON.stringify(entry, null, 2))
    await writable.close()
  } catch (error) {
    throw toStorageError(error)
  }
}
