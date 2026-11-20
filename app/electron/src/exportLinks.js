/**
 * A project linked to a folder of the writer's that it is exported to again
 * and again: a repository's docs, kept up as the project is written, by the
 * project's menu or by a connected app (`export_project`). See
 * `.llm/mcp_server_design.md`.
 *
 * The page never names the folder. The writer chooses it in a dialog, it is
 * kept here by the project's id, in `export-folders.json` in the app's data
 * folder, and the page asks only for "this project's folder" to be read or
 * written.
 *
 * Unlike an export to a folder chosen each time (`exporting.js`), which
 * replaces the folder, a linked one is written in place: it sits in a
 * repository, among files that aren't the export's.
 *
 * - A file is written only when what it would hold isn't what is there.
 * - One that is there and differs is written over when it is the export's
 *   own, as it last left it or as the page says (an older export of the
 *   same document). Anything else was changed outside, or was never the
 *   export's: it goes to the system's trash first, and is named in what
 *   comes back.
 * - What the export wrote before and no longer would, a document deleted or
 *   renamed since, goes to the system's trash, and a directory it made that
 *   is left empty goes too. Which those are is kept with the link.
 * - Nothing else in the folder is touched, and nothing outside it: a path
 *   that leads out, or through a link, is refused.
 */

import { app, dialog, shell } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { below } from './exporting.js'

/** The file's name, beside `apps.json`. */
export const LINKS_FILE = 'export-folders.json'

/** The longest text of a file there that the page is handed, in bytes. */
const LOOK_MOST = 4 * 1024 * 1024

/** What a project's id is made of. */
const ID = /^[A-Za-z0-9_-]{1,100}$/

/**
 * One project's link.
 *
 * @typedef {Object} ExportLink
 * @property {string} folder - Where, on this disk
 * @property {Record<string, string>} written - What the last export left
 *   there: each file's hash, by its path below the folder
 * @property {string[]} dirs - The directories it made, by their paths
 */

/**
 * One thing to write: a directory, a text, a file's bytes, or a file in the
 * library to copy, by its path in the export, the export's own folder first.
 * `own` says a text there now is an older export of the same document, to
 * be written over as the export's own.
 *
 * @typedef {{path: string, folder: true}
 *   | {path: string, text: string, own?: boolean}
 *   | {path: string, bytes: Uint8Array}
 *   | {path: string, file: string}} LinkedEntry
 */

/**
 * What an export to a linked folder did, by paths below the folder.
 *
 * @typedef {Object} LinkedReport
 * @property {string} folder
 * @property {string[]} written - Made, or changed
 * @property {string[]} edited - Of those, the ones that had been changed
 *   outside or were not the export's: now in the system's trash
 * @property {string[]} removed - No longer in the export: in the system's trash
 * @property {number} unchanged - How many were already as they would be written
 */

/** Where the file is: `~/Library/Application Support/inksprite/` on a Mac. */
export const linksPath = () => path.join(app.getPath('userData'), LINKS_FILE)

/**
 * @param {unknown} storyId
 * @returns {string}
 * @throws {Error} For anything that isn't a project's id
 */
function idOf(storyId) {
  if (typeof storyId !== 'string' || !ID.test(storyId)) throw new Error('Not a project’s id.')
  return storyId
}

/** @param {Buffer|string} bytes */
const hashOf = bytes => createHash('sha256').update(bytes).digest('hex')

/**
 * A file's hash, read a piece at a time.
 * @param {string} file
 * @returns {Promise<string>}
 */
function hashOfFile(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('data', chunk => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject)
  })
}

/**
 * Where a path of the export goes below the folder, and what it is called
 * there. Refused if it leads out (`below`), or through a link on the way:
 * a directory in the folder that is a link elsewhere is not followed.
 *
 * @param {string} folder
 * @param {string} relative - The export's own folder first
 * @returns {Promise<{to: string, at: string}>} `at` is '' for the folder itself
 */
