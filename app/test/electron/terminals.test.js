// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app, ipcMain } from 'electron'
import path from 'node:path'
import {
  TERMINAL_ID,
  TERMINAL_ORIGIN,
  Terminals,
  fromTerminalFrame,
  handleTerminals,
  shellEnv,
  shellFor,
  sizeFrom,
  terminalCsp,
  terminalFile,
} from '../../electron/src/terminals.js'

/** A shell's process, standing in for node-pty's. */
function fakePty() {
  const pty = {
    written: [],
    sizes: [],
    paused: 0,
    resumed: 0,
    killed: 0,
    onData: listener => (pty.print = listener),
    onExit: listener => (pty.exit = () => listener({ exitCode: 0 })),
    write: data => pty.written.push(data),
    resize: (cols, rows) => pty.sizes.push([cols, rows]),
    pause: () => pty.paused++,
    resume: () => pty.resumed++,
    kill: () => pty.killed++,
  }
  return pty
}

/**
 * A copy of the screen that reads what it is given only when told to, as the
 * real one reads a little after it is written.
 */
function fakeMirror({ cols, rows }) {
  const mirror = {
    cols,
    rows,
    read: '',
    cleared: 0,
    disposed: 0,
    /** @type {{data: string, done?: () => void}[]} */
    unread: [],
    write: (data, done) => mirror.unread.push({ data, done }),
    /** Read all that was written, in order. */
    catchUp() {
      while (mirror.unread.length) {
        const { data, done } = mirror.unread.shift()
        mirror.read += data
        done?.()
      }
    },
    resize(toCols, toRows) {
      mirror.cols = toCols
      mirror.rows = toRows
    },
    clear: () => mirror.cleared++,
    serialize: () => `<${mirror.read}>`,
    onTitle: listener => (mirror.title = listener),
    onBell: listener => (mirror.bell = listener),
    onAnswer: listener => (mirror.answer = listener),
    dispose: () => mirror.disposed++,
  }
  return mirror
}

/** A frame's end of a terminal. */
function fakePort() {
  const listeners = {}
  const port = {
    sent: [],
    started: false,
    closed: false,
    postMessage: message => port.sent.push(message),
    on: (event, listener) => (listeners[event] = listener),
    start: () => (port.started = true),
    close: () => (port.closed = true),
    /** The frame says something. */
    say: data => listeners.message?.({ data }),
    /** The frame goes. */
    go: () => listeners.close?.(),
  }
  return port
}

const SIZE = { cols: 80, rows: 24 }
const PROJECT = 'story_1'

/** Terminals over fakes, with what they made and said. */
function setup({ start } = {}) {
  const made = { ptys: [], mirrors: [], told: [], opened: [] }
  const terminals = new Terminals({
    tell: (id, event) => made.told.push({ id, event }),
    start:
      start ??
      (size => {
        const pty = fakePty()
        pty.size = size
        made.ptys.push(pty)
        return pty
      }),
    mirror: size => {
      const mirror = fakeMirror(size)
      made.mirrors.push(mirror)
      return mirror
    },
    open: url => made.opened.push(url),
  })
  return { terminals, made }
}

/** A terminal with its shell started, shown in a frame, and nothing told of it yet. */
function started() {
  const { terminals, made } = setup()
  const id = terminals.create(PROJECT)
  const port = fakePort()
  terminals.attach(id, port, SIZE)
  made.told.length = 0
  return { terminals, made, id, port, pty: made.ptys[0], mirror: made.mirrors[0] }
}

describe('terminalFile', () => {
  const packageFolder = name => path.join('/modules', name)

  it('serves the frame’s own files and the emulator’s, and nothing else', () => {
    expect(terminalFile('/', packageFolder)).toMatch(/electron[\\/]terminal[\\/]index\.html$/)
    expect(terminalFile('/frame.js', packageFolder)).toMatch(/terminal[\\/]frame\.js$/)
    expect(terminalFile('/xterm/xterm.mjs', packageFolder)).toBe(
      path.join('/modules', '@xterm/xterm', 'lib/xterm.mjs')
    )
    expect(terminalFile('/xterm/addon-fit.mjs', packageFolder)).toBe(
      path.join('/modules', '@xterm/addon-fit', 'lib/addon-fit.mjs')
    )
  })

  it('serves nothing it doesn’t list', () => {
    for (const pathname of [
      '/../src/main.js',
      '/frame.js/../../src/main.js',
      '/xterm/../../package.json',
      '/index.html',
      '/constructor',
      '/__proto__',
      '',
    ]) {
      expect(terminalFile(pathname, packageFolder)).toBeNull()
    }
  })
})

