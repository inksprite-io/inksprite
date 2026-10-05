import { describe, it, expect } from 'vitest'
import { nameFromUrl, parseServerConfig } from '@/mcp/config.js'

describe('parseServerConfig', () => {
  it('reads the mcpServers block other apps keep', () => {
    const { servers, errors } = parseServerConfig(
      JSON.stringify({
        mcpServers: {
          deepwiki: { url: 'https://mcp.deepwiki.com/mcp' },
          github: {
            url: 'https://api.githubcopilot.com/mcp/',
            headers: { Authorization: 'Bearer abc', Ignored: 3 },
          },
        },
      })
    )

    expect(errors).toEqual([])
    expect(servers).toEqual([
      { name: 'deepwiki', url: 'https://mcp.deepwiki.com/mcp' },
      {
        name: 'github',
        url: 'https://api.githubcopilot.com/mcp/',
        headers: { Authorization: 'Bearer abc' },
      },
    ])
  })

  it('reads VS Code’s servers, Windsurf’s serverUrl, and a bare map', () => {
    expect(parseServerConfig('{"servers":{"a":{"url":"https://a.example/mcp"}}}').servers).toEqual([
      { name: 'a', url: 'https://a.example/mcp' },
    ])
    expect(parseServerConfig('{"b":{"serverUrl":"https://b.example/mcp"}}').servers).toEqual([
      { name: 'b', url: 'https://b.example/mcp' },
    ])
  })

  it('reads one server on its own', () => {
    expect(parseServerConfig('{"url":"https://c.example/mcp"}').servers).toEqual([
      { name: 'server', url: 'https://c.example/mcp' },
    ])
  })

  it('keeps one that runs as a program, for the writer to see it needs a bridge', () => {
    const { servers } = parseServerConfig(
      '{"mcpServers":{"files":{"command":"npx","args":["-y","@x/files", 4]}}}'
    )

    expect(servers).toEqual([{ name: 'files', command: 'npx', args: ['-y', '@x/files'] }])
  })

  it('says what is wrong with what it cannot read', () => {
    expect(parseServerConfig('not json').errors[0]).toMatch(/isn’t JSON/)
    expect(parseServerConfig('[]').errors).toEqual(['That isn’t a list of servers.'])
    expect(parseServerConfig('{"mcpServers":{}}').errors).toEqual(['There are no servers in that.'])
    expect(parseServerConfig('{"x":{"url":"ftp://x"},"y":{}}').errors).toEqual([
      'x: ftp://x is not a web address.',
      'y: no url or command.',
    ])
  })
})

describe('nameFromUrl', () => {
  it('names a server by its host, less the parts that say nothing', () => {
    expect(nameFromUrl('https://mcp.deepwiki.com/mcp')).toBe('Deepwiki')
    expect(nameFromUrl('https://huggingface.co/mcp')).toBe('Huggingface')
    expect(nameFromUrl('nonsense')).toBe('Server')
  })
})
