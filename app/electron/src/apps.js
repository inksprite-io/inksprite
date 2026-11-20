/**
 * Other apps on this computer that work in the writer's projects, over MCP:
 * a coding agent reading a design where it is written. Each has a connection,
 * its way in: a name, a token, the projects ticked for it, and whether it
 * only reads them. They are kept here, in `apps.json` in the app's data folder, and
 * not with the page's settings: the door (`appServer.js`) checks a token
 * before any page is asked, and a connection is this computer's, so it is
 * neither synced nor in a backup. See `.llm/mcp_server_design.md`.
 *
 * The token is kept as it is, for its setup line to be copied again. A hash
 * would guard nothing: the library is beside it, in plain files.
 */

import { app } from 'electron'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { appDoor } from './appServer.js'
import { windowAsker } from './appCalls.js'
import { appExports } from './appExports.js'
import { appReads } from './appReads.js'

/** The file's name, beside `library.json`. */
export const APPS_FILE = 'apps.json'

/** The port listened on unless the writer names another: INKS on a phone's keys. */
export const DEFAULT_PORT = 4657

/** How long a connection's name may be. */
const NAME_MOST = 100

/**
 * One app's way in.
 *
 * @typedef {Object} AppConnection
 * @property {string} id
 * @property {string} name - What the writer calls it: "Claude Code"
 * @property {string} token - What its requests carry
 * @property {string[]} projects - The projects ticked for it, by their ids
 * @property {boolean} readOnly - Whether it only reads: it is offered no
 *   tool that changes anything
 * @property {number} created
 */

/**
 * What the file holds: the port apps come in on, whether they are let in at
 * all, and their connections.
 * @typedef {{port: number, enabled: boolean, connections: AppConnection[]}} AppsFile
 */

/** Where the file is: `~/Library/Application Support/inksprite/` on a Mac. */
export const appsPath = () => path.join(app.getPath('userData'), APPS_FILE)

/**
 * Whether a number is a port an app may listen on without the system's leave.
 * @param {unknown} port
 * @returns {port is number}
 */
export const isPort = port =>
  Number.isInteger(port) && Number(port) >= 1024 && Number(port) <= 65535

/** @param {string} text */
const digest = text => createHash('sha256').update(text).digest()

/**
 * A connection as the file may hold it, or null for anything that isn't one.
 *
 * @param {any} entry
 * @returns {AppConnection|null}
 */
function connectionFrom(entry) {
  if (!entry || typeof entry !== 'object') return null
  if (typeof entry.id !== 'string' || typeof entry.token !== 'string' || !entry.token) return null
  return {
    id: entry.id,
    name: typeof entry.name === 'string' ? entry.name : '',
    token: entry.token,
    projects: Array.isArray(entry.projects)
      ? entry.projects.filter((/** @type {unknown} */ id) => typeof id === 'string')
      : [],
    readOnly: entry.readOnly === true,
    created: Number.isFinite(entry.created) ? entry.created : 0,
  }
}

/**
 * The changes to a connection the page may ask for, each checked: its name,
 * its projects, and whether it only reads.
 *
 * @param {any} patch
 * @returns {Partial<AppConnection>}
 * @throws {Error} For a value that isn't what its field holds
 */
function changesFrom(patch) {
  /** @type {Partial<AppConnection>} */
  const changes = {}
  if (!patch || typeof patch !== 'object') return changes
  if ('name' in patch) changes.name = nameFrom(patch.name)
  if ('projects' in patch) {
    if (!Array.isArray(patch.projects) || patch.projects.some(id => typeof id !== 'string')) {
      throw new Error('A connection’s projects are a list of their ids.')
    }
    changes.projects = [...new Set(/** @type {string[]} */ (patch.projects))]
  }
  if ('readOnly' in patch) changes.readOnly = patch.readOnly === true
  return changes
}

/**
 * @param {unknown} name
 * @returns {string}
 * @throws {Error} For anything but a name
 */
function nameFrom(name) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('A connection needs a name.')
  return name.trim().slice(0, NAME_MOST)
}

/**
 * The connections of one app, kept in a file.
 *
 * @param {string} [file] - Where; the app's own by default
 */
