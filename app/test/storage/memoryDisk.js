/**
 * A folder of files in memory, for trying plans on. Stricter than a disk: a
 * move onto anything that is there, a write over a folder, and a move or a
 * trash of what is not there all throw, where a disk might quietly replace
 * a file. Case-insensitive like a Mac's or a Windows disk when asked.
 *
 * Folders are only where files are, as in git: one holding nothing is not
 * there.
 */

/** @typedef {import('@/storage/plan.js').Op} Op */

/**
 * @param {{caseInsensitive?: boolean}} [options]
 */
export function memoryDisk({ caseInsensitive = false } = {}) {
  /** @type {Map<string, string>} */
  const files = new Map()
  /** @type {string[]} */
  const trashed = []

  const key = (/** @type {string} */ path) =>
    caseInsensitive ? path.normalize('NFC').toLowerCase() : path
  const findFile = (/** @type {string} */ path) => {
    for (const actual of files.keys()) if (key(actual) === key(path)) return actual
    return null
  }
  const isFolder = (/** @type {string} */ path) =>
    [...files.keys()].some(actual => key(actual).startsWith(`${key(path)}/`))
  const exists = (/** @type {string} */ path) => findFile(path) !== null || isFolder(path)
  const ancestors = (/** @type {string} */ path) => {
    const parts = path.split('/')
    return parts.slice(0, -1).map((_, at) => parts.slice(0, at + 1).join('/'))
  }
  const noFileAbove = (/** @type {string} */ path) => {
    for (const above of ancestors(path)) {
      if (findFile(above)) throw new Error(`A file is where a folder is wanted: ${above}`)
    }
  }

  const disk = {
    files,
    trashed,

    /** @param {string} path @param {string} text */
    write(path, text) {
      if (isFolder(path)) throw new Error(`A folder is where a file is wanted: ${path}`)
      noFileAbove(path)
      const actual = findFile(path)
      if (actual) files.delete(actual)
      files.set(path, text)
    },

    /** @param {string} from @param {string} to */
    move(from, to) {
      if (!exists(from)) throw new Error(`Nothing to move at ${from}`)
      if (exists(to) && key(to) !== key(from)) throw new Error(`Something is already at ${to}`)
      if (key(to).startsWith(`${key(from)}/`)) throw new Error(`${from} cannot go into itself`)
      noFileAbove(to)
      for (const [actual, text] of [...files]) {
        const k = key(actual)
        if (k === key(from)) {
          files.delete(actual)
          files.set(to, text)
        } else if (k.startsWith(`${key(from)}/`)) {
          files.delete(actual)
          files.set(to + actual.slice(from.length), text)
        }
      }
    },

    /** @param {string} path */
    trash(path) {
      if (!exists(path)) throw new Error(`Nothing to trash at ${path}`)
      for (const actual of [...files.keys()]) {
        const k = key(actual)
        if (k === key(path) || k.startsWith(`${key(path)}/`)) files.delete(actual)
      }
      trashed.push(path)
    },

    /** @param {Op[]} ops */
    apply(ops) {
      for (const op of ops) {
        if (op.op === 'move') disk.move(op.from, op.to)
        else if (op.op === 'trash') disk.trash(op.path)
        else disk.write(op.path, op.text)
      }
    },

    /** @returns {string[]} */
    list: () => [...files.keys()].sort(),

    /** @param {string} path */
    read: path => {
      const actual = findFile(path)
      return actual === null ? undefined : files.get(actual)
    },
  }
  return disk
}
