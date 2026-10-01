import { describe, expect, it } from 'vitest'
import type { PdfTextPage } from './pdf'
import { buildPdfEvidence, PDF_EVIDENCE_EXTRACTOR_VERSION } from './pdfEvidence'

function page(pageNumber: number, items: PdfTextPage['items']): PdfTextPage {
  return { pageNumber, lines: [], items }
}

describe('PDF evidence ledger', () => {
  it('assigns stable, page-scoped item IDs from PDF.js item order', () => {
    const windows = buildPdfEvidence([
      page(1, [
        { str: '08/06', transform: [1, 0, 0, 1, 10, 90] },
        { str: 'STEAMGAMES.COM', transform: [1, 0, 0, 1, 100, 90] },
        { str: '$41.97', transform: [1, 0, 0, 1, 300, 90] },
      ]),
    ])

    const singleLineWindow = windows.find((w) => w.lines.length === 1)!
    expect(singleLineWindow.lines[0].items.map((i) => i.id)).toEqual(['p1-i0', 'p1-i1', 'p1-i2'])
  })

  it('collapses same-row columns into one line ordered by x, keeping raw text and coordinates', () => {
    const windows = buildPdfEvidence([
      page(1, [
        { str: '$41.97', transform: [1, 0, 0, 1, 300, 90] },
        { str: '08/06', transform: [1, 0, 0, 1, 10, 90] },
        { str: 'STEAMGAMES.COM', transform: [1, 0, 0, 1, 100, 90] },
      ]),
    ])

    const singleLineWindow = windows.find((w) => w.lines.length === 1)!
    expect(singleLineWindow.lines[0].text).toBe('08/06 STEAMGAMES.COM $41.97')
    expect(singleLineWindow.lines[0].items.map((i) => ({ text: i.text, x: i.x, y: i.y }))).toEqual([
      { text: '08/06', x: 10, y: 90 },
      { text: 'STEAMGAMES.COM', x: 100, y: 90 },
      { text: '$41.97', x: 300, y: 90 },
    ])
  })

  it('builds a multi-line window for a wrapped description without needing a date/amount shape', () => {
    const windows = buildPdfEvidence([
      page(1, [
        { str: '08/06', transform: [1, 0, 0, 1, 10, 90] },
        { str: '$41.97', transform: [1, 0, 0, 1, 300, 90] },
        { str: 'continued merchant description', transform: [1, 0, 0, 1, 10, 80] },
      ]),
    ])

    const wrapped = windows.find((w) => w.lines.length === 2)!
    expect(wrapped.lines.map((l) => l.text)).toEqual(['08/06 $41.97', 'continued merchant description'])
    expect(wrapped.extractorVersion).toBe(PDF_EVIDENCE_EXTRACTOR_VERSION)
  })

  it('keeps a repeated header line as its own window instead of discarding it', () => {
    const windows = buildPdfEvidence([
      page(1, [
        { str: 'Date', transform: [1, 0, 0, 1, 10, 100] },
        { str: 'Description', transform: [1, 0, 0, 1, 100, 100] },
        { str: 'Amount', transform: [1, 0, 0, 1, 300, 100] },
      ]),
    ])

    expect(windows.some((w) => w.lines.length === 1 && w.lines[0].text === 'Date Description Amount')).toBe(true)
  })

  it('never builds a window spanning a page boundary', () => {
    const windows = buildPdfEvidence([
      page(1, [{ str: 'last line on page 1', transform: [1, 0, 0, 1, 10, 10] }]),
      page(2, [{ str: 'first line on page 2', transform: [1, 0, 0, 1, 10, 100] }]),
    ])

    for (const w of windows) {
      expect(new Set(w.lines.map((l) => l.pageNumber)).size).toBe(1)
      expect(w.lines.every((l) => l.pageNumber === w.pageNumber)).toBe(true)
    }
  })

  it('never sends an account number line (or whatever shares its row, like the cardholder name) to Jev', () => {
    const windows = buildPdfEvidence([
      page(1, [
        { str: 'HUY CHUNG', transform: [1, 0, 0, 1, 10, 100] },
        { str: 'Account Number: XXXX XXXX XXXX 9993', transform: [1, 0, 0, 1, 120, 100] },
      ]),
    ])

    expect(windows).toHaveLength(0)
  })

  it('drops a bare masked card number even without an "Account Number" label', () => {
    const windows = buildPdfEvidence([page(1, [{ str: '**** **** **** 4242', transform: [1, 0, 0, 1, 10, 100] }])])

    expect(windows).toHaveLength(0)
  })

  it('drops a bare long digit run that looks like an unmasked account/card number', () => {
    const windows = buildPdfEvidence([page(1, [{ str: '4111111111111111', transform: [1, 0, 0, 1, 10, 100] }])])

    expect(windows).toHaveLength(0)
  })

  it('still keeps ordinary section headers that merely contain the word "account"', () => {
    const windows = buildPdfEvidence([page(1, [{ str: 'Account Summary', transform: [1, 0, 0, 1, 10, 100] }])])

    expect(windows.some((w) => w.lines[0]?.text === 'Account Summary')).toBe(true)
  })

  it('keeps real transaction rows on lines adjacent to a dropped account-number line', () => {
    const windows = buildPdfEvidence([
      page(1, [
        { str: 'Account Number: XXXX XXXX XXXX 9993', transform: [1, 0, 0, 1, 10, 100] },
        { str: '08/06', transform: [1, 0, 0, 1, 10, 90] },
        { str: 'STEAMGAMES.COM', transform: [1, 0, 0, 1, 100, 90] },
        { str: '$41.97', transform: [1, 0, 0, 1, 300, 90] },
      ]),
    ])

    expect(windows.some((w) => w.lines[0]?.text === '08/06 STEAMGAMES.COM $41.97')).toBe(true)
    expect(windows.every((w) => !w.lines.some((l) => l.text.includes('9993')))).toBe(true)
  })

  it('drops empty text items and collapses spacing, same as the deterministic parser', () => {
    const windows = buildPdfEvidence([
      page(1, [
        { str: '  Account  ', transform: [1, 0, 0, 1, 10, 20] },
        { str: '', transform: [1, 0, 0, 1, 50, 20] },
        { str: 'Summary', transform: [1, 0, 0, 1, 60, 20] },
      ]),
    ])

    const singleLineWindow = windows.find((w) => w.lines.length === 1)!
    expect(singleLineWindow.lines[0].text).toBe('Account Summary')
  })
})
