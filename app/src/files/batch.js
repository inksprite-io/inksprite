/**
 * @module files/batch
 * @description Many files at once, each with the folders it came in.
 *
 * A file chooser set to take a folder hands over every file under it with a
 * `webkitRelativePath`; a drop from the desktop hands over `DataTransfer`
 * items, and a dropped folder is an entry to walk. Both come out of here the
 * same way: a list of files, each with the folders above it, relative to
 * whatever was chosen or dropped, so the importer can make the same folders
 * in the tree.
 */

/**
 * A file to import, and where under the chosen root it was.
 *
 * @typedef {Object} Gathered
 * @property {File} file
 * @property {string[]} folders - The folders above it, outermost first; empty
 *   for a file chosen or dropped on its own
 */

/**
 * What a file system leaves lying around that nobody meant to import.
 * @param {string} name
 * @returns {boolean}
 */
export function isJunk(name) {
  return name.startsWith('.') || name === 'Thumbs.db' || name === 'desktop.ini'
}

/**
 * The files a chooser handed over, folders and all.
 *
 * A chooser set to take a folder gives each file its path under the folder
 * chosen, folder's own name first, and that name is kept: importing a folder
 * called `papers` makes a folder called `papers`. A chooser set to take files
 * gives no paths, and each file lands where it was asked for.
 *
 * @param {ArrayLike<File>} files
 * @returns {Gathered[]}
 */
export function gatherFiles(files) {
  /** @type {Gathered[]} */
  const out = []
  for (const file of Array.from(files)) {
    if (isJunk(file.name)) continue
    const path = /** @type {any} */ (file).webkitRelativePath || ''
    const folders = path.split('/').slice(0, -1).filter(Boolean)
    if (folders.some(isJunk)) continue
    out.push({ file, folders })
  }
  return out
}

/**
 * The files dropped from the desktop, folders walked.
 *
 * Where the browser gives file-system entries, a dropped folder is read to
 * the bottom. Where it gives only files — an older browser, a test — those
 * are taken as they are, at the top.
 *
 * @param {DataTransfer} transfer
 * @returns {Promise<Gathered[]>}
 */
export async function gatherDropped(transfer) {
  /** @type {Gathered[]} */
  const out = []
  const items = Array.from(transfer.items || [])
  /** @type {any[]} */
  const entries = items
    .filter(item => item.kind === 'file')
    .map(item => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))

  if (entries.length > 0 && entries.every(Boolean)) {
    for (const entry of entries) await walk(entry, [], out)
    return out
  }
  for (const file of Array.from(transfer.files || [])) {
    if (!isJunk(file.name)) out.push({ file, folders: [] })
  }
  return out
}

/**
 * Whether a drag carries files from outside the page, as opposed to a
 * document being moved within the tree.
 *
 * @param {DataTransfer|null} transfer
 * @returns {boolean}
 */
export function carriesFiles(transfer) {
  return !!transfer && Array.from(transfer.types || []).includes('Files')
}

/**
 * @param {any} entry - A FileSystemEntry
 * @param {string[]} folders
 * @param {Gathered[]} out
 */
async function walk(entry, folders, out) {
  if (isJunk(entry.name)) return
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject))
    out.push({ file, folders })
    return
  }
  if (!entry.isDirectory) return
  const reader = entry.createReader()
  const below = [...folders, entry.name]
  // readEntries hands back a batch at a time and an empty one at the end.
  for (;;) {
    /** @type {any[]} */
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) break
    for (const child of batch) await walk(child, below, out)
  }
}
