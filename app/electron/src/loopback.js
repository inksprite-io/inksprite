/**
 * Waiting on localhost for a sign-in to send the browser back.
 *
 * The browser comes back to `http://localhost:<port><path>?…`. The first
 * request to that path is answered with a page that says to go back to the
 * app, and its query is what the wait ends with; the page finishes the
 * sign-in itself (`src/platform/signIn.js`). Anything else gets a 404.
 */

import http from 'node:http'

/** How long a sign-in is waited for. */
export const WAIT_MS = 10 * 60 * 1000

/** How long a sign-in just stopped may take to let go of the port. */
const RELEASE_MS = 1000

/** How often the port is tried again meanwhile. */
const RETRY_MS = 50

/** What the browser is shown once it is back. */
const PAGE =
  '<!doctype html><meta charset="utf-8"><title>inksprite</title>' +
  '<body style="font: 16px system-ui, sans-serif; margin: 4rem auto; max-width: 28rem; text-align: center">' +
  '<p>You can close this tab and go back to inksprite.</p>'

/**
 * @typedef {Object} Listening
 * @property {number} port - The port listened on: the one asked for, or the
 *   one given for 0
 * @property {Promise<string|null>} back - The query the browser came back
 *   with, or null once stopped or out of time
 * @property {() => void} stop - Stop waiting
 */

/**
 * Listen on `port`, on both loopback addresses (`localhost` is IPv6 first on
 * some systems), for the browser to come back to `path`.
 *
 * @param {number} port
 * @param {string} path - `/connect/mcp`
 * @param {number} [time] - How long to wait
 * @returns {Promise<Listening>} Once listening; rejected when the port is in use
 */
export async function listen(port, path, time = WAIT_MS) {
  /** @type {(query: string|null) => void} */
  let finish = () => {}
  /** @type {Promise<string|null>} */
  const back = new Promise(resolve => (finish = resolve))
  /** @type {http.Server[]} */
  const servers = []
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer
  let ended = false

  /** @param {string|null} query */
  const done = query => {
    if (ended) return
    ended = true
    clearTimeout(timer)
    servers.forEach(close)
    finish(query)
  }

  /** @type {http.RequestListener} */
  const answer = (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost')
    if (url.pathname !== path) {
      response.writeHead(404, { 'Content-Length': 0, Connection: 'close' }).end()
      return
    }
    response
      .writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(PAGE),
        Connection: 'close',
      })
      .end(PAGE)
    done(url.search.slice(1))
  }

  const v4 = await bind(http.createServer(answer), '127.0.0.1', port)
  servers.push(v4)
  const actual = /** @type {import('node:net').AddressInfo} */ (v4.address()).port
  const v6 = await bind(http.createServer(answer), '::1', actual).catch(() => null)
  // The browser may have come back to the first while the second was bound.
  if (v6 && ended) close(v6)
  else if (v6) servers.push(v6)
  if (!ended) timer = setTimeout(() => done(null), time)

  return { port: actual, back, stop: () => done(null) }
}

/**
 * Stop listening, and drop any connection still open.
 *
 * @param {http.Server} server
 */
function close(server) {
  server.close()
  server.closeAllConnections()
}

/**
 * Listen with `server` on `host` and `port`, trying again for a moment while
 * the port is in use.
 *
 * @param {http.Server} server
 * @param {string} host
 * @param {number} port
 * @returns {Promise<http.Server>}
 */
async function bind(server, host, port) {
  const deadline = Date.now() + RELEASE_MS
  for (;;) {
    try {
      await new Promise((resolve, reject) => {
        const failed = error => {
          server.off('listening', listening)
          reject(error)
        }
        const listening = () => {
          server.off('error', failed)
          resolve(undefined)
        }
        server.once('error', failed)
        server.once('listening', listening)
        server.listen(port, host)
      })
      return server
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error
      if (Date.now() >= deadline) {
        throw new Error(
          `Port ${port} is in use, so the sign-in could not come back to inksprite: ${error.message}`
        )
      }
      await new Promise(resolve => setTimeout(resolve, RETRY_MS))
    }
  }
}
