'use client'

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import ExcelJS from 'exceljs'

// Drop a logo at public/logo.png to brand the exports — both formats fetch it
// at export time and silently omit the logo (falling back to a text-only
// header) if the file isn't there yet, so exports work before it's added.
const LOGO_PATH = '/logo.png'

export interface ExportInvRow {
  component: string
  qty: number
}

export interface ExportDiscrepancyRow {
  component: string
  expected: number
  counted: number
  difference: number
}

export interface ExportDiscrepancySession {
  session_id: number
  finished_at: string | null
  rows: ExportDiscrepancyRow[]
}

export interface ExportBorrowRow {
  component: string
  qty: number
  borrower: string
  taken_at: string
  due_at: string
  returned_at: string | null
}

export interface ExportLedgerRow {
  reason: string
  delta: number
  created_at: string
  running_balance: number
}

export interface ReportData {
  inventory: ExportInvRow[]
  discSessions: ExportDiscrepancySession[]
  borrows: ExportBorrowRow[]
  ledger?: { component: string; rows: ExportLedgerRow[] }
}

interface JsPDFWithAutoTable extends jsPDF {
  lastAutoTable: { finalY: number }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// jsPDF's built-in fonts (Helvetica/Times/Courier) only cover WinAnsi/Latin-1
// glyphs — component names with electronics symbols like Ω or µ render as
// garbled boxes/mis-kerned text instead of throwing, so they must be
// transliterated before reaching any PDF text/table call. Excel doesn't need
// this: it renders text with the OS/Excel font, which handles Unicode fine.
const PDF_UNSAFE_CHARS: Record<string, string> = {
  'Ω': 'ohm',
  'µ': 'u',
  'μ': 'u',
  '°': 'deg',
}

function pdfSafe(text: string): string {
  return text.replace(/[Ωµμ°]/g, ch => PDF_UNSAFE_CHARS[ch] ?? ch)
}

async function loadLogoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch(LOGO_PATH)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function timestampSuffix(): string {
  return new Date().toISOString().slice(0, 10)
}

// ── PDF ──────────────────────────────────────────────────────────────────────

export async function exportReportsPdf(data: ReportData): Promise<void> {
  const doc = new jsPDF() as JsPDFWithAutoTable
  const logo = await loadLogoDataUrl()
  const pageHeight = doc.internal.pageSize.getHeight()
  const textX = logo ? 44 : 14

  if (logo) {
    doc.addImage(logo, 'PNG', 14, 10, 24, 24)
  }
  doc.setFontSize(16)
  doc.text('DeskStock Report', textX, 20)
  doc.setFontSize(10)
  doc.setTextColor(120)
  doc.text(`Generated ${new Date().toLocaleString()}`, textX, 26)
  doc.setTextColor(0)

  let cursorY = logo ? 42 : 34

  function ensureSpace(needed: number): void {
    if (cursorY + needed > pageHeight - 15) {
      doc.addPage()
      cursorY = 20
    }
  }

  function sectionHeading(title: string): void {
    ensureSpace(14)
    doc.setFontSize(12)
    doc.setTextColor(0)
    doc.text(title, 14, cursorY)
    cursorY += 4
  }

  sectionHeading('Current Inventory')
  autoTable(doc, {
    startY: cursorY,
    head: [['Component', 'Qty']],
    body: data.inventory.map(r => [pdfSafe(r.component), String(r.qty)]),
    theme: 'striped',
    headStyles: { fillColor: [16, 129, 92] },
    margin: { bottom: 15 },
  })
  cursorY = doc.lastAutoTable.finalY + 10

  ensureSpace(10)
  sectionHeading('Discrepancy Report')
  if (data.discSessions.length === 0) {
    doc.setFontSize(9)
    doc.setTextColor(140)
    doc.text('No discrepancies recorded across any reconciled session.', 14, cursorY)
    doc.setTextColor(0)
    cursorY += 10
  } else {
    for (const session of data.discSessions) {
      ensureSpace(10)
      doc.setFontSize(9)
      doc.setTextColor(140)
      doc.text(`Session #${session.session_id} — finished ${fmtDate(session.finished_at)}`, 14, cursorY)
      doc.setTextColor(0)
      cursorY += 4
      autoTable(doc, {
        startY: cursorY,
        head: [['Component', 'Expected', 'Counted', 'Difference']],
        body: session.rows.map(r => [pdfSafe(r.component), String(r.expected), String(r.counted), String(r.difference)]),
        theme: 'striped',
        headStyles: { fillColor: [16, 129, 92] },
        margin: { bottom: 15 },
      })
      cursorY = doc.lastAutoTable.finalY + 8
    }
  }

  ensureSpace(10)
  sectionHeading('Borrow History')
  autoTable(doc, {
    startY: cursorY,
    head: [['Component', 'Qty', 'Borrower', 'Taken', 'Due', 'Returned']],
    body: data.borrows.map(b => [
      pdfSafe(b.component),
      String(b.qty),
      pdfSafe(b.borrower),
      fmtDate(b.taken_at),
      fmtDate(b.due_at),
      b.returned_at ? fmtDate(b.returned_at) : 'Outstanding',
    ]),
    theme: 'striped',
    headStyles: { fillColor: [16, 129, 92] },
    margin: { bottom: 15 },
  })
  cursorY = doc.lastAutoTable.finalY + 10

  if (data.ledger) {
    ensureSpace(10)
    sectionHeading(`Ledger Trail — ${pdfSafe(data.ledger.component)}`)
    autoTable(doc, {
      startY: cursorY,
      head: [['Date', 'Reason', 'Delta', 'Balance']],
      body: data.ledger.rows.map(r => [
        new Date(r.created_at).toLocaleString(),
        r.reason,
        (r.delta >= 0 ? '+' : '') + r.delta,
        String(r.running_balance),
      ]),
      theme: 'striped',
      headStyles: { fillColor: [16, 129, 92] },
      margin: { bottom: 15 },
    })
  }

  doc.save(`deskstock-report-${timestampSuffix()}.pdf`)
}

// ── Excel ────────────────────────────────────────────────────────────────────

function addLogoAndTitle(
  sheet: ExcelJS.Worksheet,
  title: string,
  logoImageId: number | null,
): void {
  if (logoImageId !== null) {
    sheet.addImage(logoImageId, { tl: { col: 0, row: 0 }, ext: { width: 60, height: 60 } })
  }
  sheet.getCell('C1').value = 'DeskStock'
  sheet.getCell('C1').font = { size: 16, bold: true }
  sheet.getCell('C2').value = title
  sheet.getCell('C2').font = { size: 12, color: { argb: 'FF6B7280' } }
  sheet.getCell('C3').value = `Generated ${new Date().toLocaleString()}`
  sheet.getCell('C3').font = { size: 9, color: { argb: 'FF9CA3AF' } }
  sheet.addRow([])
  sheet.addRow([])
  sheet.addRow([])
  sheet.addRow([])
}

export async function exportReportsExcel(data: ReportData): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'DeskStock'
  workbook.created = new Date()

