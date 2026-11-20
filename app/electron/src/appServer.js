/**
 * The door other apps on this computer come in by: MCP over HTTP, on the
 * loopback alone, and only while there is a connection to let in (`apps.js`).
 *
 * It is MCP's Streamable HTTP at its plainest: `POST /mcp`, a JSON answer to
 * each request, no stream and no session. The door knows who is asking and
 * nothing of what is asked: a request that gets through is handed, whole, to
 * a window's page (`appCalls.js`), which is where the tools are.
 *
 * Refused here, before any page is asked:
 * - a request with an `Origin`, which is a browser's: no page on the web is
 *   let in, and no CORS header is ever sent;
 * - a `Host` that isn't this computer's own name, which is what a site that
 *   rebinds its name to the loopback would send;
 * - a request without a connection's token;
 * - anything but a `POST` of JSON to `/mcp`, of a size a call could be.
 */

import http from 'node:http'

/** Where apps post. */
export const PATH = '/mcp'

/** The most a request's body may be: a document written whole, and room. */
export const MOST_BYTES = 4 * 1024 * 1024

/**
 * The names this computer is asked by: its loopback, and the one a container
 * on it uses for the computer it runs on.
 * @type {ReadonlySet<string>}
 */
const HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'])

/** JSON-RPC's codes for what the door itself turns down. */
const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const NOT_ANSWERED = -32000

/**
 * @param {unknown} id
 * @param {number} code
 * @param {string} message
 */
const failure = (id, code, message) => ({
  jsonrpc: '2.0',
  id: typeof id === 'string' || typeof id === 'number' ? id : null,
  error: { code, message },
})

/**
 * The name a request was sent to, without its port, or null for none that
 * can be read.
 *
 * @param {string|undefined} host - The `Host` header
 * @returns {string|null}
 */
export function hostName(host) {
  if (!host) return null
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return null
  }
}

/**
 * A request's body, as far as `most` bytes, or null for one that is longer.
 *
 * @param {http.IncomingMessage} request
 * @param {number} most
 * @returns {Promise<Buffer|null>}
 */
