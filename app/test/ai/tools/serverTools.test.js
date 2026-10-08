/* global AbortController */
import { describe, it, expect, afterEach, vi } from 'vitest'

const callServerTool = vi.hoisted(() => vi.fn())
vi.mock('@/mcp/client.js', async importOriginal => ({
  .../** @type {any} */ (await importOriginal()),
  callServerTool,
}))

import { setServers } from '@/mcp/servers.js'
import {
  executeTool,
  getEnabledToolDefinitions,
  getToolDefinitions,
  isSkill,
} from '@/ai/tools/index.js'

const wiki = {
  id: 'mcp_wiki',
  name: 'Wiki',
  prefix: 'wiki',
  url: 'https://wiki.example/mcp',
  tools: [
    {
      name: 'search',
      exposed: 'wiki__search',
      description: 'Search the wiki.',
      inputSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
      annotations: { readOnlyHint: true },
    },
    { name: 'edit', exposed: 'wiki__edit', inputSchema: { type: 'object' } },
  ],
  prompts: [],
  profiles: [],
  allowed: [],
  created: 1,
  updated: 1,
}

const names = definitions => definitions.map(d => d.function.name)

afterEach(() => {
  setServers([])
  callServerTool.mockReset()
})

describe('a server’s tools in the registry', () => {
  it('registers them as the server last listed them, and takes them away with it', () => {
    setServers([wiki])
    expect(names(getToolDefinitions())).toEqual(
      expect.arrayContaining(['wiki__search', 'wiki__edit'])
    )

    setServers([])
    expect(names(getToolDefinitions())).not.toContain('wiki__search')
  })

  it('tells the model what the server said, less the line naming its schema draft', () => {
    setServers([wiki])
    const search = getToolDefinitions().find(d => d.function.name === 'wiki__search')

    expect(search.function.description).toBe('Search the wiki.')
    expect(search.function.parameters).toEqual({
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    })
  })

  it('offers them only to a chat that names the server, less any it switched off', () => {
    setServers([wiki])

    expect(names(getEnabledToolDefinitions({}))).not.toContain('wiki__search')
    expect(names(getEnabledToolDefinitions({ servers: ['mcp_wiki'] }))).toEqual(
      expect.arrayContaining(['wiki__search', 'wiki__edit'])
    )
    expect(
      names(getEnabledToolDefinitions({ servers: ['mcp_wiki'], disabledTools: ['wiki__edit'] }))
    ).not.toContain('wiki__edit')
  })

  it('does not take them for skills', () => {
    setServers([wiki])

    expect(isSkill('wiki__search')).toBe(false)
  })

  it('runs a call through the server, and hands back its text as text', async () => {
    setServers([wiki])
    callServerTool.mockResolvedValue({ content: [{ type: 'text', text: 'Two pages.' }] })
    const { signal } = new AbortController()

    const result = await executeTool(
      {
        id: 'c1',
        type: 'function',
        function: { name: 'wiki__search', arguments: '{"query":"kenning"}' },
      },
      { signal }
    )

    // With the call's signal, for the server to hear the call was stopped,
    // and the chat's limit rather than the SDK's minute.
    expect(callServerTool).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mcp_wiki' }),
      'search',
      { query: 'kenning' },
      { signal, timeout: 120000 }
    )
    expect(result.content).toBe('Two pages.')
  })

  it('says why a call failed the way the writer would be told', async () => {
    setServers([wiki])
    callServerTool.mockRejectedValue(new TypeError('Failed to fetch'))

    const result = await executeTool({
      id: 'c1',
      type: 'function',
      function: { name: 'wiki__search', arguments: '{}' },
    })

    expect(JSON.parse(result.content).error).toMatch(/couldn’t be reached/)
  })
})
