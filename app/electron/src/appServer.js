/**
 * The door other apps on this computer come in by: MCP over HTTP, on the
 * loopback alone, and only while there is a connection to let in, the writer
 * hasn't turned apps off (`apps.js`), and a page has said it answers what
 * they ask: a build whose page doesn't offer connected apps never listens,
 * whatever `apps.json` holds.
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
 *
 * Two things more are served, each by an id that is its way in, there being
 * no token in an app's own shell, and refused a browser as the rest is:
 * what a tool made ready for the app to fetch, a document or a folder
 * exported for it, by `GET /export/<id>`, once, for a few minutes
 * (`appExports.js`); and a file the app is bringing in, sent by
 * `PUT /import/<id>` (`appImports.js`), which a window's page is then asked
 * to take, by a request of the door's own (`IMPORT_METHOD`) that no app may
 * send. The page's answer, what the file became, is the upload's.
 */

import http from 'node:http'

/** Where apps post. */
const PATH = '/mcp'

/** Where an app fetches what was made ready for it, by its id. */
const EXPORTS = '/export/'

/** Where an app sends a file it is bringing in, by its id. */
const IMPORTS = '/import/'

/**
 * What the door asks a page to do with a file sent to it: take it, and say
 * what it became. A request of the door's own, which an app is refused.
 */
export const IMPORT_METHOD = 'inksprite/import'

/** What begins the methods only the door asks a page. */
const OWN_METHODS = 'inksprite/'

/**
 * What an upload is told where no link is waiting for it, in words for the
 * app's model, which reads what its command printed.
 */
const NOTHING_WAITING =
  'That link has expired or was already used. import_document gives a new one.'

/**
 * What an upload too large to take is told.
 * @param {number} most - Bytes
 */
const tooLarge = most =>
  `The file is larger than ${Math.floor(most / (1024 * 1024))} MB, the most an app can bring in.`

/** The most a request's body may be: a document written whole, and room. */
export const MOST_BYTES = 4 * 1024 * 1024

/**
 * The names this computer is asked by: its loopback, and the ones a
 * container on it uses for the computer it runs on, under Docker, Podman and
 * Lima. Those are safe to name: `.internal` is set aside for private use and
 * is never in the public DNS, so no site can take one of them and point it
 * here, which is what refusing other names guards against.
 * @type {ReadonlySet<string>}
 */
const HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  'host.docker.internal',
  'host.containers.internal',
  'host.lima.internal',
])

/** JSON-RPC's codes for what the door itself turns down. */
const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
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
 * Where the app that sent a request reaches this computer: the name and port
 * it asked by, which is not the same from inside a container as beside it.
 *
 * @param {string|undefined} host - The `Host` header, of a name already let in
 * @returns {string}
 */
export function addressOf(host) {
  return `http://${new URL(`http://${host}`).host}`
}

/**
 * A file's name as a download's header gives it.
 * @param {string} name
 */
const disposition = name =>
  `attachment; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`

/**
 * A request's body, as far as `most` bytes, or null for one that is longer,
 * or that stops being wanted as it comes.
 *
 * @param {http.IncomingMessage} request
 * @param {number} most
 * @param {AbortSignal} [signal] - Aborted when it is no longer wanted: what
 *   was read is let go at once
 * @returns {Promise<Buffer|null>}
 */
function bodyOf(request, most, signal) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    let chunks = []
    let size = 0
    // No more of it is read; whoever answers hangs up.
    const stop = () => {
      request.removeAllListeners('data')
      request.pause()
      chunks = []
      resolve(null)
    }
    if (signal?.aborted) return stop()
    signal?.addEventListener('abort', stop, { once: true })
    request.on('data', chunk => {
      size += chunk.length
      if (size > most) return stop()
      chunks.push(chunk)
    })
    request.on('end', () => {
      signal?.removeEventListener('abort', stop)
      resolve(Buffer.concat(chunks))
    })
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
 * @param {(connection: import('./apps.js').AppConnection, message: object, signal: AbortSignal, address: string) => Promise<object>} options.ask -
 *   Has a window answer a request, told where the app reaches this computer;
 *   rejects, in words for the app's model, when none can
 * @param {Pick<import('./appExports.js').AppExports, 'take'>} options.exports -
 *   What is ready for apps to fetch
 * @param {Pick<import('./appImports.js').AppImports, 'claim'|'holds'|'release'|'arrive'|'done'|'most'>} options.imports -
 *   What apps are to send
 */
