/**
 * @module apps
 * @description Other apps on the same computer, working in the writer's
 * projects: a coding agent reading a design where it is written. In the
 * desktop app, which serves them over MCP. See `.llm/mcp_server_design.md`.
 *
 * The native side is the door (`app/electron/src/appServer.js`): it listens,
 * checks who is asking against the connections the writer made
 * (Settings › Connections › Connected apps), and hands what an app asks to a
 * window. This module is what the asking means:
 *
 * - **protocol** - MCP's requests answered, as far as tools go
 * - **tools** - The tools an app is offered, a chat's document tools with a
 *   project named on each, or only those that read for a connection that
 *   only reads: one table of what is true of each, and a call to one run,
 *   with the document it is on taken once before and once after
 * - **projects** - The projects ticked for an app, by name, and a call run in
 *   one in the window that has it, or that takes it for the call
 * - **writes** - A write's answer saying how the text was stored, where that
 *   isn't how it was sent
 * - **revisions** - A revision on every read and write of a document, what
 *   the connection last had of it, and what has changed since
 * - **exports** - A document or a folder made ready as files, each text
 *   stamped with its document, for the app's own shell to fetch by a link
 */

import { answerApps, canConnectApps } from '@/platform/apps.js'
import { answerRequest } from './protocol.js'

/**
 * Whether other apps can be let into the writer's projects here: in the
 * desktop app, one new enough to.
 *
 * @returns {boolean}
 */
export const appsOffered = () => canConnectApps()

/**
 * Have this window answer what connected apps ask. Called once, as the app
 * starts.
 */
export function serveApps() {
  if (!appsOffered()) return
  answerApps((app, message, signal) => answerRequest(message, { app, signal }))
}