describe('terminalCsp', () => {
  it('lets the frame load its own files, and be set only in the app’s page', () => {
    const csp = terminalCsp('app://inksprite')
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain('frame-ancestors app://inksprite')
    expect(csp).not.toContain('unsafe-eval')
  })
})

describe('shellFor', () => {
  it('starts the writer’s shell as a login shell on a Mac', () => {
    expect(shellFor('darwin', { SHELL: '/bin/zsh' })).toEqual({ file: '/bin/zsh', args: ['-l'] })
    expect(shellFor('darwin', {}, '/opt/homebrew/bin/fish')).toEqual({
      file: '/opt/homebrew/bin/fish',
      args: ['-l'],
    })
    expect(shellFor('darwin', {})).toEqual({ file: '/bin/zsh', args: ['-l'] })
  })

  it('starts it as it is elsewhere', () => {
    expect(shellFor('linux', { SHELL: '/usr/bin/fish' })).toEqual({
      file: '/usr/bin/fish',
      args: [],
    })
    expect(shellFor('linux', {})).toEqual({ file: '/bin/bash', args: [] })
    expect(shellFor('win32', { SHELL: '/bin/zsh' })).toEqual({ file: 'powershell.exe', args: [] })
  })
})

describe('shellEnv', () => {
  it('says what kind of terminal it is', () => {
    expect(shellEnv({ PATH: '/bin' }, { version: '1.2.3' })).toMatchObject({
      PATH: '/bin',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'inksprite',
      TERM_PROGRAM_VERSION: '1.2.3',
    })
  })

  it('leaves out what was meant for the app alone', () => {
    const env = shellEnv({
      HOME: '/home/me',
      ELECTRON_RUN_AS_NODE: '1',
      INKSPRITE_PAGE_URL: 'http://127.0.0.1:8002/',
      CHROME_DESKTOP: 'inksprite.desktop',
      GOOGLE_API_KEY: 'no',
      UNSET: undefined,
    })
    expect(Object.keys(env).sort()).toEqual(
      ['COLORTERM', 'HOME', 'LANG', 'TERM', 'TERM_PROGRAM'].sort()
    )
  })

  it('gives a language where the app has none, from the system’s', () => {
    expect(shellEnv({}, { locale: 'fr-CA' }).LANG).toBe('fr_CA.UTF-8')
    expect(shellEnv({}, { locale: 'en' }).LANG).toBe('en_US.UTF-8')
    expect(shellEnv({}).LANG).toBe('en_US.UTF-8')
  })

  it('keeps the language the app was started with', () => {
    expect(shellEnv({ LANG: 'de_DE.UTF-8' }, { locale: 'fr-CA' }).LANG).toBe('de_DE.UTF-8')
    expect(shellEnv({ LC_ALL: 'C' }, { locale: 'fr-CA' }).LANG).toBeUndefined()
  })
})

describe('sizeFrom', () => {
  it('takes a size of whole columns and rows', () => {
    expect(sizeFrom({ cols: 80, rows: 24, id: 'x' })).toEqual({ cols: 80, rows: 24 })
  })

  it('takes nothing else', () => {
    for (const size of [
      null,
      undefined,
      'big',
      {},
      { cols: 80 },
      { cols: 1, rows: 24 },
      { cols: 80.5, rows: 24 },
      { cols: '80', rows: 24 },
      { cols: 80, rows: 5000 },
      { cols: NaN, rows: 24 },
    ]) {
      expect(sizeFrom(size)).toBeNull()
    }
  })
})

