import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ExtensionsSection from '@/components/writer/settings/ExtensionsSection.vue'
import { useApplicationState } from '@/composables/useApplicationState'
import { useCardLibraryStore } from '@/stores/cardLibraryStore.js'

/** The library's rows, as storage holds them. */
const tables = { cards: new Map(), cardFiles: new Map() }

vi.mock('@/storage/index.js', () => ({
  storage: {
    all: vi.fn(async table => [...tables[table].values()]),
    count: vi.fn(async table => tables[table].size),
    remove: vi.fn(async (table, ids) => {
      for (const id of ids) tables[table].delete(id)
    }),
  },
}))

vi.mock('@/stores/syncStore.js', () => ({
  useSyncStore: () => ({
    trackChange: vi.fn(),
    trackDelete: (table, id) => tables[table].delete(id),
  }),
}))

vi.mock('@/composables/useProfiles', () => ({
  useProfiles: () => ({
    profiles: ref([
      { id: 'builtin_profile_roleplay', name: 'Roleplay', readOnly: true },
      { id: 'chatprofile_mine', name: 'Mine', readOnly: false },
    ]),
    getProfile: id => ({ id }),
    roleplayDefaultId: () => 'builtin_profile_roleplay',
  }),
}))

/** Each question asked, answered by the test. */
const require = vi.fn()
vi.mock('primevue/useconfirm', () => ({ useConfirm: () => ({ require }) }))
const add = vi.fn()
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add }) }))

/** @param {string} id */
const keepCard = id => {
  tables.cards.set(id, { id, title: id, tags: [], hash: id, added: 0 })
  tables.cardFiles.set(id, { id, card: {}, image: null })
}

const mountSection = async () => {
  const wrapper = mount(ExtensionsSection, { global: { plugins: [PrimeVue] } })
  await flushPromises()
  return wrapper
}

const roleplaySwitch = wrapper => wrapper.findComponent('[data-extension-switch="roleplay"]')

describe('ExtensionsSection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    tables.cards.clear()
    tables.cardFiles.clear()
    useApplicationState().resetState()
  })

  afterEach(() => useApplicationState().resetState())

  it('keeps Roleplay shut while it is off, and switches it on', async () => {
    const wrapper = await mountSection()
    expect(roleplaySwitch(wrapper).props('modelValue')).toBe(false)
    expect(wrapper.find('[data-extension="roleplay"] [aria-expanded]').attributes()).toMatchObject({
      'aria-expanded': 'false',
      'aria-disabled': 'true',
    })

    await roleplaySwitch(wrapper).vm.$emit('update:modelValue', true)
    expect(useApplicationState().extensionOn('roleplay')).toBe(true)
    expect(useApplicationState().roleplay.value).toBe(true)
  })

  it("holds Roleplay's own settings: the NSFW switch and the profile for cards", async () => {
    useApplicationState().setExtension('roleplay', true)
    const wrapper = await mountSection()

    await wrapper.findComponent('[data-nsfw-profiles]').vm.$emit('update:modelValue', true)
    expect(useApplicationState().nsfwProfiles.value).toBe(true)

    // Blurring NSFW pictures is switched in the library, not here.
    expect(wrapper.find('[data-blur-nsfw]').exists()).toBe(false)

    const picker = wrapper.findComponent('[data-roleplay-profile]')
    expect(picker.props('modelValue')).toBe('builtin_profile_roleplay')
    await picker.vm.$emit('update:modelValue', 'chatprofile_mine')
    expect(useApplicationState().roleplayProfileId.value).toBe('chatprofile_mine')
  })

  it('keeps the card library, asking nothing, when Roleplay goes off', async () => {
    useApplicationState().setExtension('roleplay', true)
    keepCard('libcard_1')
    keepCard('libcard_2')
    const wrapper = await mountSection()

    await roleplaySwitch(wrapper).vm.$emit('update:modelValue', false)
    await flushPromises()

    expect(useApplicationState().extensionOn('roleplay')).toBe(false)
    expect(require).not.toHaveBeenCalled()
    expect(tables.cards.size).toBe(2)
  })

  it('deletes the whole library from its button, after asking', async () => {
    useApplicationState().setExtension('roleplay', true)
    keepCard('libcard_1')
    await useCardLibraryStore().ensureLoaded()
    const wrapper = await mountSection()

    await wrapper.find('[data-delete-card-library]').trigger('click')
    await flushPromises()
    const question = require.mock.calls[0][0]
    expect(question.message).toBe('Delete the card in the library?')

    await question.accept()
    expect(tables.cards.size).toBe(0)
    expect(useCardLibraryStore().hasCards).toBe(false)
    expect(add).not.toHaveBeenCalled()
  })

  it('has nothing to delete in an empty library', async () => {
    useApplicationState().setExtension('roleplay', true)
    await useCardLibraryStore().ensureLoaded()
    const wrapper = await mountSection()
    expect(wrapper.find('[data-delete-card-library]').attributes('disabled')).toBeDefined()
  })

  describe('Python', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_PREVIEW', 'python')
      globalThis.__INKSPRITE_DESKTOP__ = { python: { run: vi.fn(), stop: vi.fn() } }
    })

    afterEach(() => {
      delete globalThis.__INKSPRITE_DESKTOP__
      vi.unstubAllEnvs()
    })

    it('is there only in the desktop app', async () => {
      expect((await mountSection()).find('[data-extension="python"]').exists()).toBe(true)
      delete globalThis.__INKSPRITE_DESKTOP__
      expect((await mountSection()).find('[data-extension="python"]').exists()).toBe(false)
    })

    it('is there only in its preview', async () => {
      vi.stubEnv('VITE_PREVIEW', '')
      expect((await mountSection()).find('[data-extension="python"]').exists()).toBe(false)
    })

    it('gives a run ten minutes until the writer sets another limit, or none', async () => {
      useApplicationState().setExtension('python', true)
      const wrapper = await mountSection()
      const limit = wrapper.findComponent('[data-python-time-limit]')
      expect(limit.props('modelValue')).toBe(600)

      await limit.vm.$emit('update:modelValue', 0)
      expect(useApplicationState().pythonTimeLimit.value).toBe(0)
    })

    it('switches on, and lists the profiles whose chats run it, Default to start', async () => {
      const wrapper = await mountSection()
      await wrapper
        .findComponent('[data-extension-switch="python"]')
        .vm.$emit('update:modelValue', true)
      expect(useApplicationState().extensionOn('python')).toBe(true)

      const mine = wrapper.findComponent('[data-python-profile="chatprofile_mine"]')
      expect(mine.props('modelValue')).toBe(false)
      await mine.vm.$emit('update:modelValue', true)
      expect(useApplicationState().pythonProfiles.value).toEqual([
        'builtin_profile_chat',
        'chatprofile_mine',
      ])
    })
  })
})
