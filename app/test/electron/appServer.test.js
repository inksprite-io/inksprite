// @vitest-environment node
/* global Buffer */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import http from 'node:http'
import {
  IMPORT_METHOD,
  MOST_BYTES,
  addressOf,
  appDoor,
  hostName,
} from '../../electron/src/appServer.js'
import { appExports } from '../../electron/src/appExports.js'
import { appImports } from '../../electron/src/appImports.js'

const CONNECTION = {
  id: 'app_1',
  name: 'Claude Code',
  token: 'the-right-token',
  projects: ['story_a'],
  readOnly: false,
  created: 1,
}

/** A port nothing is listening on. */
const freePort = () =>
  new Promise(resolve => {
    const server = http.createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })

/** Whether this computer has a loopback over IPv6 to listen on. */
const hasV6 = await new Promise(resolve => {
  const server = http.createServer()
  server.once('error', () => resolve(false))
  server.listen(0, '::1', () => server.close(() => resolve(true)))
})

/** @type {number} */
let port
/** @type {Array<typeof CONNECTION>} */
let held
/** @type {boolean} */
let enabled
/** @type {ReturnType<typeof vi.fn>} */
let ask
/** @type {ReturnType<typeof appDoor>} */
let door
/** @type {ReturnType<typeof appExports>} */
let exports
/** @type {ReturnType<typeof appImports>} */
let imports

const connections = {
  all: async () => ({ port, enabled, connections: held }),
  byToken: async token => held.find(one => one.token === token) ?? null,
}

beforeEach(async () => {
  port = await freePort()
  held = [CONNECTION]
  enabled = true
  ask = vi.fn(async (_, message) => ({ jsonrpc: '2.0', id: message.id, result: { ok: true } }))
  exports = appExports()
  imports = appImports()
  door = appDoor({ connections, ask, exports, imports })
  // A page has said it answers: the door listens for no one before.
  await door.pageAnswers()
})

afterEach(() => {
  door.stop()
  exports.clear()
  imports.clear()
})

/**
 * What the door says to a request.
 *
 * @param {Object} [options]
 * @returns {Promise<{status: number, headers: http.IncomingHttpHeaders, body: any}>}
 */
const send = ({
  method = 'POST',
  path = '/mcp',
  token = CONNECTION.token,
  headers = {},
  body = { jsonrpc: '2.0', id: 1, method: 'ping' },
  onRequest = () => {},
} = {}) =>
  new Promise((resolve, reject) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(text),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
      },
      response => {
        let said = ''
        response.on('data', chunk => (said += chunk))
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: said ? JSON.parse(said) : null,
          })
        )
      }
    )
    request.on('error', reject)
    onRequest(request)
    request.end(text)
  })

