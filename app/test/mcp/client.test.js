// @vitest-environment node
/* global AbortController */
// The client is run against the harness's test server, in Node, where fetch
// is the real thing: the point is that a server speaking the protocol is
// listed and called, session and all.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import {
  callServerTool,
  describeFailure,
  disconnect,
  getServerPrompt,
  listServer,
  promptText,
  resultForModel,
} from '@/mcp/client.js'

/**
 * Start the test server on a free port, with these arguments.
 *
 * @param {string[]} args
 * @returns {Promise<{url: string, stop: () => void}>}
 */
function startServer(args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['harness/mcp-server.js', '--port', '0', ...args])
    child.stdout.on('data', chunk => {
      const found = String(chunk).match(/(http:\/\/localhost:\d+\/mcp)/)
      if (found) resolve({ url: found[1], stop: () => child.kill() })
    })
    child.on('error', reject)
  })
}

describe('the client, against a server', () => {
  let open
  let keyed

  beforeAll(async () => {
    open = await startServer()
    keyed = await startServer(['--key', 'secret'])
  })

  afterAll(() => {
    disconnect('test')
    open?.stop()
    keyed?.stop()
  })

  it('lists what a server offers', async () => {
    const listed = await listServer({ url: open.url })

    expect(listed.serverName).toBe('inksprite test server')
    expect(listed.instructions).toContain('glossary')
    expect(listed.tools.map(tool => tool.name)).toEqual(['look_up', 'save_note', 'break'])
    expect(listed.tools[0].annotations).toEqual({ readOnlyHint: true })
    expect(listed.prompts.map(prompt => prompt.name)).toEqual(['outline'])
  })

  it('calls a tool, and keeps the connection for the next call', async () => {
    const server = { id: 'test', url: open.url }

    const first = await callServerTool(server, 'save_note', { text: 'one' })
    const second = await callServerTool(server, 'save_note', { text: 'two' })

    expect(resultForModel(first)).toMatch(/Saved note #\d+\./)
    expect(resultForModel(second)).not.toBe(resultForModel(first))
  })

  it('stops a call when its signal does, rather than trying again', async () => {
    const server = { id: 'test', url: open.url }
    const stopped = new AbortController()
    stopped.abort()

    await expect(
      callServerTool(server, 'save_note', { text: 'never' }, { signal: stopped.signal })
    ).rejects.toBeDefined()
    // Still connected, and still answering.
    const after = await callServerTool(server, 'save_note', { text: 'three' })
    expect(resultForModel(after)).toMatch(/Saved note #\d+\./)
  })

  it('sends the key it was given as a header', async () => {
    await expect(listServer({ url: keyed.url })).rejects.toBeDefined()

    const listed = await listServer({ url: keyed.url, headers: { Authorization: 'Bearer secret' } })
    expect(listed.tools).toHaveLength(3)
  })

  it('says a server that wants signing in does', async () => {
    const error = await listServer({ url: keyed.url }).catch(failure => failure)

    expect(describeFailure(error)).toMatch(/sign in/)
  })

  it('gets a prompt filled in with what it was given', async () => {
    const answer = await getServerPrompt({ id: 'test', url: open.url }, 'outline', {
      topic: 'the lighthouse',
    })

    expect(promptText(answer)).toBe('Outline a short piece about the lighthouse, in five beats.')
  })
})

describe('promptText', () => {
  it('joins what each message said, and notes what is not text', () => {
    expect(
      promptText({
        messages: [
          { role: 'user', content: { type: 'text', text: 'First.' } },
          { role: 'assistant', content: { type: 'text', text: 'Second.' } },
          { role: 'user', content: { type: 'image', data: 'x', mimeType: 'image/png' } },
        ],
      })
    ).toBe('First.\n\nSecond.\n\n[1 part of the prompt left out: only text is read here]')
    expect(promptText({ messages: [] })).toBe('')
  })
})

describe('describeFailure', () => {
  it('says what each kind of failure means', () => {
    const http = status => ({ data: { status } })

    expect(describeFailure(http(403))).toMatch(/refused/)
    expect(describeFailure(http(404))).toMatch(/Nothing answers/)
    expect(describeFailure(http(502))).toMatch(/error \(502\)/)
    expect(describeFailure(new TypeError('Failed to fetch'))).toMatch(/CORS/)
    expect(describeFailure(new Error('Something odd'))).toBe('Something odd')
  })

  it('says an answer that is not an MCP server is not one, not what its schema found', () => {
    const issues = [{ code: 'invalid_type', expected: 'string', path: ['jsonrpc'], message: 'x' }]
    expect(describeFailure(new Error(JSON.stringify(issues, null, 2)))).toMatch(/not an MCP server/)
    expect(describeFailure(new Error(`MCP error: ${JSON.stringify(issues)}`))).toMatch(/not an MCP/)
    expect(describeFailure(Object.assign(new Error('bad'), { issues }))).toMatch(/not an MCP/)
    expect(describeFailure(new Error('Unexpected content type: text/html'))).toMatch(/not an MCP/)
  })
})

describe('resultForModel', () => {
  it('sends text as text, and an error as one', () => {
    expect(
      resultForModel({
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
      })
    ).toBe('a\n\nb')
    expect(resultForModel({ content: [{ type: 'text', text: 'no' }], isError: true })).toEqual({
      error: 'no',
    })
  })

  it('sends structured content as JSON when there is no text', () => {
    expect(resultForModel({ content: [], structuredContent: { count: 2 } })).toBe('{"count":2}')
  })

  it('leaves out images with a note, and says when there was nothing', () => {
    expect(
      resultForModel({ content: [{ type: 'image', data: 'x', mimeType: 'image/png' }] })
    ).toMatch(/1 part of the answer left out/)
    expect(resultForModel({ content: [] })).toBe('(The tool returned nothing.)')
  })

  it('reads text a resource carries, and links to one it points at', () => {
    expect(
      resultForModel({
        content: [
          { type: 'resource', resource: { uri: 'x', text: 'Inside.' } },
          { type: 'resource_link', uri: 'https://x.example', name: 'X' },
        ],
      })
    ).toBe('Inside.\n\n[X](https://x.example)')
  })
})