export function appConnections(file = appsPath()) {
  /** @type {AppsFile|null} */
  let held = null
  /** @type {Promise<unknown>} */
  let doing = Promise.resolve()

  /** @returns {Promise<AppsFile>} */
  const read = async () => {
    if (held) return held
    /** @type {any} */
    let stored = null
    try {
      stored = JSON.parse(await fs.readFile(file, 'utf8'))
    } catch (error) {
      // None yet, or one that can't be read: the writer makes them again.
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') {
        console.error(`${file} could not be read: ${/** @type {Error} */ (error).message}`)
      }
    }
    held = {
      port: isPort(stored?.port) ? stored.port : DEFAULT_PORT,
      enabled: stored?.enabled !== false,
      connections: (Array.isArray(stored?.connections) ? stored.connections : [])
        .map(connectionFrom)
        .filter((/** @type {AppConnection|null} */ one) => one !== null),
    }
    return held
  }

  /**
   * Write the file, readable by the writer alone, whole or not at all.
   * @param {AppsFile} next
   */
  const write = async next => {
    const draft = `${file}.${process.pid}.tmp`
    await fs.writeFile(draft, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    await fs.rename(draft, file)
    held = next
  }

  /**
   * One change at a time, each made to the file as the last left it.
   *
   * @template T
   * @param {(now: AppsFile) => Promise<T>} change
   * @returns {Promise<T>}
   */
  const inTurn = change => {
    const done = doing.then(async () => change(await read()))
    doing = done.catch(() => {})
    return done
  }

  return {
    /**
     * The port, whether apps are let in, and every connection.
     * @returns {Promise<AppsFile>}
     */
    all: () => inTurn(async now => ({ ...now, connections: [...now.connections] })),

    /**
     * Make a connection, with a token of its own and no project ticked: one
     * that may write, which is what an app is mostly connected to do.
     *
     * @param {unknown} name
     * @returns {Promise<AppConnection>}
     */
    add: name =>
      inTurn(async now => {
        /** @type {AppConnection} */
        const made = {
          id: `app_${randomBytes(6).toString('hex')}`,
          name: nameFrom(name),
          token: randomBytes(32).toString('base64url'),
          projects: [],
          readOnly: false,
          created: Date.now(),
        }
        await write({ ...now, connections: [...now.connections, made] })
        return made
      }),

    /**
     * Change a connection's name, its projects, or whether it only reads.
     *
     * @param {unknown} id
     * @param {unknown} patch
     * @returns {Promise<AppConnection>}
     * @throws {Error} For a connection there isn't, or a value that won't do
     */
    update: (id, patch) =>
      inTurn(async now => {
        const before = now.connections.find(one => one.id === id)
        if (!before) throw new Error('No such connection.')
        const after = { ...before, ...changesFrom(patch) }
        await write({
          ...now,
          connections: now.connections.map(one => (one.id === id ? after : one)),
        })
        return after
      }),

    /**
     * Remove a connection: its token opens nothing from then on.
     *
     * @param {unknown} id
     * @returns {Promise<void>}
     */
    remove: id =>
      inTurn(async now => {
        if (!now.connections.some(one => one.id === id)) return
        await write({ ...now, connections: now.connections.filter(one => one.id !== id) })
      }),

    /**
     * Listen on another port from now on.
     *
     * @param {unknown} port
     * @returns {Promise<void>}
     * @throws {Error} For a number that isn't a port an app may take
     */
    setPort: port =>
      inTurn(async now => {
        if (!isPort(port)) throw new Error('A port is a number from 1024 to 65535.')
        if (port !== now.port) await write({ ...now, port })
      }),

    /**
     * Let apps in, or none: with it off, nothing is listened for, and the
     * connections are kept for when it is on again.
     *
     * @param {unknown} enabled
     * @returns {Promise<void>}
     */
    setEnabled: enabled =>
      inTurn(async now => {
        if ((enabled === true) !== now.enabled) await write({ ...now, enabled: enabled === true })
      }),

    /**
     * The connection a token is of, or null. Every connection's is compared,
     * each in the same time, so how long it takes says nothing of the token.
     *
     * @param {string} token
     * @returns {Promise<AppConnection|null>}
     */
    byToken: token =>
      inTurn(async now => {
        const given = digest(token)
        /** @type {AppConnection|null} */
        let found = null
        for (const one of now.connections) {
          if (timingSafeEqual(given, digest(one.token))) found = one
        }
        return found
      }),
  }
}

/** @typedef {ReturnType<typeof appConnections>} AppConnections */

/**
 * Answer the page's calls about connections, and open the door to the apps
 * that have one: listening only while there is a connection and apps are let
 * in, and handing what an app asks to a window to answer (`appCalls.js`).
 *
 * @param {Object} bridge
 * @param {(channel: string, answer: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any) => void} bridge.handle -
 *   Answer a channel, from the app's page only
 * @param {(channel: string, listener: (event: Electron.IpcMainEvent, ...args: any[]) => void) => void} bridge.on -
 *   Listen on a channel, from the app's page only
 * @param {() => Electron.WebContents[]} bridge.pages - The app's windows'
 *   pages, the one in front first
 */
export function handleApps({ handle, on, pages }) {
  const connections = appConnections()
  const asker = windowAsker(pages)
  const exports = appExports()
  const door = appDoor({ connections, ask: asker.ask, exports })
  const reads = appReads()

  on('apps:answer', (event, request, answer) => asker.answered(event.sender.id, request, answer))

  /** What the page shows: the connections, and whether they can get in. */
  const state = async () => ({ ...(await connections.all()), ...door.state() })
  handle('apps:list', () => state())
  handle('apps:add', async (_, name) => {
    const made = await connections.add(name)
    await door.sync()
    return made
  })
  handle('apps:update', (_, id, patch) => connections.update(id, patch))
  handle('apps:remove', async (_, id) => {
    await connections.remove(id)
    await door.sync()
    // What it had read goes with it, and what was ready for it to fetch.
    exports.forget(id)
    await reads.forget(id).catch(() => {})
  })
  // The door moves to a new port as it is named, and shuts as apps are
  // turned off: an app set up with the old address is no longer answered.
  handle('apps:port', async (_, port) => {
    await connections.setPort(port)
    await door.sync()
    return state()
  })
  handle('apps:enable', async (_, enabled) => {
    await connections.setEnabled(enabled)
    await door.sync()
    return state()
  })

  // What each connection last read or wrote of each document, kept for the
  // page to say what changed since (`appReads.js`).
  handle('apps:read', (_, connection, document) => reads.get(connection, document))
  handle('apps:reads', (_, connection) => reads.all(connection))
  handle('apps:keep', (_, connection, document, record) => reads.put(connection, document, record))

  // What a page has made ready for a connection's app to fetch, by a link
  // that works once (`appExports.js`).
  handle('apps:offer', (_, connection, file) => exports.offer(connection, file))

  // Connections made before the app last quit are let in as it starts.
  door.sync().catch(error => console.error(`Apps could not be listened for: ${error.message}`))
}