describe('appDoor', () => {
  it('hands a request with a connection’s token to a window, and sends its answer', async () => {
    const answer = await send({ body: { jsonrpc: '2.0', id: 3, method: 'tools/list' } })

    expect(answer.status).toBe(200)
    expect(answer.headers['content-type']).toBe('application/json')
    expect(answer.body).toEqual({ jsonrpc: '2.0', id: 3, result: { ok: true } })
    expect(ask).toHaveBeenCalledWith(
      CONNECTION,
      { jsonrpc: '2.0', id: 3, method: 'tools/list' },
      expect.any(Object),
      `http://127.0.0.1:${port}`
    )
    expect(door.state().called.app_1).toBeGreaterThan(0)
  })

  it('tells the window where the app reaches this computer, by the name it asked by', async () => {
    await send({ headers: { Host: `host.docker.internal:${port}` } })
    expect(ask.mock.calls.at(-1)[3]).toBe(`http://host.docker.internal:${port}`)

    await send({ headers: { Host: `localhost:${port}` } })
    expect(ask.mock.calls.at(-1)[3]).toBe(`http://localhost:${port}`)
  })

  it('never sends a CORS header', async () => {
    const answer = await send()
    expect(Object.keys(answer.headers).filter(name => name.startsWith('access-control'))).toEqual(
      []
    )
  })

  it('refuses a request without a token, or with one that is no connection’s', async () => {
    for (const token of [null, 'another-token', '']) {
      const answer = await send({ token })
      expect(answer.status).toBe(401)
      expect(answer.headers['www-authenticate']).toBe('Bearer')
    }
    expect((await send({ token: null, headers: { Authorization: 'Basic abc' } })).status).toBe(401)
    expect(ask).not.toHaveBeenCalled()
  })

  it('refuses a browser’s request, whatever token it carries', async () => {
    for (const origin of ['https://elsewhere.example', 'http://127.0.0.1', 'null']) {
      expect((await send({ headers: { Origin: origin } })).status).toBe(403)
    }
    expect(
      (await send({ method: 'OPTIONS', headers: { Origin: 'https://x.example' } })).status
    ).toBe(403)
    expect(ask).not.toHaveBeenCalled()
  })

  it('refuses a name that isn’t this computer’s, and takes the ones that are', async () => {
    for (const host of ['elsewhere.example', `rebound.example:${port}`, '10.0.0.5']) {
      expect((await send({ headers: { Host: host } })).status).toBe(403)
    }
    expect(ask).not.toHaveBeenCalled()

    for (const host of [
      'localhost',
      `127.0.0.1:${port}`,
      '[::1]:4657',
      'host.docker.internal',
      // What a container calls the computer it runs on, under Podman and Lima.
      `host.containers.internal:${port}`,
      'host.lima.internal',
    ]) {
      expect((await send({ headers: { Host: host } })).status, host).toBe(200)
    }
  })

  it('takes no name that only looks like one of this computer’s', async () => {
    for (const host of [
      'host.docker.internal.example.com',
      'evil.host.containers.internal',
      'host.lima.internal.',
      'containers.internal',
    ]) {
      expect((await send({ headers: { Host: host } })).status, host).toBe(403)
    }
    expect(ask).not.toHaveBeenCalled()
  })

  it('answers only a POST to its one path', async () => {
    expect((await send({ path: '/' })).status).toBe(404)
    expect((await send({ path: '/mcp/other' })).status).toBe(404)
    for (const method of ['GET', 'DELETE', 'PUT']) {
      const answer = await send({ method })
      expect(answer.status).toBe(405)
      expect(answer.headers.allow).toBe('POST')
    }
    expect((await send({ path: '/mcp?x=1' })).status).toBe(200)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('refuses what isn’t one JSON request', async () => {
    const notJson = await send({ body: '{not json' })
    expect(notJson.status).toBe(400)
    expect(notJson.body.error.code).toBe(-32700)

    for (const body of ['[{"jsonrpc":"2.0","id":1,"method":"ping"}]', '"ping"', 'null']) {
      const answer = await send({ body })
      expect(answer.status).toBe(400)
      expect(answer.body.error.code).toBe(-32600)
    }
    expect(ask).not.toHaveBeenCalled()
  })

  it('refuses a body larger than a call could be', async () => {
    const answer = await send({ body: JSON.stringify({ padding: 'x'.repeat(MOST_BYTES) }) })
    expect(answer.status).toBe(413)
    expect(ask).not.toHaveBeenCalled()
  })

  it('takes what is said, not asked, without handing it on', async () => {
    const answer = await send({ body: { jsonrpc: '2.0', method: 'notifications/initialized' } })
    expect(answer.status).toBe(202)
    expect(answer.body).toBeNull()
    expect(ask).not.toHaveBeenCalled()
  })

  it('tells the app why, in a JSON-RPC error, when no window could answer', async () => {
    ask.mockRejectedValue(new Error('inksprite has no window open.'))
    const answer = await send({ body: { jsonrpc: '2.0', id: 'a', method: 'tools/list' } })

    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({
      jsonrpc: '2.0',
      id: 'a',
      error: { code: -32000, message: 'inksprite has no window open.' },
    })
  })

  it('stops a request the app calls off', async () => {
    /** @type {AbortSignal|undefined} */
    let signal
    ask.mockImplementation(
      (_, message, given) =>
        new Promise(resolve => {
          signal = given
          given.addEventListener('abort', () =>
            resolve({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'stopped' } })
          )
        })
    )
    const waiting = send({ body: { jsonrpc: '2.0', id: 9, method: 'tools/call' } })
    await vi.waitFor(() => expect(signal).toBeDefined())
    expect(signal.aborted).toBe(false)

    await send({
      body: { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 9 } },
    })

    expect(signal.aborted).toBe(true)
    expect((await waiting).body.error.message).toBe('stopped')
  })

  it('stops a request whose app hangs up', async () => {
    /** @type {AbortSignal|undefined} */
    let signal
    ask.mockImplementation((_, __, given) => {
      signal = given
      return new Promise(() => {})
    })
    /** @type {http.ClientRequest|undefined} */
    let request
    send({ onRequest: made => (request = made) }).catch(() => {})
    await vi.waitFor(() => expect(signal).toBeDefined())

    request.destroy()

    await vi.waitFor(() => expect(signal.aborted).toBe(true))
  })

  it('listens for no one until a page has said it answers, whatever connections there are', async () => {
    door.stop()
    const unanswered = appDoor({ connections, ask, exports })

    // As the app starts, and as a connection is made: nothing to answer it.
    await unanswered.sync()
    expect(unanswered.state()).toMatchObject({ listening: false, problem: null })
    await expect(send()).rejects.toThrow()

    await unanswered.pageAnswers()
    expect(unanswered.state().listening).toBe(true)
    expect((await send()).status).toBe(200)

    // And from then on, for the run: a connection removed and made again.
    held = []
    await unanswered.sync()
    await expect(send()).rejects.toThrow()
    held = [CONNECTION]
    await unanswered.sync()
    expect((await send()).status).toBe(200)
    unanswered.stop()
  })

  it('listens only while there is a connection', async () => {
    expect(door.state()).toMatchObject({ listening: true, problem: null })

    held = []
    await door.sync()
    expect(door.state().listening).toBe(false)
    await expect(send()).rejects.toThrow()

    held = [CONNECTION]
    await door.sync()
    expect((await send()).status).toBe(200)
  })

  it('listens for no one while apps are turned off, whatever connections there are', async () => {
    enabled = false
    await door.sync()
    expect(door.state()).toMatchObject({ listening: false, problem: null })
    await expect(send()).rejects.toThrow()

    enabled = true
    await door.sync()
    expect((await send()).status).toBe(200)
  })

  it('moves to another port when told of one', async () => {
    const before = port
    port = await freePort()
    await door.sync()

    expect((await send()).status).toBe(200)
    port = before
    await expect(send()).rejects.toThrow()
  })

  it('says so when something else has the port', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    door.stop()
    const other = http.createServer()
    await new Promise(resolve => other.listen(port, '127.0.0.1', resolve))

    await door.sync()

    expect(door.state()).toEqual({
      listening: false,
      problem: `Port ${port} is in use by something else.`,
      called: {},
    })
    other.close()
    error.mockRestore()
  })

  it.skipIf(!hasV6)(
    'says the port is in use when something else has it over IPv6, and listens on neither',
    async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      door.stop()
      // Something else at `[::1]`, which is where `localhost` leads on some
      // systems: an app set up with that name would hand it its token.
      const other = http.createServer()
      await new Promise(resolve => other.listen(port, '::1', resolve))

      await door.sync()

      expect(door.state()).toEqual({
        listening: false,
        problem: `Port ${port} is in use by something else.`,
        called: {},
      })
      await expect(send()).rejects.toThrow()

      // Once it is free, the door has both.
      await new Promise(resolve => other.close(resolve))
      await door.sync()
      expect(door.state()).toMatchObject({ listening: true, problem: null })
      expect((await send()).status).toBe(200)
      error.mockRestore()
    }
  )
})

