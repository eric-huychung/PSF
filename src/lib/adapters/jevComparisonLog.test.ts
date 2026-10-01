import { describe, expect, it } from 'vitest'
import { FakeDirectoryHandle } from '../storage/testing/fakeFileSystem'
import { writeJevComparisonLog, type JevComparisonLogEntry } from './jevComparisonLog'

function entry(overrides: Partial<JevComparisonLogEntry> = {}): JevComparisonLogEntry {
  return {
    fileName: 'chase-2026-08.pdf',
    statementYear: 2026,
    generatedAt: '2026-09-29T12:00:00.000Z',
    deterministic: { transactions: [{ date: '2026-08-06', amount: -41.97, description: 'STEAMGAMES.COM' }], rejectedCount: 0 },
    jev: { mode: 'ready', rows: [], metrics: { modelId: 'typesafe/jev-1.13', promptVersion: 'pdf-extraction-prompt-v2', candidateRecall: 1, falsePositiveRate: 0, unresolvedRate: 0, reconciliationPassRate: 1 } },
    ...overrides,
  }
}

describe('writeJevComparisonLog', () => {
  it('writes a JSON log under debug/jev-vs-manual, keeping it out of the real data folders', async () => {
    const folder = new FakeDirectoryHandle('finances')

    await writeJevComparisonLog(folder.asHandle(), entry())

    const debugDir = folder.directories.get('debug')
    const logDir = debugDir?.directories.get('jev-vs-manual')
    expect(logDir).toBeDefined()
    expect(logDir!.files.size).toBe(1)
  })

  it('names the file from the source PDF, sanitizing unsafe characters', async () => {
    const folder = new FakeDirectoryHandle('finances')

    await writeJevComparisonLog(folder.asHandle(), entry({ fileName: 'weird name (1).pdf' }))

    const logDir = folder.directories.get('debug')!.directories.get('jev-vs-manual')!
    const [fileName] = logDir.files.keys()
    expect(fileName).toBe('weird_name__1_.pdf.json')
  })

  it('overwrites the previous comparison for the same source PDF instead of piling up files', async () => {
    const folder = new FakeDirectoryHandle('finances')

    await writeJevComparisonLog(folder.asHandle(), entry({ generatedAt: '2026-09-29T12-00-00.000Z' }))
    await writeJevComparisonLog(folder.asHandle(), entry({ generatedAt: '2026-09-29T13-00-00.000Z' }))

    const logDir = folder.directories.get('debug')!.directories.get('jev-vs-manual')!
    expect(logDir.files.size).toBe(1)
    const [content] = logDir.files.values()
    expect(JSON.parse(content).generatedAt).toBe('2026-09-29T13-00-00.000Z')
  })

  it('writes both the deterministic and Jev sides so they can be compared from one file', async () => {
    const folder = new FakeDirectoryHandle('finances')
    const logEntry = entry()

    await writeJevComparisonLog(folder.asHandle(), logEntry)

    const logDir = folder.directories.get('debug')!.directories.get('jev-vs-manual')!
    const [content] = logDir.files.values()
    expect(JSON.parse(content)).toEqual(logEntry)
  })

  it('records a Jev failure reason instead of dropping it, when Jev did not produce a result', async () => {
    const folder = new FakeDirectoryHandle('finances')
    const logEntry = entry({ jev: { error: 'Add an OpenRouter API key in Settings to run the experimental Jev extraction.' } })

    await writeJevComparisonLog(folder.asHandle(), logEntry)

    const logDir = folder.directories.get('debug')!.directories.get('jev-vs-manual')!
    const [content] = logDir.files.values()
    expect(JSON.parse(content).jev).toEqual({ error: 'Add an OpenRouter API key in Settings to run the experimental Jev extraction.' })
  })
})
