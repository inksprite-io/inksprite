/* global AbortController */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const tools = vi.hoisted(() => ({ toolsFor: vi.fn(), callTool: vi.fn() }))
vi.mock('@/apps/tools.js', () => tools)

import { PROTOCOL_VERSIONS, answerRequest, instructionsFor } from '@/apps/protocol.js'

const APP = { id: 'app_1', name: 'Claude Code', projects: ['story_a'], edit: 'off', comment: false }

const signal = new AbortController().signal
const asking = { app: APP, signal }

/** @param {string} method @param {object} [params] */
const request = (method, params) => ({
  jsonrpc: '2.0',
  id: 5,
  method,
  ...(params ? { params } : {}),
})

beforeEach(() => {
  vi.clearAllMocks()
  tools.toolsFor.mockReturnValue([
    { name: 'list_projects', description: 'The projects.', inputSchema: { type: 'object' } },
    { name: 'read_document', description: 'Read.', inputSchema: { type: 'object' } },
  ])
  tools.callTool.mockResolvedValue({ result: { content: [{ type: 'text', text: 'read' }] } })
})

describe('answerRequest', () => {
  it('says what it is and what it offers when an app connects', async () => {
    const { response } = await answerRequest(
      request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'a-client', version: '1' },
      }),
      asking
    )

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 5,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'inksprite', version: expect.any(String) },
        instructions: instructionsFor(APP),
      },
    })
  })

  it('tells the app what its connection may do, and no more', () => {
    const reads = instructionsFor(APP)
    expect(reads).toContain('to list, search and read their documents')
    expect(reads).not.toMatch(/edit_document|add_comment/)

    const edits = instructionsFor({ ...APP, edit: 'editing' })
    expect(edits).toContain('to read and write their documents')
    expect(edits).toContain('edit_document')
    expect(edits).not.toContain('add_comment')

    const comments = instructionsFor({ ...APP, comment: true })
    expect(comments).toContain('add_comment')
    expect(comments).toContain("carries this connection's name")
    expect(comments).not.toContain('edit_document')

    const suggests = instructionsFor({ ...APP, edit: 'suggesting' })
    expect(suggests).toContain('to read and write their documents')
    expect(suggests).toContain('is suggested to the user in the document')
    expect(suggests).not.toContain('is in the document at once')
    expect(edits).not.toContain('is suggested to the user')
  })

  it('speaks the app’s version of the protocol when it has it, and its newest otherwise', async () => {
    for (const version of PROTOCOL_VERSIONS) {
      const { response } = await answerRequest(
        request('initialize', { protocolVersion: version }),
        asking
      )
      expect(response.result.protocolVersion).toBe(version)
    }
    for (const version of ['2024-11-05', '2099-01-01', undefined, 7]) {
      const { response } = await answerRequest(
        request('initialize', { protocolVersion: version }),
        asking
      )
      expect(response.result.protocolVersion).toBe(PROTOCOL_VERSIONS[0])
    }
  })

  it('answers a ping', async () => {
    expect(await answerRequest(request('ping'), asking)).toEqual({
      response: { jsonrpc: '2.0', id: 5, result: {} },
    })
  })

  it('lists the tools the app is offered', async () => {
    const { response } = await answerRequest(request('tools/list'), asking)
    expect(tools.toolsFor).toHaveBeenCalledWith(APP)
    expect(response.result.tools.map(tool => tool.name)).toEqual(['list_projects', 'read_document'])
  })

  it('runs a call to one of them, and sends what it answered', async () => {
    const answer = await answerRequest(
      request('tools/call', { name: 'read_document', arguments: { path: 'notes/Plan' } }),
      asking
    )

    expect(tools.callTool).toHaveBeenCalledWith(
      APP,
      'read_document',
      { path: 'notes/Plan' },
      signal
    )
    expect(answer).toEqual({
      response: { jsonrpc: '2.0', id: 5, result: { content: [{ type: 'text', text: 'read' }] } },
    })
  })

  it('calls a tool with nothing when its arguments are not an object', async () => {
    for (const args of [undefined, null, 'text', ['a']]) {
      await answerRequest(request('tools/call', { name: 'list_projects', arguments: args }), asking)
      expect(tools.callTool).toHaveBeenLastCalledWith(APP, 'list_projects', {}, signal)
    }
  })

  it('refuses a tool the app is not offered, without running anything', async () => {
    for (const name of ['edit_document', 'run_python', undefined, 3]) {
      const { response } = await answerRequest(request('tools/call', { name }), asking)
      expect(response.error).toEqual({ code: -32602, message: `Unknown tool: ${String(name)}` })
    }
    expect(tools.callTool).not.toHaveBeenCalled()
  })

  it('passes on a call another window is to run', async () => {
    tools.callTool.mockResolvedValue({ pass: 'elsewhere' })
    expect(await answerRequest(request('tools/call', { name: 'read_document' }), asking)).toEqual({
      pass: 'elsewhere',
    })
  })

  it('says a method it does not have is not found', async () => {
    for (const method of ['resources/list', 'prompts/list', 'sampling/createMessage', 'nonsense']) {
      const { response } = await answerRequest(request(method), asking)
      expect(response).toEqual({
        jsonrpc: '2.0',
        id: 5,
        error: { code: -32601, message: `Method not found: ${method}` },
      })
    }
  })
})
