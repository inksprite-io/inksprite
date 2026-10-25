// @vitest-environment node
/* global Response, ReadableStream, TextEncoder, AbortSignal */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { BrowserWindow, ipcMain, net, shell } from 'electron'

const loopback = vi.hoisted(() => ({ listen: vi.fn() }))
vi.mock('../../electron/src/loopback.js', () => loopback)
const updates = vi.hoisted(() => ({ downloadUpdate: vi.fn(), installUpdate: vi.fn() }))
vi.mock('../../electron/src/updates.js', () => updates)
const settingsFile = vi.hoisted(() => ({ readSettingsFile: vi.fn() }))
vi.mock('../../electron/src/settingsFile.js', () => settingsFile)
const windows = vi.hoisted(() => ({ bringForward: vi.fn() }))
vi.mock('../../electron/src/windows.js', () => windows)
const python = vi.hoisted(() => ({ run: vi.fn(), stop: vi.fn() }))
vi.mock('../../electron/src/sandbox.js', () => ({
  PythonSessions: class {
    run = python.run
    stop = python.stop
  },
}))

import { handleBridge, projectFiles } from '../../electron/src/bridge.js'

const ORIGIN = 'app://inksprite'

/** The page's window: the frame calls come from, and where answers go. */
const page = ({ url = `${ORIGIN}/project/1`, parent = null } = {}) => ({
  senderFrame: { url, parent },
  sender: {
    id: 1,
    send: vi.fn(),
    isDestroyed: () => false,
    once: vi.fn(),
    off: vi.fn(),
  },
})

/** What `ipcMain` was given for each channel. */
const handlers = {}
const listeners = {}

/** Opens a window on a path of the page, as `main.js` gives the bridge. */
const openWindow = vi.fn()

