/**
 * What the page may ask of the native side, answered here: requests to
 * servers, sign-ins in the system browser, links opened outside the app, and
 * updates. `preload.cjs` is the page's end of it, and `src/platform/` in the
 * page is what calls it.
 *
 * Only the app's own page is answered: each call is checked for where it came
 * from, whatever the window has loaded.
 */

import { BrowserWindow, ipcMain, net, shell } from 'electron'
import { openable, originOf, webAddress } from './links.js'
import { listen } from './loopback.js'
import { downloadUpdate, installUpdate } from './updates.js'

/** Statuses whose response has no body. */
const NO_BODY = new Set([101, 103, 204, 205, 304])

/**
 * Answer the page's calls.
 *
 * @param {string} origin - The page's origin: `app://inksprite`, or the dev
 *   server's
 */
export function handleBridge(origin) {
  /**
   * Answer `channel` with `answer`'s result as `{value}`, or what it threw as
   * `{error}`, which the preload throws again as an Error with that message.
   *
   * @param {string} channel
   * @param {(event: Electron.IpcMainInvokeEvent, ...args: any[]) => any} answer
   */
  const handle = (channel, answer) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!fromPage(event, origin)) return { error: 'Only the app’s page may ask that.' }
      try {
        return { value: await answer(event, ...args) }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })

  /**
   * Listen for `channel`, from the page only.
   *
   * @param {string} channel
   * @param {(event: Electron.IpcMainEvent, ...args: any[]) => void} listener
   */
  const on = (channel, listener) =>
    ipcMain.on(channel, (event, ...args) => {
      if (fromPage(event, origin)) listener(event, ...args)
    })

  // Requests to servers, made here rather than in the page, so that no server
  // refuses them for the page's origin (`src/platform/fetch.js`). They go out
  // through Chromium's network stack, as the page's would: the system's proxy
  // and certificates apply.
  /** @type {Map<string, AbortController>} */
  const requests = new Map()
  handle('fetch', async (event, id, request) => {
    const key = `${event.sender.id}:${id}`
    const controller = new AbortController()
    requests.set(key, controller)
    /** @param {object} part */
    const send = part => {
      if (!event.sender.isDestroyed()) event.sender.send('fetch:body', id, part)
    }
    let response
    try {
      response = await net.fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: request.redirect,
        credentials: 'omit',
        signal: controller.signal,
      })
    } catch (error) {
      requests.delete(key)
      throw error
    }
    stream(response, send).finally(() => requests.delete(key))
    return {
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers],
    }
  })
  on('fetch:abort', (event, id) => requests.get(`${event.sender.id}:${id}`)?.abort())

  // Sign-ins, in the system browser and back (`src/platform/signIn.js`). One
  // is waited for at a time: a sign-in started while another waits takes its
  // place.
  /** @type {{key: string, stop: () => void}|null} */
  let waiting = null
  handle('signIn', async (event, id, { address, port, path }) => {
    if (!webAddress(address)) throw new Error(`Not an address to sign in at: ${address}`)
    waiting?.stop()
    const key = `${event.sender.id}:${id}`
    const listening = await listen(port, path)
    waiting = { key, stop: listening.stop }
    try {
      await shell.openExternal(address)
    } catch (error) {
      listening.stop()
      throw new Error(`The browser could not be opened: ${error.message}`)
    }
    listening.back.then(query => {
      if (waiting?.key === key) waiting = null
      if (query === null || event.sender.isDestroyed()) return
      event.sender.send('signIn:back', id, query)
      BrowserWindow.fromWebContents(event.sender)?.focus()
    })
  })
  on('signIn:stop', (event, id) => {
    if (waiting?.key !== `${event.sender.id}:${id}`) return
    waiting.stop()
    waiting = null
  })

  // Links to other sites (`src/platform/open.js`).
  handle('open', async (_, url) => {
    if (!openable(url)) throw new Error(`Not a link that opens: ${url}`)
    try {
      await shell.openExternal(url)
    } catch (error) {
      throw new Error(`The browser could not be opened: ${error.message}`)
    }
  })

  // Updates from the public repository's releases (`updates.js`).
  handle('update:download', () => downloadUpdate())
  handle('update:install', () => installUpdate())
}

/**
 * Hand a response's body to the page as it comes, and say when it has all
 * come, or failed.
 *
 * @param {Response} response
 * @param {(part: {chunk?: Uint8Array, done?: true, error?: string}) => void} send
 * @returns {Promise<void>}
 */
async function stream(response, send) {
  if (!response.body || NO_BODY.has(response.status)) {
    send({ done: true })
    return
  }
  try {
    for await (const chunk of response.body) send({ chunk })
    send({ done: true })
  } catch (error) {
    send({ error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * Whether a call came from the app's page, in the window's top frame.
 *
 * @param {Electron.IpcMainEvent|Electron.IpcMainInvokeEvent} event
 * @param {string} origin
 * @returns {boolean}
 */
function fromPage(event, origin) {
  const frame = event.senderFrame
  return Boolean(frame && !frame.parent) && originOf(frame.url) === origin
}