describe('what was made ready for an app to fetch', () => {
  const FILE = { name: 'Vault plan — draft.md', bytes: new Uint8Array([35, 32, 80, 108, 97, 110]) }

  /**
   * Fetch from the door as an app's shell does: no token, nothing but the link.
   *
   * @returns {Promise<{status: number, headers: http.IncomingHttpHeaders, bytes: Buffer}>}
   */
  const fetchFile = (id, { method = 'GET', headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const request = http.request(
        { host: '127.0.0.1', port, path: `/export/${id}`, method, headers },
        response => {
          const chunks = []
          response.on('data', chunk => chunks.push(chunk))
          response.on('end', () =>
            resolve({
              status: response.statusCode,
              headers: response.headers,
              bytes: Buffer.concat(chunks),
            })
          )
        }
      )
      request.on('error', reject)
      request.end()
    })

  it('is handed over by its link alone, as a file to save and never a page', async () => {
    const { id } = exports.offer('app_1', FILE)

    const answer = await fetchFile(id)

    expect(answer.status).toBe(200)
    expect([...answer.bytes]).toEqual([...FILE.bytes])
    expect(answer.headers['content-type']).toBe('application/octet-stream')
    expect(answer.headers['content-length']).toBe('6')
    expect(answer.headers['x-content-type-options']).toBe('nosniff')
    expect(answer.headers['cache-control']).toBe('no-store')
    expect(answer.headers['content-disposition']).toBe(
      "attachment; filename*=UTF-8''Vault%20plan%20%E2%80%94%20draft.md"
    )
    expect(Object.keys(answer.headers).filter(name => name.startsWith('access-control'))).toEqual(
      []
    )
    // No window is asked anything.
    expect(ask).not.toHaveBeenCalled()
  })

  it('is handed over once', async () => {
    const { id } = exports.offer('app_1', FILE)

    expect((await fetchFile(id)).status).toBe(200)
    const again = await fetchFile(id)

    expect(again.status).toBe(404)
    expect(again.bytes.length).toBe(0)
  })

  it('is not there under an id never made, or one whose time is up', async () => {
    exports.offer('app_1', FILE)
    for (const id of ['nothing', '', 'a'.repeat(43), '..%2f..%2fapps.json']) {
      expect((await fetchFile(id)).status, id).toBe(404)
    }

    const short = appExports({ life: 1 })
    const brief = appDoor({ connections, ask, exports: short })
    door.stop()
    await brief.pageAnswers()
    const { id } = short.offer('app_1', FILE)
    await new Promise(resolve => setTimeout(resolve, 20))

    expect((await fetchFile(id)).status).toBe(404)
    brief.stop()
  })

  it('is refused a browser, and a name that isn’t this computer’s, and is still there after', async () => {
    const { id } = exports.offer('app_1', FILE)

    for (const headers of [
      { Origin: 'https://example.com' },
      { Origin: 'null' },
      // A page opened, or a picture or a script that names the link.
      { 'Sec-Fetch-Site': 'none' },
      { 'Sec-Fetch-Site': 'cross-site' },
      { Host: `evil.example:${port}` },
    ]) {
      expect((await fetchFile(id, { headers })).status, JSON.stringify(headers)).toBe(403)
    }

    expect((await fetchFile(id)).status).toBe(200)
  })

  it('is only fetched: anything else leaves it there', async () => {
    const { id } = exports.offer('app_1', FILE)

    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
      const answer = await fetchFile(id, { method })
      expect(answer.status, method).toBe(405)
      expect(answer.headers.allow).toBe('GET')
    }

    expect((await fetchFile(id)).status).toBe(200)
  })

  it('is reached by the names a container asks by', async () => {
    for (const name of ['host.docker.internal', 'host.containers.internal', 'host.lima.internal']) {
      const { id } = exports.offer('app_1', FILE)
      const answer = await fetchFile(id, { headers: { Host: `${name}:${port}` } })
      expect(answer.status, name).toBe(200)
    }
  })
})

