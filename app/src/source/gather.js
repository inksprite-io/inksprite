/**
 * @module source/gather
 * @description A codebase's files, read and sorted into what comes in and
 * what is left out.
 *
 * Wherever the files come from — a folder chosen in the browser, an archive
 * from GitHub — they arrive here as entries: a path, a size, and a way to
 * read the bytes. What the rules or the name rule out is never read; what is
 * left is read, and kept only if it is text, but for a PDF, a book, a Word
 * file or a picture, which comes in whole (`isWholeFileName`). The caps are
 * checked as the files are counted, so a codebase too big to take stops
 * before anything is written rather than after.
 */

import { mimeOf } from '@/files/inspect.js'
import { createRules } from './rules.js'
import { isBinaryName, isWholeFileName } from './language.js'
import { textOf } from './text.js'

/** @typedef {import('@/files/batch.js').Gathered} Gathered */

/** Larger than this, a file of text is left out. */
export const MAX_FILE_BYTES = 512 * 1024

/** Larger than this, a file that comes in whole is left out. */
export const MAX_WHOLE_FILE_BYTES = 50 * 1024 * 1024

/** More files than this, and the import stops. */
export const MAX_FILES = 5000

/** More text than this, in bytes, and the import stops. */
export const MAX_TOTAL_BYTES = 40 * 1024 * 1024

/** More bytes of files that come in whole than this, and the import stops. */
export const MAX_WHOLE_BYTES = 200 * 1024 * 1024

/**
 * One file of a codebase, before it is read.
 *
 * @typedef {Object} SourceEntry
 * @property {string} path - From the codebase's top, `/` between folders
 * @property {number} size - Bytes
 * @property {() => Promise<Uint8Array>|Uint8Array} read
 */

/**
 * One file that came in: its text, or a file that comes in whole, its bytes,
 * whose text is read out of them when it is written.
 *
 * @typedef {Object} SourceFile
 * @property {string} path
 * @property {string} text - As it is, with `\n` line ends; '' for a file that comes in whole
 * @property {number} size - Bytes, as it came
 * @property {Uint8Array} [bytes] - A file that comes in whole: a PDF, a book, a Word file, a picture
 * @property {string} [mime] - Its media type, for one that comes in whole
 */

/**
 * What was left out, and why.
 *
 * @typedef {Object} LeftOut
 * @property {number} never - Version control, installed packages, secrets
 * @property {number} ignored - The default list or a `.gitignore`
 * @property {string[]} binary - Not text, and not a file that comes in whole
 * @property {string[]} large - Over MAX_FILE_BYTES, or MAX_WHOLE_FILE_BYTES for a file that comes in whole
 */

/**
 * @typedef {Object} GatheredSource
 * @property {SourceFile[]} files - In path order
 * @property {LeftOut} left
 * @property {number} bytes - The text's size in all
 * @property {number} wholeBytes - The size of the files that came in whole, in all
 */

/** @param {string} path */
const nameOf = path => path.slice(path.lastIndexOf('/') + 1)

/** @param {number} bytes */
const megabytes = bytes => (bytes / (1024 * 1024)).toFixed(1)

/** A codebase too big to take whole. */
export class SourceTooLargeError extends Error {
  /**
   * @param {number} files - How many files would have come in, at least
   * @param {number} bytes - Of text
   * @param {number} [wholeBytes] - Of the files that would have come in whole
   */
  constructor(files, bytes, wholeBytes = 0) {
    const over =
      wholeBytes > MAX_WHOLE_BYTES && files <= MAX_FILES && bytes <= MAX_TOTAL_BYTES
        ? `${megabytes(wholeBytes)} MB of PDFs, documents and pictures, over the limit of ${MAX_WHOLE_BYTES / (1024 * 1024)} MB`
        : `at least ${files.toLocaleString('en-US')} files and ${megabytes(bytes)} MB of text, ` +
          `over the limit of ${MAX_FILES.toLocaleString('en-US')} files or ${MAX_TOTAL_BYTES / (1024 * 1024)} MB`
    super(`More than this can take: ${over}. Import one of its folders instead.`)
    this.name = 'SourceTooLargeError'
  }
}

