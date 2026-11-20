/**
 * @module platform/terminal
 * @description In the desktop app, terminals: a shell of the writer's own in
 * a tab of the chat panel, the window's and not a project's. The page makes
 * one, lists its own and ends one;
 * what is typed goes to the shell from a frame of another origin, which the
 * page sets in place and can't reach into, so nothing in the page can run a
 * command. See `app/electron/src/terminals.js` and `.llm/terminal_design.md`.
 */

/* global URLSearchParams */
import { desktop, isDesktop } from './desktop.js'

/** @typedef {import('./desktop.js').TerminalEvent} TerminalEvent */

/** Where a terminal's frame is, and so its origin. */
export const TERMINAL_ORIGIN = 'terminal://frame'

/** What a terminal's id begins with: how its tab is told from a chat's. */
export const TERMINAL_ID = 'terminal:'

/**
 * Whether an id is a terminal's.
 *
 * @param {unknown} id
 * @returns {boolean}
 */
export const isTerminalId = id => typeof id === 'string' && id.startsWith(TERMINAL_ID)

/**
 * Whether there are terminals here: in the desktop app, one new enough to
 * have them.
 *
 * @returns {boolean}
 */
export const hasTerminal = () => isDesktop() && Boolean(desktop().terminals)

/** @returns {NonNullable<import('./desktop.js').DesktopBridge['terminals']>} */
function terminals() {
  const bridge = hasTerminal() ? desktop().terminals : null
  if (!bridge) throw new Error('Terminals are only in the desktop app.')
  return bridge
}

/**
 * Make a terminal. Its shell starts when its frame shows it.
 *
 * @returns {Promise<string>} Its id
 */
export const createTerminal = () => terminals().create()

/**
 * This window's terminals, which outlive a reload of the page.
 *
 * @returns {Promise<{id: string, title: string}[]>}
 */
export const listTerminals = () => terminals().list()

/**
 * End a terminal, and what runs in it.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
export const closeTerminal = id => terminals().close(id)

/**
 * Say what hears of this window's terminals: one named by the program in it,
 * one that rang, one whose shell ended. There is one listener.
 *
 * @param {(id: string, event: TerminalEvent) => void} listener
 */
export const onTerminalEvent = listener =>
  terminals().onEvent((id, event) => {
    listener(id, event)
  })

/**
 * How a terminal looks, which the page hands its frame.
 *
 * @typedef {Object} TerminalAppearance
 * @property {boolean} dark
 * @property {string} background - As `#rrggbb`
 * @property {string} foreground - As `#rrggbb`
 * @property {number} fontSize - In pixels
 */

/**
 * The address of a terminal's frame, looking as given from its first paint.
 *
 * @param {string} id
 * @param {TerminalAppearance} appearance
 * @returns {string}
 */
export function terminalFrameUrl(id, { dark, background, foreground, fontSize }) {
  const params = new URLSearchParams({
    id,
    dark: dark ? '1' : '0',
    background: background.replace(/^#/, ''),
    foreground: foreground.replace(/^#/, ''),
    fontSize: String(fontSize),
  })
  return `${TERMINAL_ORIGIN}/?${params}`
}
