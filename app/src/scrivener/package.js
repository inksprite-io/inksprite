/* global Blob */
/**
 * @module scrivener/package
 * @description A Scrivener project's files, by their path inside it, from a
 * folder or a zip.
 *
 * A project is a folder named `<name>.scriv`, which a Mac shows as one file.
 * It comes in dropped, as a folder with its files listed, or zipped: by
 * Finder's Compress, by Scrivener's backups, or by the browser. Chrome and
 * Electron zip a package chosen in a file chooser, as a Mac shows it, and hand
 * it over as `<name>.scriv.zip`. Either way what the import gets is the same:
 * the project's name, and its files by their path under the `.scriv`, the
 * binder (`<name>.scrivx`) among them at the top.
 *
 * A zip is listed before anything in it is unpacked, so asking whether one
 * holds a project costs only its directory, and only the project's own files
 * are unpacked: not the `__MACOSX` folder Finder adds, nor anything beside the
 * project.
 */

import { unzipSync } from 'fflate'
import { folderOf } from '@/files/batch.js'

/**
 * @typedef {Object} ScrivenerPackage
 * @property {string} name - The project's: its `.scriv` folder's name without
 *   the extension
 * @property {Map<string, Blob>} files - Every file in it, by its path inside
 *   it, `/`-separated
 */

/** The binder's file. */
const SCRIVX = /\.scrivx$/i

/**
 * Whether a file is a zip, by its name or its type.
 *
 * @param {File} file
 * @returns {boolean}
 */
export const isZip = file =>
  /\.zip$/i.test(file.name) ||
  file.type === 'application/zip' ||
  file.type === 'application/x-zip-compressed'

/**
 * Whether a file chosen may hold a project: a zip, or a `.scriv` as a browser
 * that does not zip a package might hand one over.
 *
 * @param {File} file
 * @returns {boolean}
 */
export const mayHoldProject = file => isZip(file) || /\.scriv$/i.test(file.name)

/**
 * A project's name from the folder it is in, or from its binder's file when it
 * is in none.
 *
 * @param {string} folder - Empty when the binder is at the top
 * @param {string} binder - The `.scrivx` file's name
 * @returns {string}
 */
const nameOf = (folder, binder) =>
  (folder ? folder.replace(/\.scriv$/i, '') : binder.replace(SCRIVX, '')) || 'Untitled'

/**
 * The project in a folder chosen or dropped whole, when it is one: a single
 * folder with a binder at its top.
 *
 * @param {import('@/files/batch.js').Gathered[]} listed
 * @returns {ScrivenerPackage|null}
 */
export function packageOfFolder(listed) {
  const folder = folderOf(listed)
  if (!folder) return null
  const binder = listed.find(({ file, folders }) => folders.length === 1 && SCRIVX.test(file.name))
  if (!binder) return null
  return {
    name: nameOf(folder, binder.file.name),
    files: new Map(
      listed.map(({ file, folders }) => [[...folders.slice(1), file.name].join('/'), file])
    ),
  }
}

/**
 * The project in a zip, when there is one. The binder nearest the top is the
 * project's; Finder's `__MACOSX` copies are not.
 *
 * @param {Blob} zip
 * @returns {Promise<ScrivenerPackage|null>}
 */
export async function packageOfZip(zip) {
  // A package the browser handed over as the folder it is cannot be read as a
  // file.
  const buffer = await zip.arrayBuffer().catch(() => null)
  if (!buffer) return null
  const bytes = new Uint8Array(buffer)
  /** @type {string|null} */
  let binder = null
  try {
    unzipSync(bytes, {
      filter: entry => {
        const { name } = entry
        if (SCRIVX.test(name) && !name.startsWith('__MACOSX/')) {
          if (binder === null || depthOf(name) < depthOf(binder)) binder = name
        }
        return false
      },
    })
  } catch {
    // Not a zip that can be read, so not a project.
    return null
  }
  if (binder === null) return null

  const found = /** @type {string} */ (binder)
  const slash = found.lastIndexOf('/')
  const prefix = found.slice(0, slash + 1)
  const unpacked = unzipSync(bytes, {
    filter: entry =>
      entry.name.startsWith(prefix) &&
      !entry.name.startsWith('__MACOSX/') &&
      !entry.name.endsWith('/'),
  })
  /** @type {Map<string, Blob>} */
  const files = new Map()
  for (const [path, data] of Object.entries(unpacked)) {
    files.set(path.slice(prefix.length), new Blob([data]))
  }
  const folder = prefix.slice(0, -1).split('/').at(-1) ?? ''
  return { name: nameOf(folder, found.slice(slash + 1)), files }
}

/** @param {string} path */
const depthOf = path => path.split('/').length
