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
 * without its token.
 * @typedef {Omit<AppConnection, 'token'|'created'>} AskingApp
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
 * Change a connection's name, its projects, or what it may do.
 * @param {string} id
 * @param {Partial<Pick<AppConnection, 'name'|'projects'|'edit'|'comment'>>} patch
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
 * Have apps reach inksprite on another port.
 * @param {number} port
 * @returns {Promise<AppsState>}
 */
export const setAppsPort = port => bridge().setPort(port)

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
