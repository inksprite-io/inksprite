// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_PORT, appConnections, isPort } from '../../electron/src/apps.js'

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
    expect(await appConnections(file).all()).toEqual({ port: DEFAULT_PORT, connections: [] })
  })

  it('makes a connection with a token of its own, suggesting, and no project ticked', async () => {
    const connections = appConnections(file)
    const made = await connections.add('  Claude Code  ')
    const other = await connections.add('Another')

    expect(made).toMatchObject({
      name: 'Claude Code',
      projects: [],
      edit: 'suggesting',
      comment: true,
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

  it("changes a connection's name, its projects and what it may do", async () => {
    const connections = appConnections(file)
    const { id, token } = await connections.add('Claude Code')

    const after = await connections.update(id, {
      name: 'The agent',
      projects: ['story_a', 'story_b', 'story_a'],
      edit: 'editing',
      comment: false,
    })

    expect(after).toMatchObject({
      id,
      token,
      name: 'The agent',
      projects: ['story_a', 'story_b'],
      edit: 'editing',
      comment: false,
    })
    expect((await appConnections(file).all()).connections).toEqual([after])
  })

  it('leaves a connection as it was when a change is not one it can hold', async () => {
    const connections = appConnections(file)
    const made = await connections.add('Claude Code')

    await expect(connections.update(made.id, { projects: 'story_a' })).rejects.toThrow('projects')
    await expect(connections.update(made.id, { projects: [1] })).rejects.toThrow('projects')
    await expect(connections.update(made.id, { edit: 'anything' })).rejects.toThrow('Not a way')
    await expect(connections.update(made.id, { name: '' })).rejects.toThrow('needs a name')
    await expect(connections.update('app_none', { name: 'x' })).rejects.toThrow('No such')
    // Nothing the page may not set is taken from it.
    await connections.update(made.id, { token: 'mine', id: 'other', created: 0 })

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
    expect(await appConnections(file).all()).toEqual({ port: DEFAULT_PORT, connections: [] })
    expect(error).toHaveBeenCalled()
    error.mockRestore()

    await fs.writeFile(
      file,
      JSON.stringify({
        port: 'high',
        connections: [
          { id: 'app_1', token: 'secret', name: 'Kept', projects: ['story_a', 7], edit: 'never' },
          { id: 'app_2', name: 'No token' },
          'nonsense',
        ],
      })
    )
    expect(await appConnections(file).all()).toEqual({
      port: DEFAULT_PORT,
      connections: [
        {
          id: 'app_1',
          token: 'secret',
          name: 'Kept',
          projects: ['story_a'],
          edit: 'suggesting',
          comment: true,
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
