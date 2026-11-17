import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mayAsk, offEverywhere, settingOf } from '@/ai/tools/everywhere.js'
import { useApplicationState } from '@/composables/useApplicationState.js'
import { setServers } from '@/mcp/servers.js'
import { setWebSearch } from '@/web/config.js'

const wiki = {
  id: 'mcp_wiki',
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
  created: 1,
  updated: 1,
}

describe('a tool as it is set for the whole app', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useApplicationState().resetState()
  })

  afterEach(() => {
    setServers([])
    setWebSearch(null)
  })

  it('has one of the app’s own on until it is switched off', () => {
    expect(settingOf('roll_dice')).toBe('on')
    expect(mayAsk('roll_dice')).toBe(false)

    useApplicationState().setToolOff('roll_dice', true)
    expect(offEverywhere('roll_dice')).toBe(true)
    expect(settingOf('roll_dice')).toBe('off')
    expect(offEverywhere('oracle')).toBe(false)

    useApplicationState().setToolOff('roll_dice', false)
    expect(settingOf('roll_dice')).toBe('on')
  })

  it('has a page read ask first until reading never asks, and a page kept until keeping doesn’t', () => {
    expect(mayAsk('read_web_page')).toBe(true)
    expect(settingOf('read_web_page')).toBe('ask')
    expect(settingOf('save_web_page')).toBe('ask')
    expect(settingOf('web_search')).toBe('on')

    setWebSearch({ id: 'web', keys: {}, readWithoutAsking: true, saveWithoutAsking: true })
    expect(settingOf('read_web_page')).toBe('always')
    expect(settingOf('save_web_page')).toBe('always')

    useApplicationState().setToolOff('read_web_page', true)
    expect(settingOf('read_web_page')).toBe('off')
  })

  it('has a server’s tool by its server’s row: what it says of itself, until the writer says', () => {
    setServers([wiki])
    expect(mayAsk('wiki__search')).toBe(true)
    expect(settingOf('wiki__search')).toBe('always')
    expect(settingOf('wiki__edit')).toBe('ask')

    setServers([{ ...wiki, asks: ['search'], allowed: ['edit'] }])
    expect(settingOf('wiki__search')).toBe('ask')
    expect(settingOf('wiki__edit')).toBe('always')

    setServers([{ ...wiki, off: ['edit'] }])
    expect(offEverywhere('wiki__edit')).toBe(true)
    expect(settingOf('wiki__edit')).toBe('off')
    // By the server's row, not the app's list of its own.
    expect(useApplicationState().toolsOff.value).toEqual([])
  })
})
