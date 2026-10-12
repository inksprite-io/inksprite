/**
 * The library: the folder the writer's projects are kept in, a folder of
 * files each, and what the page may do there.
 *
 * It is `Projects` in the app's data folder, beside the rest of what the app
 * keeps, and not asked for: there is nothing to give permission to, and it
 * is in no folder a sync service keeps in step already. Whether the
 * projects are kept in it at all is a switch in the page's settings, kept in
 * `library.json` there: off in a release until it has been tried more
 * widely, on in a run from the checkout. The page names files by their path
 * below the library, `/` between the parts, and the layout of a project is
 * the page's to know (`src/storage/` there): here is only the disk, held to
 * the library. A path that would lead anywhere else, through `..` or a link,
 * is refused, so a page gone wrong can harm the library and nothing else.
 *
 * Nothing is deleted but a project's narration audio, which is made again
 * on asking and would fill the trash: what else goes goes to the system's
 * trash, or to the library's own `.inksprite-trash/` where there is none. A
 * file is written
 * whole or not at all: to a file beside it, made safe on the disk, then
 * renamed over it. A file changed since the page last saw it goes to the
 * trash before it is written over or moved onto, and the page is told.
 */

import { app, shell } from 'electron'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

/** Whether the projects are kept in the library, and whether they are in it yet. */
const SETTINGS_FILE = 'library.json'

/** The library, in the app's data folder. */
const LIBRARY_FOLDER = 'Projects'

/** A project's own folder, whose story file says the folder is a project. */
const STORY_FILE = '.inksprite/story.json'

/** Where what goes is kept when the system has no trash. */
const OWN_TRASH = '.inksprite-trash'

/**
 * A project's narration audio, the one thing deleted rather than trashed,
 * and not walked: the app asks for a document's when it reads it aloud.
 */
const AUDIO = /^[^/]+\/\.inksprite\/audio(\/|$)/

/** How many files are read at once. */
const READ_AT_ONCE = 64

/**
 * @typedef {Object} LibrarySettings
 * @property {string} path - The library
 * @property {boolean} enabled - Whether the projects are kept in it. Unset means
 *   off in a release and on in a run from the checkout.
 * @property {boolean} moved - Whether the projects kept in the window were moved into it
 */

/** @type {LibrarySettings|null} */
let settings = null

const settingsPath = () => path.join(app.getPath('userData'), SETTINGS_FILE)

/**
 * Where the library is: in the app's data folder, so a run from the
 * checkout, whose data is its own, has a library of its own too.
 */
export const libraryPath = () => path.join(app.getPath('userData'), LIBRARY_FOLDER)

/** @returns {Promise<LibrarySettings>} */
export async function librarySettings() {
  if (settings) return settings
  /** @type {Record<string, unknown>} */
  let read = {}
  try {
    read = JSON.parse(await fs.readFile(settingsPath(), 'utf8'))
  } catch {
    // Never switched: the default.
  }
  settings = {
    path: libraryPath(),
    enabled: typeof read.enabled === 'boolean' ? read.enabled : !app.isPackaged,
    moved: read.moved === true,
  }
  return settings
}

/** @param {LibrarySettings} next */
async function saveSettings(next) {
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true })
  const { enabled, moved } = next
  await writeWhole(settingsPath(), `${JSON.stringify({ enabled, moved }, null, 2)}\n`)
  settings = next
}

/** Say the projects kept in the window are in the library now. */
export async function markMoved() {
  await saveSettings({ ...(await librarySettings()), moved: true })
}

/**
 * Keep the projects in the library from now on. The window's projects are
 * moved into it when the page opens again.
 *
 * @returns {Promise<string>} Where it is
 */
export async function enableLibrary() {
  await fs.mkdir(libraryPath(), { recursive: true })
  await saveSettings({ ...(await librarySettings()), enabled: true, moved: false })
  return libraryPath()
}

/**
 * Keep the projects in the window again, once the page has copied them back
 * there. The library's files are left where they are.
 */
export async function disableLibrary() {
  await saveSettings({ ...(await librarySettings()), enabled: false, moved: false })
}

/**
 * Make the library, when the projects are kept in it and it is not there:
 * the first time a run from the checkout opens, or after it was taken away.
 *
 * @returns {Promise<string|null>} Where it is, or null when the projects are kept in the window
 */
export async function ensureLibrary() {
  const { enabled } = await librarySettings()
  if (!enabled) return null
  await fs.mkdir(libraryPath(), { recursive: true })
  return libraryPath()
}

/**
 * When a file was last written and how long it is, to tell whether anything
 * else has written it since.
 *
 * @typedef {{mtime: number, size: number}} Seen
 */

/**
 * What the page may ask to be done, with paths below the library.
 *
 * - `write` - The whole file. `expect` is what the page saw of it, or null
 *   when it saw none there; a file not as it was seen is trashed first.
 * - `append` - `text` from byte `at` on, the file ending there, when the
 *   file is still `size` bytes long; refused when it is not
 * - `move` - A file or folder with all in it; one already where it goes,
 *   that is not itself in another case, is trashed first
 * - `trash` - A file or folder, if it is there
 * - `delete` - A file or folder of a project's narration audio, for good;
 *   refused anywhere else
 *
 * @typedef {{op: 'write', path: string, text?: string, bytes?: Uint8Array, expect?: Seen|null}
 *   | {op: 'append', path: string, at: number, text: string, size: number}
 *   | {op: 'move', from: string, to: string}
 *   | {op: 'trash', path: string}
 *   | {op: 'delete', path: string}} LibraryOp
 */

