import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useWebSearchStore } from '../../src/stores/webSearchStore'
import { setWebSearch, webSearchSetup } from '../../src/web/config.js'
import { CHAT_PROFILE_ID } from '../../src/ai/profiles/index.js'

const get = vi.fn()
vi.mock('../../src/stores/db', () => ({
  default: { webSearch: { get: (...args) => get(...args) } },
}))

const trackChange = vi.fn()
vi.mock('../../src/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange, trackDelete: vi.fn() }),
}))

const disconnect = vi.fn()
vi.mock('../../src/mcp/client.js', () => ({ disconnect: (...args) => disconnect(...args) }))

describe('the web search store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    get.mockResolvedValue(undefined)
  })

  afterEach(() => setWebSearch(null))

  it('starts with nothing chosen, to be used in chats on Default once it is', async () => {
    const store = useWebSearchStore()
    await store.ensureInitialized()

    expect(store.setup).toEqual({ id: 'web', keys: {}, profiles: [CHAT_PROFILE_ID] })
    expect(webSearchSetup()).toEqual(store.setup)
  })

  it('loads the stored row and hands it on', async () => {
    get.mockResolvedValue({ id: 'web', service: 'kagi', keys: { kagi: 'k' }, profiles: [] })

    const store = useWebSearchStore()
    await store.ensureInitialized()

    expect(get).toHaveBeenCalledWith('web')
    expect(store.setup.service).toBe('kagi')
    expect(webSearchSetup()?.keys).toEqual({ kagi: 'k' })
  })

  it('keeps a change, hands it on, and drops the connection a key changed for', async () => {
    const store = useWebSearchStore()
    await store.ensureInitialized()

    store.update({ service: 'exa', keys: { exa: 'k1' } })

    expect(trackChange).toHaveBeenCalledWith(
      'webSearch',
      'web',
      expect.objectContaining({ id: 'web', service: 'exa', keys: { exa: 'k1' } })
    )
    expect(webSearchSetup()?.service).toBe('exa')
    expect(disconnect).toHaveBeenCalledWith('web:exa')
  })
})
