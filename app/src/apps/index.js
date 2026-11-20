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
 * - **tools** - The tools an app is offered, the documents' reading ones so
 *   far, and a call to one run
 * - **projects** - The projects ticked for an app, by name, and a call run in
 *   one in the window that has it, or that takes it for the call
 */

import { inPreview } from '@/config/preview.js'
import { answerApps, canConnectApps } from '@/platform/apps.js'
import { answerRequest } from './protocol.js'

/**
 * Whether other apps can be let into the writer's projects here: in the
 * desktop app, while the feature is in preview.
 *
 * @returns {boolean}
 */
export const appsOffered = () => inPreview('mcp-server') && canConnectApps()

/**
 * Have this window answer what connected apps ask. Called once, as the app
 * starts.
 */
export function serveApps() {
  if (!appsOffered()) return
  answerApps((app, message, signal) => answerRequest(message, { app, signal }))
}