export function appDoor({ connections, ask, exports, imports }) {
  /** @type {http.Server[]} */
  let servers = []
  /** Whether a page of this run has said it answers what apps ask. */
  let answered = false
  /** The port listened on, or null while not listening. @type {number|null} */
  let listening = null
  /** Why it isn't listening though it should be. @type {string|null} */
  let problem = null
  /** When each connection last asked something, by its id. @type {Map<string, number>} */
  const called = new Map()
  /** Requests being answered, for an app to call off. @type {Map<string, AbortController>} */
  const underWay = new Map()
  /** How many files have been handed to a page, for each request's id. */
  let imported = 0

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
   * Hand over what was made ready under an id, the once.
   *
   * @param {http.IncomingMessage} request
   * @param {http.ServerResponse} response
   * @param {string} id
   */
  const download = (request, response, id) => {
    // A browser says where it is fetching from, or why: nothing here is for one.
    if (request.headers['sec-fetch-site'] !== undefined) return send(response, 403)
    if (request.method !== 'GET') return send(response, 405, undefined, { Allow: 'GET' })
    const file = exports.take(id)
    if (!file) return send(response, 404)
    response
      .writeHead(200, {
        // Never a page, whatever is in it.
        'Content-Type': 'application/octet-stream',
        'Content-Length': file.bytes.length,
        'Content-Disposition': disposition(file.name),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      })
      .end(file.bytes)
  }

  /**
   * Take a file sent by a link, the once, and have a window's page take it
   * from here and say what it became, which is the answer.
   *
   * @param {http.IncomingMessage} request
   * @param {http.ServerResponse} response
   * @param {string} id
   */
  const upload = async (request, response, id) => {
    // A browser says where it is sending from, or why: nothing here is for one.
    if (request.headers['sec-fetch-site'] !== undefined) return send(response, 403)
    if (request.method !== 'PUT') return send(response, 405, undefined, { Allow: 'PUT' })
    /** Refuse what is being sent, reading no more of it. */
    const refuse = (/** @type {number} */ status, /** @type {string} */ error) => {
      response.once('finish', () => request.destroy())
      send(response, status, { error }, { Connection: 'close' })
    }
    // Nothing sent is kept until a link is found waiting for it: without one,
    // a request is nobody's to hold in memory. And what comes is let go the
    // moment its link is: its minutes up, or a newer one taking its place.
    const reading = new AbortController()
    if (!imports.claim(id, () => reading.abort())) return refuse(404, NOTHING_WAITING)
    /** @type {Buffer|null} */
    let body = null
    let gone = false
    try {
      body =
        Number(request.headers['content-length']) > imports.most
          ? null
          : await bodyOf(request, imports.most, reading.signal)
    } finally {
      gone = !imports.holds(id)
      if (body === null) imports.release(id)
    }
    if (body === null)
      return gone ? refuse(404, NOTHING_WAITING) : refuse(413, tooLarge(imports.most))
    const arrived = imports.arrive(id, body)
    if (!arrived) return refuse(404, NOTHING_WAITING)
    try {
      const { connections: all } = await connections.all()
      const connection = all.find(one => one.id === arrived.connection)
      if (!connection) return send(response, 404, { error: NOTHING_WAITING })
      called.set(connection.id, Date.now())

      const controller = new AbortController()
      // An app that hangs up has given up on what it sent.
      response.on('close', () => {
        if (!response.writableEnded) controller.abort()
      })
      /** @type {any} */
      let answer
      try {
        answer = await ask(
          connection,
          {
            jsonrpc: '2.0',
            id: `import-${++imported}`,
            method: IMPORT_METHOD,
            params: { id, about: arrived.about },
          },
          controller.signal,
          addressOf(request.headers.host)
        )
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error)
        return send(response, 503, { error: why })
      }
      const result = answer?.result
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        return send(response, 500, { error: 'inksprite couldn’t take the file.' })
      }
      send(response, 'error' in result ? 422 : 200, result)
    } finally {
      imports.done(id)
    }
  }

  /**
   * @param {http.IncomingMessage} request
   * @param {http.ServerResponse} response
   */
  const respond = async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://localhost')
      const fetching = url.pathname.startsWith(EXPORTS)
      const sending = url.pathname.startsWith(IMPORTS)
      if (url.pathname !== PATH && !fetching && !sending) return send(response, 404)
      if (request.headers.origin !== undefined) return send(response, 403)
      if (!HOSTS.has(hostName(request.headers.host) ?? '')) return send(response, 403)
      if (fetching) return download(request, response, url.pathname.slice(EXPORTS.length))
      if (sending) return await upload(request, response, url.pathname.slice(IMPORTS.length))

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
      // What only the door asks a page, an app may not.
      if (typeof message.method === 'string' && message.method.startsWith(OWN_METHODS)) {
        return send(
          response,
          200,
          failure(message.id, METHOD_NOT_FOUND, `Method not found: ${message.method}`)
        )
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
        const address = addressOf(request.headers.host)
        send(response, 200, await ask(connection, message, controller.signal, address))
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

  /**
   * Listen if there is a connection to let in and a page to answer it, on
   * the port the file names, and stop if there is none, or apps are turned
   * off.
   *
   * @returns {Promise<void>}
   */
  const sync = async () => {
    const { port, enabled, connections: all } = await connections.all()
    if (!answered || !enabled || all.length === 0) {
      stop()
      problem = null
      return
    }
    if (listening === port) return
    stop()
    try {
      servers.push(await listenOn(answer, '127.0.0.1', port))
      // `localhost` is IPv6 first on some systems. A system without IPv6 has
      // the one above. One where something else has the port there has
      // neither: an app that asks by `localhost` would hand that its token.
      const v6 = await listenOn(answer, '::1', port).catch(error => {
        if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EADDRINUSE') throw error
        return null
      })
      if (v6) servers.push(v6)
      listening = port
      problem = null
    } catch (error) {
      stop()
      problem =
        /** @type {NodeJS.ErrnoException} */ (error).code === 'EADDRINUSE'
          ? `Port ${port} is in use by something else.`
          : `Port ${port} couldn’t be opened.`
      console.error(`${problem} ${/** @type {Error} */ (error).message}`)
    }
  }

  return {
    sync,

    /**
     * A page has said it answers what apps ask: from now on, for as long as
     * the app runs, the door listens where there is a connection to let in.
     *
     * @returns {Promise<void>}
     */
    pageAnswers() {
      answered = true
      return sync()
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
