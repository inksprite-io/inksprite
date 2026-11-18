import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/stores/db', () => ({
  default: {
    webSearch: { get: vi.fn(async () => undefined) },
    mcpServers: { toArray: vi.fn(async () => []) },
  },
}))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn(), start: () => false }),
}))
vi.mock('@/mcp/client.js', () => ({ disconnect: vi.fn() }))

import { OFF_ASK_ALWAYS, OFF_ON, useToolSettings } from '@/composables/useToolSettings.js'
import { useApplicationState } from '@/composables/useApplicationState.js'
import { useWebSearch } from '@/composables/useWebSearch.js'
import { useMcpServerStore } from '@/stores/mcpServerStore.js'
import { setServers } from '@/mcp/servers.js'
import { setWebSearch } from '@/web/config.js'

describe('a tool’s setting for the whole app, as a screen reads and writes it', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useApplicationState().resetState()
  })

  afterEach(() => {
    setServers([])
    setWebSearch(null)
  })

  it('offers three settings for a tool that may ask first, and two for any other', () => {
    const settings = useToolSettings()
    expect(settings.optionsFor('read_web_page')).toBe(OFF_ASK_ALWAYS)
    expect(settings.optionsFor('web_search')).toBe(OFF_ON)
    expect(settings.optionsFor('roll_dice')).toBe(OFF_ON)
  })

  it('keeps whether reading on the writer’s own network asks, apart from the web', () => {
    const web = useWebSearch()
    web.setLocalReading('always')
    expect(web.setup.value.readLocalWithoutAsking).toBe(true)
    expect(web.setup.value.readWithoutAsking).not.toBe(true)
    web.setLocalReading('ask')
    expect(web.setup.value.readLocalWithoutAsking).toBe(false)
  })

  it('keeps what reading and keeping a page ask in the web search’s settings', () => {
    const settings = useToolSettings()
    const web = useWebSearch()

    settings.setSetting('read_web_page', 'always')
    settings.setSetting('save_web_page', 'always')
    expect(web.setup.value).toMatchObject({ readWithoutAsking: true, saveWithoutAsking: true })
    expect(settings.settingOf('read_web_page')).toBe('always')

    settings.setSetting('read_web_page', 'ask')
    expect(web.setup.value.readWithoutAsking).toBe(false)
    expect(settings.settingOf('read_web_page')).toBe('ask')
  })

  it('switches one of the app’s own off and on, leaving what it asked as it was', () => {
    const settings = useToolSettings()
    settings.setSetting('read_web_page', 'always')

    settings.setSetting('read_web_page', 'off')
    expect(useApplicationState().toolsOff.value).toEqual(['read_web_page'])
    expect(settings.settingOf('read_web_page')).toBe('off')
    expect(useWebSearch().setup.value.readWithoutAsking).toBe(true)

    settings.setSetting('web_search', 'off')
    settings.setSetting('web_search', 'on')
    expect(useApplicationState().toolsOff.value).toEqual(['read_web_page'])
  })

  it('sets a server’s tool on the server’s own row', () => {
    const server = useMcpServerStore().createServer({
      name: 'Wiki',
      prefix: 'wiki',
      url: 'https://wiki.example/mcp',
      tools: [{ name: 'edit', exposed: 'wiki__edit', inputSchema: {} }],
      prompts: [],
      allowed: [],
    })
    const settings = useToolSettings()
    expect(settings.settingOf('wiki__edit')).toBe('ask')

    settings.setSetting('wiki__edit', 'always')
    expect(useMcpServerStore().getServer(server.id).allowed).toEqual(['edit'])
    expect(settings.settingOf('wiki__edit')).toBe('always')
    expect(useApplicationState().toolsOff.value).toEqual([])
  })

  it('always allows a site, and asks about it again once it is taken off', () => {
    const web = useWebSearch()
    web.allowSite('tides.example')
    web.allowSite('almanac.example')
    web.allowSite('tides.example')
    expect(web.setup.value.allowedSites).toEqual(['tides.example', 'almanac.example'])

    web.disallowSite('tides.example')
    expect(web.setup.value.allowedSites).toEqual(['almanac.example'])
  })
})