async function placeIn(folder, relative) {
  const to = below(folder, relative)
  const parts = path.relative(folder, to).split(path.sep).filter(Boolean)
  let step = folder
  for (const part of parts) {
    step = path.join(step, part)
    const there = await fs.lstat(step).catch(() => null)
    if (!there) break
    if (there.isSymbolicLink()) {
      throw new Error(`${parts.join('/')} goes through a link, which an export doesn’t follow.`)
    }
  }
  return { to, at: parts.join('/') }
}

/**
 * The links of one app's projects, kept in a file.
 *
 * @param {string} [file] - Where; the app's own by default
 */
export function exportLinks(file = linksPath()) {
  /** @type {Record<string, ExportLink>|null} */
  let held = null
  /** @type {Promise<unknown>} */
  let doing = Promise.resolve()

  /** @returns {Promise<Record<string, ExportLink>>} */
  const read = async () => {
    if (held) return held
    /** @type {any} */
    let stored = null
    try {
      stored = JSON.parse(await fs.readFile(file, 'utf8'))
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') {
        console.error(`${file} could not be read: ${/** @type {Error} */ (error).message}`)
      }
    }
    held = {}
    for (const [storyId, link] of Object.entries(stored?.links ?? {})) {
      if (!ID.test(storyId) || typeof link?.folder !== 'string' || !path.isAbsolute(link.folder)) {
        continue
      }
      held[storyId] = {
        folder: link.folder,
        written: link.written && typeof link.written === 'object' ? link.written : {},
        dirs: Array.isArray(link.dirs) ? link.dirs.filter(dir => typeof dir === 'string') : [],
      }
    }
    return held
  }

  /** @param {Record<string, ExportLink>} next */
  const write = async next => {
    const draft = `${file}.${process.pid}.tmp`
    await fs.writeFile(draft, `${JSON.stringify({ links: next }, null, 2)}\n`, { mode: 0o600 })
    await fs.rename(draft, file)
    held = next
  }

  /**
   * One thing at a time, each done to the links as the last left them.
   *
   * @template T
   * @param {(links: Record<string, ExportLink>) => Promise<T>} work
   * @returns {Promise<T>}
   */
  const inTurn = work => {
    const done = doing.then(async () => work(await read()))
    doing = done.catch(() => {})
    return done
  }

  /**
   * @param {Record<string, ExportLink>} links
   * @param {unknown} storyId
   * @returns {ExportLink}
   * @throws {Error} For a project with no folder linked
   */
  const linkOf = (links, storyId) => {
    const link = links[idOf(storyId)]
    if (!link) throw new Error('No folder is linked to this project.')
    return link
  }

  return {
    /**
     * The folder a project is linked to, or null.
     *
     * @param {unknown} storyId
     * @returns {Promise<string|null>}
     */
    linked: storyId => inTurn(async links => links[idOf(storyId)]?.folder ?? null),

    /**
     * Ask the writer for the folder a project is exported to from now on.
     * Another folder than before starts afresh: what was written to the old
     * one stays there.
     *
     * @param {Electron.BrowserWindow|null} window - The dialog's
     * @param {unknown} storyId
     * @returns {Promise<string|null>} The folder, or null when they cancelled
     */
    link: (window, storyId) =>
      inTurn(async links => {
        const id = idOf(storyId)
        /** @type {Electron.OpenDialogOptions} */
        const options = {
          buttonLabel: 'Choose',
          properties: ['openDirectory', 'createDirectory'],
          ...(links[id] ? { defaultPath: links[id].folder } : {}),
        }
        const { canceled, filePaths } = window
          ? await dialog.showOpenDialog(window, options)
          : await dialog.showOpenDialog(options)
        const folder = canceled ? undefined : filePaths[0]
        if (!folder) return null
        if (links[id]?.folder !== folder) {
          await write({ ...links, [id]: { folder, written: {}, dirs: [] } })
        }
        return folder
      }),

    /**
     * Stop exporting a project to its folder. What is there stays.
     *
     * @param {unknown} storyId
     * @returns {Promise<void>}
     */
    unlink: storyId =>
      inTurn(async links => {
        const id = idOf(storyId)
        if (!links[id]) return
        const { [id]: _gone, ...rest } = links
        await write(rest)
      }),

    /**
     * The text of each of these files as it is in a project's folder now,
     * for the page to tell an older export of its own from a file changed
     * outside: null for one that isn't there, isn't a file, or is very long.
     *
     * @param {unknown} storyId
     * @param {unknown} paths - Each as the export has it, its own folder first
     * @returns {Promise<Record<string, string|null>>}
     */
    look: (storyId, paths) =>
      inTurn(async links => {
        const { folder } = linkOf(links, storyId)
        /** @type {Record<string, string|null>} */
        const found = {}
        for (const relative of Array.isArray(paths) ? paths : []) {
          if (typeof relative !== 'string') continue
          found[relative] = null
          try {
            const { to } = await placeIn(folder, relative)
            const there = await fs.lstat(to)
            if (there.isFile() && there.size <= LOOK_MOST) {
              found[relative] = await fs.readFile(to, 'utf8')
            }
          } catch {
            // Not there, or not a path of the export: nothing to say of it.
          }
        }
        return found
      }),

    /**
     * Write an export into a project's folder, in place.
     *
     * @param {unknown} storyId
     * @param {LinkedEntry[]} entries
     * @param {(file: string) => Promise<{path: string}|null>} locate - Where a
     *   file in the library is on this disk
     * @returns {Promise<LinkedReport>}
     * @throws {Error} For a project with no folder, a path that would lead
     *   out of it, or a file the library doesn't have
     */
    apply: (storyId, entries, locate) =>
      inTurn(async links => {
        const id = idOf(storyId)
        const link = linkOf(links, id)
        const { folder } = link
        await fs.mkdir(folder, { recursive: true })

        /** @type {LinkedReport} */
        const report = { folder, written: [], edited: [], removed: [], unchanged: 0 }
        /** @type {Record<string, string>} */
        const written = {}
        /** @type {string[]} */
        const dirs = []

        for (const entry of Array.isArray(entries) ? entries : []) {
          const { to, at } = await placeIn(folder, entry?.path)
          if (!at) continue
          if ('folder' in entry) {
            await fs.mkdir(to, { recursive: true })
            dirs.push(at)
            continue
          }

          const from = 'file' in entry ? await locate(entry.file) : null
          if ('file' in entry && !from) throw new Error(`${at} isn’t in the library.`)
          const bytes =
            'text' in entry
              ? Buffer.from(String(entry.text), 'utf8')
              : 'bytes' in entry
                ? Buffer.from(entry.bytes)
                : null
          const hash = bytes
            ? hashOf(bytes)
            : await hashOfFile(/** @type {{path: string}} */ (from).path)
          written[at] = hash

          const there = await fs.lstat(to).catch(() => null)
          if (there && !there.isFile()) throw new Error(`${at} is there, and isn’t a file.`)
          const was = there ? await hashOfFile(to) : null
          if (was === hash) {
            report.unchanged++
            continue
          }
          if (there) {
            // The export's own, as it left it or as the page knows it: written
            // over. Anything else is kept, in the trash.
            const own = link.written[at] === was || ('text' in entry && entry.own === true)
            if (!own) {
              await shell.trashItem(to)
              report.edited.push(at)
            }
          }
          await fs.mkdir(path.dirname(to), { recursive: true })
          if (bytes) await fs.writeFile(to, bytes)
          else await fs.copyFile(/** @type {{path: string}} */ (from).path, to)
          report.written.push(at)
        }

        // What it wrote before and no longer would, and the directories that
        // leaves empty, the deepest first.
        for (const at of Object.keys(link.written)) {
          if (at in written) continue
          const to = path.join(folder, ...at.split('/'))
          const there = await fs.lstat(to).catch(() => null)
          if (!there?.isFile()) continue
          await shell.trashItem(to)
          report.removed.push(at)
        }
        const left = link.dirs.filter(dir => !dirs.includes(dir))
        for (const at of left.sort((a, b) => b.length - a.length)) {
          await fs.rmdir(path.join(folder, ...at.split('/'))).catch(() => {})
        }

        await write({ ...links, [id]: { folder, written, dirs } })
        return report
      }),
  }
}
