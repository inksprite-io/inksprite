/**
 * @module composables/useToolSettings
 * @description A tool's setting for the whole app (ai/tools/everywhere.js),
 * read so that a screen follows it and written where it is kept: a server's
 * tool on the server's row, the web's two that ask in the web search's
 * settings, and off or on for any of the app's own. For the tool list in a
 * chat's settings, and for wherever else a tool's setting is shown: the
 * web's, beside the service that searches.
 */

import { mayAsk, settingOf } from '@/ai/tools/everywhere.js'
import { READ_WEB_PAGE, SAVE_WEB_PAGE, WEB_SEARCH } from '@/ai/tools/web.js'
import { serverTool } from '@/mcp/servers.js'
import { useApplicationState } from './useApplicationState.js'
import { useMcpServers } from './useMcpServers.js'
import { useWebSearch } from './useWebSearch.js'

/** @typedef {{label: string, value: string}} Option */

/** For a tool that never asks. @type {Option[]} */
export const OFF_ON = [
  { label: 'Off', value: 'off' },
  { label: 'On', value: 'on' },
]

/** For a tool that may ask the writer before it runs. @type {Option[]} */
export const OFF_ASK_ALWAYS = [
  { label: 'Off', value: 'off' },
  { label: 'Ask first', value: 'ask' },
  { label: 'Always allow', value: 'always' },
]

/**
 * The web's tools as the writer reads them, in the order they are listed,
 * the group's name left unsaid.
 * @type {Record<string, string>}
 */
export const WEB_TOOL_LABELS = {
  [WEB_SEARCH]: 'Search',
  [READ_WEB_PAGE]: 'Read pages',
  [SAVE_WEB_PAGE]: 'Save pages',
}

/**
 * @returns {{
 *   optionsFor: (name: string) => Option[],
 *   settingOf: (name: string) => import('@/ai/tools/everywhere.js').ToolSetting,
 *   setSetting: (name: string, setting: string) => void,
 * }}
 */
export function useToolSettings() {
  const app = useApplicationState()
  const mcp = useMcpServers()
  const webSearch = useWebSearch()

  return {
    /** What a tool can be set to: three ways for one that may ask first. */
    optionsFor: name => (mayAsk(name) ? OFF_ASK_ALWAYS : OFF_ON),

    /** How a tool is set, read again when what keeps it changes. */
    settingOf(name) {
      void mcp.servers.value
      void webSearch.setup.value
      void app.toolsOff.value
      return settingOf(name)
    },

    /**
     * Set a tool for the whole app.
     * @param {string} name - The tool, as the model calls it
     * @param {string} setting - `off`, `on`, `ask` or `always`
     */
    setSetting(name, setting) {
      if (serverTool(name)) {
        mcp.setToolSetting(name, /** @type {'off'|'ask'|'always'} */ (setting))
        return
      }
      app.setToolOff(name, setting === 'off')
      if (setting === 'off') return
      if (name === READ_WEB_PAGE) webSearch.setAskBeforeReading(setting === 'ask')
      if (name === SAVE_WEB_PAGE) webSearch.setAskBeforeSaving(setting === 'ask')
    },
  }
}
