/* global URLSearchParams */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/stores/db', () => ({
  default: { mcpServers: { toArray: vi.fn(async () => []) } },
}))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn(), start: () => false }),
}))

const auth = vi.hoisted(() => {
  globalThis.BroadcastChannel = class {
    postMessage() {}
    close() {}
  }
  return { startSignIn: vi.fn(), finishSignIn: vi.fn() }
})
vi.mock('@/mcp/auth.js', async importOriginal => ({
  .../** @type {any} */ (await importOriginal()),
  startSignIn: auth.startSignIn,
  finishSignIn: auth.finishSignIn,
}))

const browser = vi.hoisted(() => ({ signInInBrowser: vi.fn() }))
vi.mock('@/platform/signIn.js', async importOriginal => ({
  .../** @type {any} */ (await importOriginal()),
  signInInBrowser: browser.signInInBrowser,
}))

import { useMcpServers } from '@/composables/useMcpServers.js'

const SERVER = 'https://mcp.example/mcp'
const AUTHORIZE = new URL('https://auth.example/authorize?client_id=x')

describe('signIn, in the desktop window', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    globalThis.__INKSPRITE_DESKTOP__ = {}
    auth.startSignIn.mockImplementation(async (url, onRedirect) => {
      onRedirect(AUTHORIZE)
      return 'REDIRECT'
    })
  })

  afterEach(() => {
    delete globalThis.__INKSPRITE_DESKTOP__
    vi.restoreAllMocks()
  })

  it('signs in through the system browser, with no tab, and finishes in the window', async () => {
    const open = vi.spyOn(window, 'open')
    const params = new URLSearchParams('code=c&state=s')
    browser.signInInBrowser.mockResolvedValue(params)
    auth.finishSignIn.mockResolvedValue({ url: SERVER })

    const outcome = await useMcpServers().signIn(SERVER)

    expect(outcome).toEqual({ signedIn: true })
    expect(open).not.toHaveBeenCalled()
    expect(browser.signInInBrowser).toHaveBeenCalledWith(
      AUTHORIZE,
      '/connect/mcp',
      expect.objectContaining({ signal: expect.anything() })
    )
    expect(auth.finishSignIn).toHaveBeenCalledWith(params)
  })

  it('says why, when the sign-in could not finish', async () => {
    browser.signInInBrowser.mockResolvedValue(new URLSearchParams('error=access_denied'))
    auth.finishSignIn.mockRejectedValue(new Error('Sign-in was cancelled.'))

    const outcome = await useMcpServers().signIn(SERVER)

    expect(outcome).toEqual({ error: 'Sign-in was cancelled.' })
  })
})

describe('a server’s tool, set for the whole app', () => {
  beforeEach(() => setActivePinia(createPinia()))

  /** A server with a tool that says it only reads and one that doesn't. */
  const connected = async () => {
    const { useMcpServerStore } = await import('@/stores/mcpServerStore.js')
    const store = useMcpServerStore()
    const server = store.createServer({
      name: 'Wiki',
      prefix: 'wiki',
      url: 'https://wiki.example/mcp',
      tools: [
        {
          name: 'search',
          exposed: 'wiki__search',
          inputSchema: {},
          annotations: { readOnlyHint: true },
        },
        { name: 'edit', exposed: 'wiki__edit', inputSchema: {} },
      ],
      prompts: [],
      allowed: [],
    })
    return () => store.getServer(server.id)
  }

  it('asks first, always allows, or is off, each taking the last one’s place', async () => {
    const row = await connected()
    const { setToolSetting } = useMcpServers()

    setToolSetting('wiki__edit', 'always')
    expect(row()).toMatchObject({ allowed: ['edit'], asks: [], off: [] })

    setToolSetting('wiki__search', 'ask')
    expect(row()).toMatchObject({ allowed: ['edit'], asks: ['search'] })

    setToolSetting('wiki__edit', 'ask')
    expect(row()).toMatchObject({ allowed: [], asks: ['search', 'edit'] })
  })

  it('keeps what a tool was set to while it is off, for when it is back on', async () => {
    const row = await connected()
    const { setToolSetting } = useMcpServers()

    setToolSetting('wiki__edit', 'always')
    setToolSetting('wiki__edit', 'off')
    expect(row()).toMatchObject({ allowed: ['edit'], off: ['edit'] })

    setToolSetting('wiki__edit', 'always')
    expect(row()).toMatchObject({ allowed: ['edit'], off: [] })
  })

  it('has nothing ask once everything from the server is always allowed', async () => {
    const row = await connected()
    const { setToolSetting, allowServer } = useMcpServers()

    setToolSetting('wiki__search', 'ask')
    allowServer('wiki__edit')
    expect(row()).toMatchObject({ allowAll: true, asks: [] })
  })
})