describe('a file an app sends', () => {
  const ABOUT = { storyId: 'story_a', parentId: 'folder_1', name: 'Notes.md' }

  /**
   * Send to the door as an app's shell does: no token, nothing but the link.
   *
   * @returns {Promise<{status: number, headers: http.IncomingHttpHeaders, body: any}>}
   */
  const sendFile = (id, bytes = Buffer.from('# Notes\n'), { method = 'PUT', headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const request = http.request(
        {
          host: '127.0.0.1',
          port,
          path: `/import/${id}`,
          method,
          headers: { 'Content-Length': bytes.length, ...headers },
        },
        response => {
          let said = ''
          response.on('data', chunk => (said += chunk))
          response.on('end', () =>
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body: said ? JSON.parse(said) : null,
            })
          )
        }
      )
      request.on('error', reject)
      request.end(bytes)
    })

  it('is handed to a window to take, by the door’s own request, and the answer is the upload’s', async () => {
    ask.mockImplementation(async (_, message) => ({
      jsonrpc: '2.0',
      id: message.id,
      result: { success: true, document: { path: 'Research/Notes' } },
    }))
    const { id } = imports.open('app_1', ABOUT)

    const answer = await sendFile(id)

    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({ success: true, document: { path: 'Research/Notes' } })
    expect(ask).toHaveBeenCalledTimes(1)
    const [connection, message, , address] = ask.mock.calls[0]
    expect(connection.id).toBe('app_1')
    expect(message).toMatchObject({ method: IMPORT_METHOD, params: { id, about: ABOUT } })
    expect(address).toBe(`http://127.0.0.1:${port}`)
    // Done with, whether or not the page took it.
    expect(imports.size).toBe(0)
  })

  it('keeps the file for the page to take until the page has answered', async () => {
    /** @type {any} */
    let taken = null
    ask.mockImplementation(async (_, message) => {
      taken = imports.take('app_1', message.params.id)
      return { jsonrpc: '2.0', id: message.id, result: { success: true } }
    })
    const { id } = imports.open('app_1', ABOUT)

    await sendFile(id, Buffer.from([0, 1, 2, 255]))

    expect([...taken.bytes]).toEqual([0, 1, 2, 255])
    expect(taken.about).toEqual(ABOUT)
  })

  it('says what went wrong as the page said it, or why no page could take it', async () => {
    ask.mockImplementation(async (_, message) => ({
      jsonrpc: '2.0',
      id: message.id,
      result: { error: 'There is already something at "Research/Notes".' },
    }))
    const refused = await sendFile(imports.open('app_1', ABOUT).id)
    expect(refused.status).toBe(422)
    expect(refused.body.error).toMatch(/already something/)

    ask.mockRejectedValue(new Error('inksprite has no window open.'))
    const unanswered = await sendFile(imports.open('app_1', ABOUT).id)
    expect(unanswered.status).toBe(503)
    expect(unanswered.body).toEqual({ error: 'inksprite has no window open.' })
  })

  /**
   * Start sending to the door, a part of what the request says it holds.
   *
   * @param {string} id
   * @param {number} length - What the request says it holds
   * @param {Buffer} part - What is sent of it, for now
   */
  const startSending = (id, length, part) => {
    /** @type {(answer: {status: number, body: any}) => void} */
    let answered = () => {}
    const answer = new Promise(resolve => (answered = resolve))
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: `/import/${id}`,
        method: 'PUT',
        headers: { 'Content-Length': length },
      },
      response => {
        let said = ''
        response.on('data', chunk => (said += chunk))
        response.on('end', () =>
          answered({ status: response.statusCode ?? 0, body: said ? JSON.parse(said) : null })
        )
      }
    )
    // The door hangs up on what it refuses.
    request.on('error', () => {})
    request.write(part)
    return { request, answer }
  }

  it('takes one file to a link, and none by a link never made or run out', async () => {
    const { id } = imports.open('app_1', ABOUT)
    expect((await sendFile(id)).status).toBe(200)
    const again = await sendFile(id)
    expect(again.status).toBe(404)
    // Said, for the app's model to read in what its command printed.
    expect(again.body.error).toMatch(/Nothing is waiting by that link/)

    for (const other of ['nothing', '', 'a'.repeat(43), '..%2f..%2fapps.json']) {
      expect((await sendFile(other)).status, other).toBe(404)
    }
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('reads nothing sent to a link that isn’t waiting', async () => {
    // Ten megabytes said, a kilobyte sent: the answer comes before the rest.
    const { request, answer } = startSending('nothing', 10 * 1024 * 1024, Buffer.alloc(1024))

    const refused = await answer

    expect(refused.status).toBe(404)
    expect(refused.body.error).toMatch(/Nothing is waiting by that link/)
    request.destroy()
  })

  it('takes one file at a time by a link, and lets it wait again for one that never came whole', async () => {
    const { id } = imports.open('app_1', ABOUT)
    const first = startSending(id, 100, Buffer.alloc(10))

    // While the first is on its way, a second is refused before it is read.
    await vi.waitFor(async () => expect((await sendFile(id)).status).toBe(404))
    first.request.destroy()

    // The first gave up: the link waits for a file again.
    await vi.waitFor(async () => expect((await sendFile(id)).status).toBe(200))
  })

  it('takes none for a connection removed since the link was made', async () => {
    const { id } = imports.open('app_1', ABOUT)
    held = [{ ...CONNECTION, id: 'app_2', token: 'another' }]

    expect((await sendFile(id)).status).toBe(404)
    expect(ask).not.toHaveBeenCalled()
  })

  it('is refused a browser, a name that isn’t this computer’s, and anything but a PUT', async () => {
    const { id } = imports.open('app_1', ABOUT)

    for (const headers of [
      { Origin: 'https://example.com' },
      { Origin: 'null' },
      { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'same-origin' },
      { Host: `evil.example:${port}` },
    ]) {
      expect((await sendFile(id, undefined, { headers })).status, JSON.stringify(headers)).toBe(403)
    }
    for (const method of ['GET', 'POST', 'DELETE']) {
      const answer = await sendFile(id, undefined, { method })
      expect(answer.status, method).toBe(405)
      expect(answer.headers.allow).toBe('PUT')
    }

    // Still waiting for its file.
    expect((await sendFile(id)).status).toBe(200)
  })

  it('refuses a file larger than can be taken, and takes nothing of it', async () => {
    const small = appImports()
    Object.defineProperty(small, 'most', { value: 4 })
    const brief = appDoor({ connections, ask, exports, imports: small })
    door.stop()
    await brief.pageAnswers()
    const { id } = small.open('app_1', ABOUT)

    const answer = await sendFile(id, Buffer.from('more than four'))

    expect(answer.status).toBe(413)
    expect(answer.body.error).toMatch(/larger than/)
    expect(ask).not.toHaveBeenCalled()
    expect((await sendFile(id, Buffer.from('four'))).status).toBe(200)
    brief.stop()
  })

  it('is refused as a request an app makes itself', async () => {
    const { id } = imports.open('app_1', ABOUT)
    imports.arrive(id, Buffer.from('# Notes'))

    const answer = await send({
      body: { jsonrpc: '2.0', id: 7, method: IMPORT_METHOD, params: { id, about: ABOUT } },
    })

    expect(answer.status).toBe(200)
    expect(answer.body.error.code).toBe(-32601)
    expect(ask).not.toHaveBeenCalled()
    expect(imports.take('app_1', id)).not.toBeNull()
  })
})

describe('addressOf', () => {
  it('is where a request was sent: its name and its port', () => {
    expect(addressOf('127.0.0.1:4657')).toBe('http://127.0.0.1:4657')
    expect(addressOf('host.docker.internal:4700')).toBe('http://host.docker.internal:4700')
    expect(addressOf('[::1]:4657')).toBe('http://[::1]:4657')
    // Nothing but the name and port is taken from it.
    expect(addressOf('localhost:4657/x?y')).toBe('http://localhost:4657')
  })
})

describe('hostName', () => {
  it('is the name a request was sent to, without its port', () => {
    expect(hostName('localhost:4657')).toBe('localhost')
    expect(hostName('127.0.0.1')).toBe('127.0.0.1')
    expect(hostName('[::1]:4657')).toBe('[::1]')
    expect(hostName('Host.Docker.Internal:4657')).toBe('host.docker.internal')
    expect(hostName(undefined)).toBeNull()
    expect(hostName('a b')).toBeNull()
  })
})
