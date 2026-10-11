import { describe, it, expect, afterEach } from 'vitest'
import {
  missingHeaders,
  needsApproval,
  serverTool,
  serversForChat,
  setServers,
} from '@/mcp/servers.js'

const server = (id, extra = {}) => ({
  id,
  name: id,
  prefix: id,
  url: `https://${id}.example/mcp`,
  tools: [
    { name: 'read', exposed: `${id}__read`, inputSchema: {}, annotations: { readOnlyHint: true } },
    { name: 'write', exposed: `${id}__write`, inputSchema: {} },
  ],
  prompts: [],
  profiles: [],
  allowed: [],
  created: 1,
  updated: 1,
  ...extra,
})

afterEach(() => setServers([]))

describe('serversForChat', () => {
  it('follows the chat’s profile until the chat chooses', () => {
    setServers([server('a', { profiles: ['chat'] }), server('b', { profiles: ['roleplay'] })])

    expect(serversForChat({}, 'chat').map(one => one.id)).toEqual(['a'])
    expect(serversForChat({ mcpServers: ['b'] }, 'chat').map(one => one.id)).toEqual(['b'])
    expect(serversForChat({ mcpServers: [] }, 'chat')).toEqual([])
  })

  it('offers none that runs as a program, whatever the chat chose', () => {
    setServers([server('a', { url: undefined, command: 'npx', profiles: ['chat'] })])

    expect(serversForChat({}, 'chat')).toEqual([])
    expect(serversForChat({ mcpServers: ['a'] }, 'chat')).toEqual([])
  })
})

describe('needsApproval', () => {
  it('lets a tool that says it only reads run, and asks before the rest', () => {
    setServers([server('a')])

    expect(needsApproval('a__read')).toBe(false)
    expect(needsApproval('a__write')).toBe(true)
  })

  it('asks before nothing of a server the writer always allows', () => {
    setServers([server('a', { allowAll: true })])

    expect(needsApproval('a__write')).toBe(false)
  })

  it('does not ask before one the writer always allows, or a tool of the app’s', () => {
    setServers([server('a', { allowed: ['write'] })])

    expect(needsApproval('a__write')).toBe(false)
    expect(needsApproval('read_document')).toBe(false)
  })
})

describe('serverTool', () => {
  it('finds the server and tool behind a name the model called', () => {
    setServers([server('a'), server('b')])

    const found = serverTool('b__write')
    expect(found.server.id).toBe('b')
    expect(found.tool.name).toBe('write')
    expect(serverTool('c__write')).toBeNull()
  })
})

describe('missingHeaders', () => {
  it('names the headers a backup left empty', () => {
    expect(missingHeaders({ headers: { Authorization: '', 'X-Team': 'blue' } })).toEqual([
      'Authorization',
    ])
  })

  it('names none for a server with every value, or no headers', () => {
    expect(missingHeaders({ headers: { Authorization: 'Bearer k' } })).toEqual([])
    expect(missingHeaders({})).toEqual([])
  })
})
