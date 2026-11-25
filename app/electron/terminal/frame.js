/**
 * The terminal's frame: the emulator, drawing what one terminal's shell
 * prints and sending it what is typed (`../src/terminals.js`).
 *
 * The frame is set into the app's page and is of another origin, so the page
 * can't reach in. The shell is reached through `__INKSPRITE_TERMINAL__`,
 * which the preload gives this frame alone. From the page it takes only how
 * to look (`appearance.js`), and it tells the page only that it was clicked,
 * and which of the app's shortcuts was pressed in it.
 *
 * The page does say where the keys go, so the frame takes what is typed and
 * pasted only while it is shown (`sight.js`). What is pasted is cleaned
 * before the shell has it (`paste.js`), and a link says where it leads before
 * it is clicked (`address.js`).
 */

/* global IntersectionObserver */
import { Terminal } from './xterm/xterm.mjs'
import { FitAddon } from './xterm/addon-fit.mjs'
import { WebLinksAddon } from './xterm/addon-web-links.mjs'
import { shownAddress } from './address.js'
import { FONT_FAMILY, appearanceFrom, appearanceOf, themeFor } from './appearance.js'
import { LINE_BREAK, keyAction } from './keys.js'
import { cleanPaste, takePastes } from './paste.js'
import { IN_WINDOW, isShown, keysGate } from './sight.js'

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

/** The line at the frame's foot that says where a link leads. */
const foot = /** @type {HTMLElement} */ (document.getElementById('address'))

let appearance = appearanceOf(params)

/** Give the frame its appearance's two colours, for the ground and the line at its foot. */
function wear() {
  const { style } = document.documentElement
  style.setProperty('--ground', appearance.background)
  style.setProperty('--text', appearance.foreground)
}
wear()

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

/**
 * Say where the link under the pointer leads, at the foot of the frame, as a
 * browser does: a program can print a link under any words it likes.
 *
 * @param {string|null} url - The link's address, or null once the pointer
 *   has left it
 */
function showAddress(url) {
  const address = url ? shownAddress(url) : ''
  foot.textContent = address
  foot.hidden = !address
}

/** What a link does under the pointer, whether a program made it one or its text is an address. */
const link = {
  activate: openLink,
  hover: (/** @type {MouseEvent} */ _event, /** @type {string} */ url) => showAddress(url),
  leave: () => showAddress(null),
}

const terminal = new Terminal({
  scrollback: SCROLLBACK,
  fontFamily: FONT_FAMILY,
  fontSize: appearance.fontSize,
  theme: themeFor(appearance),
  linkHandler: link,
})
const fit = new FitAddon()
terminal.loadAddon(fit)
terminal.loadAddon(new WebLinksAddon(openLink, { hover: link.hover, leave: link.leave }))
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

/**
 * What the emulator has for its shell goes through here: what is typed and
 * pasted only while the terminal is shown, or for the moment after it is
 * given the keys, until the browser says whether it is.
 */
const gate = keysGate(message => bridge?.send(message))

terminal.onData(data => gate.say({ type: 'input', data }))
terminal.onBinary(data => gate.say({ type: 'binary', data }))

/**
 * What the frame knows of where it is: nothing, until the browser says.
 * @type {import('./sight.js').Sight}
 */
const sight = { share: 0, size: null }

/**
 * Look again at whether the terminal is shown, when the frame is given the
 * keys and when what it knows of where it is changes. Shown, it takes the
 * keys the frame has; not shown, it lets them go.
 */
function look() {
  sight.size = room()
  const was = gate.shown
  gate.show(isShown(sight))
  if (gate.shown === was) return
  if (!gate.shown) terminal.blur()
  else if (document.hasFocus()) terminal.focus()
}

// How much of the frame is in the window, which the browser says as it changes.
new IntersectionObserver(
  entries => {
    sight.share = entries[entries.length - 1].intersectionRatio
    look()
  },
  { threshold: [0, IN_WINDOW, 1] }
).observe(document.documentElement)

// The emulator takes the keys itself when it is clicked, shown or not.
terminal.textarea?.addEventListener('focus', () => {
  if (!gate.takes) terminal.blur()
})

takePastes(host, text => {
  if (gate.takes) terminal.paste(text)
})

terminal.attachCustomKeyEventHandler(event => {
  if (!gate.takes) return false
  const action = keyAction(event, mac)
  if (!action) return true
  if (event.type !== 'keydown') return false
  if (action === 'browser') return false
  if (action === 'page' || action === 'pageAlone') {
    // One of the terminal's own keys held down is pressed once: each would
    // make a terminal.
    if (action === 'pageAlone' && event.repeat) {
      event.preventDefault()
      return false
    }
    const { key, code, metaKey, ctrlKey, shiftKey, altKey } = event
    window.parent.postMessage({ type: 'key', key, code, metaKey, ctrlKey, shiftKey, altKey }, page)
    if (action === 'pageAlone') event.preventDefault()
    return false
  }
  event.preventDefault()
  if (action === 'lineBreak') {
    gate.say({ type: 'input', data: LINE_BREAK })
  } else if (action === 'copy') {
    if (terminal.hasSelection()) navigator.clipboard.writeText(terminal.getSelection())
  } else if (action === 'paste') {
    navigator.clipboard.readText().then(
      text => {
        if (gate.takes) terminal.paste(cleanPaste(text))
      },
      () => {}
    )
  } else if (action === 'selectAll') {
    terminal.selectAll()
  } else if (action === 'clear') {
    // Only what is seen is cleared: in the moment before the browser says a
    // terminal just given the keys is shown, it may be one that never is.
    if (gate.shown) {
      terminal.clear()
      bridge?.send({ type: 'clear' })
    }
  }
  return false
})

// The page's menus close on a click outside them, and a click in here is
// one the page never sees.
window.addEventListener('pointerdown', () => window.parent.postMessage({ type: 'pointer' }, page), {
  capture: true,
})

// The page focuses the frame when its tab is shown, a moment before the
// browser says the frame is in the window.
window.addEventListener('focus', () => {
  look()
  gate.wait(() => terminal.blur())
  terminal.focus()
})

window.addEventListener('message', event => {
  if (event.source !== window.parent || event.data?.type !== 'appearance') return
  appearance = appearanceFrom(event.data.appearance, appearance)
  terminal.options.theme = themeFor(appearance)
  terminal.options.fontSize = appearance.fontSize
  wear()
  if (attached) refit()
})

/** @type {ReturnType<typeof setTimeout>|undefined} */
let settling
new ResizeObserver(() => {
  look()
  clearTimeout(settling)
  settling = setTimeout(() => {
    if (attached) refit()
    else attach()
    // Once more with the size settled: the emulator may not have known the
    // size of its letters the first time, in a frame only just shown.
    look()
  }, SETTLE_MS)
}).observe(host)

attach()
