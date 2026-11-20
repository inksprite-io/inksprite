/* global AbortController */
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
 * What a connection last read or wrote of a document, as `keepAppRead` was
 * handed it: null for none, and in a desktop app from before they were kept.
 *
 * @param {string} connection
 * @param {string} document
 * @returns {Promise<object|null>}
 */
export const appRead = async (connection, document) =>
  (await bridge().read?.(connection, document)) ?? null

/**
 * Everything kept for a connection, a record for each document.
 *
 * @param {string} connection
 * @returns {Promise<object[]>}
 */
export const appReads = async connection => (await bridge().reads?.(connection)) ?? []

/**
 * Keep what a connection now has of a document, in place of what it had.
 *
 * @param {string} connection
 * @param {string} document
 * @param {object} record
 * @returns {Promise<void>}
 */
export const keepAppRead = async (connection, document, record) => {
  await bridge().keep?.(connection, document, record)
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
