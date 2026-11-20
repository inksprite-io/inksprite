// @vitest-environment node
/**
 * A real MCP client against the door and the page's answers behind it, with
 * the tools stood in for: what a client is sent is what the protocol asks.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import http from 'node:http'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { appDoor } from '../../electron/src/appServer.js'

const tools = vi.hoisted(() => ({ toolsFor: vi.fn(), callTool: vi.fn() }))
vi.mock('@/apps/tools.js', () => tools)

import { INSTRUCTIONS, answerRequest } from '@/apps/protocol.js'

const CONNECTION = {
  id: 'app_1',
  name: 'Claude Code',
  token: 'the-right-token',
  projects: ['story_a'],
  edit: 'suggesting',
  comment: true,
  created: 1,
}

/** @type {number} */
let port
/** @type {ReturnType<typeof appDoor>} */
let door

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
  ])
  tools.callTool.mockImplementation(async (_, __, args) =>
    args.path === 'notes/Nothing'
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
      all: async () => ({ port, connections: [CONNECTION] }),
      byToken: async token => (token === CONNECTION.token ? CONNECTION : null),
    },
    ask: async (connection, message, signal) => {
      const answer = await answerRequest(message, { app: connection, signal })
      if ('pass' in answer) throw new Error('inksprite has no window open.')
      return answer.response
    },
  })
  await door.sync()
})

afterAll(() => {
  door.stop()
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
  it('connects, and is told what inksprite is', async () => {
    const client = await connect()

    expect(client.getServerVersion()).toMatchObject({ name: 'inksprite' })
    expect(client.getServerCapabilities()).toEqual({ tools: {} })
    expect(client.getInstructions()).toBe(INSTRUCTIONS)
    await client.close()
  })

  it('lists the tools and calls one', async () => {
    const client = await connect()

    const { tools: listed } = await client.listTools()
    expect(listed).toEqual([
      expect.objectContaining({ name: 'read_document', annotations: { readOnlyHint: true } }),
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
