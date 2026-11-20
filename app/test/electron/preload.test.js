// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const source = readFileSync(
  fileURLToPath(new URL('../../electron/src/preload.cjs', import.meta.url)),
  'utf8'
)

/** A channel's two ends, as far as the preload uses them. */
class Channel {
  port1 = { close: vi.fn(), postMessage: vi.fn(), onmessage: null }
  port2 = {}
}

/**
 * Run the preload as Electron does in a frame: the window's top frame or
 * one set into it, at an origin.
 *
 * @param {{mainFrame: boolean, origin: string}} frame
 */
function runIn({ mainFrame, origin }) {
  /** @type {Record<string, any>} */
  const exposed = {}
  const contextBridge = {
    exposeInMainWorld: vi.fn((name, api) => {
      exposed[name] = api
    }),
  }
  /** @type {Record<string, Function>} */
  const heard = {}
  const ipcRenderer = {
    on: vi.fn((channel, listener) => {
      heard[channel] = listener
    }),
    send: vi.fn(),
    invoke: vi.fn(async () => ({ value: undefined })),
    postMessage: vi.fn(),
  }
  /** @type {Channel[]} */
  const channels = []
  const MessageChannel = function () {
    const channel = new Channel()
    channels.push(channel)
    return channel
  }
  const run = vm.compileFunction(source, ['require', 'process', 'location', 'MessageChannel'])
  run(
    (/** @type {string} */ name) => {
      if (name !== 'electron') throw new Error(`The preload reaches nothing but Electron: ${name}`)
      return { contextBridge, ipcRenderer }
    },
    { isMainFrame: mainFrame },
    { origin },
    MessageChannel
  )
  return { exposed, ipcRenderer, heard, channels }
}

describe('the preload, in the window’s own page', () => {
  it('gives the page the desktop’s bridge, and listens for the native side', () => {
    const { exposed, heard } = runIn({ mainFrame: true, origin: 'app://inksprite' })

    expect(Object.keys(exposed)).toEqual(['__INKSPRITE_DESKTOP__'])
    expect(Object.keys(heard).sort()).toEqual([
      'apps:call',
      'apps:cancel',
      'fetch:body',
      'menu:command',
      'python:fetchFile',
      'signIn:back',
      'terminal:event',
      'window:save',
    ])
  })

  it('tells the page what the native side says, and the native side that the page saved', async () => {
    const { exposed, heard, ipcRenderer } = runIn({ mainFrame: true, origin: 'app://inksprite' })
    const desktop = exposed.__INKSPRITE_DESKTOP__

    const onEvent = vi.fn()
    desktop.terminals.onEvent(onEvent)
    heard['terminal:event']({}, 'terminal:1', { type: 'bell' })
    expect(onEvent).toHaveBeenCalledWith('terminal:1', { type: 'bell' })

    const save = vi.fn(async () => {})
    desktop.beforeClosing(save)
    await heard['window:save']()
    expect(save).toHaveBeenCalledTimes(1)
    expect(ipcRenderer.send).toHaveBeenCalledWith('window:saved')
  })

  it('is the page’s bridge in the top frame, wherever that is', () => {
    const { exposed } = runIn({ mainFrame: true, origin: 'terminal://frame' })
    expect(Object.keys(exposed)).toEqual(['__INKSPRITE_DESKTOP__'])
  })
})

describe('the preload, in a terminal’s frame', () => {
  it('gives the frame its port to the shell and nothing else, and listens for nothing', () => {
    const { exposed, ipcRenderer, channels } = runIn({
      mainFrame: false,
      origin: 'terminal://frame',
    })

    expect(Object.keys(exposed)).toEqual(['__INKSPRITE_TERMINAL__'])
    const terminal = exposed.__INKSPRITE_TERMINAL__
    expect(Object.keys(terminal).sort()).toEqual(['attach', 'send'])
    expect(ipcRenderer.on).not.toHaveBeenCalled()

    // Nothing is sent before the frame has asked for its shell.
    terminal.send({ type: 'input', data: 'x' })
    expect(ipcRenderer.postMessage).not.toHaveBeenCalled()

    const onMessage = vi.fn()
    terminal.attach({ id: 'terminal:1', cols: 80, rows: 24 }, onMessage)
    const [{ port1, port2 }] = channels
    expect(ipcRenderer.postMessage).toHaveBeenCalledWith(
      'terminal:attach',
      { id: 'terminal:1', cols: 80, rows: 24 },
      [port2]
    )
    port1.onmessage({ data: { type: 'data', data: 'hello' } })
    expect(onMessage).toHaveBeenCalledWith({ type: 'data', data: 'hello' })

    terminal.send({ type: 'input', data: 'x' })
    expect(port1.postMessage).toHaveBeenCalledWith({ type: 'input', data: 'x' })
  })
})

describe('the preload, in any other frame', () => {
  it('gives it nothing, and listens for nothing', () => {
    for (const origin of ['https://example.com', 'app://inksprite', 'null', 'terminal://other']) {
      const { exposed, ipcRenderer } = runIn({ mainFrame: false, origin })
      expect(exposed).toEqual({})
      expect(ipcRenderer.on).not.toHaveBeenCalled()
      expect(ipcRenderer.send).not.toHaveBeenCalled()
      expect(ipcRenderer.postMessage).not.toHaveBeenCalled()
    }
  })
})