/**
 * The files a codebase's rules let in, sizes and all, without reading them.
 * `.gitignore` files are read first, since they decide the rest.
 *
 * @param {SourceEntry[]} entries
 * @param {Object} [options]
 * @param {import('./rules.js').Rules} [options.rules]
 * @param {boolean} [options.gitignores] - Whether to read and apply the
 *   codebase's `.gitignore` files; default true
 * @returns {Promise<{kept: SourceEntry[], left: LeftOut}>}
 */
export async function sortEntries(entries, { rules = createRules(), gitignores = true } = {}) {
  /** @type {LeftOut} */
  const left = { never: 0, ignored: 0, binary: [], large: [] }

  const found = gitignores
    ? entries
        .filter(entry => entry.path === '.gitignore' || entry.path.endsWith('/.gitignore'))
        .sort((a, b) => a.path.length - b.path.length)
    : []
  for (const entry of found) {
    if (rules.check(entry.path)) continue
    const text = textOf(await entry.read())
    if (text !== null) rules.addGitignore(entry.path.slice(0, -'/.gitignore'.length), text)
  }

  /** @type {SourceEntry[]} */
  const kept = []
  for (const entry of entries) {
    const by = rules.check(entry.path)
    const name = nameOf(entry.path)
    const limit = isWholeFileName(name) ? MAX_WHOLE_FILE_BYTES : MAX_FILE_BYTES
    if (by === 'never') left.never++
    else if (by === 'ignored') left.ignored++
    else if (isBinaryName(name) && !isWholeFileName(name)) left.binary.push(entry.path)
    else if (entry.size > limit) left.large.push(entry.path)
    else kept.push(entry)
  }
  return { kept, left }
}

/**
 * Read a codebase's entries and keep the text.
 *
 * @param {SourceEntry[]} entries
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {(done: number, total: number) => void} [options.onProgress]
 * @param {boolean} [options.gitignores] - See `sortEntries`
 * @param {(kept: SourceEntry[]) => void|Promise<void>} [options.prepare] - Told
 *   what will be read, before any of it is: for a source that reads better
 *   all at once, such as an archive
 * @returns {Promise<GatheredSource>}
 * @throws {SourceTooLargeError} Before reading anything, when the files
 *   let in are over a cap
 */
export async function gatherSource(entries, { signal, onProgress, gitignores, prepare } = {}) {
  const { kept, left } = await sortEntries(entries, { gitignores })
  const sizeOf = (/** @type {boolean} */ whole) =>
    kept
      .filter(entry => isWholeFileName(nameOf(entry.path)) === whole)
      .reduce((sum, entry) => sum + entry.size, 0)
  const total = sizeOf(false)
  const wholeTotal = sizeOf(true)
  if (kept.length > MAX_FILES || total > MAX_TOTAL_BYTES || wholeTotal > MAX_WHOLE_BYTES) {
    throw new SourceTooLargeError(kept.length, total, wholeTotal)
  }
  await prepare?.(kept)

  /** @type {SourceFile[]} */
  const files = []
  let bytes = 0
  let wholeBytes = 0
  for (const [at, entry] of kept.entries()) {
    signal?.throwIfAborted()
    const read = await entry.read()
    const name = nameOf(entry.path)
    if (isWholeFileName(name)) {
      files.push({ path: entry.path, text: '', size: entry.size, bytes: read, mime: mimeOf(name) })
      wholeBytes += entry.size
    } else {
      const text = textOf(read)
      if (text === null) left.binary.push(entry.path)
      else {
        files.push({ path: entry.path, text, size: entry.size })
        bytes += entry.size
      }
    }
    onProgress?.(at + 1, kept.length)
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { files, left, bytes, wholeBytes }
}

/**
 * The entries of a folder chosen or dropped whole: every file under it, by
 * the path below the folder, and the folder's name.
 *
 * @param {Gathered[]} listed - As `files/batch.js` lists them, dotfiles and all
 * @returns {{name: string, entries: SourceEntry[]}}
 */
export function entriesOfFolder(listed) {
  const name = listed.find(({ folders }) => folders.length > 0)?.folders[0] || 'Repository'
  const entries = listed.map(({ file, folders }) => ({
    path: [...folders.slice(1), file.name].join('/'),
    size: file.size,
    read: async () => new Uint8Array(await file.arrayBuffer()),
  }))
  return { name, entries }
}
