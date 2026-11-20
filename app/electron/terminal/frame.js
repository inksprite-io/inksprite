/**
 * The terminal's frame: the emulator, drawing what one terminal's shell
 * prints and sending it what is typed (`../src/terminals.js`).
 *
 * The frame is set into the app's page and is of another origin, so the page
 * can't reach in. The shell is reached through `__INKSPRITE_TERMINAL__`,
 * which the preload gives this frame alone. From the page it takes only how
 * to look (`appearance.js`), and it tells the page only that it was clicked,
 * and which of the app's shortcuts was pressed in it.
 */

import { Terminal } from './xterm/xterm.mjs'
import { FitAddon } from './xterm/addon-fit.mjs'
import { WebLinksAddon } from './xterm/addon-web-links.mjs'
import { FONT_FAMILY, appearanceFrom, appearanceOf, themeFor } from './appearance.js'
import { LINE_BREAK, keyAction } from './keys.js'

/** The lines kept above the screen, as the shell's copy keeps them. */
const SCROLLBACK = 5000

/** The narrowest the frame is fitted to: narrower, and it is on its way to hidden. */
const NARROWEST = 10

/** How long the frame's size is left to settle before the shell is told. */
const SETTLE_MS = 60

/**
 * @type {{
 *   attach: (request: {id: string, cols: number, rows: number}, onMessage: (message: any) => void) => void,
 *   send: (message: object) => void,
 * }|undefined}
 */
const bridge = /** @type {any} */ (window).__INKSPRITE_TERMINAL__

const params = new URLSearchParams(location.search)
const id = params.get('id') ?? ''
const mac = /Mac/.test(navigator.platform)

/** The page the frame is set in, which is all it posts to. */
const page = location.ancestorOrigins?.[0] ?? '*'

const host = /** @type {HTMLElement} */ (document.getElementById('terminal'))

let appearance = appearanceOf(params)
document.body.style.background = appearance.background

/**
 * Open a link the writer clicked with Command held, or Control off a Mac, as
 * terminals do: a plain click is for selecting.
 *
 * @param {MouseEvent} event
 * @param {string} url
 */
const openLink = (event, url) => {
  if (mac ? event.metaKey : event.ctrlKey) bridge?.send({ type: 'open', url })
}

const terminal = new Terminal({
  scrollback: SCROLLBACK,
  fontFamily: FONT_FAMILY,
  fontSize: appearance.fontSize,
  theme: themeFor(appearance),
  linkHandler: { activate: openLink },
})
const fit = new FitAddon()
terminal.loadAddon(fit)
terminal.loadAddon(new WebLinksAddon(openLink))
terminal.open(host)

/** Whether the shell has been asked for, which waits until the frame has a size. */
let attached = false

/**
 * The size the frame has room for, or null while it is hidden or all but.
 *
 * @returns {{cols: number, rows: number}|null}
 */
function room() {
  const size = fit.proposeDimensions()
  if (!size || !(size.cols >= NARROWEST) || !(size.rows >= 2)) return null
  return { cols: size.cols, rows: size.rows }
}

/** Take the size there is room for, and tell the shell. */
function refit() {
  const size = room()
  if (!size) return
  if (size.cols !== terminal.cols || size.rows !== terminal.rows) {
    terminal.resize(size.cols, size.rows)
  }
  bridge?.send({ type: 'resize', ...size })
}

/** Ask for the shell, at the size there is room for. */
function attach() {
  const size = room()
  if (!size || !bridge || !id) return
  attached = true
  terminal.resize(size.cols, size.rows)
  bridge.attach({ id, ...size }, fromShell)
}

/**
 * What the shell's side sends: what was printed, the screen as it stood
 * before this frame showed it, or word that the shell has ended.
 *
 * @param {any} message
 */
function fromShell(message) {
  if (message?.type === 'data') {
    const { data } = message
    terminal.write(data, () => bridge?.send({ type: 'drawn', count: data.length }))
  } else if (message?.type === 'screen') {
    // Written at the size it was kept at, and then fitted to this frame.
    terminal.reset()
    terminal.resize(message.cols, message.rows)
    terminal.write(message.data, refit)
  } else if (message?.type === 'exit') {
    terminal.options.disableStdin = true
  }
}

terminal.onData(data => bridge?.send({ type: 'input', data }))
terminal.onBinary(data => bridge?.send({ type: 'binary', data }))

terminal.attachCustomKeyEventHandler(event => {
  const action = keyAction(event, mac)
  if (!action) return true
  if (event.type !== 'keydown') return false
  if (action === 'browser') return false
  if (action === 'page') {
    const { key, code, metaKey, ctrlKey, shiftKey, altKey } = event
    window.parent.postMessage({ type: 'key', key, code, metaKey, ctrlKey, shiftKey, altKey }, page)
    return false
  }
  event.preventDefault()
  if (action === 'lineBreak') {
    bridge?.send({ type: 'input', data: LINE_BREAK })
  } else if (action === 'copy') {
    if (terminal.hasSelection()) navigator.clipboard.writeText(terminal.getSelection())
  } else if (action === 'paste') {
    navigator.clipboard.readText().then(
      text => terminal.paste(text),
      () => {}
    )
  } else if (action === 'selectAll') {
    terminal.selectAll()
  } else if (action === 'clear') {
    terminal.clear()
    bridge?.send({ type: 'clear' })
  }
  return false
})

// The page's menus close on a click outside them, and a click in here is
// one the page never sees.
window.addEventListener('pointerdown', () => window.parent.postMessage({ type: 'pointer' }, page), {
  capture: true,
})

// The page focuses the frame when its tab is shown.
window.addEventListener('focus', () => terminal.focus())

window.addEventListener('message', event => {
  if (event.source !== window.parent || event.data?.type !== 'appearance') return
  appearance = appearanceFrom(event.data.appearance, appearance)
  terminal.options.theme = themeFor(appearance)
  terminal.options.fontSize = appearance.fontSize
  document.body.style.background = appearance.background
  if (attached) refit()
})

/** @type {ReturnType<typeof setTimeout>|undefined} */
let settling
new ResizeObserver(() => {
  clearTimeout(settling)
  settling = setTimeout(() => (attached ? refit() : attach()), SETTLE_MS)
}).observe(host)

attach()
if (document.hasFocus()) terminal.focus()
