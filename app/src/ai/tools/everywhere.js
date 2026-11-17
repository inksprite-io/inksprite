/**
 * @module ai/tools/everywhere
 * @description The tools switched for the whole app, where a profile
 * switches only the group they are in: every tool but the documents' and the
 * skills (./choice.js).
 *
 * A tool is on wherever its group is, unless it is off here; and one that
 * may ask the writer first is asked about, or always allowed, here too. Each
 * is kept with what it is a tool of, so it goes where that goes: a server's
 * on the server's own row, by the tool's own name, and the app's own (the
 * web's, Python's, the RPG's) in the app's settings. What the web's ask
 * about is the web search's to say (web/config.js).
 */

import { useApplicationState } from '@/composables/useApplicationState.js'
import { needsApproval, serverTool } from '@/mcp/servers.js'
import { readingAllowed, savesWithoutAsking } from '@/web/config.js'
import { READ_WEB_PAGE, SAVE_WEB_PAGE } from './web.js'

/**
 * How a tool is set for the whole app: off, on, or for one that may ask the
 * writer before it runs, asking first or always allowed.
 *
 * @typedef {'off'|'on'|'ask'|'always'} ToolSetting
 */

/**
 * Whether a tool is switched off for the whole app.
 *
 * @param {string} name - The tool, as the model calls it
 * @returns {boolean}
 */
export function offEverywhere(name) {
  const found = serverTool(name)
  if (found) return (found.server.off || []).includes(found.tool.name)
  return useApplicationState().toolsOff.value.includes(name)
}

/**
 * Whether a tool is one that may ask the writer before it runs: a server's,
 * and the web's two that fetch an address the model names.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function mayAsk(name) {
  return name === READ_WEB_PAGE || name === SAVE_WEB_PAGE || serverTool(name) !== null
}

/**
 * How a tool is set for the whole app.
 *
 * @param {string} name - The tool, as the model calls it
 * @returns {ToolSetting}
 */
export function settingOf(name) {
  if (offEverywhere(name)) return 'off'
  if (name === READ_WEB_PAGE) return readingAllowed().always ? 'always' : 'ask'
  if (name === SAVE_WEB_PAGE) return savesWithoutAsking() ? 'always' : 'ask'
  if (serverTool(name)) return needsApproval(name) ? 'ask' : 'always'
  return 'on'
}
