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
 *
 * Listing keeps everything, dotfiles included, since a codebase's
 * `.gitignore` files say what to leave out of it. Gathering for the ordinary
 * import then drops what nobody meant to import (`withoutJunk`).
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
export function listFiles(files) {
  return Array.from(files).map(file => {
    const path = /** @type {any} */ (file).webkitRelativePath || ''
    return { file, folders: path.split('/').slice(0, -1).filter(Boolean) }
  })
}

/**
 * What was listed, less the files nobody meant to import: dotfiles, the
 * system's own litter, and anything in a dot-folder.
 *
 * @param {Gathered[]} listed
 * @returns {Gathered[]}
 */
export function withoutJunk(listed) {
  return listed.filter(({ file, folders }) => !isJunk(file.name) && !folders.some(isJunk))
}

/**
 * The files a chooser handed over, for the ordinary import.
 *
 * @param {ArrayLike<File>} files
 * @returns {Gathered[]}
 */
export const gatherFiles = files => withoutJunk(listFiles(files))

/**
 * The one folder everything listed is in, when it is: a folder chosen whole,
 * or dropped on its own.
 *
 * @param {Gathered[]} listed
 * @returns {string|null} Its name
 */
export function folderOf(listed) {
  const top = listed[0]?.folders[0]
  return top && listed.every(({ folders }) => folders[0] === top) ? top : null
}

/**
 * The files dropped from the desktop, folders walked.
 *
 * Where the browser gives file-system entries, a dropped folder is read to
 * the bottom. Where it gives only files — an older browser, a test — those
 * are taken as they are, at the top. Dotfiles are listed; dot-folders, such
 * as `.git`, are not walked.
 *
 * @param {DataTransfer} transfer
 * @returns {Promise<Gathered[]>}
 */
export async function listDropped(transfer) {
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
  return Array.from(transfer.files || []).map(file => ({ file, folders: [] }))
}

/**
 * The files dropped from the desktop, for the ordinary import.
 *
 * @param {DataTransfer} transfer
 * @returns {Promise<Gathered[]>}
 */
export const gatherDropped = async transfer => withoutJunk(await listDropped(transfer))

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
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject))
    out.push({ file, folders })
    return
  }
  if (!entry.isDirectory || isJunk(entry.name)) return
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
