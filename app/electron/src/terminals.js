/**
 * Terminals: a shell of the writer's own, in a tab of the chat panel
 * (`.llm/terminal_design.md`).
 *
 * The page never types into one. What the page may do is make a terminal,
 * list its own and end one; the keys go from a frame of another origin,
 * `terminal://frame/`, whose page is ours (`../terminal/`) and shows nothing
 * but what the shell prints. So a script that got into the page, from what a
 * model wrote or a page it kept, has no way to run a command: the frame's
 * window is closed to it, and only that frame is handed the port.
 *
 * A terminal outlives its frame. The chat panel comes and goes (another
 * project, focus mode, a reload), and what runs in a terminal must not die
 * with it, so the process is kept here with a copy of its screen, a terminal
 * without a window that reads all the shell prints. A frame that attaches is
 * sent the screen as it stands and then what comes after.
 *
 * A terminal is a project's, named by the page that makes it, and no
 * window's: it runs on while its project isn't open anywhere, and is there
 * in whichever window opens the project next. So every window's page is told
 * what becomes of every terminal, and any of them may end one. It ends when
 * a page says so (its tab closed, its project gone), when its shell does, and
 * when the app quits.
 */

import { app, protocol, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openable, originOf } from './links.js'

/** The frame's scheme. */
export const TERMINAL_SCHEME = 'terminal'

/** Where the frame's page is, and so its origin. */
export const TERMINAL_ORIGIN = `${TERMINAL_SCHEME}://frame`

/** The scheme as `protocol.registerSchemesAsPrivileged` takes it. */
export const TERMINAL_SCHEME_PRIVILEGES = {
  scheme: TERMINAL_SCHEME,
  privileges: { standard: true, secure: true },
}

/** What a terminal's id begins with, which is how the page tells its tab from a chat's. */
export const TERMINAL_ID = 'terminal:'

/** The lines kept above the screen, here and in the frame. */
export const SCROLLBACK = 5000

/** The longest title kept of what a program names its terminal. */
const TITLE_MOST = 200

/**
 * How much the shell may print ahead of what has been read, in characters:
 * past the first it is held, until what is unread falls under the second. A
 * program that prints without end would otherwise fill the memory.
 */
const HELD_ABOVE = 400_000
const FREED_BELOW = 40_000

/**
 * What the frame's page may load: its own files. The emulator draws with
 * styles it writes itself. And where it may be set: in the app's page.
 *
 * @param {string} pageOrigin
 * @returns {string}
 */
export const terminalCsp = pageOrigin =>
  [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `frame-ancestors ${pageOrigin}`,
  ].join('; ')

/** Content types, by extension, of what the frame is served. */
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
}

/**
 * The frame's files, by their paths in its page: its own, and the emulator's
 * from its package. Nothing else is served.
 *
 * @type {Record<string, [package: string|null, file: string]>}
 */
const FILES = {
  '/': [null, 'index.html'],
  '/frame.js': [null, 'frame.js'],
  '/appearance.js': [null, 'appearance.js'],
  '/keys.js': [null, 'keys.js'],
  '/frame.css': [null, 'frame.css'],
  '/xterm/xterm.mjs': ['@xterm/xterm', 'lib/xterm.mjs'],
  '/xterm/xterm.css': ['@xterm/xterm', 'css/xterm.css'],
  '/xterm/addon-fit.mjs': ['@xterm/addon-fit', 'lib/addon-fit.mjs'],
  '/xterm/addon-web-links.mjs': ['@xterm/addon-web-links', 'lib/addon-web-links.mjs'],
}

const require = createRequire(import.meta.url)

/**
 * The file a request for `pathname` is answered with, or null.
 *
 * @param {string} pathname
 * @param {(name: string) => string} [packageFolder] - Where a package is
 * @returns {string|null}
 */
export function terminalFile(
  pathname,
  packageFolder = name => path.dirname(require.resolve(`${name}/package.json`))
) {
  const found = Object.hasOwn(FILES, pathname) ? FILES[pathname] : null
  if (!found) return null
  const [from, file] = found
  const folder = from ? packageFolder(from) : fileURLToPath(new URL('../terminal', import.meta.url))
  return path.join(folder, file)
}

/**
 * Answer the frame's scheme from its files.
 *
 * @param {string} pageOrigin - The app's page's
 */
