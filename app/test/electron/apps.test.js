// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { DEFAULT_PORT, appConnections, handleApps, isPort } from '../../electron/src/apps.js'

/** @type {string} */
let dir
/** @type {string} */
let file

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apps-test-'))
  file = path.join(dir, 'apps.json')
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('appConnections', () => {
  it('starts with none, on the port it has when nothing says otherwise', async () => {
    expect(await appConnections(file).all()).toEqual({
      port: DEFAULT_PORT,
      enabled: true,
      connections: [],
    })
  })

  it('makes a connection with a token of its own, that may write, and no project ticked', async () => {
    const connections = appConnections(file)
    const made = await connections.add('  Claude Code  ')
    const other = await connections.add('Another')

    expect(made).toMatchObject({
      name: 'Claude Code',
      projects: [],
      readOnly: false,
    })
    expect(made.token).toMatch(/^[\w-]{43}$/)
    expect(other.token).not.toBe(made.token)
    expect(other.id).not.toBe(made.id)
  })

  it('keeps them in a file only the writer reads, for the app opened again', async () => {
    const made = await appConnections(file).add('Claude Code')

    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
    expect((await appConnections(file).all()).connections).toEqual([made])
  })

  it('refuses a connection without a name', async () => {
    const connections = appConnections(file)
    await expect(connections.add('   ')).rejects.toThrow('needs a name')
    await expect(connections.add(undefined)).rejects.toThrow('needs a name')
    expect((await connections.all()).connections).toEqual([])
  })

  it("changes a connection's name, its projects and whether it only reads", async () => {
    const connections = appConnections(file)
    const { id, token } = await connections.add('Claude Code')

    const after = await connections.update(id, {
      name: 'The agent',
      projects: ['story_a', 'story_b', 'story_a'],
      readOnly: true,
    })

    expect(after).toMatchObject({
      id,
      token,
      name: 'The agent',
      projects: ['story_a', 'story_b'],
      readOnly: true,
    })
    expect((await appConnections(file).all()).connections).toEqual([after])
  })

  it('leaves a connection as it was when a change is not one it can hold', async () => {
    const connections = appConnections(file)
    const made = await connections.add('Claude Code')

    await expect(connections.update(made.id, { projects: 'story_a' })).rejects.toThrow('projects')
    await expect(connections.update(made.id, { projects: [1] })).rejects.toThrow('projects')
    await expect(connections.update(made.id, { name: '' })).rejects.toThrow('needs a name')
    await expect(connections.update('app_none', { name: 'x' })).rejects.toThrow('No such')
    // Nothing the page may not set is taken from it, and only a plain yes
    // has it read only.
    await connections.update(made.id, { token: 'mine', id: 'other', created: 0, readOnly: 'no' })

    expect((await connections.all()).connections).toEqual([made])
  })

  it('finds a connection by its token, and none by another or by one removed', async () => {
    const connections = appConnections(file)
    const one = await connections.add('One')
    const two = await connections.add('Two')

    expect(await connections.byToken(two.token)).toEqual(two)
    expect(await connections.byToken(`${one.token}x`)).toBeNull()
    expect(await connections.byToken('')).toBeNull()

    await connections.remove(one.id)
    expect(await connections.byToken(one.token)).toBeNull()
    expect((await connections.all()).connections).toEqual([two])
  })

  it('listens on another port once told, if it is one an app may take', async () => {
    const connections = appConnections(file)
    await connections.setPort(5000)
    await expect(connections.setPort(80)).rejects.toThrow('1024 to 65535')
    await expect(connections.setPort('5001')).rejects.toThrow('1024 to 65535')

    expect((await appConnections(file).all()).port).toBe(5000)
  })

  it('lets apps in until told not to, and keeps that', async () => {
    const connections = appConnections(file)
    const made = await connections.add('Claude Code')

    await connections.setEnabled(false)
    expect(await appConnections(file).all()).toMatchObject({ enabled: false, connections: [made] })

    // Only a plain yes turns it on.
    await connections.setEnabled('yes')
    expect((await appConnections(file).all()).enabled).toBe(false)
    await connections.setEnabled(true)
    expect((await appConnections(file).all()).enabled).toBe(true)
  })

  it('makes changes asked at once one at a time, losing none', async () => {
    const connections = appConnections(file)
    await Promise.all(['a', 'b', 'c', 'd'].map(name => connections.add(name)))

    expect((await appConnections(file).all()).connections.map(one => one.name)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
  })

  it('reads a file that is not what it writes as far as it can', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await fs.writeFile(file, 'not json')
    expect(await appConnections(file).all()).toEqual({
      port: DEFAULT_PORT,
      enabled: true,
      connections: [],
    })
    expect(error).toHaveBeenCalled()
    error.mockRestore()

    await fs.writeFile(
      file,
      JSON.stringify({
        port: 'high',
        enabled: 'no',
        connections: [
          // Fields a connection doesn't have are let go, and one of the
          // wrong kind is read as unset.
          {
            id: 'app_1',
            token: 'secret',
            name: 'Kept',
            projects: ['story_a', 7],
            edit: 'suggesting',
            comment: true,
            readOnly: 'yes',
          },
          { id: 'app_2', name: 'No token' },
          'nonsense',
        ],
      })
    )
    expect(await appConnections(file).all()).toEqual({
      port: DEFAULT_PORT,
      enabled: true,
      connections: [
        {
          id: 'app_1',
          token: 'secret',
          name: 'Kept',
          projects: ['story_a'],
          readOnly: false,
          created: 0,
        },
      ],
    })
  })
})

