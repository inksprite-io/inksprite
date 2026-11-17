import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/stores/db', () => ({
  default: { mcpServers: { toArray: vi.fn(async () => []) } },
}))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn(), start: () => false }),
}))

import { useMcpServerStore } from '@/stores/mcpServerStore.js'

describe('mcpServerStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  /** A server whose tools the writer has always allowed, one by one and all at once. */
  const allowed = () =>
    useMcpServerStore().createServer({
      name: 'Tracker',
      url: 'https://tracker.example/mcp',
      allowed: ['file'],
      allowAll: true,
    })

  it('asks again for a server given another address', () => {
    const store = useMcpServerStore()
    const server = allowed()

    const moved = store.updateServer(server.id, { url: 'https://elsewhere.example/mcp' })

    expect(moved?.url).toBe('https://elsewhere.example/mcp')
    expect(moved?.allowed).toEqual([])
    expect(moved).not.toHaveProperty('allowAll')
  })

  it('keeps what is always allowed through any other change, the same address among them', () => {
    const store = useMcpServerStore()
    const server = allowed()

    store.updateServer(server.id, { name: 'Issues', headers: { 'X-Key': 'k' } })
    const same = store.updateServer(server.id, { url: server.url })

    expect(same).toMatchObject({ name: 'Issues', allowed: ['file'], allowAll: true })
  })
})