export function serveTerminalFrame(pageOrigin) {
  const csp = terminalCsp(pageOrigin)
  protocol.handle(TERMINAL_SCHEME, async request => {
    const url = new URL(request.url)
    const file = url.host === 'frame' ? terminalFile(url.pathname) : null
    const body = file && (await readFile(file).catch(() => null))
    if (!body) return new Response(null, { status: 404 })
    return new Response(body, {
      headers: {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Content-Security-Policy': csp,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })
}

/**
 * The shell a terminal runs, and how it is started: the writer's own, as a
 * login shell on a Mac, where an app opened from the Dock has none of what
 * their profile sets (the `PATH` first of all) and every terminal starts one.
 * Elsewhere the app has the session's environment already, and the shell
 * reads what an interactive one does.
 *
 * @param {string} platform - As `process.platform`
 * @param {Record<string, string|undefined>} env
 * @param {string|null} [userShell] - The shell the system has for the user
 * @returns {{file: string, args: string[]}}
 */
export function shellFor(platform, env, userShell = null) {
  if (platform === 'win32') return { file: 'powershell.exe', args: [] }
  const file = env.SHELL || userShell || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  return { file, args: platform === 'darwin' ? ['-l'] : [] }
}

/**
 * The environment a terminal's shell starts with: the app's, without what
 * was meant for the app alone, saying what kind of terminal it is in. An app
 * opened from the Dock has no language set, and a program then takes the
 * text it prints for ASCII, so one is given from the system's.
 *
 * @param {Record<string, string|undefined>} env
 * @param {{locale?: string, version?: string}} [about]
 * @returns {Record<string, string>}
 */
export function shellEnv(env, { locale = '', version = '' } = {}) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && !/^(ELECTRON_|INKSPRITE_|CHROME_|GOOGLE_API_KEY$)/.test(name)) {
      out[name] = value
    }
  }
  if (!out.LANG && !out.LC_ALL && !out.LC_CTYPE) {
    const [, language, region] = /^([a-z]{2,3})[-_]([A-Z]{2})$/.exec(locale) ?? []
    out.LANG = `${language ? `${language}_${region}` : 'en_US'}.UTF-8`
  }
  out.TERM = 'xterm-256color'
  out.COLORTERM = 'truecolor'
  out.TERM_PROGRAM = 'inksprite'
  if (version) out.TERM_PROGRAM_VERSION = version
  return out
}

/**
 * A size as a terminal takes it, or null for anything else.
 *
 * @param {any} size
 * @returns {{cols: number, rows: number}|null}
 */
export function sizeFrom(size) {
  const { cols, rows } = size ?? {}
  const whole = (/** @type {unknown} */ n) =>
    typeof n === 'number' && Number.isInteger(n) && n >= 2 && n <= 1000
  return whole(cols) && whole(rows) ? { cols, rows } : null
}

/**
 * A shell's process, as the terminals use it. `node-pty`'s is one.
 *
 * @typedef {Object} Pty
 * @property {(listener: (data: string) => void) => unknown} onData
 * @property {(listener: (exit: {exitCode: number, signal?: number}) => void) => unknown} onExit
 * @property {(data: string|Buffer) => void} write
 * @property {(cols: number, rows: number) => void} resize
 * @property {() => void} pause
 * @property {() => void} resume
 * @property {(signal?: string) => void} kill
 */

/**
 * A copy of a terminal's screen, kept by reading all its shell prints.
 *
 * @typedef {Object} Mirror
 * @property {number} cols
 * @property {number} rows
 * @property {(data: string, done?: () => void) => void} write - `done` once it
 *   has been read, and before anything written after it is
 * @property {(cols: number, rows: number) => void} resize
 * @property {() => void} clear - Forget what scrolled off the screen
 * @property {() => string} serialize - What, written to an empty terminal of
 *   this size, makes the screen and what scrolled off it
 * @property {(listener: (title: string) => void) => unknown} onTitle
 * @property {(listener: () => void) => unknown} onBell
 * @property {(listener: (data: string) => void) => unknown} onAnswer - What the
 *   terminal itself says back to a program that asks it something
 * @property {() => void} dispose
 */

/**
 * The frame's end, as the terminals use it: an Electron `MessagePortMain`.
 *
 * @typedef {Object} Port
 * @property {(message: any) => void} postMessage
 * @property {(event: 'message'|'close', listener: (event: any) => void) => unknown} on
 * @property {() => void} start
 * @property {() => void} close
 */

/**
 * What the pages are told of a terminal: it was made in a project, the
 * program in it named it, it rang, it was looked at since, or it is gone,
 * `failed` for a shell that never started.
 *
 * @typedef {{type: 'made', project: string}
 *   | {type: 'title', title: string}
 *   | {type: 'bell'}
 *   | {type: 'seen'}
 *   | {type: 'exit', failed?: true}} TerminalEvent
 */

/**
 * @typedef {Object} Terminal
 * @property {string} id
 * @property {string} project - The project it was made in, as the page named it
 * @property {string} title
 * @property {boolean} rang - Whether it rang its bell and hasn't been looked
 *   at since
 * @property {Pty|null} pty - Null until a frame first attaches, and says how
 *   large it is
 * @property {Mirror|null} mirror
 * @property {Port|null} port - The frame showing it, if one is
 * @property {string[]|null} waiting - What was printed since a frame attached
 *   and before it was sent the screen, to send after; null once it has it
 * @property {number} unread - Characters sent to the frame and not yet drawn
 * @property {number} unmirrored - Characters not yet read into the copy
 * @property {boolean} held - Whether the shell is held back
 */

/**
 * A shell process, started with what the terminals were made with.
 *
 * @param {{cols: number, rows: number}} size
 * @returns {Pty}
 */
function startShell({ cols, rows }) {
  const pty = require('node-pty')
  const { file, args } = shellFor(process.platform, process.env, userShell())
  return pty.spawn(file, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: os.homedir(),
    env: shellEnv(process.env, { locale: app.getSystemLocale(), version: app.getVersion() }),
  })
}

/** The shell the system has for the user, where it says. */
function userShell() {
  try {
    return os.userInfo().shell
  } catch {
    return null
  }
}

/**
 * A copy of a screen, on the emulator the frame draws with, without a window.
 *
 * @param {{cols: number, rows: number}} size
 * @returns {Mirror}
 */
function headlessMirror({ cols, rows }) {
  const { Terminal } = require('@xterm/headless')
  const { SerializeAddon } = require('@xterm/addon-serialize')
  const terminal = new Terminal({ cols, rows, scrollback: SCROLLBACK, allowProposedApi: true })
  const serializer = new SerializeAddon()
  terminal.loadAddon(serializer)
  return {
    get cols() {
      return terminal.cols
    },
    get rows() {
      return terminal.rows
    },
    write: (data, done) => terminal.write(data, done),
    resize: (toCols, toRows) => terminal.resize(toCols, toRows),
    clear: () => terminal.clear(),
    serialize: () => serializer.serialize(),
    onTitle: listener => terminal.onTitleChange(listener),
    onBell: listener => terminal.onBell(listener),
    onAnswer: listener => terminal.onData(listener),
    dispose: () => terminal.dispose(),
  }
}

/** The longest name of a project a terminal is made in. */
const PROJECT_MOST = 200

/**
 * The app's terminals, each a project's.
 */
export class Terminals {
  /** @type {Map<string, Terminal>} */
  #terminals = new Map()
  #start
  #mirror
  #tell
  #open

  /**
   * @param {Object} with
   * @param {(id: string, event: TerminalEvent) => void} with.tell - Tells the
   *   pages what became of a terminal
   * @param {(size: {cols: number, rows: number}) => Pty} [with.start]
   * @param {(size: {cols: number, rows: number}) => Mirror} [with.mirror]
   * @param {(url: string) => unknown} [with.open] - Opens a link the writer
   *   clicked
   */
  constructor({ tell, start = startShell, mirror = headlessMirror, open = shell.openExternal }) {
    this.#tell = tell
    this.#start = start
    this.#mirror = mirror
    this.#open = open
  }

  /**
   * Make a terminal in a project. Its shell starts when a frame first shows
   * it, and says how large it is.
   *
   * @param {unknown} project - The project, by the name the page has for it,
   *   which the pages are told again with its terminals
   * @returns {string} Its id
   */
  create(project) {
    if (typeof project !== 'string' || !project || project.length > PROJECT_MOST) {
      throw new Error('A terminal is made in a project, named by a string.')
    }
    const id = `${TERMINAL_ID}${randomUUID()}`
    this.#terminals.set(id, {
      id,
      project,
      title: '',
      rang: false,
      pty: null,
      mirror: null,
      port: null,
      waiting: null,
      unread: 0,
      unmirrored: 0,
      held: false,
    })
    this.#tell(id, { type: 'made', project })
    return id
  }

  /**
   * Every terminal, in the order they were made.
   *
   * @returns {{id: string, project: string, title: string, rang: boolean}[]}
   */
  list() {
    return [...this.#terminals.values()].map(({ id, project, title, rang }) => ({
      id,
      project,
      title,
      rang,
    }))
  }

  /**
   * Show a terminal in a frame: start its shell at the frame's size, if it
   * hasn't one, or send the frame the screen as it stands, and from then on
   * what the shell prints. A frame that showed it before is let go, in
   * whichever window it was. A frame that names no terminal there is, or no
   * size, is told there is none.
   *
   * @param {unknown} id
   * @param {Port} port
   * @param {unknown} size
   */
  attach(id, port, size) {
    const terminal = typeof id === 'string' ? this.#terminals.get(id) : undefined
    const at = sizeFrom(size)
    if (!terminal || !at) {
      port.postMessage({ type: 'exit' })
      port.close()
      return
    }
    terminal.port?.close()
    terminal.port = port
    terminal.unread = 0
    port.on('message', ({ data }) => {
      if (terminal.port === port) this.#fromFrame(terminal, data)
    })
    port.on('close', () => {
      if (terminal.port !== port) return
      terminal.port = null
      terminal.waiting = null
      terminal.unread = 0
      this.#ease(terminal)
    })
    port.start()

    if (!terminal.pty) {
      try {
        this.#begin(terminal, at)
      } catch (error) {
        console.error('A terminal’s shell could not be started:', error)
        this.#ended(terminal, true)
      }
      return
    }
    // The screen as it stands once all that was printed has been read into
    // the copy, and then what was printed while it was.
    const mirror = /** @type {Mirror} */ (terminal.mirror)
    terminal.waiting = []
    mirror.write('', () => {
      if (terminal.port !== port) return
      port.postMessage({
        type: 'screen',
        cols: mirror.cols,
        rows: mirror.rows,
        data: mirror.serialize(),
      })
      const waiting = terminal.waiting ?? []
      terminal.waiting = null
      for (const data of waiting) this.#send(terminal, data)
    })
  }

  /**
   * End a terminal: its shell is hung up on, as when a terminal's window is
   * closed, and the pages are told it is gone.
   *
   * @param {unknown} id
   */
  close(id) {
    const terminal = typeof id === 'string' ? this.#terminals.get(id) : undefined
    if (!terminal) return
    this.#drop(terminal)
    this.#tell(terminal.id, { type: 'exit' })
  }

  /** End every terminal, as the app quits. */
  closeAll() {
    for (const terminal of [...this.#terminals.values()]) this.#drop(terminal)
  }

  /**
   * A terminal that rang has been looked at.
   *
   * @param {unknown} id
   */
  seen(id) {
    const terminal = typeof id === 'string' ? this.#terminals.get(id) : undefined
    if (!terminal?.rang) return
    terminal.rang = false
    this.#tell(terminal.id, { type: 'seen' })
  }

  /**
   * Start a terminal's shell, and its copy of the screen.
   *
   * @param {Terminal} terminal
   * @param {{cols: number, rows: number}} size
   */
  #begin(terminal, size) {
    const pty = this.#start(size)
    const mirror = this.#mirror(size)
    terminal.pty = pty
    terminal.mirror = mirror
    pty.onData(data => {
      if (terminal.pty !== pty) return
      terminal.unmirrored += data.length
      mirror.write(data, () => {
        terminal.unmirrored -= data.length
        this.#ease(terminal)
      })
      if (terminal.waiting) terminal.waiting.push(data)
      else this.#send(terminal, data)
      if (!terminal.held && Math.max(terminal.unread, terminal.unmirrored) > HELD_ABOVE) {
        terminal.held = true
        pty.pause()
      }
    })
    pty.onExit(() => {
      if (terminal.pty === pty) this.#ended(terminal)
    })
    mirror.onTitle(title => {
      terminal.title = String(title).slice(0, TITLE_MOST)
      this.#tell(terminal.id, { type: 'title', title: terminal.title })
    })
    mirror.onBell(() => {
      terminal.rang = true
      this.#tell(terminal.id, { type: 'bell' })
    })
    // A program that asks the terminal something (where the cursor is, what
    // it can do) is answered by the frame's, and with no frame by the copy.
    mirror.onAnswer(data => {
      if (!terminal.port && terminal.pty === pty) pty.write(data)
    })
  }

  /**
   * Send the frame what the shell printed.
   *
   * @param {Terminal} terminal
   * @param {string} data
   */
  #send(terminal, data) {
    if (!terminal.port) return
    terminal.unread += data.length
    terminal.port.postMessage({ type: 'data', data })
  }

  /**
   * Let a held shell go on, once enough of what it printed has been read.
   *
   * @param {Terminal} terminal
   */
  #ease(terminal) {
    if (!terminal.held || Math.max(terminal.unread, terminal.unmirrored) >= FREED_BELOW) return
    terminal.held = false
    terminal.pty?.resume()
  }

  /**
   * What the frame sends: the keys typed, its size, how much it has drawn,
   * that it was cleared, and a link clicked.
   *
   * @param {Terminal} terminal
   * @param {any} message
   */
  #fromFrame(terminal, message) {
    const { pty, mirror } = terminal
    if (!pty || !mirror || typeof message !== 'object' || message === null) return
    if (message.type === 'input') {
      if (typeof message.data === 'string') pty.write(message.data)
    } else if (message.type === 'binary') {
      // What a program asked for as bytes, a mouse's place among them.
      if (typeof message.data === 'string') pty.write(Buffer.from(message.data, 'binary'))
    } else if (message.type === 'clear') {
      mirror.clear()
    } else if (message.type === 'resize') {
      const size = sizeFrom(message)
      if (!size || (size.cols === mirror.cols && size.rows === mirror.rows)) return
      pty.resize(size.cols, size.rows)
      mirror.resize(size.cols, size.rows)
    } else if (message.type === 'drawn') {
      if (!Number.isInteger(message.count) || message.count <= 0) return
      terminal.unread = Math.max(0, terminal.unread - message.count)
      this.#ease(terminal)
    } else if (message.type === 'open') {
      if (typeof message.url === 'string' && openable(message.url)) this.#open(message.url)
    }
  }

  /**
   * A terminal whose shell ended, or never started: the pages are told, and
   * it is gone.
   *
   * @param {Terminal} terminal
   * @param {boolean} [failed] - Whether it never started
   */
  #ended(terminal, failed = false) {
    terminal.pty = null
    this.#drop(terminal)
    this.#tell(terminal.id, failed ? { type: 'exit', failed } : { type: 'exit' })
  }

  /**
   * Forget a terminal, hanging up on its shell if it has one, and telling
   * its frame.
   *
   * @param {Terminal} terminal
   */
  #drop(terminal) {
    this.#terminals.delete(terminal.id)
    const { pty, mirror, port } = terminal
    terminal.pty = null
    terminal.mirror = null
    terminal.port = null
    try {
      pty?.kill()
    } catch {
      // Already gone.
    }
    mirror?.dispose()
    if (port) {
      port.postMessage({ type: 'exit' })
      port.close()
    }
  }
}

