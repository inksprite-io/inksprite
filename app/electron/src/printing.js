/**
 * The page as it prints, saved as a PDF where the writer says: a document
 * the page has put in the app's place to print (`src/composables/usePrint.js`
 * in the page), without the print dialog.
 *
 * The paper is the region's, Letter where that is what is sold and A4
 * elsewhere, and the margins are the page's own (`@page` in `style.css`).
 * Its headings are the PDF's outline, which a reader shows beside it.
 */

import { app, dialog } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

/** The regions whose paper is Letter, by the system's country code. */
const LETTER = new Set(['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'CR', 'GT', 'PA', 'DO', 'PR'])

/**
 * The paper for a region.
 *
 * @param {string} country - Its two-letter code, or '' for none known
 * @returns {'Letter'|'A4'}
 */
export const paperFor = country => (LETTER.has(country.toUpperCase()) ? 'Letter' : 'A4')

/**
 * Ask where to save a PDF, and save the page there as it prints.
 *
 * @param {Electron.WebContents} page
 * @param {Electron.BrowserWindow|null} window - The dialog's
 * @param {string} name - The file's name to start with, without `.pdf`
 * @returns {Promise<boolean>} Whether it was saved; false when the writer
 *   cancelled
 */
export async function savePdf(page, window, name) {
  const options = {
    defaultPath: `${path.basename(String(name)) || 'Untitled'}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  }
  const { canceled, filePath } = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (canceled || !filePath) return false
  const pdf = await page.printToPDF({
    pageSize: paperFor(app.getLocaleCountryCode()),
    generateTaggedPDF: true,
    generateDocumentOutline: true,
  })
  await fs.writeFile(filePath, pdf)
  return true
}