/**
 * The library at `root`, and what may be done in it.
 *
 * @param {string} root - The library, links followed
 */
export function libraryFolder(root) {
  /**
   * A path below the library, as one on this disk. Refused if it is not
   * one: empty parts, `.` or `..`, and, on Windows, what would name a drive
   * or a stream.
   *
   * @param {string} relative
   * @returns {string}
   */
  const resolve = relative => {
    if (typeof relative !== 'string' || !relative) throw new Error('No path in the library')
    const parts = relative.split('/')
    const bad = process.platform === 'win32' ? /[\\:\0]/ : /\0/
    for (const part of parts) {
      if (!part || part === '.' || part === '..' || bad.test(part)) {
        throw new Error(`Not a path in the library: ${relative}`)
      }
    }
    return path.join(root, ...parts)
  }

  /**
   * Refuse a path that leads out of the library through a link: the nearest
   * folder above it that is there must be in the library once links are
   * followed, and the path itself must be no link.
   *
   * @param {string} absolute
   */
  const confine = async absolute => {
    let dir = path.dirname(absolute)
    for (;;) {
      const real = await fs.realpath(dir).catch(() => null)
      if (real !== null) {
        if (real !== root && !real.startsWith(`${root}${path.sep}`)) {
          throw new Error('That path leads out of the library')
        }
        break
      }
      const above = path.dirname(dir)
      if (above === dir) throw new Error('That path leads out of the library')
      dir = above
    }
    const there = await fs.lstat(absolute).catch(() => null)
    if (there?.isSymbolicLink()) throw new Error('That path is a link')
    return absolute
  }

  /** @param {string} relative */
  const inside = async relative => confine(resolve(relative))

  /**
   * Send a file or folder to the trash.
   *
   * @param {string} absolute
   */
  const trash = async absolute => {
    try {
      await shell.trashItem(absolute)
    } catch {
      const kept = path.join(root, OWN_TRASH, `${Date.now()}-${randomBytes(3).toString('hex')}`)
      await fs.mkdir(kept, { recursive: true })
      await fs.rename(absolute, path.join(kept, path.basename(absolute)))
    }
  }

  /** @param {string} absolute */
  const seen = async absolute => {
    const found = await fs.stat(absolute).catch(() => null)
    return found ? { mtime: found.mtimeMs, size: found.size } : null
  }

  return {
    /**
     * The projects in the library, its folders with a story file in them,
     * and every name at its top, which a new project's folder keeps clear of.
     *
     * @returns {Promise<{projects: string[], taken: string[]}>}
     */
    async projects() {
      const items = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
      /** @type {string[]} */
      const found = []
      for (const item of items) {
        if (!item.isDirectory() || item.name.startsWith('.')) continue
        const story = await fs
          .stat(path.join(root, item.name, ...STORY_FILE.split('/')))
          .catch(() => null)
        if (story?.isFile()) found.push(item.name)
      }
      return { projects: found.sort(), taken: items.map(item => item.name).sort() }
    },

    /**
     * Every file a project's folder holds as far as the app reads it, by
     * path below the folder: its own `.inksprite/` but for its narration
     * audio, and each folder in it that is a folder of the project's or is
     * in a repository. Any other folder, and any link, is named but not gone
     * into.
     *
     * @param {string} dir - The project's folder, below the library
     * @returns {Promise<{files: Array<{path: string} & Seen>, closed: string[]}>}
     */
    async walk(dir) {
      const top = await inside(dir)
      /** @type {Array<{path: string} & Seen>} */
      const files = []
      /** @type {string[]} */
      const closed = []
      /**
       * @param {string} absolute
       * @param {string} relative
       * @param {boolean} open - Everything below is the app's: a repository, or `.inksprite/`
       */
      const visit = async (absolute, relative, open) => {
        const items = await fs.readdir(absolute, { withFileTypes: true })
        const names = new Set(items.map(item => item.name))
        const repository = open || names.has('.repository.json')
        for (const item of items) {
          const at = relative ? `${relative}/${item.name}` : item.name
          const full = path.join(absolute, item.name)
          if (item.isSymbolicLink()) {
            closed.push(at)
          } else if (item.isFile()) {
            const found = await fs.stat(full)
            files.push({ path: at, mtime: found.mtimeMs, size: found.size })
          } else if (item.isDirectory()) {
            if (at === '.inksprite/audio') continue
            const ours =
              repository ||
              (relative === '' && item.name === '.inksprite') ||
              (await fs.stat(path.join(full, '.folder.md')).catch(() => null)) !== null ||
              (await fs.stat(path.join(full, '.repository.json')).catch(() => null)) !== null
            if (ours)
              await visit(full, at, repository || (relative === '' && item.name === '.inksprite'))
            else closed.push(at)
          }
        }
      }
      await visit(top, '', false)
      return { files, closed }
    },

    /**
     * The text of each of these files that is there.
     *
     * @param {string[]} paths
     * @returns {Promise<Record<string, string>>}
     */
    async readTexts(paths) {
      /** @type {Record<string, string>} */
      const texts = {}
      for (let start = 0; start < paths.length; start += READ_AT_ONCE) {
        await Promise.all(
          paths.slice(start, start + READ_AT_ONCE).map(async relative => {
            const text = await fs.readFile(await inside(relative), 'utf8').catch(() => null)
            if (text !== null) texts[relative] = text
          })
        )
      }
      return texts
    },

    /**
     * The names of the files in a folder, not those in folders within it:
     * none when it is not there.
     *
     * @param {string} relative
     * @returns {Promise<string[]>}
     */
    async list(relative) {
      const items = await fs
        .readdir(await inside(relative), { withFileTypes: true })
        .catch(() => [])
      return items
        .filter(item => item.isFile())
        .map(item => item.name)
        .sort()
    },

    /**
     * @param {string} relative
     * @returns {Promise<Uint8Array|null>} Null when the file is not there
     */
    async readBytes(relative) {
      const bytes = await fs.readFile(await inside(relative)).catch(() => null)
      return bytes ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null
    },

    /**
     * Do what the page asks, in order.
     *
     * @param {LibraryOp[]} ops
     * @returns {Promise<{seen: Record<string, Seen>, conflicts: string[]}>} How each
     *   file written was left, and which files were not as the page had seen them
     */
    async apply(ops) {
      /** @type {Record<string, Seen>} */
      const written = {}
      /** @type {string[]} */
      const conflicts = []
      for (const op of ops) {
        if (op.op === 'write') {
          const target = await inside(op.path)
          if (op.expect !== undefined) {
            const found = await seen(target)
            const same =
              found && op.expect && found.mtime === op.expect.mtime && found.size === op.expect.size
            if (found && !same) {
              await trash(target)
              conflicts.push(op.path)
            }
          }
          await fs.mkdir(path.dirname(target), { recursive: true })
          await writeWhole(target, op.bytes ?? op.text ?? '')
          written[op.path] = /** @type {Seen} */ (await seen(target))
        } else if (op.op === 'append') {
          const target = await inside(op.path)
          const found = await seen(target)
          if ((found?.size ?? 0) !== op.size || op.at > op.size) {
            throw new Error(`Changed since it was read: ${op.path}`)
          }
          await fs.mkdir(path.dirname(target), { recursive: true })
          await writeFrom(target, op.at, op.text)
          written[op.path] = /** @type {Seen} */ (await seen(target))
        } else if (op.op === 'move') {
          const from = await inside(op.from)
          const to = await inside(op.to)
          const there = await fs.lstat(to).catch(() => null)
          if (there && !(await sameFile(from, to))) {
            await trash(to)
            conflicts.push(op.to)
          }
          await fs.mkdir(path.dirname(to), { recursive: true })
          await fs.rename(from, to)
        } else if (op.op === 'trash') {
          const target = await inside(op.path)
          if (await fs.lstat(target).catch(() => null)) await trash(target)
        } else if (op.op === 'delete') {
          if (!AUDIO.test(op.path)) throw new Error(`Only narration audio is deleted: ${op.path}`)
          await fs.rm(await inside(op.path), { recursive: true, force: true })
        } else {
          throw new Error(`Not something to do in the library: ${/** @type {any} */ (op).op}`)
        }
      }
      return { seen: written, conflicts }
    },

    /**
     * Show a file or folder in the system's file manager: the library itself
     * when no path is given.
     *
     * @param {string} [relative]
     */
    async reveal(relative) {
      shell.showItemInFolder(relative ? await inside(relative) : root)
    },
  }
}

/**
 * Write a file whole: to one beside it, kept on the disk, then renamed over
 * it, so a stop partway leaves the file as it was.
 *
 * @param {string} target
 * @param {string|Uint8Array} data
 */
async function writeWhole(target, data) {
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomBytes(4).toString('hex')}.tmp`
  )
  const handle = await fs.open(temp, 'w')
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fs.rename(temp, target)
  } catch (error) {
    await fs.rm(temp, { force: true })
    throw error
  }
}

/**
 * Write text into a file from a byte on, and end the file after it.
 *
 * @param {string} target
 * @param {number} at
 * @param {string} text
 */
async function writeFrom(target, at, text) {
  const bytes = Buffer.from(text, 'utf8')
  const handle = await fs.open(target, 'r+').catch(() => fs.open(target, 'w+'))
  try {
    await handle.write(bytes, 0, bytes.length, at)
    await handle.truncate(at + bytes.length)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * Whether two paths are the one file: a rename that only changes case, on a
 * disk that does not tell case apart.
 *
 * @param {string} a
 * @param {string} b
 */
async function sameFile(a, b) {
  const [one, two] = await Promise.all([fs.stat(a), fs.stat(b)])
  return one.dev === two.dev && one.ino === two.ino
}
