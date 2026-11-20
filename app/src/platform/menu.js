/**
 * @module platform/menu
 * @description In the desktop app, what its menu asks of the page: a new
 * document, a new chat, the tab the writer is in closed or the one closed
 * last opened again, the tabs stepped through, the projects, the settings
 * (`app/electron/src/menu.js`). The menu has the keys a browser keeps for
 * its own tabs, so in a browser none of it is asked.
 */

import { desktop, isDesktop } from './desktop.js'

/**
 * What the menu asks for, and for `showTab` the tab's place in its strip,
 * from 1.
 *
 * @typedef {'newDocument'|'newChat'|'projects'|'settings'|'closeTab'|'reopenTab'|'nextTab'|'previousTab'|'showTab'} MenuCommand
 */

/**
 * Whether the menu has keys for the tabs, and the rest: in the desktop app,
 * unless it is older than the page it loads.
 *
 * @returns {boolean}
 */
export const hasMenuCommands = () => isDesktop() && Boolean(desktop().onMenuCommand)

/**
 * Do something when the menu asks. One listener at a time, the writer's
 * frame's. Nothing in a browser.
 *
 * @param {(command: MenuCommand, detail?: number) => void} listener
 * @returns {() => void} Stops listening
 */
export function onMenuCommand(listener) {
  if (!hasMenuCommands()) return () => {}
  desktop().onMenuCommand?.(/** @type {(command: string, detail?: number) => void} */ (listener))
  return () => desktop().onMenuCommand?.(null)
}
