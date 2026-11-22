/**
 * @module platform/terminal
 * @description In the desktop app, terminals: a shell of the writer's own in
 * a tab of a project's chat panel. A page makes one in a project, lists those
 * there are and ends one; what is typed goes to the shell from a frame of
 * another origin, which the page sets in place and can't reach into, so
 * nothing in the page can run a command. What passes between the page and
 * that frame is here too: how the frame is to look, in its address, and a
 * shortcut pressed in it, read as the frame said it. See
 * `app/electron/src/terminals.js` and `.llm/terminal_design.md`.
 */

/* global URLSearchParams */
import { desktop, isDesktop } from './desktop.js'

/** @typedef {import('./desktop.js').TerminalEvent} TerminalEvent */

/**
 * Where a terminal's frame is, and so its origin: the native side's, written
 * out again here, as `TERMINAL_ID` is. A test holds each to the other.
 */
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
 * Make a terminal in a project. Its shell starts when its frame shows it.
 *
 * @param {string} project - The project's id
 * @returns {Promise<string>} Its id
 */
export const createTerminal = project => terminals().create(project)

/**
 * Every terminal there is, in whichever project: they outlive the window
 * that made them, and a reload of the page.
 *
 * @returns {Promise<{id: string, project: string, title: string, rang: boolean}[]>}
 */
export const listTerminals = () => terminals().list()

/**
 * Say a terminal that rang has been looked at, which every window then knows.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
export const terminalSeen = id => terminals().seen(id)

/**
 * End a terminal, and what runs in it.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
export const closeTerminal = id => terminals().close(id)

/**
 * Say what hears of the terminals, in whichever window they show: one made,
 * one named by the program in it, one that rang or was looked at since, one
 * that is gone. There is one listener.
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

/**
 * A key pressed, as far as a shortcut goes.
 *
 * @typedef {Object} PressedKey
 * @property {string} key
 * @property {string} code
 * @property {boolean} metaKey
 * @property {boolean} ctrlKey
 * @property {boolean} shiftKey
 * @property {boolean} altKey
 */

/** Whether the page is on a Mac, where the app's keys are on Command. */
const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent || '')

/**
 * Which of the terminal's keys a key is. Command-L makes one, as in command
 * line, and Control-Shift-L off a Mac, where Control-L clears a shell's
 * screen and terminals keep their own keys on Control-Shift. Control-` goes
 * to a terminal, as editors of code have it, on a Mac too, where Command-`
 * goes from window to window, and with Shift makes one, as they have that
 * too. The key left of 1 by where it is, or by what it types where the
 * keyboard has it elsewhere. A terminal's frame hands them to the page,
 * reading them the same (`electron/terminal/keys.js`).
 *
 * @param {PressedKey} event
 * @param {boolean} [mac] - Whether to read it as a Mac's; this one's, if not given
 * @returns {'showTerminal'|'newTerminal'|null}
 */
export function terminalKey({ key, code, metaKey, ctrlKey, shiftKey, altKey }, mac = IS_MAC) {
  if (altKey) return null
  if (key.toLowerCase() === 'l') {
    const held = mac ? metaKey && !ctrlKey && !shiftKey : ctrlKey && shiftKey && !metaKey
    return held ? 'newTerminal' : null
  }
  if (!ctrlKey || metaKey) return null
  if (code !== 'Backquote' && key !== '`' && key !== '~') return null
  return shiftKey ? 'newTerminal' : 'showTerminal'
}

/**
 * A shortcut as a frame said it was pressed, as what a key event is made
 * from. Only one with Command held, or one of the terminal's own keys, is
 * the app's to act on: everything else typed in a terminal is its shell's.
 * Null for anything else.
 *
 * @param {any} said
 * @returns {PressedKey|null}
 */
export function appShortcutFrom(said) {
  if (typeof said !== 'object' || said === null) return null
  const { key, code } = said
  if (typeof key !== 'string' || typeof code !== 'string') return null
  if (key.length > 20 || code.length > 20) return null
  const shortcut = {
    key,
    code,
    metaKey: said.metaKey === true,
    ctrlKey: said.ctrlKey === true,
    shiftKey: said.shiftKey === true,
    altKey: said.altKey === true,
  }
  return shortcut.metaKey || terminalKey(shortcut) ? shortcut : null
}