  const logoDataUrl = await loadLogoDataUrl()
  const logoImageId = logoDataUrl
    ? workbook.addImage({ base64: logoDataUrl.split(',')[1], extension: 'png' })
    : null

  const invSheet = workbook.addWorksheet('Inventory')
  addLogoAndTitle(invSheet, 'Current Inventory', logoImageId)
  invSheet.addRow(['Component', 'Qty']).font = { bold: true }
  data.inventory.forEach(r => invSheet.addRow([r.component, r.qty]))
  invSheet.columns = [{ width: 28 }, { width: 12 }]

  const discSheet = workbook.addWorksheet('Discrepancies')
  addLogoAndTitle(discSheet, 'Discrepancy Report', logoImageId)
  discSheet.addRow(['Session', 'Finished', 'Component', 'Expected', 'Counted', 'Difference']).font = { bold: true }
  data.discSessions.forEach(s => {
    s.rows.forEach(r => {
      discSheet.addRow([s.session_id, fmtDate(s.finished_at), r.component, r.expected, r.counted, r.difference])
    })
  })
  discSheet.columns = [{ width: 10 }, { width: 14 }, { width: 24 }, { width: 12 }, { width: 12 }, { width: 12 }]

  const borrowSheet = workbook.addWorksheet('Borrows')
  addLogoAndTitle(borrowSheet, 'Borrow History', logoImageId)
  borrowSheet.addRow(['Component', 'Qty', 'Borrower', 'Taken', 'Due', 'Returned']).font = { bold: true }
  data.borrows.forEach(b => {
    borrowSheet.addRow([
      b.component,
      b.qty,
      b.borrower,
      fmtDate(b.taken_at),
      fmtDate(b.due_at),
      b.returned_at ? fmtDate(b.returned_at) : 'Outstanding',
    ])
  })
  borrowSheet.columns = [{ width: 24 }, { width: 8 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 14 }]

  if (data.ledger) {
    const ledgerSheet = workbook.addWorksheet('Ledger')
    addLogoAndTitle(ledgerSheet, `Ledger Trail — ${data.ledger.component}`, logoImageId)
    ledgerSheet.addRow(['Date', 'Reason', 'Delta', 'Balance']).font = { bold: true }
    data.ledger.rows.forEach(r => {
      ledgerSheet.addRow([new Date(r.created_at).toLocaleString(), r.reason, r.delta, r.running_balance])
    })
    ledgerSheet.columns = [{ width: 20 }, { width: 14 }, { width: 10 }, { width: 10 }]
  }

  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `deskstock-report-${timestampSuffix()}.xlsx`,
  )
}