/**
 * Whether a message came from the terminal's frame, set straight into the
 * app's own page: nothing else is handed a terminal's port.
 *
 * @param {{senderFrame: Electron.WebFrameMain|null}} event
 * @param {string} pageOrigin - The app's page's
 * @returns {boolean}
 */
export function fromTerminalFrame(event, pageOrigin) {
  const frame = event.senderFrame
  const parent = frame?.parent
  return Boolean(
    frame &&
      parent &&
      !parent.parent &&
      originOf(frame.url) === TERMINAL_ORIGIN &&
      originOf(parent.url) === pageOrigin
  )
}

/**
 * Answer the pages' calls for terminals, and the frame's.
 *
 * @param {Object} bridge
 * @param {(channel: string, answer: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any) => void} bridge.handle -
 *   Answers a call from the app's page (`bridge.js`)
 * @param {Electron.IpcMain} bridge.ipcMain
 * @param {string} bridge.origin - The app's page's
 * @param {() => Electron.WebContents[]} bridge.pages - The app's windows'
 *   pages, each told what becomes of every terminal
 * @param {Terminals} [bridge.terminals]
 * @returns {Terminals}
 */
export function handleTerminals({
  handle,
  ipcMain,
  origin,
  pages,
  terminals = new Terminals({
    tell: (id, event) => {
      for (const page of pages()) page.send('terminal:event', id, event)
    },
  }),
}) {
  handle('terminal:create', (_, project) => terminals.create(project))
  handle('terminal:list', () => terminals.list())
  handle('terminal:close', (_, id) => terminals.close(id))
  handle('terminal:seen', (_, id) => terminals.seen(id))

  ipcMain.on('terminal:attach', (event, request) => {
    const [port] = event.ports
    if (!port) return
    if (!fromTerminalFrame(event, origin)) {
      port.close()
      return
    }
    terminals.attach(request?.id, port, request)
  })

  app.on('will-quit', () => terminals.closeAll())
  return terminals
}