beforeAll(() => {
  handleBridge(ORIGIN, { openWindow })
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

describe('windows', () => {
  it('opens another window on the path the page asks for', async () => {
    expect(await handlers['window:open'](page(), '/project/story_2')).toEqual({ value: undefined })
    expect(openWindow).toHaveBeenCalledWith('/project/story_2')
  })

  it('says why when a window could not be opened there', async () => {
    openWindow.mockImplementationOnce(() => {
      throw new Error('Not a path in the app: https://elsewhere.example/')
    })
    expect(await handlers['window:open'](page(), 'https://elsewhere.example/')).toEqual({
      error: 'Not a path in the app: https://elsewhere.example/',
    })
  })

  it('brings forward the window that asks, and no other', async () => {
    const window = { id: 'the one asking' }
    BrowserWindow.fromWebContents.mockReturnValue(window)
    const event = page()

    await handlers['window:focus'](event)
    expect(BrowserWindow.fromWebContents).toHaveBeenCalledWith(event.sender)
    expect(windows.bringForward).toHaveBeenCalledWith(window)
  })
})

describe('settings:file', () => {
  it('hands the page the settings file a script left, or null', async () => {
    settingsFile.readSettingsFile.mockResolvedValue('{"scope":"settings"}')
    expect(await handlers['settings:file'](page())).toEqual({ value: '{"scope":"settings"}' })

    settingsFile.readSettingsFile.mockResolvedValue(null)
    expect(await handlers['settings:file'](page())).toEqual({ value: null })
  })

  it("answers the app's page only", async () => {
    expect(await handlers['settings:file'](page({ url: 'https://elsewhere.example/' }))).toEqual({
      error: expect.stringContaining('Only the app'),
    })
    expect(settingsFile.readSettingsFile).not.toHaveBeenCalled()
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

describe('python', () => {
  it("runs the page's code in the session it names", async () => {
    const result = { stdout: '42', stderr: '', value: null, error: null, restarted: false }
    python.run.mockResolvedValue(result)

    expect(await handlers['python:run'](page(), 'chat-1', 'print(42)')).toEqual({ value: result })
    expect(python.run).toHaveBeenCalledWith('chat-1', 'print(42)', {
      timeoutMs: null,
      project: null,
      filename: null,
    })

    await handlers['python:run'](page(), 'chat-1', 'print(42)', {
      timeoutMs: 600000,
      filename: '/project/Sims/d20.py',
    })
    expect(python.run).toHaveBeenLastCalledWith('chat-1', 'print(42)', {
      timeoutMs: 600000,
      project: null,
      filename: '/project/Sims/d20.py',
    })
  })

  it('takes a time limit of milliseconds, or none', async () => {
    for (const timeoutMs of [0, -1, Infinity, '600000']) {
      expect(await handlers['python:run'](page(), 'chat-1', '1', { timeoutMs })).toHaveProperty(
        'error'
      )
    }
    expect(python.run).not.toHaveBeenCalled()
  })

  it('runs nothing but a string of code, with a project that is a list', async () => {
    expect(await handlers['python:run'](page(), 'chat-1', { code: 'print(42)' })).toHaveProperty(
      'error'
    )
    expect(
      await handlers['python:run'](page(), 'chat-1', '1', { project: { path: 'x' } })
    ).toHaveProperty('error')
    expect(await handlers['python:run'](page(), 'chat-1', '1', { filename: 1 })).toHaveProperty(
      'error'
    )
    expect(python.run).not.toHaveBeenCalled()
  })

  it('hands the run its project, without the library when it has no files', async () => {
    python.run.mockResolvedValue({})
    const project = [
      { path: 'Rules', folder: true },
      { path: 'Rules/Combat', id: 'doc_1', text: '# Combat' },
    ]
    await handlers['python:run'](page(), 'chat-1', '1', { project })
    expect(python.run).toHaveBeenCalledWith('chat-1', '1', {
      timeoutMs: null,
      project,
      filename: null,
    })
  })

  it('has the page fetch a file still on the sync server when the run reads it', async () => {
    python.run.mockResolvedValue({})
    const event = page()
    await handlers['python:run'](event, 'chat-1', '1', {
      project: [{ path: 'big.pdf', id: 'doc_1', size: 2048, onServer: true }],
    })
    const [entry] = python.run.mock.calls[0][2].project
    expect(entry).toEqual({ path: 'big.pdf', id: 'doc_1', size: 2048, fetch: expect.any(Function) })

    const fetched = entry.fetch()
    expect(event.sender.send).toHaveBeenCalledWith('python:fetchFile', 'chat-1', 1, 'doc_1')
    const [, , request] = event.sender.send.mock.calls[0]
    // Only the page that was asked answers for it: another's answer would
    // have it looked for in a library this test hasn't got.
    listeners['python:fetched']({ ...page(), sender: { id: 2 } }, request, 'Thief/big.pdf')
    listeners['python:fetched'](event, request, null)
    expect(await fetched).toBeNull()
    expect(event.sender.off).toHaveBeenCalledWith('destroyed', expect.any(Function))
  })

  it('reads a fetch as failed when the page goes before answering', async () => {
    python.run.mockResolvedValue({})
    const event = page()
    await handlers['python:run'](event, 'chat-1', '1', {
      project: [{ path: 'big.pdf', id: 'doc_1', size: 2048, onServer: true }],
    })
    const fetched = python.run.mock.calls[0][2].project[0].fetch()
    const [, closed] = event.sender.once.mock.calls[0]
    closed()
    expect(await fetched).toBeNull()
  })

  it('stops the session the page names, and only for the page', () => {
    listeners['python:stop'](page(), 'chat-1')
    expect(python.stop).toHaveBeenCalledWith('chat-1')

    listeners['python:stop'](page({ url: 'https://elsewhere.example/' }), 'chat-2')
    expect(python.stop).toHaveBeenCalledTimes(1)
  })
})

describe('projectFiles', () => {
  it('finds each imported file in the library, and leaves out what isn’t there', async () => {
    const locate = vi.fn(async file =>
      file === 'Thief/Data/odds.csv' ? { path: '/library/Thief/Data/odds.csv', size: 120 } : null
    )
    expect(
      await projectFiles(
        [
          { path: 'Data', folder: true },
          { path: 'Data/odds.csv', id: 'doc_1', file: 'Thief/Data/odds.csv' },
          { path: 'Data/gone.pdf', id: 'doc_2', file: 'Thief/Data/gone.pdf' },
          { path: 'Notes', id: 'doc_3', text: 'kept' },
        ],
        locate,
        vi.fn()
      )
    ).toEqual([
      { path: 'Data', folder: true },
      { path: 'Data/odds.csv', id: 'doc_1', file: '/library/Thief/Data/odds.csv', size: 120 },
      { path: 'Notes', id: 'doc_3', text: 'kept' },
    ])
  })

  it('fetches a file still on the sync server when it is read, then finds it', async () => {
    const locate = vi.fn(async file => ({ path: `/library/${file}`, size: 2048 }))
    const fetchFile = vi.fn().mockResolvedValueOnce('Thief/big.pdf').mockResolvedValueOnce(null)
    const [entry] = await projectFiles(
      [{ path: 'big.pdf', id: 'doc_1', size: 2048, onServer: true }],
      locate,
      fetchFile
    )
    expect(locate).not.toHaveBeenCalled()
    expect(fetchFile).not.toHaveBeenCalled()

    expect(await entry.fetch()).toEqual({ path: '/library/Thief/big.pdf', size: 2048 })
    expect(fetchFile).toHaveBeenCalledWith('doc_1')
    expect(await entry.fetch()).toBeNull()
    expect(locate).toHaveBeenCalledTimes(1)
  })

  it('leaves out what isn’t a folder, a text or a file, and a file the library refused', async () => {
    const locate = vi.fn().mockRejectedValue(new Error('That path leads out of the library'))
    expect(
      await projectFiles(
        [
          null,
          { path: '', folder: true },
          { path: 'x', id: 1, text: 'no id' },
          { path: 'y', id: 'doc_1' },
          { path: 'z', id: 'doc_2', file: '../../etc/passwd' },
          { path: 'w', id: 'doc_3', size: -1, onServer: true },
          { path: 'v', id: 'doc_4', size: '12', onServer: true },
        ],
        locate,
        vi.fn()
      )
    ).toEqual([])
  })
})
