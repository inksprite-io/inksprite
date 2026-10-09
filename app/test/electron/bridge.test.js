// @vitest-environment node
/* global Response, ReadableStream, TextEncoder, AbortSignal */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { BrowserWindow, ipcMain, net, shell } from 'electron'

const loopback = vi.hoisted(() => ({ listen: vi.fn() }))
vi.mock('../../electron/src/loopback.js', () => loopback)
const updates = vi.hoisted(() => ({ downloadUpdate: vi.fn(), installUpdate: vi.fn() }))
vi.mock('../../electron/src/updates.js', () => updates)

import { handleBridge } from '../../electron/src/bridge.js'

const ORIGIN = 'app://inksprite'

/** The page's window: the frame calls come from, and where answers go. */
const page = ({ url = `${ORIGIN}/project/1`, parent = null } = {}) => ({
  senderFrame: { url, parent },
  sender: { id: 1, send: vi.fn(), isDestroyed: () => false },
})

/** What `ipcMain` was given for each channel. */
const handlers = {}
const listeners = {}

beforeAll(() => {
  handleBridge(ORIGIN)
  for (const [channel, handler] of ipcMain.handle.mock.calls) handlers[channel] = handler
  for (const [channel, listener] of ipcMain.on.mock.calls) listeners[channel] = listener
})

beforeEach(() => {
  vi.clearAllMocks()
})

/** A response whose body comes as `chunks`. */
const streamed = (chunks, init) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
        controller.close()
      },
    }),
    init
  )

describe('handleBridge', () => {
  it("answers the app's page only, not another site or a frame inside it", async () => {
    updates.downloadUpdate.mockResolvedValue('0.1.0-dev.7')

    expect(await handlers['update:download'](page())).toEqual({ value: '0.1.0-dev.7' })
    for (const event of [
      page({ url: 'https://elsewhere.example/' }),
      page({ parent: {} }),
      { senderFrame: null, sender: page().sender },
    ]) {
      expect(await handlers['update:download'](event)).toEqual({
        error: expect.stringContaining('Only the app'),
      })
    }
    expect(updates.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('says what went wrong as an error to throw again in the page', async () => {
    updates.installUpdate.mockImplementation(() => {
      throw new Error('No update has been downloaded.')
    })
    expect(await handlers['update:install'](page())).toEqual({
      error: 'No update has been downloaded.',
    })
  })
})

describe('fetch', () => {
  const request = {
    url: 'http://192.168.1.20:8080/v1/chat/completions',
    method: 'POST',
    headers: [['authorization', 'Bearer key']],
    body: new TextEncoder().encode('{}'),
    redirect: 'follow',
  }

  it('makes the request, answers with its head, and sends the body after', async () => {
    net.fetch.mockResolvedValue(
      streamed(['data: 1\n\n', 'data: 2\n\n'], {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/event-stream' },
      })
    )
    const event = page()

    const answer = await handlers.fetch(event, 7, request)

    expect(answer).toEqual({
      value: { status: 200, statusText: 'OK', headers: [['content-type', 'text/event-stream']] },
    })
    expect(net.fetch).toHaveBeenCalledWith(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      redirect: 'follow',
      credentials: 'omit',
      signal: expect.any(AbortSignal),
    })
    await vi.waitFor(() =>
      expect(event.sender.send).toHaveBeenLastCalledWith('fetch:body', 7, { done: true })
    )
    const text = event.sender.send.mock.calls
      .filter(([, , part]) => part.chunk)
      .map(([, , part]) => new TextDecoder().decode(part.chunk))
      .join('')
    expect(text).toBe('data: 1\n\ndata: 2\n\n')
  })

  it('says why when the request gets no answer', async () => {
    net.fetch.mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'))
    expect(await handlers.fetch(page(), 8, request)).toEqual({
      error: 'net::ERR_CONNECTION_REFUSED',
    })
  })

  it('stops the request the page stops', async () => {
    /** @type {AbortSignal} */
    let signal
    net.fetch.mockImplementation((url, init) => {
      signal = init.signal
      return new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted')))
      )
    })
    const event = page()

    const answering = handlers.fetch(event, 9, request)
    listeners['fetch:abort'](event, 9)

    expect(signal.aborted).toBe(true)
    expect(await answering).toEqual({ error: 'aborted' })
  })
})

describe('signIn', () => {
  const request = { address: 'https://auth.example/authorize', port: 41721, path: '/connect/mcp' }

  /** A wait for the browser that comes back with `query` when told. */
  const waiting = () => {
    let back
    const listening = { port: 41721, back: new Promise(r => (back = r)), stop: vi.fn() }
    listening.stop.mockImplementation(() => back(null))
    loopback.listen.mockResolvedValueOnce(listening)
    return { listening, back: query => back(query) }
  }

  it('listens, opens the address, and hands the page the query the browser came back with', async () => {
    const { back } = waiting()
    const focus = vi.fn()
    BrowserWindow.fromWebContents.mockReturnValue({ focus })
    const event = page()

    expect(await handlers.signIn(event, 3, request)).toEqual({ value: undefined })
    expect(loopback.listen).toHaveBeenCalledWith(41721, '/connect/mcp')
    expect(shell.openExternal).toHaveBeenCalledWith('https://auth.example/authorize')

    back('code=abc&state=xyz')
    await vi.waitFor(() =>
      expect(event.sender.send).toHaveBeenCalledWith('signIn:back', 3, 'code=abc&state=xyz')
    )
    expect(focus).toHaveBeenCalled()
  })

  it('opens nothing but a web address', async () => {
    expect(await handlers.signIn(page(), 4, { ...request, address: 'file:///etc/passwd' })).toEqual(
      { error: expect.stringContaining('Not an address to sign in at') }
    )
    expect(loopback.listen).not.toHaveBeenCalled()
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('stops waiting when the page says, and when another sign-in takes its place', async () => {
    const first = waiting()
    const second = waiting()
    const event = page()

    await handlers.signIn(event, 5, request)
    await handlers.signIn(event, 6, request)
    expect(first.listening.stop).toHaveBeenCalled()

    listeners['signIn:stop'](event, 5)
    expect(second.listening.stop).not.toHaveBeenCalled()
    listeners['signIn:stop'](event, 6)
    expect(second.listening.stop).toHaveBeenCalled()
    expect(event.sender.send).not.toHaveBeenCalled()
  })

  it('stops listening when the browser cannot be opened', async () => {
    const { listening } = waiting()
    shell.openExternal.mockRejectedValueOnce(new Error('no browser'))

    expect(await handlers.signIn(page(), 7, request)).toEqual({
      error: 'The browser could not be opened: no browser',
    })
    expect(listening.stop).toHaveBeenCalled()
  })
})

describe('open', () => {
  it('opens a web or mail link in the system', async () => {
    expect(await handlers.open(page(), 'https://example.com/')).toEqual({ value: undefined })
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/')
  })

  it('opens nothing else, whatever the page asks', async () => {
    expect(await handlers.open(page(), 'javascript:alert(1)')).toEqual({
      error: 'Not a link that opens: javascript:alert(1)',
    })
    expect(shell.openExternal).not.toHaveBeenCalled()
  })
})