describe('Terminals', () => {
  it('makes a terminal in a project, tells the pages, and lists every one', () => {
    const { terminals, made } = setup()
    const id = terminals.create(PROJECT)
    const second = terminals.create('story_2')

    expect(id.startsWith(TERMINAL_ID)).toBe(true)
    expect(second).not.toBe(id)
    expect(terminals.list()).toEqual([
      { id, project: PROJECT, title: '', rang: false },
      { id: second, project: 'story_2', title: '', rang: false },
    ])
    expect(made.told).toEqual([
      { id, event: { type: 'made', project: PROJECT } },
      { id: second, event: { type: 'made', project: 'story_2' } },
    ])
  })

  it('makes none without a project to make it in', () => {
    const { terminals } = setup()
    for (const project of [undefined, null, '', 7, {}, 'p'.repeat(500)]) {
      expect(() => terminals.create(project)).toThrow('A terminal is made in a project')
    }
    expect(terminals.list()).toEqual([])
  })

  it('starts the shell when a frame first shows it, at the frame’s size', () => {
    const { terminals, made } = setup()
    const id = terminals.create(PROJECT)
    expect(made.ptys).toHaveLength(0)

    const port = fakePort()
    terminals.attach(id, port, { cols: 100, rows: 30 })

    expect(made.ptys).toHaveLength(1)
    expect(made.ptys[0].size).toEqual({ cols: 100, rows: 30 })
    expect(made.mirrors[0]).toMatchObject({ cols: 100, rows: 30 })
    expect(port.started).toBe(true)
    expect(port.sent).toEqual([])
  })

  it('sends the frame what the shell prints, and reads it into the copy', () => {
    const { pty, mirror, port } = started()
    pty.print('hello')
    pty.print(' there')
    mirror.catchUp()

    expect(port.sent).toEqual([
      { type: 'data', data: 'hello' },
      { type: 'data', data: ' there' },
    ])
    expect(mirror.read).toBe('hello there')
  })

  it('types what the frame sends, as text and as bytes', () => {
    const { pty, port } = started()
    port.say({ type: 'input', data: 'ls\r' })
    port.say({ type: 'binary', data: '\x1b[M\xff' })
    port.say({ type: 'input', data: 7 })
    port.say({ type: 'input' })
    port.say('ls')
    port.say(null)

    expect(pty.written).toHaveLength(2)
    expect(pty.written[0]).toBe('ls\r')
    expect([...pty.written[1]]).toEqual([0x1b, 0x5b, 0x4d, 0xff])
  })

  it('takes the frame’s size, when it is one and has changed', () => {
    const { pty, mirror, port } = started()
    port.say({ type: 'resize', cols: 120, rows: 40 })
    port.say({ type: 'resize', cols: 120, rows: 40 })
    port.say({ type: 'resize', cols: 0, rows: 40 })
    port.say({ type: 'resize', cols: 'wide', rows: 40 })

    expect(pty.sizes).toEqual([[120, 40]])
    expect(mirror).toMatchObject({ cols: 120, rows: 40 })
  })

  it('clears the copy when the frame was cleared', () => {
    const { mirror, port } = started()
    port.say({ type: 'clear' })
    expect(mirror.cleared).toBe(1)
  })

  it('opens a link clicked in the frame, if it is one that may open', () => {
    const { made, port } = started()
    port.say({ type: 'open', url: 'https://example.com/docs' })
    port.say({ type: 'open', url: 'file:///etc/passwd' })
    port.say({ type: 'open', url: 'javascript:alert(1)' })
    port.say({ type: 'open', url: 12 })

    expect(made.opened).toEqual(['https://example.com/docs'])
  })

  it('tells a frame there is none, for a terminal there isn’t or a size that isn’t one', () => {
    const { terminals, made } = setup()
    const id = terminals.create(PROJECT)

    const unknown = fakePort()
    terminals.attach(`${TERMINAL_ID}nope`, unknown, SIZE)
    const unsized = fakePort()
    terminals.attach(id, unsized, { cols: 80 })
    const unnamed = fakePort()
    terminals.attach({ id }, unnamed, SIZE)

    for (const port of [unknown, unsized, unnamed]) {
      expect(port.sent).toEqual([{ type: 'exit' }])
      expect(port.closed).toBe(true)
    }
    expect(made.ptys).toHaveLength(0)
  })

  it('keeps the shell running when its frame goes', () => {
    const { terminals, pty, mirror, port, id } = started()
    port.go()
    pty.print('still here')
    mirror.catchUp()

    expect(pty.killed).toBe(0)
    expect(mirror.read).toBe('still here')
    expect(port.sent).toEqual([])
    expect(terminals.list().map(terminal => terminal.id)).toEqual([id])
  })

  it('sends a frame that shows it again the screen as it stands, then what came after', () => {
    const { terminals, pty, mirror, port, id } = started()
    pty.print('before')
    port.go()
    pty.print(' unseen')

    const again = fakePort()
    terminals.attach(id, again, { cols: 60, rows: 20 })
    // Nothing until all that was printed has been read into the copy.
    expect(again.sent).toEqual([])
    pty.print(' meanwhile')
    mirror.catchUp()
    pty.print(' after')

    expect(again.sent).toEqual([
      { type: 'screen', cols: 80, rows: 24, data: '<before unseen>' },
      { type: 'data', data: ' meanwhile' },
      { type: 'data', data: ' after' },
    ])
    expect(pty.sizes).toEqual([])
  })

  it('lets go of the frame that showed it when another does', () => {
    const { terminals, pty, mirror, port, id } = started()
    const next = fakePort()
    terminals.attach(id, next, SIZE)
    mirror.catchUp()

    expect(port.closed).toBe(true)
    // The first frame's messages and its going are nothing to the terminal now.
    port.say({ type: 'input', data: 'x' })
    port.go()
    pty.print('to the new frame')
    expect(pty.written).toEqual([])
    expect(next.sent.at(-1)).toEqual({ type: 'data', data: 'to the new frame' })
  })

  it('answers what a program asks the terminal only while no frame shows it', () => {
    const { pty, mirror, port } = started()
    mirror.answer('\x1b[1;1R')
    expect(pty.written).toEqual([])

    port.go()
    mirror.answer('\x1b[1;1R')
    expect(pty.written).toEqual(['\x1b[1;1R'])
  })

  it('holds the shell back while what it printed is unread, and lets it go on after', () => {
    const { pty, mirror, port } = started()
    const much = 'x'.repeat(300_000)
    pty.print(much)
    expect(pty.paused).toBe(0)
    pty.print(much)
    expect(pty.paused).toBe(1)
    pty.print('more')
    expect(pty.paused).toBe(1)

    // The copy has read it all, but the frame has drawn none of it.
    mirror.catchUp()
    expect(pty.resumed).toBe(0)
    port.say({ type: 'drawn', count: 600_000 })
    expect(pty.resumed).toBe(1)

    port.say({ type: 'drawn', count: -5 })
    port.say({ type: 'drawn', count: 'all' })
    expect(pty.resumed).toBe(1)
  })

  it('stops holding the shell for a frame that has gone', () => {
    const { pty, mirror, port } = started()
    pty.print('x'.repeat(500_000))
    mirror.catchUp()
    expect(pty.paused).toBe(1)

    port.go()
    expect(pty.resumed).toBe(1)
  })

  it('tells the pages what the program names its terminal', () => {
    const { made, mirror, terminals, id } = started()
    mirror.title('vim notes.md')
    mirror.title('t'.repeat(500))

    expect(made.told[0]).toEqual({ id, event: { type: 'title', title: 'vim notes.md' } })
    expect(made.told[1].event.title).toHaveLength(200)
    expect(terminals.list()[0].title).toHaveLength(200)
  })

  it('remembers that a terminal rang until a page says it was looked at', () => {
    const { made, mirror, terminals, id } = started()
    terminals.seen(id)
    expect(made.told).toEqual([])

    mirror.bell()
    expect(terminals.list()[0].rang).toBe(true)
    terminals.seen(id)
    terminals.seen(id)
    terminals.seen('terminal:nope')

    expect(terminals.list()[0].rang).toBe(false)
    expect(made.told).toEqual([
      { id, event: { type: 'bell' } },
      { id, event: { type: 'seen' } },
    ])
  })

  it('is gone when its shell ends, and says so to the pages and its frame', () => {
    const { terminals, made, pty, mirror, port, id } = started()
    pty.exit()

    expect(terminals.list()).toEqual([])
    expect(made.told).toEqual([{ id, event: { type: 'exit' } }])
    expect(port.sent.at(-1)).toEqual({ type: 'exit' })
    expect(port.closed).toBe(true)
    expect(mirror.disposed).toBe(1)
    expect(pty.killed).toBe(0)
  })

  it('says a shell never started, and is gone', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { terminals, made } = setup({
      start: () => {
        throw new Error('no such shell')
      },
    })
    const id = terminals.create(PROJECT)
    const port = fakePort()
    terminals.attach(id, port, SIZE)

    expect(made.told.at(-1)).toEqual({ id, event: { type: 'exit', failed: true } })
    expect(terminals.list()).toEqual([])
    expect(port.closed).toBe(true)
    error.mockRestore()
  })

  it('hangs up on the shell when a page ends it, and tells the pages once', () => {
    const { terminals, made, pty, mirror, port, id } = started()
    terminals.close('terminal:nope')
    expect(pty.killed).toBe(0)

    terminals.close(id)
    expect(pty.killed).toBe(1)
    expect(mirror.disposed).toBe(1)
    expect(port.closed).toBe(true)
    expect(terminals.list()).toEqual([])
    // The shell's own end, coming after, is of a terminal already gone.
    pty.exit()
    pty.print('late')
    terminals.close(id)
    expect(made.told).toEqual([{ id, event: { type: 'exit' } }])
  })

  it('ends a terminal no frame ever showed', () => {
    const { terminals, made } = setup()
    const id = terminals.create(PROJECT)
    terminals.close(id)
    expect(terminals.list()).toEqual([])
    expect(made.ptys).toHaveLength(0)
  })

  it('ends every terminal as the app quits, with nobody left to tell', () => {
    const { terminals, made } = setup()
    for (const project of [PROJECT, PROJECT, 'story_2']) {
      terminals.attach(terminals.create(project), fakePort(), SIZE)
    }
    made.told.length = 0

    terminals.closeAll()
    expect(made.ptys.map(pty => pty.killed)).toEqual([1, 1, 1])
    expect(terminals.list()).toEqual([])
    expect(made.told).toEqual([])
  })
})

