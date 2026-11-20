/**
 * Check connected apps a request's whole way, in a real Electron: in at the
 * door on the loopback (`src/appServer.js`), across the preload's bridge to a
 * window's page, and back out. The shell's own modules answer (`src/bridge.js`
 * and what it wires: `src/apps.js`, `src/appCalls.js`, `src/appReads.js`,
 * `src/appExports.js`), in windows made as the app makes them
 * (`src/windows.js`: sandboxed, with `src/preload.cjs`). The page is the
 * check's own, at the app's origin, and reaches the bridge through the page's
 * `src/platform/apps.js`. The check is the app that asks, over a socket.
 *
 * Nothing listens until the app's page says it answers. A request with a
 * connection's token reaches the page, and the page's answer comes back as
 * it was given. Any other is refused at the door, and no page asked. A
 * request is called off in the page when its app gives up, and an app is
 * told why, in words, when no page answers it. Every function the bridge
 * gives the page hands back plain values. A file the page offers is fetched
 * once, byte for byte. A removed connection is refused at once, and the port
 * closes with the last of them, or with apps switched off. With two windows,
 * the one in front is asked first, and the next when it passes or closes.
 *
 * In the container, on a display of Xvfb's (`Xvfb :94 &`):
 *
 *   DISPLAY=:94 node_modules/.bin/electron scripts/check-apps.js
 *
 * On a Mac, with the Electron `start-on-mac.sh` fetched:
 *
 *   ~/Library/Caches/inksprite/electron-v44.11.3-darwin-arm64/Electron.app/Contents/MacOS/Electron scripts/check-apps.js
 *
 * It keeps its data in a folder of its own and listens on ports the system
 * picks, so it runs beside the app.
 */

import { BrowserWindow, app, protocol } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { handleBridge } from '../src/bridge.js'
import { originOf } from '../src/links.js'
import { PAGE_URL, registerScheme } from '../src/page.js'
import { osSandboxed } from '../src/sandbox.js'
import { bringForward, windowOpener } from '../src/windows.js'

/**
 * How long the shell here waits on a page that doesn't answer, in place of
 * its own five minutes, and how long the check waits for the app to be told.
 */
const SHELL_PATIENCE_MS = 1000
const PATIENCE_MS = 3000

/** The most a check may take: one waiting on what never comes fails, and the next runs. */
const CHECK_MOST_MS = 15_000

/** What an app is told when no window answered it (`src/appCalls.js`). */
const NOT_READY = 'inksprite isn’t ready. Try again in a moment.'
const NOT_OPENED = 'The project couldn’t be opened. Open it in inksprite and try again.'
const NO_WINDOW = 'inksprite has no window open.'
const GIVEN_UP = 'The request was given up on.'

/** What the bridge refuses a page that isn't the app's (`src/bridge.js`). */
const NOT_THE_PAGE = 'Only the app’s page may ask that.'

/** What is refused for an id that is no connection's (`src/apps.js`). */
const NO_CONNECTION = 'No such connection.'

/** The functions the bridge gives the page as `apps`: one more is one more to check. */
const BRIDGE = 'add answer forget keep list offer read reads remove setEnabled setPort update'

/** The page's own modules for the bridge, which the check's page loads as the app's does. */
const PLATFORM = fileURLToPath(new URL('../../src/platform/', import.meta.url))

/** The preload the app gives its windows (`src/windows.js`). */
const PRELOAD = fileURLToPath(new URL('../src/preload.cjs', import.meta.url))

/**
 * The check's page. It answers what apps ask as `check.mode` says, keeps
 * what it was asked, and calls the page's functions for the check.
 */
const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>check</title>
<script type="module">
  import * as apps from '/src/platform/apps.js'

  /** What a call came to: its value, or what it threw, if that was an Error. */
  const outcome = promise =>
    promise.then(
      value => ({ value, threw: null }),
      error => ({ threw: error instanceof Error ? error.message : 'not an Error' })
    )

  const check = {
    /** What this page was asked, each with whether its app called it off. */
    asked: [],

    /** What this page does with what it is asked: answer, pass, throw or hang. */
    mode: 'answer',

    /** Say this page answers, as the app's does (src/apps/index.js). */
    answer() {
      apps.answerApps(async (app, message, signal) => {
        const entry = { app, message, stopped: false }
        check.asked.push(entry)
        signal.addEventListener('abort', () => {
          entry.stopped = true
        })
        if (check.mode === 'pass') return { pass: 'elsewhere' }
        if (check.mode === 'throw') throw new Error('The check’s page threw.')
        if (check.mode === 'hang') return new Promise(() => {})
        const result = { window: location.pathname.slice(1), app, echo: message.params ?? null }
        return { response: { jsonrpc: '2.0', id: message.id, result } }
      })
    },

    /** Answer through the bridge itself, with what each of its functions handed back. */
    answerRaw() {
      const returned = globalThis.__INKSPRITE_DESKTOP__.apps.answer((app, message, onStop) => {
        const result = { answer: typeof returned, onStop: typeof onStop }
        try {
          result.stop = typeof onStop(() => {})
        } catch (error) {
          result.stop = 'threw: ' + error.message
        }
        return Promise.resolve({ response: { jsonrpc: '2.0', id: message.id, result } })
      })
    },

    /** Call one of the page's functions for connected apps. */
    call: (name, args) => outcome(Promise.resolve().then(() => apps[name](...args))),

    /** Offer a connection's app a file of these bytes. */
    offer: (connection, name, base64) =>
      check.call('offerAppExport', [
        connection,
        { name, bytes: Uint8Array.from(atob(base64), character => character.charCodeAt(0)) },
      ]),
  }
  globalThis.check = check
