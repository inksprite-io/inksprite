import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { computed } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import WebSearchConnection from '@/components/writer/settings/WebSearchConnection.vue'
import { useWebSearchStore } from '@/stores/webSearchStore.js'
import { useWebSearch } from '@/composables/useWebSearch.js'
import { setWebSearch } from '@/web/config.js'

vi.mock('@/stores/db', () => ({
  default: { webSearch: { get: vi.fn(async () => undefined) } },
}))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn(), start: () => false }),
}))

const listServer = vi.hoisted(() => vi.fn())
const callServerTool = vi.hoisted(() => vi.fn())
vi.mock('@/mcp/client.js', async importOriginal => ({
  .../** @type {any} */ (await importOriginal()),
  listServer,
  callServerTool,
}))

const fetch = vi.hoisted(() => vi.fn())
vi.mock('@/platform/fetch.js', () => ({ fetch }))

vi.mock('@/composables/useProfiles', () => ({
  useProfiles: () => ({
    profiles: computed(() => [
      { id: 'builtin_profile_chat', name: 'Default', readOnly: true },
      { id: 'builtin_profile_roleplay', name: 'Roleplay', readOnly: true },
    ]),
  }),
}))

const mountSection = async () => {
  const wrapper = mount(WebSearchConnection, {
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: {} },
      stubs: { ExpandableSection: { template: '<div><slot name="actions" /><slot /></div>' } },
    },
  })
  await flushPromises()
  return wrapper
}

/** A service's card. */
const card = (wrapper, id) => wrapper.find(`[data-web-service="${id}"]`)

/** Open a service's card, as a click on it does. */
const open = async (wrapper, id) => {
  if (card(wrapper, id).find('[data-connection-body]').exists()) return
  await card(wrapper, id).find('button[aria-expanded]').trigger('click')
  await flushPromises()
}

/** Type a key in a service's card and leave the field, as a click elsewhere would. */
const typeKey = async (wrapper, id, key) => {
  await open(wrapper, id)
  const field = card(wrapper, id).find('[data-field="web-key"]')
  await field.setValue(key)
  await field.trigger('blur')
  await flushPromises()
}

/** Press Connect on a service's card. */
const connect = async (wrapper, id) => {
  await open(wrapper, id)
  await card(wrapper, id).find('[data-action="web-connect"]').trigger('click')
  await flushPromises()
}

/** What a service's card says of how it answered. */
const status = (wrapper, id) => card(wrapper, id).find('[data-status]').text()

