/**
 * A project or a folder exported to a folder of the writer's
 * (`src/files/exportDocument.js` in the page says what is in it): a
 * repository's docs, written straight into the checkout.
 *
 * The page asks where first, with a save dialog, and then hands over what
 * to write there. Only a place the writer chose is written to, once. A
 * folder already there under that name goes to the system's trash first, so
 * what was deleted since an export before doesn't stay behind; the dialog
 * has asked whether to replace it. The export's own top folder is the one
 * chosen, under whatever name the writer gave it, and an imported file is
 * copied from where it is in the library rather than sent over.
 */

import { dialog, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * What the page hands over: a directory, a text, a file's bytes, or a file
 * in the library to copy, by its path in the export, the export's own folder
 * first in it.
 *
 * @typedef {{path: string, folder: true}
 *   | {path: string, text: string}
 *   | {path: string, bytes: Uint8Array}
 *   | {path: string, file: string}} ExportEntry
 */

/**
 * The exports to folders of one app: where each window's writer chose.
 */
export function exportFolders() {
  /** The places chosen and not written yet. @type {Set<string>} */
  const chosen = new Set()

  return {
    /**
     * Ask where to put an export.
     *
     * @param {Electron.BrowserWindow|null} window - The dialog's
     * @param {string} name - The folder's name to start with
     * @returns {Promise<string|null>} Where, or null when the writer cancelled
     */
    async choose(window, name) {
      const options = {
        defaultPath: name,
        buttonLabel: 'Export',
        /** @type {Array<'createDirectory'|'showOverwriteConfirmation'>} */
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      }
      const { canceled, filePath } = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options)
      if (canceled || !filePath) return null
      chosen.add(filePath)
      return filePath
    },

    /**
     * Write an export where the writer chose, in place of what is there.
     *
     * @param {string} target - As `choose` gave it
     * @param {ExportEntry[]} entries
     * @param {(file: string) => Promise<{path: string}|null>} locate - Where a
     *   file in the library is on this disk
     * @returns {Promise<void>}
     * @throws {Error} For a place not chosen, a path that would lead out of
     *   it, or a file the library doesn't have
     */
    async write(target, entries, locate) {
      if (!chosen.delete(target)) throw new Error('That folder wasn’t chosen to export to.')
      const there = await fs.lstat(target).catch(() => null)
      if (there) await shell.trashItem(target)
      await fs.mkdir(target, { recursive: true })
      for (const entry of entries) {
        const to = below(target, entry.path)
        if ('folder' in entry) {
          await fs.mkdir(to, { recursive: true })
          continue
        }
        await fs.mkdir(path.dirname(to), { recursive: true })
        if ('text' in entry) await fs.writeFile(to, entry.text, 'utf8')
        else if ('bytes' in entry) await fs.writeFile(to, entry.bytes)
        else {
          const found = await locate(entry.file)
          if (!found) throw new Error(`${path.basename(to)} isn’t in the library.`)
          await fs.copyFile(found.path, to)
        }
      }
    },
  }
}

/**
 * Where a path of the export goes in the folder chosen, its first part, the
 * export's own folder, being that folder. Refused if it would lead anywhere
 * else: empty parts, `.` or `..`, and, on Windows, what would name a drive
 * or a stream.
 *
 * @param {string} target
 * @param {string} relative
 * @returns {string}
 */
function below(target, relative) {
  const parts = typeof relative === 'string' ? relative.split('/') : []
  const bad = process.platform === 'win32' ? /[\\:\0]/ : /\0/
  if (
    parts.length === 0 ||
    parts.some(part => !part || part === '.' || part === '..' || bad.test(part))
  ) {
    throw new Error(`Not a path in the export: ${relative}`)
  }
  return path.join(target, ...parts.slice(1))
}
