/* global AbortController, queueMicrotask */
/**
 * @module platform/apps
 * @description In the desktop app, the other apps on this computer let into
 * the writer's projects: their connections, kept by the native side, and the
 * way this window answers what one asks. See `app/electron/src/apps.js` and
 * `.llm/mcp_server_design.md`.
 */

import { desktop, isDesktop } from './desktop.js'

/** @typedef {import('./desktop.js').AppConnection} AppConnection */
/** @typedef {import('./desktop.js').AppsState} AppsState */
/** @typedef {import('./desktop.js').AppAnswer} AppAnswer */

/**
 * A connection as a window is told of it when its app asks something:
 * without its token, and with where the app reaches this computer
 * (`http://127.0.0.1:4657`, or by another name from inside a container).
 * @typedef {Omit<AppConnection, 'token'|'created'> & {address: string}} AskingApp
 */

/**
 * Whether other apps can be let in here: in the desktop app, one new enough
 * to.
 *
 * @returns {boolean}
 */
export const canConnectApps = () => isDesktop() && Boolean(desktop().apps)

/**
 * @returns {import('./desktop.js').DesktopApps}
 * @throws {Error} Outside the desktop app, or in one too old to
 */
function bridge() {
  const apps = canConnectApps() ? desktop().apps : null
  if (!apps) throw new Error('Other apps connect only to the desktop app.')
  return apps
}

/**
 * The connections, and whether their apps can get in.
 * @returns {Promise<AppsState>}
 */
export const listApps = () => bridge().list()

/**
 * Make a connection, with a token of its own and no project ticked.
 * @param {string} name
 * @returns {Promise<AppConnection>}
 */
export const addApp = name => bridge().add(name)

/**
 * Change a connection's name, its projects, or whether it only reads.
 * @param {string} id
 * @param {Partial<Pick<AppConnection, 'name'|'projects'|'readOnly'>>} patch
 * @returns {Promise<AppConnection>}
 */
export const updateApp = (id, patch) => bridge().update(id, patch)

/**
 * Remove a connection: its token opens nothing from then on.
 * @param {string} id
 * @returns {Promise<void>}
 */
export const removeApp = id => bridge().remove(id)

/**
 * Have apps reach inksprite on another port, from now: one set up with the
 * old address is no longer answered.
 * @param {number} port
 * @returns {Promise<AppsState>}
 */
export const setAppsPort = port => bridge().setPort(port)

/**
 * Let apps in, or none. Off, nothing is listened for, and the connections
 * are kept.
 * @param {boolean} enabled
 * @returns {Promise<AppsState>}
 */
export const setAppsEnabled = enabled => bridge().setEnabled(enabled)

/**
 * What a connection last read or wrote of a document, as `keepRead` was
 * handed it, or null for none.
 *
 * @param {string} connection
 * @param {string} document
 * @returns {Promise<object|null>}
 */
export const keptRead = async (connection, document) => bridge().read(connection, document)

/**
 * Everything kept for a connection, a record for each document: whole, or
 * only the fields named, which spares a caller the text of each.
 *
 * @param {string} connection
 * @param {string[]} [fields]
 * @returns {Promise<object[]>}
 */
export const keptReads = async (connection, fields) => bridge().reads(connection, fields)

/**
 * Keep what a connection now has of a document, in place of what it had.
 *
 * @param {string} connection
 * @param {string} document
 * @param {object} record
 * @returns {Promise<void>}
 */
export const keepRead = async (connection, document, record) =>
  bridge().keep(connection, document, record)

/**
 * Let go of what was kept of some documents, or of a project's: one
 * connection's, or every connection's where none is named.
 *
 * @param {{connection?: string, documents?: string[], project?: string}} what
 * @returns {Promise<void>}
 */
export const forgetReads = async what => bridge().forget(what)

/**
 * Documents deleted for good that the native side has yet to be told of.
 * @type {Set<string>}
 */
const deleted = new Set()

/** Whether the telling of them is under way: it is done once for all that gather. */
let telling = false

/**
 * Tell the native side what is gone, whatever comes of it: what was deleted
 * is deleted all the same.
 * @param {{documents?: string[], project?: string}} what
 */
const tellGone = what => {
  Promise.resolve()
    .then(() => bridge().forget(what))
    .catch(error => console.error('What connected apps had read could not be let go of:', error))
}

/**
 * Let go of what any connection had of a document, or of a project's
 * documents, deleted for good: a copy of the text is not kept past it.
 * Nothing to do outside the desktop app. Documents deleted together, as a
 * folder's or a project's are, are told of together.
 *
 * @param {{document?: string, project?: string}} gone
 */
export function forgetReadsOf({ document, project }) {
  // Called as a document is deleted, which nothing here is a reason to stop.
  try {
    if (!canConnectApps()) return
  } catch {
    return
  }
  if (project) tellGone({ project })
  if (!document) return
  deleted.add(document)
  if (telling) return
  telling = true
  queueMicrotask(() => {
    const documents = [...deleted]
    deleted.clear()
    telling = false
    tellGone({ documents })
  })
}

/**
 * Hold a file for a connection's app to fetch with its own shell: once,
 * within a few minutes, at `/export/<id>` of the address it reaches this
 * computer by.
 *
 * @param {string} connection
 * @param {{name: string, bytes: Uint8Array}} file
 * @returns {Promise<{id: string}>}
 */
export const offerAppExport = (connection, file) => bridge().offer(connection, file)

/**
 * Wait for a file from a connection's app, which its own shell sends once,
 * within a few minutes, to `/import/<id>` of the address it reaches this
 * computer by. What it is for is handed back with it.
 *
 * @param {string} connection
 * @param {Record<string, unknown>} about
 * @returns {Promise<{id: string}>}
 */
export const awaitAppImport = (connection, about) => bridge().receive(connection, about)

/**
 * The file a connection's app sent by a link, the once.
 *
 * @param {string} connection
 * @param {string} id
 * @returns {Promise<{about: Record<string, unknown>, bytes: Uint8Array}|null>} Null
 *   before one has come, or after it was taken
 */
export const takeAppImport = (connection, id) => bridge().received(connection, id)

/**
 * Say what answers an app's request in this window.
 *
 * @param {(app: AskingApp, message: object, signal: AbortSignal) => Promise<AppAnswer>} answer -
 *   `signal` is aborted when the app gives up on the request
 */
export function answerApps(answer) {
  bridge().answer((app, message, onStop) => {
    const controller = new AbortController()
    onStop(() => controller.abort())
    return answer(app, message, controller.signal)
  })
}
