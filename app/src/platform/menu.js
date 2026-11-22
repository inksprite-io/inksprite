/**
 * @module platform/menu
 * @description In the desktop app, what its menu asks of the page: a new
 * document, a new chat or terminal, the tab the writer is in closed or the
 * one closed last opened again, the tabs stepped through, a terminal shown,
 * the projects, the settings (`app/electron/src/menu.js`). The menu has the
 * keys a browser keeps for its own tabs, so in a browser none of it is
 * asked. What it holds of what the page's settings decide, a new chat and
 * the terminals, the page tells it.
 */

import { desktop, isDesktop } from './desktop.js'

/**
 * What the menu asks for, and for `showTab` the tab's place in its strip,
 * from 1.
 *
 * @typedef {'newDocument'|'newChat'|'newTerminal'|'showTerminal'|'projects'|'settings'|'closeTab'|'reopenTab'|'nextTab'|'previousTab'|'showTab'} MenuCommand
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

/**
 * Have the menu hold a new chat, while the AI is on, and the terminals,
 * while their extension is. Nothing in a browser, or in a desktop app older
 * than the page.
 *
 * @param {{chat: boolean, terminal: boolean}} items
 */
export function showInMenu(items) {
  if (isDesktop()) desktop().showInMenu?.({ chat: items.chat, terminal: items.terminal })
}