describe('fromTerminalFrame', () => {
  const top = { url: 'app://inksprite/project/1', parent: null }
  const frame = { url: `${TERMINAL_ORIGIN}/?id=x`, parent: top }

  it('is the terminal’s frame, set straight into the app’s page', () => {
    expect(fromTerminalFrame({ senderFrame: frame }, 'app://inksprite')).toBe(true)
  })

  it('is no other frame', () => {
    const not = [
      null,
      top,
      { url: 'https://example.com/', parent: top },
      { url: `${TERMINAL_ORIGIN}/`, parent: null },
      // The page itself on the terminal's address.
      { url: `${TERMINAL_ORIGIN}/`, parent: { url: 'https://example.com/', parent: null } },
      // Set into a frame of the page's, not the page.
      { url: `${TERMINAL_ORIGIN}/`, parent: { url: 'app://inksprite/', parent: top } },
      { url: 'terminal://other/', parent: top },
    ]
    for (const senderFrame of not) {
      expect(fromTerminalFrame({ senderFrame }, 'app://inksprite')).toBe(false)
    }
  })
})

describe('handleTerminals', () => {
  beforeEach(() => {
    vi.mocked(ipcMain.on).mockClear()
    vi.mocked(app.on).mockClear()
  })

  /** A window's page. */
  const window = () => ({ send: vi.fn() })

  /** The bridge's calls, answered over terminals of fakes, with two windows open. */
  function bridge() {
    const made = { ptys: [] }
    const pages = [window(), window()]
    /** @type {Record<string, Function>} */
    const calls = {}
    handleTerminals({
      handle: (channel, answer) => (calls[channel] = answer),
      ipcMain,
      origin: 'app://inksprite',
      pages: () => pages,
    })
    const attach = vi
      .mocked(ipcMain.on)
      .mock.calls.find(([channel]) => channel === 'terminal:attach')
    return { made, pages, calls, attach: attach[1] }
  }

  const top = { url: 'app://inksprite/', parent: null }
  const frame = { url: `${TERMINAL_ORIGIN}/?id=x`, parent: top }

  it('makes a terminal in a project, and tells every window', () => {
    const { calls, pages } = bridge()
    const id = calls['terminal:create']({}, 'story_1')

    expect(calls['terminal:list']({})).toEqual([{ id, project: 'story_1', title: '', rang: false }])
    for (const page of pages) {
      expect(page.send).toHaveBeenCalledWith('terminal:event', id, {
        type: 'made',
        project: 'story_1',
      })
    }
  })

  it('ends a terminal for any window, and tells every window', () => {
    const { calls, pages } = bridge()
    const id = calls['terminal:create']({}, 'story_1')
    calls['terminal:close']({}, id)

    expect(calls['terminal:list']({})).toEqual([])
    for (const page of pages) {
      expect(page.send).toHaveBeenLastCalledWith('terminal:event', id, { type: 'exit' })
    }
  })

  it('keeps a terminal when no window is open to tell', () => {
    const { calls, pages } = bridge()
    const id = calls['terminal:create']({}, 'story_1')
    pages.length = 0

    expect(calls['terminal:list']({}).map(terminal => terminal.id)).toEqual([id])
  })

  it('hands no frame but the terminal’s a terminal, the page least of all', () => {
    const { calls, attach } = bridge()
    const id = calls['terminal:create']({}, 'story_1')
    const port = fakePort()

    attach({ senderFrame: top, ports: [port] }, { id, ...SIZE })
    expect(port.closed).toBe(true)
    expect(port.sent).toEqual([])

    // Nor is anything done without a port, and a frame that says nothing is
    // told there is no terminal.
    attach({ senderFrame: frame, ports: [] }, { id, ...SIZE })
    const unsaid = fakePort()
    attach({ senderFrame: frame, ports: [unsaid] }, undefined)
    expect(unsaid.closed).toBe(true)
    expect(unsaid.sent).toEqual([{ type: 'exit' }])
  })

  it('ends every terminal as the app quits', () => {
    const { calls } = bridge()
    calls['terminal:create']({}, 'story_1')
    calls['terminal:create']({}, 'story_2')

    const quit = vi.mocked(app.on).mock.calls.find(([event]) => event === 'will-quit')
    quit[1]()
    expect(calls['terminal:list']({})).toEqual([])
  })
})