function bodyOf(request, most) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = []
    let size = 0
    request.on('data', chunk => {
      size += chunk.length
      if (size > most) {
        // No more of it is read; whoever answers hangs up.
        request.removeAllListeners('data')
        request.pause()
        resolve(null)
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

/**
 * Listen with a server on a loopback address.
 *
 * @param {http.RequestListener} answer
 * @param {string} host
 * @param {number} port
 * @returns {Promise<http.Server>}
 */
function listenOn(answer, host, port) {
  const server = http.createServer(answer)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.once('listening', () => {
      server.off('error', reject)
      resolve(server)
    })
    server.listen(port, host)
  })
}

/**
 * The door of one app.
 *
 * @param {Object} options
 * @param {Pick<import('./apps.js').AppConnections, 'all'|'byToken'>} options.connections
 * @param {(connection: import('./apps.js').AppConnection, message: object, signal: AbortSignal) => Promise<object>} options.ask -
 *   Has a window answer a request; rejects, in words for the app's model,
 *   when none can
 */
export function appDoor({ connections, ask }) {
  /** @type {http.Server[]} */
  let servers = []
  /** The port listened on, or null while not listening. @type {number|null} */
  let listening = null
  /** Why it isn't listening though it should be. @type {string|null} */
  let problem = null
  /** When each connection last asked something, by its id. @type {Map<string, number>} */
  const called = new Map()
  /** Requests being answered, for an app to call off. @type {Map<string, AbortController>} */
  const underWay = new Map()

  /**
   * @param {http.ServerResponse} response
   * @param {number} status
   * @param {object} [body]
   * @param {Record<string, string>} [headers]
   */
  const send = (response, status, body, headers = {}) => {
    if (response.writableEnded || response.destroyed) return
    const text = body === undefined ? '' : JSON.stringify(body)
    response
      .writeHead(status, {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        'Content-Length': Buffer.byteLength(text),
        ...headers,
      })
      .end(text)
  }

  /**
   * @param {http.IncomingMessage} request
   * @param {http.ServerResponse} response
   */
  const respond = async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://localhost')
      if (url.pathname !== PATH) return send(response, 404)
      if (request.headers.origin !== undefined) return send(response, 403)
      if (!HOSTS.has(hostName(request.headers.host) ?? '')) return send(response, 403)

      const [scheme, token] = (request.headers.authorization || '').split(' ')
      const connection =
        scheme?.toLowerCase() === 'bearer' && token ? await connections.byToken(token) : null
      if (!connection) return send(response, 401, undefined, { 'WWW-Authenticate': 'Bearer' })
      if (request.method !== 'POST') return send(response, 405, undefined, { Allow: 'POST' })

      const body =
        Number(request.headers['content-length']) > MOST_BYTES
          ? null
          : await bodyOf(request, MOST_BYTES)
      if (body === null) {
        response.once('finish', () => request.destroy())
        return send(response, 413, undefined, { Connection: 'close' })
      }
      /** @type {any} */
      let message
      try {
        message = JSON.parse(body.toString('utf8'))
      } catch {
        return send(response, 400, failure(null, PARSE_ERROR, 'The request isn’t JSON.'))
      }
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        return send(response, 400, failure(null, INVALID_REQUEST, 'One request at a time.'))
      }
      called.set(connection.id, Date.now())

      // Something said, not asked: nothing to answer. An app calling off a
      // request has it stopped.
      const asks = typeof message.method === 'string' && 'id' in message
      if (!asks) {
        if (message.method === 'notifications/cancelled') {
          underWay.get(`${connection.id}:${String(message.params?.requestId)}`)?.abort()
        }
        return send(response, 202)
      }

      const key = `${connection.id}:${String(message.id)}`
      const controller = new AbortController()
      underWay.set(key, controller)
      // An app that hangs up has given up on what it asked.
      response.on('close', () => {
        if (!response.writableEnded) controller.abort()
      })
      try {
        send(response, 200, await ask(connection, message, controller.signal))
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error)
        send(response, 200, failure(message.id, NOT_ANSWERED, why))
      } finally {
        if (underWay.get(key) === controller) underWay.delete(key)
      }
    } catch (error) {
      console.error(`An app's request could not be answered: ${error}`)
      send(response, 500)
    }
  }

  /** @type {http.RequestListener} */
  const answer = (request, response) => {
    respond(request, response)
  }

  const stop = () => {
    for (const server of servers) {
      server.close()
      server.closeAllConnections()
    }
    servers = []
    listening = null
  }

  return {
    /**
     * Listen if there is a connection to let in, on the port the file names,
     * and stop if there is none.
     *
     * @returns {Promise<void>}
     */
    async sync() {
      const { port, connections: all } = await connections.all()
      if (all.length === 0) {
        stop()
        problem = null
        return
      }
      if (listening === port) return
      stop()
      try {
        servers.push(await listenOn(answer, '127.0.0.1', port))
        // `localhost` is IPv6 first on some systems; a system without it
        // has the one above.
        const v6 = await listenOn(answer, '::1', port).catch(() => null)
        if (v6) servers.push(v6)
        listening = port
        problem = null
      } catch (error) {
        stop()
        problem =
          /** @type {NodeJS.ErrnoException} */ (error).code === 'EADDRINUSE'
            ? `Port ${port} is in use by something else.`
            : `Port ${port} couldn’t be listened on.`
        console.error(`${problem} ${/** @type {Error} */ (error).message}`)
      }
    },

    stop,

    /**
     * Whether apps can get in, and when each last did.
     *
     * @returns {{listening: boolean, problem: string|null, called: Record<string, number>}}
     */
    state: () => ({
      listening: listening !== null,
      problem,
      called: Object.fromEntries(called),
    }),
  }
}
