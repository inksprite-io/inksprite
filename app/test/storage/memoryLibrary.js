/* global TextEncoder */

/**
 * A library in memory, doing what `electron/src/library.js` does on a disk:
 * a write expects the file as it was seen and trashes one that is not, an
 * append refuses a file not the length expected, a move trashes what is in
 * its way, and nothing is deleted outright but narration audio. Every write moves a clock on, so
 * a file written again is not as it was seen.
 */

/** @typedef {import('@/storage/library.js').LibraryDisk} LibraryDisk */
/** @typedef {import('@/storage/library.js').LibraryOp} LibraryOp */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function memoryLibrary() {
  /** @type {Map<string, {bytes: Uint8Array, mtime: number}>} */
  const files = new Map()
  /** @type {string[]} */
  const trashed = []
  /** @type {Array<{path: string, files: Map<string, Uint8Array>}>} */
  const trash = []
  let clock = 1

  const below = (/** @type {string} */ path) =>
    [...files.keys()].filter(file => file === path || file.startsWith(`${path}/`))
  const exists = (/** @type {string} */ path) => below(path).length > 0
  const seenOf = (/** @type {string} */ path) => {
    const file = files.get(path)
    return file ? { mtime: file.mtime, size: file.bytes.length } : null
  }
  const takeAway = (/** @type {string} */ path) => {
    const kept = new Map()
    for (const file of below(path)) {
      kept.set(file, /** @type {any} */ (files.get(file)).bytes)
      files.delete(file)
    }
    trash.push({ path, files: kept })
    trashed.push(path)
  }

  /** Write behind the library's back, as another editor would. */
  const outside = {
    /** @param {string} path @param {string} text */
    write(path, text) {
      files.set(path, { bytes: encoder.encode(text), mtime: clock++ })
    },
    /** @param {string} path */
    read: path => {
      const file = files.get(path)
      return file ? decoder.decode(file.bytes) : undefined
    },
    /** @param {string} from @param {string} to */
    move(from, to) {
      for (const file of below(from)) {
        const kept = /** @type {any} */ (files.get(file))
        files.delete(file)
        files.set(to + file.slice(from.length), kept)
      }
    },
    list: () => [...files.keys()].sort(),
  }

  /** @type {LibraryDisk} */
  const disk = {
    async projects() {
      const tops = new Set([...files.keys()].map(path => path.split('/')[0]))
      const projects = [...tops].filter(
        top => !top.startsWith('.') && files.has(`${top}/.inksprite/story.json`)
      )
      return { projects: projects.sort(), taken: [...tops].sort() }
    },

    async walk(dir) {
      /** @type {Array<{path: string, mtime: number, size: number}>} */
      const found = []
      /** @type {Set<string>} */
      const closed = new Set()
      const prefix = `${dir}/`
      const opens = (/** @type {string} */ folder) =>
        files.has(`${prefix}${folder}/.folder.md`) ||
        files.has(`${prefix}${folder}/.repository.json`)
      for (const [path, file] of files) {
        if (!path.startsWith(prefix)) continue
        const relative = path.slice(prefix.length)
        const parts = relative.split('/')
        // Each folder on the way must be one the walk goes into.
        let open = true
        let inside = false
        for (let depth = 1; depth < parts.length; depth++) {
          const folder = parts.slice(0, depth).join('/')
          if (inside || (depth === 1 && parts[0] === '.inksprite')) {
            inside = true
            continue
          }
          if (files.has(`${prefix}${folder}/.repository.json`)) {
            inside = true
            continue
          }
          if (!opens(folder)) {
            closed.add(folder)
            open = false
            break
          }
        }
        if (open) found.push({ path: relative, mtime: file.mtime, size: file.bytes.length })
      }
      return { files: found, closed: [...closed] }
    },

    async read(paths) {
      /** @type {Record<string, string>} */
      const texts = {}
      for (const path of paths) {
        const file = files.get(path)
        if (file) texts[path] = decoder.decode(file.bytes)
      }
      return texts
    },

    async list(dir) {
      const prefix = `${dir}/`
      return [...files.keys()]
        .filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(path => path.slice(prefix.length))
        .sort()
    },

    async readBytes(path) {
      return files.get(path)?.bytes.slice() ?? null
    },

    async apply(ops) {
      /** @type {Record<string, {mtime: number, size: number}>} */
      const seen = {}
      /** @type {string[]} */
      const conflicts = []
      for (const op of ops) {
        if (op.op === 'write') {
          if (op.expect !== undefined) {
            const found = seenOf(op.path)
            const same =
              found && op.expect && found.mtime === op.expect.mtime && found.size === op.expect.size
            if (found && !same) {
              takeAway(op.path)
              conflicts.push(op.path)
            }
          }
          const bytes = op.bytes ? op.bytes.slice() : encoder.encode(op.text ?? '')
          files.set(op.path, { bytes, mtime: clock++ })
          seen[op.path] = /** @type {any} */ (seenOf(op.path))
        } else if (op.op === 'append') {
          const size = files.get(op.path)?.bytes.length ?? 0
          if (size !== op.size || op.at > op.size) {
            throw new Error(`Changed since it was read: ${op.path}`)
          }
          const before = (files.get(op.path)?.bytes ?? new Uint8Array()).slice(0, op.at)
          const after = encoder.encode(op.text)
          const bytes = new Uint8Array(before.length + after.length)
          bytes.set(before)
          bytes.set(after, before.length)
          files.set(op.path, { bytes, mtime: clock++ })
          seen[op.path] = /** @type {any} */ (seenOf(op.path))
        } else if (op.op === 'move') {
          if (!exists(op.from)) throw new Error(`Nothing to move at ${op.from}`)
          if (exists(op.to)) {
            takeAway(op.to)
            conflicts.push(op.to)
          }
          for (const file of below(op.from)) {
            const kept = /** @type {any} */ (files.get(file))
            files.delete(file)
            files.set(op.to + file.slice(op.from.length), kept)
          }
        } else if (op.op === 'trash') {
          if (exists(op.path)) takeAway(op.path)
        } else if (op.op === 'delete') {
          if (!/^[^/]+\/\.inksprite\/audio(\/|$)/.test(op.path)) {
            throw new Error(`Only narration audio is deleted: ${op.path}`)
          }
          for (const file of below(op.path)) files.delete(file)
        }
      }
      return { seen, conflicts }
    },
  }

  return { disk, outside, trashed, trash, files }
}
