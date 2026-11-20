// @vitest-environment node
/* global Buffer */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import http from 'node:http'
import { MOST_BYTES, appDoor, hostName } from '../../electron/src/appServer.js'

const CONNECTION = {
  id: 'app_1',
  name: 'Claude Code',
  token: 'the-right-token',
  projects: ['story_a'],
  edit: 'suggesting',
  comment: true,
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

/** @type {number} */
let port
/** @type {Array<typeof CONNECTION>} */
let held
/** @type {ReturnType<typeof vi.fn>} */
let ask
/** @type {ReturnType<typeof appDoor>} */
let door

const connections = {
  all: async () => ({ port, connections: held }),
  byToken: async token => held.find(one => one.token === token) ?? null,
}

beforeEach(async () => {
  port = await freePort()
  held = [CONNECTION]
  ask = vi.fn(async (_, message) => ({ jsonrpc: '2.0', id: message.id, result: { ok: true } }))
  door = appDoor({ connections, ask })
  await door.sync()
})

afterEach(() => {
  door.stop()
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
      expect.any(Object)
    )
    expect(door.state().called.app_1).toBeGreaterThan(0)
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

    for (const host of ['localhost', `127.0.0.1:${port}`, '[::1]:4657', 'host.docker.internal']) {
      expect((await send({ headers: { Host: host } })).status).toBe(200)
    }
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