describe('isPort', () => {
  it('takes the ports an app may listen on without leave', () => {
    expect(isPort(4657)).toBe(true)
    expect(isPort(1024)).toBe(true)
    expect(isPort(65535)).toBe(true)
    expect(isPort(1023)).toBe(false)
    expect(isPort(65536)).toBe(false)
    expect(isPort(4657.5)).toBe(false)
    expect(isPort('4657')).toBe(false)
  })
})

describe('handleApps', () => {
  /** @type {Map<string, (...args: any[]) => any>} */
  let handlers
  /** @type {Map<string, (...args: any[]) => any>} */
  let listeners
  /** Ask the native side, as the page does. */
  const call = (channel, ...args) => handlers.get(channel)({}, ...args)
  /** Tell it something, as the page does. */
  const say = (channel, ...args) => listeners.get(channel)({ sender: { id: 1 } }, ...args)

  /** A port nothing is listening on. */
  const freePort = () =>
    new Promise(resolve => {
      const server = http.createServer()
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address()
        server.close(() => resolve(port))
      })
    })

  /** What the door answers a call with a token, or why nothing did. */
  const post = (port, token) =>
    new Promise((resolve, reject) => {
      const text = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
      const request = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/mcp',
          method: 'POST',
          agent: false,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        },
        response => {
          response.resume()
          response.on('end', () => resolve(response.statusCode))
        }
      )
      request.on('error', reject)
      request.end(text)
    })

  /** Start the app's side over the data folder as it is. */
  const start = () => {
    handlers = new Map()
    listeners = new Map()
    handleApps({
      handle: (channel, answer) => handlers.set(channel, answer),
      on: (channel, listener) => listeners.set(channel, listener),
      pages: () => [],
    })
  }

  const record = (document, storyId) => ({ storyId, document, revision: 'r1', text: 'Text.' })
  const kept = async connection =>
    (await fs.readdir(path.join(dir, 'app-reads', connection)).catch(() => [])).sort()

  beforeEach(() => {
    app.getPath.mockReturnValue(dir)
  })

  it('opens the door only once a page has said it answers, whatever the file holds', async () => {
    const port = await freePort()
    const made = await appConnections(file).add('Claude Code')
    await appConnections(file).setPort(port)

    // As the app starts, with a connection made before it last quit.
    start()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(await call('apps:list')).toMatchObject({ listening: false, problem: null })
    await expect(post(port, made.token)).rejects.toThrow()

    // A connection made by a page that never said it answers opens nothing.
    const other = await call('apps:add', 'Another')
    expect((await call('apps:list')).listening).toBe(false)
    await expect(post(port, other.token)).rejects.toThrow()

    say('apps:answering')
    await vi.waitFor(async () => expect((await call('apps:list')).listening).toBe(true))
    expect(await post(port, made.token)).toBe(200)

    // The door shuts with the last connection.
    await call('apps:remove', made.id)
    await call('apps:remove', other.id)
    expect((await call('apps:list')).listening).toBe(false)
  })

  it('keeps, reads back and holds for a connection there is, and for no other id', async () => {
    start()
    const made = await call('apps:add', 'Claude Code')
    const file1 = { name: 'Plan.md', bytes: new Uint8Array([1]) }

    await call('apps:keep', made.id, 'doc_1', record('doc_1', 'story_a'))
    expect(await call('apps:read', made.id, 'doc_1')).toMatchObject({ revision: 'r1' })
    expect(await call('apps:reads', made.id, ['document'])).toEqual([{ document: 'doc_1' }])
    expect(await call('apps:offer', made.id, file1)).toEqual({ id: expect.any(String) })

    for (const nobody of ['app_nobody', 'x'.repeat(40), '', null, 7, ['app_1']]) {
      const said = 'No such connection.'
      await expect(call('apps:keep', nobody, 'doc_1', record('doc_1', 'story_a'))).rejects.toThrow(
        said
      )
      await expect(call('apps:read', nobody, 'doc_1')).rejects.toThrow(said)
      await expect(call('apps:reads', nobody)).rejects.toThrow(said)
      await expect(call('apps:offer', nobody, file1)).rejects.toThrow(said)
    }
    // Nothing was kept under a name of the page's making.
    expect(await fs.readdir(path.join(dir, 'app-reads'))).toEqual([made.id])

    // Nor for a connection once it is removed.
    await call('apps:remove', made.id)
    await expect(call('apps:offer', made.id, file1)).rejects.toThrow('No such connection.')
    await expect(call('apps:keep', made.id, 'doc_1', record('doc_1', 'story_a'))).rejects.toThrow()
    expect(await kept(made.id)).toEqual([])
  })

  it('lets go of what a connection had read of a project unticked for it, and of no other', async () => {
    start()
    const one = await call('apps:add', 'Claude Code')
    const two = await call('apps:add', 'Another')
    for (const made of [one, two]) {
      await call('apps:update', made.id, { projects: ['story_a', 'story_b'] })
      await call('apps:keep', made.id, 'doc_a', record('doc_a', 'story_a'))
      await call('apps:keep', made.id, 'doc_b', record('doc_b', 'story_b'))
    }

    // Renamed, or set to read only: nothing was unticked.
    await call('apps:update', one.id, { name: 'Renamed', readOnly: true })
    expect(await kept(one.id)).toEqual(['doc_a.json', 'doc_b.json'])

    await call('apps:update', one.id, { projects: ['story_b'] })
    expect(await kept(one.id)).toEqual(['doc_b.json'])
    expect(await kept(two.id)).toEqual(['doc_a.json', 'doc_b.json'])
  })

  it('lets go of what the page says is gone: documents, or a project, for one connection or all', async () => {
    start()
    const one = await call('apps:add', 'Claude Code')
    const two = await call('apps:add', 'Another')
    for (const made of [one, two]) {
      await call('apps:keep', made.id, 'doc_a', record('doc_a', 'story_a'))
      await call('apps:keep', made.id, 'doc_a2', record('doc_a2', 'story_a'))
      await call('apps:keep', made.id, 'doc_b', record('doc_b', 'story_b'))
    }

    // Told once that it is gone: that connection's alone.
    await call('apps:forget', { connection: one.id, documents: ['doc_a'] })
    expect(await kept(one.id)).toEqual(['doc_a2.json', 'doc_b.json'])
    expect(await kept(two.id)).toEqual(['doc_a.json', 'doc_a2.json', 'doc_b.json'])

    // A document deleted for good: everyone's.
    await call('apps:forget', { documents: ['doc_a2'] })
    expect(await kept(one.id)).toEqual(['doc_b.json'])
    expect(await kept(two.id)).toEqual(['doc_a.json', 'doc_b.json'])

    // A project deleted for good: everyone's of it.
    await call('apps:forget', { project: 'story_a' })
    expect(await kept(two.id)).toEqual(['doc_b.json'])

    // Nothing named, nothing gone.
    await call('apps:forget', {})
    await call('apps:forget', null)
    expect(await kept(one.id)).toEqual(['doc_b.json'])
  })
})
