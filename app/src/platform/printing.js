/**
 * @module platform/printing
 * @description In the desktop app, the page as it prints saved straight to
 * a PDF where the writer says, rather than through the print dialog. See
 * `app/electron/src/printing.js`.
 */

import { desktop, isDesktop } from './desktop.js'

/**
 * Whether a PDF can be saved here without the print dialog: in the desktop
 * app, one new enough to.
 *
 * @returns {boolean}
 */
export const canSavePdf = () => isDesktop() && Boolean(desktop().pdf)

/**
 * Ask where, and save the page there as it prints.
 *
 * @param {string} name - The file's name to start with, without `.pdf`
 * @returns {Promise<boolean>} Whether it was saved; false when the writer
 *   cancelled
 * @throws {Error} Outside the desktop app, in one too old to, or when it
 *   couldn't be saved
 */
export function savePdf(name) {
  const pdf = canSavePdf() ? desktop().pdf : null
  if (!pdf) throw new Error('A PDF is saved this way only in the desktop app.')
  return pdf.save(name)
}
