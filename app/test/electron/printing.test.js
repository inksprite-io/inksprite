// @vitest-environment node
/* global TextEncoder */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, dialog } from 'electron'
import { paperFor, savePdf } from '../../electron/src/printing.js'

/** A folder of its own for each test, where the writer saves the PDF. */
let dir

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'inksprite-pdf-'))
  dialog.showSaveDialog.mockReset()
  app.getLocaleCountryCode.mockReturnValue('US')
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** The page, which prints as a few bytes of PDF. */
const page = () => ({ printToPDF: vi.fn(async () => new TextEncoder().encode('%PDF-1.7')) })

describe('paperFor', () => {
  it('is Letter where that is the paper sold, and A4 elsewhere', () => {
    expect(paperFor('US')).toBe('Letter')
    expect(paperFor('ca')).toBe('Letter')
    expect(paperFor('GB')).toBe('A4')
    expect(paperFor('')).toBe('A4')
  })
})

describe('savePdf', () => {
  it('asks where, starting from the document’s name, and prints nothing when cancelled', async () => {
    const printed = page()
    dialog.showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })
    expect(await savePdf(printed, null, 'The Thief')).toBe(false)
    expect(dialog.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'The Thief.pdf' })
    )
    expect(printed.printToPDF).not.toHaveBeenCalled()
  })

  it('saves the page as it prints, on the region’s paper, where the writer chose', async () => {
    const printed = page()
    const to = path.join(dir, 'thief.pdf')
    dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: to })
    expect(await savePdf(printed, null, 'The Thief')).toBe(true)
    expect(printed.printToPDF).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 'Letter', generateDocumentOutline: true })
    )
    expect(await fs.readFile(to, 'utf8')).toBe('%PDF-1.7')
  })

  it('starts from a name, never a path', async () => {
    dialog.showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })
    await savePdf(page(), null, '../../etc/passwd')
    expect(dialog.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'passwd.pdf' })
    )
  })
})
