import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { computed } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import WebSearchConnection from '@/components/writer/settings/WebSearchConnection.vue'
import { useWebSearchStore } from '@/stores/webSearchStore.js'
import { setWebSearch } from '@/web/config.js'
import { CHAT_PROFILE_ID } from '@/ai/profiles/index.js'

vi.mock('@/stores/db', () => ({
  default: { webSearch: { get: vi.fn(async () => undefined) } },
}))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const listServer = vi.hoisted(() => vi.fn())
vi.mock('@/mcp/client.js', async importOriginal => ({
  .../** @type {any} */ (await importOriginal()),
  listServer,
}))

vi.mock('@/composables/useProfiles', () => ({
  useProfiles: () => ({
    profiles: computed(() => [
      { id: 'builtin_profile_chat', name: 'Default', readOnly: true },
      { id: 'builtin_profile_roleplay', name: 'Roleplay', readOnly: true },
    ]),
  }),
}))

const mountSection = async () => {
  const wrapper = mount(WebSearchConnection, { global: { plugins: [PrimeVue] } })
  await flushPromises()
  return wrapper
}

/** Pick a service as the dropdown would. */
const pick = async (wrapper, id) => {
  await wrapper.findComponent({ name: 'Select' }).vm.$emit('update:modelValue', id)
  await flushPromises()
}

describe('WebSearchConnection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    listServer.mockReset()
    listServer.mockResolvedValue({ tools: [] })
  })

  afterEach(() => setWebSearch(null))

  it('starts on none, asking for nothing', async () => {
    const wrapper = await mountSection()

    expect(wrapper.findComponent({ name: 'Select' }).props('modelValue')).toBe('none')
    expect(wrapper.find('[data-field="web-key"]').exists()).toBe(false)
  })

  it('offers Brave only in the desktop app', async () => {
    const options = wrapper => wrapper.findComponent({ name: 'Select' }).props('options')
    const brave = wrapper => options(wrapper).find(option => option.value === 'brave')

    expect(brave(await mountSection()).disabled).toBe(true)

    globalThis.__INKSPRITE_DESKTOP__ = {}
    try {
      expect(brave(await mountSection()).disabled).toBe(false)
    } finally {
      delete globalThis.__INKSPRITE_DESKTOP__
    }
  })

  it('does not check Brave, whose only check is a search that costs', async () => {
    globalThis.__INKSPRITE_DESKTOP__ = {}
    try {
      const wrapper = await mountSection()
      await pick(wrapper, 'brave')
      await wrapper.find('[data-field="web-key"]').setValue('bk')
      await wrapper.find('[data-field="web-key"]').trigger('blur')
      await flushPromises()

      expect(useWebSearchStore().setup.keys).toEqual({ brave: 'bk' })
      expect(wrapper.find('[data-web-check]').exists()).toBe(false)
    } finally {
      delete globalThis.__INKSPRITE_DESKTOP__
    }
  })

  it('uses Exa with no key, checks it, and says where searches go', async () => {
    const wrapper = await mountSection()

    await pick(wrapper, 'exa')

    expect(useWebSearchStore().setup.service).toBe('exa')
    expect(listServer).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://mcp.exa.ai/mcp' })
    )
    expect(wrapper.find('[data-web-check]').text()).toBe('Connected')
    expect(wrapper.text()).toContain('Searches go to Exa, which may keep them.')
    expect(wrapper.find('[data-field="web-key"]').attributes('placeholder')).toBe('Optional')
  })

  it('keeps a key typed in, and checks the service with it', async () => {
    const wrapper = await mountSection()
    await pick(wrapper, 'exa')
    listServer.mockClear()

    await wrapper.find('[data-field="web-key"]').setValue('k1')
    await wrapper.find('[data-field="web-key"]').trigger('blur')
    await flushPromises()

    expect(useWebSearchStore().setup.keys).toEqual({ exa: 'k1' })
    expect(listServer).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { 'x-api-key': 'k1' } })
    )
  })

  it('says why a service refused', async () => {
    listServer.mockRejectedValue(Object.assign(new Error('Unauthorized'), { code: 401 }))
    const wrapper = await mountSection()
    await pick(wrapper, 'kagi')

    await wrapper.find('[data-field="web-key"]').setValue('bad')
    await wrapper.find('[data-field="web-key"]').trigger('blur')
    await flushPromises()

    expect(wrapper.find('[data-web-check]').text()).toBe(
      'Kagi refused the key. Check it in Settings › Connections › Web search.'
    )
  })

  it('does not check Kagi before it has a key', async () => {
    const wrapper = await mountSection()

    await pick(wrapper, 'kagi')

    expect(listServer).not.toHaveBeenCalled()
    expect(wrapper.find('[data-web-check]').exists()).toBe(false)
  })

  it('stops searching when None is chosen', async () => {
    const wrapper = await mountSection()
    await pick(wrapper, 'exa')

    await pick(wrapper, 'none')

    expect(useWebSearchStore().setup.service).toBeUndefined()
    expect(wrapper.find('[data-field="web-key"]').exists()).toBe(false)
  })

  it('keeps the key of a service switched away from', async () => {
    const wrapper = await mountSection()
    await pick(wrapper, 'kagi')
    await wrapper.find('[data-field="web-key"]').setValue('kk')
    await wrapper.find('[data-field="web-key"]').trigger('blur')
    await flushPromises()

    await pick(wrapper, 'exa')
    await pick(wrapper, 'kagi')

    expect(wrapper.find('[data-field="web-key"]').element.value).toBe('kk')
  })

  it('searches in chats on Default to start with, and on another profile once asked', async () => {
    const wrapper = await mountSection()
    await pick(wrapper, 'exa')
    const toggle = label =>
      wrapper
        .findAllComponents({ name: 'ToggleSwitch' })
        .find(one => one.props('ariaLabel') === label)

    expect(toggle('Search the web in chats on Default').props('modelValue')).toBe(true)
    await toggle('Search the web in chats on Roleplay').vm.$emit('update:modelValue', true)

    expect(useWebSearchStore().setup.profiles).toEqual([
      CHAT_PROFILE_ID,
      'builtin_profile_roleplay',
    ])
  })
})