describe('WebSearchConnection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    listServer.mockReset()
    listServer.mockResolvedValue({ tools: [] })
    fetch.mockReset()
    callServerTool.mockReset()
    // App-wide, so one test's check would show in the next.
    useWebSearch().checks.value = {}
  })

  afterEach(() => setWebSearch(null))

  it('lists every service as a card with its address, none in use, asking for nothing', async () => {
    const wrapper = await mountSection()

    expect(
      wrapper.findAll('[data-web-service]').map(one => one.attributes('data-web-service'))
    ).toEqual(['exa', 'kagi', 'brave'])
    expect(card(wrapper, 'exa').find('[data-connection-address]').text()).toBe('mcp.exa.ai')
    expect(wrapper.find('[data-in-use]').exists()).toBe(false)
    expect(wrapper.find('[data-field="web-key"]').exists()).toBe(false)
    expect(listServer).not.toHaveBeenCalled()
  })

  it('offers Brave only in the desktop app', async () => {
    let wrapper = await mountSection()
    expect(status(wrapper, 'brave')).toBe('Desktop app only')
    await card(wrapper, 'brave').find('button[aria-expanded]').trigger('click')
    expect(card(wrapper, 'brave').find('[data-connection-body]').exists()).toBe(false)

    globalThis.__INKSPRITE_DESKTOP__ = {}
    try {
      wrapper = await mountSection()
      await open(wrapper, 'brave')
      expect(card(wrapper, 'brave').find('[data-field="web-key"]').exists()).toBe(true)
    } finally {
      delete globalThis.__INKSPRITE_DESKTOP__
    }
  })

  it('connects on Enter in the key field', async () => {
    const wrapper = await mountSection()
    await open(wrapper, 'exa')

    await card(wrapper, 'exa').find('[data-field="web-key"]').setValue('k1')
    await card(wrapper, 'exa').find('[data-field="web-key"]').trigger('keydown.enter')
    await flushPromises()

    expect(useWebSearchStore().setup.keys).toEqual({ exa: 'k1' })
    expect(listServer).toHaveBeenCalledOnce()
  })

  it('says why a service refused', async () => {
    listServer.mockRejectedValue(Object.assign(new Error('Unauthorized'), { code: 401 }))
    const wrapper = await mountSection()

    await typeKey(wrapper, 'exa', 'bad')
    await connect(wrapper, 'exa')

    expect(card(wrapper, 'exa').find('[data-web-check]').text()).toBe('Exa refused the key.')
    expect(status(wrapper, 'exa')).toBe('Not connected')
    // One that doesn't answer isn't made the one in use.
    expect(useWebSearchStore().setup.service).toBeUndefined()
  })

  it('forgets what a check found once the key changes', async () => {
    listServer.mockRejectedValue(Object.assign(new Error('Unauthorized'), { code: 401 }))
    const wrapper = await mountSection()
    await typeKey(wrapper, 'exa', 'bad')
    await connect(wrapper, 'exa')

    await typeKey(wrapper, 'exa', 'good')

    expect(card(wrapper, 'exa').find('[data-web-check]').exists()).toBe(false)
  })

  it('does not check Kagi before it has a key', async () => {
    const wrapper = await mountSection()

    await open(wrapper, 'kagi')

    expect(listServer).not.toHaveBeenCalled()
    expect(
      card(wrapper, 'kagi').find('[data-action="web-connect"]').attributes('disabled')
    ).toBeDefined()
  })

  it('holds a key, Connect and Use for web search in a card', async () => {
    const wrapper = await mountSection()
    await open(wrapper, 'exa')

    const body = card(wrapper, 'exa').find('[data-connection-body]')
    expect(body.findAll('input')).toHaveLength(1)
    expect(body.find('[data-field="web-key"]').attributes('placeholder')).toBe('Optional')
    expect(body.findAll('button').map(button => button.text())).toEqual([
      'Connect',
      'Use for web search',
    ])
    // Whether a page is kept unasked is the extension's.
    for (const words of ['In use', 'Stop using', 'Ask before saving']) {
      expect(wrapper.text()).not.toContain(words)
    }
    expect(wrapper.find('[data-field="web-ask-before-saving"]').exists()).toBe(false)
  })

  it('searches with a service from its card, which is then tinted and offers it no more', async () => {
    const wrapper = await mountSection()
    await connect(wrapper, 'exa')
    await typeKey(wrapper, 'kagi', 'k2')

    await card(wrapper, 'kagi').find('[data-action="web-use"]').trigger('click')
    await flushPromises()

    expect(useWebSearchStore().setup.service).toBe('kagi')
    expect(card(wrapper, 'kagi').find('[aria-current]').exists()).toBe(true)
    expect(card(wrapper, 'kagi').find('[data-action="web-use"]').exists()).toBe(false)
    await open(wrapper, 'exa')
    expect(card(wrapper, 'exa').find('[aria-current]').exists()).toBe(false)
    expect(card(wrapper, 'exa').find('[data-action="web-use"]').exists()).toBe(true)
  })

  it('keeps the key typed in when a service is made the one used', async () => {
    const wrapper = await mountSection()
    await open(wrapper, 'kagi')
    const use = () => card(wrapper, 'kagi').find('[data-action="web-use"]')
    expect(use().attributes('disabled')).toBeDefined()

    await card(wrapper, 'kagi').find('[data-field="web-key"]').setValue('k3')
    expect(use().attributes('disabled')).toBeUndefined()
    await use().trigger('click')
    await flushPromises()

    expect(useWebSearchStore().setup).toMatchObject({ service: 'kagi', keys: { kagi: 'k3' } })
  })

  it('opens one card at a time, and shuts the one clicked again', async () => {
    const wrapper = await mountSection()

    await open(wrapper, 'exa')
    await open(wrapper, 'kagi')
    expect(wrapper.findAll('[data-connection-body]')).toHaveLength(1)
    expect(card(wrapper, 'kagi').find('[data-connection-body]').exists()).toBe(true)

    await card(wrapper, 'kagi').find('button[aria-expanded]').trigger('click')
    expect(wrapper.find('[data-connection-body]').exists()).toBe(false)
  })

  it('says nothing of a service that answered, or of one not asked', async () => {
    const wrapper = await mountSection()

    await connect(wrapper, 'exa')

    expect(listServer).toHaveBeenCalledOnce()
    expect(card(wrapper, 'exa').find('[data-status]').exists()).toBe(false)
    expect(card(wrapper, 'exa').find('[data-web-check]').exists()).toBe(false)
    expect(card(wrapper, 'kagi').find('[data-status]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Connected')
  })

  it('marks a refusal with a red dot, and what only is with none', async () => {
    listServer.mockRejectedValue(Object.assign(new Error('Unauthorized'), { code: 401 }))
    const wrapper = await mountSection()
    await typeKey(wrapper, 'exa', 'bad')
    await connect(wrapper, 'exa')

    const refused = card(wrapper, 'exa').find('[data-status]')
    expect(refused.attributes('data-status')).toBe('bad')
    expect(refused.find('.bg-red-500').exists()).toBe(true)
    const elsewhere = card(wrapper, 'brave').find('[data-status]')
    expect(elsewhere.attributes('data-status')).toBe('neutral')
    expect(elsewhere.find('.bg-red-500').exists()).toBe(false)
  })

  it('makes the first service to answer the one used, where none is', async () => {
    const wrapper = await mountSection()
    expect(useWebSearchStore().setup.service).toBeUndefined()

    await connect(wrapper, 'exa')

    expect(useWebSearchStore().setup.service).toBe('exa')
    // Checked just now: not asked a second time for being chosen.
    expect(listServer).toHaveBeenCalledOnce()
  })

  it('leaves the one used as it is when another answers', async () => {
    const wrapper = await mountSection()
    await connect(wrapper, 'exa')

    await typeKey(wrapper, 'kagi', 'k2')
    await connect(wrapper, 'kagi')

    expect(useWebSearchStore().setup.keys).toMatchObject({ kagi: 'k2' })
    expect(card(wrapper, 'kagi').find('[data-status]').exists()).toBe(false)
    expect(useWebSearchStore().setup.service).toBe('exa')
  })
})