</script>`

const userData = mkdtempSync(path.join(tmpdir(), 'apps-check-'))
app.setPath('userData', userData)
// What the checks kept there goes with the process: the connections, and
// what they read. Electron's network process may leave its cache behind.
process.on('exit', () => rmSync(userData, { recursive: true, force: true }))
registerScheme()
// The checks close the app's windows, and the app would quit with the last.
app.on('window-all-closed', () => {})
// The checks wait for the app to be ready, which it isn't until this module
// has loaded: awaited here, it would never be.
app
  .whenReady()
  .then(checkAll)
  .catch(error => {
    console.error(error)
    app.exit(1)
  })

/** @param {number} ms */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Wait until something is so, and say whether it came to be.
 *
 * @param {() => unknown} condition
 * @param {number} [ms] - How long to wait
 * @returns {Promise<boolean>}
 */
async function until(condition, ms = 3000) {
  const started = Date.now()
  while (Date.now() - started < ms) {
    if (await condition()) return true
    await sleep(20)
  }
  return false
}

/**
 * Whether anything listens on a port of the loopback.
 *
 * @param {number} port
 * @param {string} [host]
 * @returns {Promise<boolean>}
 */
function listens(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const socket = net.connect({ port, host })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

/**
 * Whether a port can be got into, at either of the loopback's addresses.
 * @param {number} port
 */
const reachable = async port => (await listens(port)) || (await listens(port, '::1'))

/**
 * A port nothing listens on, of the system's choosing, or null where the
 * address can't be listened on at all.
 *
 * @param {string} [host]
 * @returns {Promise<number|null>}
 */
function freePort(host = '127.0.0.1') {
  return new Promise(resolve => {
    const server = net.createServer()
    server.once('error', () => resolve(null))
    server.listen(0, host, () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address())
      server.close(() => resolve(port))
    })
  })
}

/**
 * What the door answered.
 * @typedef {{status: number, headers: http.IncomingHttpHeaders, body: Buffer, json: any}} Answer
 */

/**
 * Ask the door as an app would, on a socket of the request's own: none is
 * kept for the next, so a door that has shut is seen to be shut.
 *
 * @param {number} port
 * @param {Object} [options]
 * @param {string} [options.token] - A connection's token
 * @param {unknown} [options.body] - Sent as JSON
 * @param {string} [options.method]
 * @param {string} [options.url]
 * @param {Record<string, string>} [options.headers]
 * @returns {{request: http.ClientRequest, answer: Promise<Answer>}} The
 *   request, for hanging up on, and what comes back
 */
function ask(port, { token, body, method = 'POST', url = '/mcp', headers = {} } = {}) {
  const request = http.request({
    host: '127.0.0.1',
    port,
    method,
    path: url,
    agent: false,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
  })
  /** @type {Promise<Answer>} */
  const answer = new Promise((resolve, reject) => {
    request.on('error', reject)
    request.on('response', response => {
      /** @type {Buffer[]} */
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('error', reject)
      response.on('end', () => {
        const bytes = Buffer.concat(chunks)
        const isJson = response.headers['content-type'] === 'application/json'
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: bytes,
          json: isJson ? JSON.parse(bytes.toString('utf8')) : null,
        })
      })
    })
  })
  request.end(body === undefined ? undefined : JSON.stringify(body))
  return { request, answer }
}

/**
 * Whether a value is plain: what JSON holds, and so what the bridge carries.
 * @param {unknown} value
 */
const plain = value => isDeepStrictEqual(value, JSON.parse(JSON.stringify(value)))

/**
 * Whether the door told an app why its request wasn't answered: a JSON-RPC
 * error under the request's id, in these words, or in any where none are
 * named.
 *
 * @param {Answer} answer
 * @param {{id: number}} message - The request
 * @param {string} [why]
 */
function saysWhy({ status, json }, message, why) {
  const words = json?.error?.message
  return (
    status === 200 &&
    typeof words === 'string' &&
    words !== '' &&
    (why === undefined || words === why) &&
    isDeepStrictEqual(json, {
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32000, message: words },
    })
  )
}

/**
 * A connection as a page is told of it, asked by an address
 * (`src/appCalls.js`): without its token.
 *
 * @param {{id: string, name: string, projects: string[], readOnly: boolean}} connection
 * @param {string} address
 */
const toldOf = ({ id, name, projects, readOnly }, address) => ({
  id,
  name,
  projects,
  readOnly,
  address,
})

/** @param {Answer} answer */
const said = ({ status, json }) => `${status} ${JSON.stringify(json?.error?.message ?? null)}`

/** @param {Buffer} bytes */
const sha = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 16)

async function checkAll() {
  // The check's page, wherever in the scheme it is asked for, and the two
  // modules of the app's page it loads.
  protocol.handle('app', request => {
    const module = /^\/src\/platform\/(apps|desktop)\.js$/.exec(new URL(request.url).pathname)
    return module
      ? new Response(readFileSync(path.join(PLATFORM, `${module[1]}.js`)), {
          headers: { 'Content-Type': 'text/javascript' },
        })
      : new Response(PAGE, { headers: { 'Content-Type': 'text/html' } })
  })

  const port = /** @type {number} */ (await freePort())
  const otherPort = /** @type {number} */ (await freePort())
  const v6 = (await freePort('::1')) !== null
  const address = `http://127.0.0.1:${port}`

  // A connection made before the app last quit, as `apps.json` holds it.
  const first = {
    id: 'app_first',
    name: 'First app',
    token: randomBytes(32).toString('base64url'),
    projects: ['story_a'],
    readOnly: false,
    created: Date.now(),
  }
  const appsFile = path.join(userData, 'apps.json')
  writeFileSync(appsFile, JSON.stringify({ port, enabled: true, connections: [first] }))
  /** What `apps.json` holds now. */
  const kept = () => JSON.parse(readFileSync(appsFile, 'utf8'))

  const openWindow = windowOpener(PAGE_URL)
  handleBridge(
    /** @type {string} */ (originOf(PAGE_URL)),
    { openWindow },
    { appPatience: SHELL_PATIENCE_MS }
  )

  /** @type {{name: string, ok: boolean, detail: string}[]} */
  const results = []

  /**
   * Record a check, and print it.
   *
   * @param {{name: string, ok: boolean, detail: string}} result
   */
  function record(result) {
    results.push(result)
    console.log(`${result.ok ? '✓' : '✗'} ${result.name}`)
    console.log(result.detail.replace(/^/gm, '    '))
  }

  /**
   * Run a check, and record what it found.
   *
   * @param {string} name
   * @param {() => Promise<{ok: boolean, detail: string}>} run
   */
  async function check(name, run) {
    const late = sleep(CHECK_MOST_MS).then(() => {
      throw new Error(`no end to it in ${CHECK_MOST_MS / 1000} seconds`)
    })
    try {
      record({ name, ...(await Promise.race([run(), late])) })
    } catch (error) {
      record({ name, ok: false, detail: `threw: ${error.message}` })
    }
  }

  /**
   * Run code in a window's page, where the page's own script runs.
   *
   * @param {Electron.BrowserWindow} window
   * @param {string} code
   * @returns {Promise<any>}
   */
  const js = (window, code) => window.webContents.executeJavaScript(code)

  /**
   * Call one of `src/platform/apps.js`'s functions in a window's page.
   *
   * @param {Electron.BrowserWindow} window
   * @param {string} name
   * @param {...unknown} args
   * @returns {Promise<{value?: any, threw: string|null}>} What it came to
   */
  const call = (window, name, ...args) =>
    js(window, `check.call(${JSON.stringify(name)}, ${JSON.stringify(args)})`)

  /**
   * Have a window's page offer a connection's app a file.
   *
   * @param {Electron.BrowserWindow} window
   * @param {string} connection
   * @param {string} name
   * @param {Buffer} bytes
   * @returns {Promise<{value?: any, threw: string|null}>}
   */
  const offer = (window, connection, name, bytes) =>
    js(
      window,
      `check.offer(${JSON.stringify(connection)}, ${JSON.stringify(name)}, '${bytes.toString('base64')}')`
    )

  /**
   * What a window's page does with what it is asked from now on.
   *
   * @param {Electron.BrowserWindow} window
   * @param {'answer'|'pass'|'throw'|'hang'} mode
   */
  const set = (window, mode) => js(window, `check.mode = '${mode}'`)

  /**
   * How many requests a window's page has been asked.
   * @param {Electron.BrowserWindow} window
   * @returns {Promise<number>}
   */
  const askedOf = window => js(window, 'check.asked.length')

  /**
   * Whether a request was called off in a window's page, or null for one the
   * page was never asked.
   *
   * @param {Electron.BrowserWindow} window
   * @param {{id: number}} message
   * @returns {Promise<boolean|null>}
   */
  const stoppedIn = (window, message) =>
    js(window, `check.asked.find(entry => entry.message.id === ${message.id})?.stopped ?? null`)

  /**
   * Wait for the check's page to be there in a window.
   * @param {Electron.BrowserWindow} window
   */
  const loaded = window => until(() => js(window, 'typeof check === "object"'), 10_000)

  /**
   * Open a window as the app does, on the check's page, and wait for the
   * page to be there and the window to show.
   *
   * @param {string} name - What its page calls itself in its answers
   */
  const windowOn = async name => {
    const window = openWindow(`/${name}`)
    await loaded(window)
    await until(() => window.isVisible())
    return window
  }

  /**
   * Bring a window to the front, as the app does.
   *
   * @param {Electron.BrowserWindow} window
   * @throws {Error} Where it won't come
   */
  const inFront = async window => {
    bringForward(window)
    if (!(await until(() => BrowserWindow.getFocusedWindow() === window))) {
      throw new Error('The window wouldn’t come to the front.')
    }
  }

  let requests = 0
  /**
   * A request as an app sends one.
   * @param {unknown} [params]
   */
  const request = params => ({ jsonrpc: '2.0', id: ++requests, method: 'tools/call', params })

  /**
   * Post a message to the door under a connection's token.
   *
   * @param {string} token
   * @param {object} message
   * @param {Record<string, string>} [headers]
   */
  const post = (token, message, headers) => ask(port, { token, body: message, headers }).answer

  // Before a page answers.

  const one = await windowOn('one')
  await check('opens the app’s window sandboxed, with the bridge and nothing of Node', async () => {
    const bridge = await js(one, 'Object.keys(__INKSPRITE_DESKTOP__.apps).sort().join(" ")')
    const node = await js(one, '[typeof require, typeof process, typeof module].join(" ")')
    const sandboxed = osSandboxed(one.webContents.getOSProcessId())
    return {
      ok: bridge === BRIDGE && node === 'undefined undefined undefined' && sandboxed,
      detail: `apps: ${bridge}\nrequire, process, module: ${node}; the system sandboxes it: ${sandboxed}`,
    }
  })

  await check('listens for no one before a page says it answers', async () => {
    const { value: state } = await call(one, 'listApps')
    const open = await reachable(port)
    return {
      ok: !open && state.listening === false && isDeepStrictEqual(state.connections, [first]),
      detail: `${state.connections.length} connection in apps.json, port ${port} ${open ? 'open' : 'shut'}`,
    }
  })

  // A page that isn't the app's, in a window with the same preload: what a
  // window taken to another site would be.
  const stranger = new BrowserWindow({
    show: false,
    webPreferences: { preload: PRELOAD, sandbox: true },
  })
  await stranger.loadURL('app://elsewhere/stranger')
  await check('tells a page of another origin nothing, and opens no door for it', async () => {
    const { threw } = await call(stranger, 'listApps')
    await js(stranger, 'check.answer()')
    await sleep(300)
    const open = await reachable(port)
    return {
      ok: threw === NOT_THE_PAGE && !open,
      detail: `its list: ${threw}; after it said it answers, port ${port} ${open ? 'open' : 'shut'}`,
    }
  })

  await check('listens once the app’s page says it answers', async () => {
    await js(one, 'check.answer()')
    const open = await until(() => listens(port))
    const openV6 = await listens(port, '::1')
    const { value: state } = await call(one, 'listApps')
    return {
      ok: open && openV6 === v6 && state.listening === true && state.problem === null,
      detail: `127.0.0.1:${port} ${open ? 'open' : 'shut'}, [::1]:${port} ${openV6 ? 'open' : 'shut'} (this system ${v6 ? 'has' : 'has no'} ::1)`,
    }
  })

  // A request's way to the page and back.

  const tricky = {
    text: 'She said "no", then \'yes\'. A back\\slash, a tab\tand\nline breaks\r\nof both kinds.',
    languages: [
      'naïve café',
      '日本語',
      'Ελληνικά',
      'עברית',
      '🖋️ 👩‍💻',
      String.fromCodePoint(0x65, 0x301, 0x2028),
    ],
    nested: { deep: { deeper: [{ deepest: [1, -2.5, 1e21, true, false, null] }, [], {}, ''] } },
    long: 'A line of a long document, with “quotes” and an ü.\n'.repeat(20_000),
  }

  await check(
    'hands what an app asks to the page, and the page’s answer back, intact',
    async () => {
      const message = request(tricky)
      const started = Date.now()
      const { status, headers, body, json } = await post(first.token, message)
      const ms = Date.now() - started
      const handed = await js(one, 'check.asked.at(-1)?.message')
      return {
        ok:
          status === 200 &&
          headers['content-type'] === 'application/json' &&
          isDeepStrictEqual(handed, message) &&
          isDeepStrictEqual(Object.keys(json), ['jsonrpc', 'id', 'result']) &&
          json.id === message.id &&
          json.result?.window === 'one' &&
          isDeepStrictEqual(json.result.echo, tricky),
        detail: `${status} in ${ms} ms, ${body.length} bytes back, ${tricky.long.length} characters of them one text`,
      }
    }
  )

  await check('tells the page who asks, without the token, and the address asked by', async () => {
    const beside = await post(first.token, request())
    const within = `host.docker.internal:${port}`
    const inside = await post(first.token, request(), { Host: within })
    const [told, toldInside] = [beside, inside].map(({ json }) => json.result?.app)
    return {
      ok:
        isDeepStrictEqual(told, toldOf(first, address)) &&
        isDeepStrictEqual(toldInside, toldOf(first, `http://${within}`)),
      detail: `${JSON.stringify(told)}\nand from a container: ${toldInside?.address}`,
    }
  })

  await check('answers requests sent at once, each with its own answer', async () => {
    const messages = Array.from({ length: 20 }, (_, n) => request({ n, text: `Request ${n}.` }))
    const answers = await Promise.all(messages.map(message => post(first.token, message)))
    const own = answers.filter(
      ({ json }, n) =>
        json?.id === messages[n].id && isDeepStrictEqual(json.result?.echo, messages[n].params)
    ).length
    return { ok: own === messages.length, detail: `${own} of ${messages.length}` }
  })

  await check('hands the page’s functions nothing the bridge can’t carry', async () => {
    await js(one, 'check.answerRaw()')
    const seen = (await post(first.token, request())).json.result ?? {}
    await js(one, 'check.answer()')
    return {
      ok: isDeepStrictEqual(seen, { answer: 'undefined', onStop: 'function', stop: 'undefined' }),
      detail: `answer() handed back ${seen.answer}; the page was handed a ${seen.onStop} to say how a request stops, which handed back ${seen.stop}`,
    }
  })

  await check('takes what is said, not asked, without asking the page', async () => {
    const before = await askedOf(one)
    const { status, body } = await post(first.token, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })
    const more = (await askedOf(one)) - before
    return {
      ok: status === 202 && body.length === 0 && more === 0,
      detail: `${status}; the page was asked ${more} more`,
    }
  })

  // Refused at the door.

  /** @type {[string, {token?: string, headers?: Record<string, string>}, number][]} */
  const refused = [
    ['without a token', {}, 401],
    ['with a token that is no connection’s', { token: randomBytes(32).toString('base64url') }, 401],
    ['from a browser', { token: first.token, headers: { Origin: 'https://example.com' } }, 403],
    [
      'sent to a name that isn’t this computer’s',
      { token: first.token, headers: { Host: `example.com:${port}` } },
      403,
    ],
  ]
  for (const [name, options, expected] of refused) {
    await check(`refuses a request ${name}, and asks no page`, async () => {
      const before = await askedOf(one)
      const { status, headers, body } = await ask(port, { body: request(), ...options }).answer
      const more = (await askedOf(one)) - before
      return {
        ok:
          status === expected &&
          body.length === 0 &&
          more === 0 &&
          !('access-control-allow-origin' in headers),
        detail: `${status}; the page was asked ${more} more`,
      }
    })
  }

  // An app that gives up.

  await check('calls a request off in the page when its app hangs up', async () => {
    await set(one, 'hang')
    const message = request()
    const { request: sent, answer } = ask(port, { token: first.token, body: message })
    answer.catch(() => {})
    const reached = await until(async () => (await stoppedIn(one, message)) !== null)
    const started = Date.now()
    sent.destroy()
    const stopped = await until(() => stoppedIn(one, message))
    return {
      ok: reached && stopped,
      detail: stopped
        ? `its signal aborted ${Date.now() - started} ms after the app hung up`
        : `the page was ${reached ? '' : 'not '}asked, and its signal never aborted`,
    }
  })

  await check('and when its app says it has given up, which the app is told', async () => {
    await set(one, 'hang')
    const message = request()
    const { answer } = ask(port, { token: first.token, body: message })
    const reached = await until(async () => (await stoppedIn(one, message)) !== null)
    const cancelled = await post(first.token, {
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: message.id },
    })
    const stopped = await until(() => stoppedIn(one, message))
    const given = await answer
    return {
      ok: reached && cancelled.status === 202 && stopped && saysWhy(given, message, GIVEN_UP),
      detail: `the notification: ${cancelled.status}; its signal ${stopped ? 'aborted' : 'never aborted'}; the request: ${said(given)}`,
    }
  })

  // A page that doesn't answer.

  await check('tells the app so, in words, when the page’s answerer throws', async () => {
    await set(one, 'throw')
    const message = request()
    const answer = await post(first.token, message)
    return { ok: saysWhy(answer, message, NOT_READY), detail: said(answer) }
  })

  /**
   * Ask a page that doesn't answer, and say whether the app is told so in
   * the time the check can wait.
   *
   * @param {() => void} [then] - What is done once the page has been asked
   */
  const leftUnanswered = async then => {
    await set(one, 'hang')
    const message = request()
    const { request: sent, answer } = ask(port, { token: first.token, body: message })
    answer.catch(() => {})
    await until(async () => (await stoppedIn(one, message)) !== null)
    then?.()
    const told = await Promise.race([answer, sleep(PATIENCE_MS).then(() => null)])
    sent.destroy()
    return told
      ? { ok: saysWhy(told, message), detail: said(told) }
      : {
          ok: false,
          detail: `no answer in ${PATIENCE_MS / 1000} seconds: the app was left waiting until it hung up`,
        }
  }
  await check('and when the page never answers', () => leftUnanswered())
  await check('and when the page is reloaded before it has answered', () =>
    leftUnanswered(() => one.webContents.reload())
  )
  // The page is a new one since, and says again that it answers.
  await loaded(one)
  await js(one, 'check.answer()')

  // What the bridge gives the page, each function called as the page calls it.

  await check('lists the connections, and whether their apps get in', async () => {
    const { value: state } = await call(one, 'listApps')
    const called = state.called[first.id]
    return {
      ok:
        plain(state) &&
        isDeepStrictEqual(
          { ...state, called: null },
          {
            port,
            enabled: true,
            connections: [first],
            listening: true,
            problem: null,
            called: null,
          }
        ) &&
        isDeepStrictEqual(Object.keys(state.called), [first.id]) &&
        Date.now() - called < 60_000,
      detail: `${Object.keys(state).join(', ')}; ${state.connections[0].name} last called ${Date.now() - called} ms ago`,
    }
  })

  /** @type {typeof first} */
  let second
  await check('makes a connection, whose token gets in at once', async () => {
    const { value: made } = await call(one, 'addApp', '  Second app ')
    second = made
    const { json } = await post(made.token, request())
    return {
      ok:
        plain(made) &&
        isDeepStrictEqual(made, {
          id: made.id,
          name: 'Second app',
          token: made.token,
          projects: [],
          readOnly: false,
          created: made.created,
        }) &&
        /^app_[0-9a-f]{12}$/.test(made.id) &&
        /^[\w-]{43}$/.test(made.token) &&
        Number.isFinite(made.created) &&
        isDeepStrictEqual(kept().connections, [first, made]) &&
        json.result?.app.id === made.id,
      detail: `${Object.keys(made).join(', ')}; answered as ${json.result?.app.name}`,
    }
  })

  await check('changes one, which the page is told of when its app next asks', async () => {
    const patch = { name: 'Reader', projects: ['story_a', 'story_b'], readOnly: true }
    const { value: changed } = await call(one, 'updateApp', second.id, patch)
    const { json } = await post(second.token, request())
    const ok =
      isDeepStrictEqual(changed, { ...second, ...patch }) &&
      isDeepStrictEqual(json.result?.app, toldOf(changed, address))
    second = changed
    return { ok, detail: JSON.stringify(json.result?.app) }
  })

  await check('says why not, as an error the page can read', async () => {
    const whys = [
      (await call(one, 'updateApp', 'app_none', { name: 'x' })).threw,
      (await call(one, 'updateApp', second.id, { projects: 'story_a' })).threw,
      (await call(one, 'addApp', '  ')).threw,
      (await call(one, 'setAppsPort', 80)).threw,
    ]
    return {
      ok: isDeepStrictEqual(whys, [
        NO_CONNECTION,
        'A connection’s projects are a list of their ids.',
        'A connection needs a name.',
        'A port is a number from 1024 to 65535.',
      ]),
      detail: whys.join('\n'),
    }
  })

  const read = {
    storyId: 'story_a',
    revision: 'r2',
    passed: ['r0', 'r1'],
    text: tricky.text + tricky.languages.join('\n') + tricky.long,
  }
  await check('keeps what a connection read of a document, and hands it back', async () => {
    const keeping = await call(one, 'keepRead', second.id, 'doc_1', read)
    const back = await call(one, 'keptRead', second.id, 'doc_1')
    const none = await call(one, 'keptRead', second.id, 'doc_2')
    return {
      ok:
        keeping.threw === null &&
        keeping.value === undefined &&
        isDeepStrictEqual(back.value, read) &&
        none.value === null,
      detail: `kept: ${keeping.threw ?? keeping.value}; read back ${back.value?.text?.length} characters; one never kept: ${none.value}`,
    }
  })

  await check('lists what is kept, whole or by field, and lets go of it', async () => {
    await call(one, 'keepRead', second.id, 'doc_2', {
      storyId: 'story_b',
      revision: 'r7',
      text: 'x',
    })
    /** @param {{revision: string}[]} records */
    const revisions = records => records.map(record => record.revision).sort()
    const whole = (await call(one, 'keptReads', second.id)).value
    const fields = (await call(one, 'keptReads', second.id, ['revision'])).value
    const letGo = await call(one, 'forgetReads', { connection: second.id, documents: ['doc_1'] })
    const left = (await call(one, 'keptReads', second.id)).value
    await call(one, 'forgetReads', { project: 'story_b' })
    const last = (await call(one, 'keptReads', second.id)).value
    return {
      ok:
        whole.length === 2 &&
        whole.some((/** @type {object} */ record) => isDeepStrictEqual(record, read)) &&
        fields.every((/** @type {object} */ record) => Object.keys(record).join() === 'revision') &&
        isDeepStrictEqual(revisions(fields), ['r2', 'r7']) &&
        letGo.threw === null &&
        letGo.value === undefined &&
        isDeepStrictEqual(revisions(left), ['r7']) &&
        isDeepStrictEqual(last, []),
      detail: `whole: ${revisions(whole)}; by field: ${JSON.stringify(fields)}; a document let go: ${revisions(left)}; its project too: ${JSON.stringify(last)}`,
    }
  })

  await check('keeps, reads and holds for no id but a connection’s', async () => {
    const whys = [
      (await call(one, 'keepRead', 'app_none', 'doc_1', read)).threw,
      (await call(one, 'keptRead', 'app_none', 'doc_1')).threw,
      (await call(one, 'keptReads', '../app-reads')).threw,
      (await offer(one, 'app_none', 'a.md', Buffer.from('x'))).threw,
    ]
    const written = existsSync(path.join(userData, 'app-reads', 'app_none'))
    return {
      ok: whys.every(why => why === NO_CONNECTION) && !written,
      detail: whys.join(' '),
    }
  })

  // A file made ready for an app to fetch.

  const file = {
    name: 'Désign “final” (1).tar',
    bytes: Buffer.concat([
      Buffer.from(Array.from({ length: 256 }, (_, byte) => byte)),
      randomBytes(256 * 1024),
    ]),
  }
  let link = ''
  await check('holds a file the page offers a connection’s app', async () => {
    const { value, threw } = await offer(one, second.id, file.name, file.bytes)
    link = `/export/${value?.id}`
    return {
      ok: threw === null && plain(value) && /^\{"id":"[\w-]{43}"\}$/.test(JSON.stringify(value)),
      detail: threw ?? `${Object.keys(value).join(', ')}: ${value.id.length} characters`,
    }
  })

  await check('refuses it a browser, another name, and anything but a GET', async () => {
    const tries = [
      { headers: { 'Sec-Fetch-Site': 'cross-site' } },
      { headers: { 'Sec-Fetch-Site': 'same-origin' } },
      { headers: { Origin: 'https://example.com' } },
      { headers: { Host: `example.com:${port}` } },
      { method: 'POST' },
    ]
    const statuses = []
    for (const options of tries) {
      statuses.push((await ask(port, { method: 'GET', url: link, ...options }).answer).status)
    }
    return { ok: statuses.join(' ') === '403 403 403 403 405', detail: statuses.join(' ') }
  })

  await check('hands it over by its link alone, byte for byte, as a file to save', async () => {
    const { status, headers, body } = await ask(port, { method: 'GET', url: link }).answer
    const named = decodeURIComponent(String(headers['content-disposition']).split("''")[1] ?? '')
    return {
      ok:
        status === 200 &&
        body.equals(file.bytes) &&
        named === file.name &&
        headers['content-type'] === 'application/octet-stream' &&
        headers['x-content-type-options'] === 'nosniff' &&
        headers['cache-control'] === 'no-store',
      detail: `${status}, ${body.length} bytes of ${file.bytes.length}, sha256 ${sha(body)} of ${sha(file.bytes)}, named ${named}`,
    }
  })

  await check('once', async () => {
    const { status, body } = await ask(port, { method: 'GET', url: link }).answer
    return { ok: status === 404 && body.length === 0, detail: `${status}, ${body.length} bytes` }
  })

  // Connections removed, apps switched off, and the port.

  await check('refuses a removed connection at once, and lets go of what it had', async () => {
    await call(one, 'keepRead', second.id, 'doc_3', read)
    const held = (await offer(one, second.id, 'held.md', Buffer.from('Held.'))).value
    const before = await askedOf(one)
    const removing = await call(one, 'removeApp', second.id)
    const { status } = await post(second.token, request())
    const more = (await askedOf(one)) - before
    const fetched = await ask(port, { method: 'GET', url: `/export/${held.id}` }).answer
    const reads = existsSync(path.join(userData, 'app-reads', second.id))
    const other = await post(first.token, request())
    return {
      ok:
        removing.threw === null &&
        removing.value === undefined &&
        status === 401 &&
        more === 0 &&
        fetched.status === 404 &&
        !reads &&
        other.status === 200,
      detail: `its token: ${status}; the page was asked ${more} more; its file: ${fetched.status}; its reads ${reads ? 'kept' : 'gone'}; another’s token: ${other.status}`,
    }
  })

  await check('stops listening when the last connection is removed', async () => {
    await call(one, 'removeApp', first.id)
    const open = await reachable(port)
    const { value: state } = await call(one, 'listApps')
    return {
      ok: !open && state.listening === false && state.connections.length === 0,
      detail: `port ${port} ${open ? 'open' : 'shut'}, listening: ${state.listening}`,
    }
  })

  /** @type {typeof first} */
  let third
  await check('listens again as one is made', async () => {
    third = (await call(one, 'addApp', 'Third app')).value
    const { status } = await post(third.token, request())
    return { ok: status === 200, detail: `its token: ${status}` }
  })

  await check(
    'stops listening while apps are switched off, and keeps the connections',
    async () => {
      const { value: state } = await call(one, 'setAppsEnabled', false)
      const open = await reachable(port)
      return {
        ok:
          plain(state) &&
          state.enabled === false &&
          state.listening === false &&
          isDeepStrictEqual(state.connections, [third]) &&
          !open &&
          isDeepStrictEqual(kept(), { port, enabled: false, connections: [third] }),
        detail: `enabled: ${state.enabled}, listening: ${state.listening}, ${state.connections.length} connection, port ${port} ${open ? 'open' : 'shut'}`,
      }
    }
  )

  await check('and listens again when they are switched back on', async () => {
    const { value: state } = await call(one, 'setAppsEnabled', true)
    const { status } = await post(third.token, request())
    return {
      ok: state.enabled === true && state.listening === true && status === 200,
      detail: `enabled: ${state.enabled}, listening: ${state.listening}, its token: ${status}`,
    }
  })

  await check('moves to another port as it is named, and back', async () => {
    const { value: moved } = await call(one, 'setAppsPort', otherPort)
    const there = await ask(otherPort, { token: third.token, body: request() }).answer
    const left = await reachable(port)
    const { value: back } = await call(one, 'setAppsPort', port)
    const here = await post(third.token, request())
    const leftAgain = await reachable(otherPort)
    return {
      ok:
        plain(moved) &&
        moved.port === otherPort &&
        moved.listening === true &&
        there.json?.result?.app.address === `http://127.0.0.1:${otherPort}` &&
        !left &&
        back.port === port &&
        here.status === 200 &&
        !leftAgain,
      detail: `on ${otherPort}: ${there.status}, and ${port} ${left ? 'open' : 'shut'}; back on ${port}: ${here.status}, and ${otherPort} ${leftAgain ? 'open' : 'shut'}`,
    }
  })

  // Two windows. The windows on the app's page are asked in turn, the one in
  // front first (`pages` in `src/bridge.js`), until one answers: a page that
  // passes, that hasn't said it answers, or whose window closes has the next
  // asked (`src/appCalls.js`).

  const two = await windowOn('two')
  await js(two, 'check.answer()')
  const both = async () => (await askedOf(one)) + (await askedOf(two))

  await check('asks the window in front, and no other', async () => {
    const before = await both()
    const answered = []
    for (const front of [two, one, two]) {
      await inFront(front)
      answered.push((await post(third.token, request())).json.result?.window)
    }
    const asked = (await both()) - before
    return {
      ok: answered.join(', ') === 'two, one, two' && asked === 3,
      detail: `in front: two, one, two; answered by: ${answered.join(', ')}; ${asked} pages asked of 3 requests`,
    }
  })

  await check('asks the next window when the one in front passes', async () => {
    await inFront(one)
    await set(one, 'pass')
    const message = request()
    const { json } = await post(third.token, message)
    const passed = (await stoppedIn(one, message)) !== null
    return {
      ok: passed && json.result?.window === 'two',
      detail: `one was ${passed ? '' : 'not '}asked; answered by ${json.result?.window}`,
    }
  })

  await check('tells the app the project couldn’t be opened when every window passes', async () => {
    await set(two, 'pass')
    const before = await both()
    const message = request()
    const answer = await post(third.token, message)
    const asked = (await both()) - before
    await set(two, 'answer')
    return {
      ok: saysWhy(answer, message, NOT_OPENED) && asked === 2,
      detail: `${said(answer)}; ${asked} pages asked`,
    }
  })

  await check('tells the app when the window asked closes, and asks no other', async () => {
    await inFront(one)
    await set(one, 'hang')
    const before = await askedOf(two)
    const message = request()
    const { answer } = ask(port, { token: third.token, body: message })
    const reached = await until(async () => (await stoppedIn(one, message)) !== null)
    one.close()
    const told = await answer
    const more = (await askedOf(two)) - before
    return {
      ok: reached && one.isDestroyed() && saysWhy(told, message) && more === 0,
      detail: `one was ${reached ? '' : 'not '}asked, and ${one.isDestroyed() ? 'closed' : 'is still open'}; ${said(told)}; two was asked ${more} more`,
    }
  })

  // A window whose page hasn't said it answers, as one still loading hasn't.
  const silent = await windowOn('silent')
  await check('tells the app inksprite isn’t ready when no window’s page answers', async () => {
    two.close()
    const closed = await until(() => two.isDestroyed())
    const message = request()
    const answer = await post(third.token, message)
    return { ok: closed && saysWhy(answer, message, NOT_READY), detail: said(answer) }
  })

  await check('tells the app there is no window when none is on the app’s page', async () => {
    silent.close()
    const closed = await until(() => silent.isDestroyed())
    const message = request()
    const answer = await post(third.token, message)
    const strangers = await askedOf(stranger)
    return {
      ok: closed && saysWhy(answer, message, NO_WINDOW) && strangers === 0,
      detail: `${said(answer)}; the page of another origin, still open, was asked ${strangers} times`,
    }
  })

  const failed = results.filter(result => !result.ok).length
  console.log(failed ? `${failed} of ${results.length} failed` : `all ${results.length} passed`)
  app.exit(failed ? 1 : 0)
}
