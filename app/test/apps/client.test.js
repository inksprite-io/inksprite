// @vitest-environment node
/* global TextEncoder */
/**
 * A real MCP client against the door and the page's answers behind it, with
 * the tools stood in for: what a client is sent is what the protocol asks.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import http from 'node:http'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { appDoor } from '../../electron/src/appServer.js'
import { appExports } from '../../electron/src/appExports.js'

const tools = vi.hoisted(() => ({ toolsFor: vi.fn(), callTool: vi.fn() }))
vi.mock('@/apps/tools.js', () => tools)

import { answerRequest, instructionsFor } from '@/apps/protocol.js'

const CONNECTION = {
  id: 'app_1',
  name: 'Claude Code',
  token: 'the-right-token',
  projects: ['story_a'],
  readOnly: false,
  created: 1,
}

/** @type {number} */
let port
/** @type {ReturnType<typeof appDoor>} */
let door
/** What is held for an app to fetch, as the native side holds it. */
const held = appExports()

beforeAll(async () => {
  port = await new Promise(resolve => {
    const server = http.createServer()
    server.listen(0, '127.0.0.1', () => {
      const found = server.address().port
      server.close(() => resolve(found))
    })
  })
  tools.toolsFor.mockReturnValue([
    {
      name: 'read_document',
      description: 'Read a document.',
      inputSchema: {
        type: 'object',
        properties: { project: { type: 'string' }, path: { type: 'string' } },
        required: ['path'],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: 'export_document',
      description: 'Get a document as a file.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      annotations: { readOnlyHint: true },
    },
  ])
  tools.callTool.mockImplementation(async (app, name, args) =>
    name === 'export_document'
      ? {
          // As `apps/exports.js` answers: a link at the address the app asked by.
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  url: `${app.address}/export/${held.offer(app.id, { name: 'Plan.md', bytes: new TextEncoder().encode('Bring rope.\n') }).id}`,
                }),
              },
            ],
          },
        }
      : args.path === 'notes/Nothing'
        ? { result: { content: [{ type: 'text', text: 'No document there.' }], isError: true } }
        : {
            result: {
              content: [
                { type: 'text', text: '{"path":"notes/Plan"}' },
                { type: 'text', text: 'Bring rope.' },
              ],
            },
          }
  )
  door = appDoor({
    connections: {
      all: async () => ({ port, enabled: true, connections: [CONNECTION] }),
      byToken: async token => (token === CONNECTION.token ? CONNECTION : null),
    },
    ask: async (connection, message, signal, address) => {
      const answer = await answerRequest(message, { app: { ...connection, address }, signal })
      if ('pass' in answer) throw new Error('inksprite has no window open.')
      return answer.response
    },
    exports: held,
  })
  // A page has said it answers, which is when the door opens.
  await door.pageAnswers()
})

afterAll(() => {
  door.stop()
  held.clear()
})

/** A client connected with a token. */
const connect = async (token = CONNECTION.token) => {
  const client = new Client({ name: 'a-test-client', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    })
  )
  return client
}

describe('a client through the door', () => {
  it('is answered with a link its shell can fetch, once, without the token', async () => {
    const client = await connect()

    const answer = await client.callTool({
      name: 'export_document',
      arguments: { path: 'notes/Plan' },
    })
    const { url } = JSON.parse(answer.content[0].text)
    await client.close()

    expect(url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}/export/[\\w-]{43}$`))
    const fetched = await fetch(url)
    expect(fetched.status).toBe(200)
    expect(await fetched.text()).toBe('Bring rope.\n')
    expect((await fetch(url)).status).toBe(404)
  })

  it('connects, and is told what inksprite is', async () => {
    const client = await connect()

    expect(client.getServerVersion()).toMatchObject({ name: 'inksprite' })
    expect(client.getServerCapabilities()).toEqual({ tools: {} })
    expect(client.getInstructions()).toBe(instructionsFor(CONNECTION))
    await client.close()
  })

  it('lists the tools and calls one', async () => {
    const client = await connect()

    const { tools: listed } = await client.listTools()
    expect(listed).toEqual([
      expect.objectContaining({ name: 'read_document', annotations: { readOnlyHint: true } }),
      expect.objectContaining({ name: 'export_document' }),
    ])

    const read = await client.callTool({ name: 'read_document', arguments: { path: 'notes/Plan' } })
    expect(read.content).toEqual([
      { type: 'text', text: '{"path":"notes/Plan"}' },
      { type: 'text', text: 'Bring rope.' },
    ])
    expect(read.isError).toBeFalsy()

    const missing = await client.callTool({
      name: 'read_document',
      arguments: { path: 'notes/Nothing' },
    })
    expect(missing.isError).toBe(true)
    await client.close()
  })

  it('is told why when no window can answer', async () => {
    const client = await connect()
    tools.callTool.mockResolvedValueOnce({ pass: 'elsewhere' })

    await expect(
      client.callTool({ name: 'read_document', arguments: { path: 'notes/Plan' } })
    ).rejects.toThrow('inksprite has no window open.')
    await client.close()
  })

  it('does not connect with a token that is no connection’s', async () => {
    await expect(connect('another-token')).rejects.toThrow()
  })
})
