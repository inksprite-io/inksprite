import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ExtensionsSection from '@/components/writer/settings/ExtensionsSection.vue'
import AllowedSitesDialog from '@/components/writer/settings/AllowedSitesDialog.vue'
import { useApplicationState } from '@/composables/useApplicationState'
import { useCardLibraryStore } from '@/stores/cardLibraryStore.js'
import { useWebSearchStore } from '@/stores/webSearchStore.js'
import { useWebSearch } from '@/composables/useWebSearch.js'
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'
import { setWebSearch } from '@/web/config.js'

/** The library's rows, as storage holds them. */
const tables = { cards: new Map(), cardFiles: new Map() }

vi.mock('@/storage/index.js', () => ({
  storage: {
    get: vi.fn(async () => undefined),
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

/** Listing a web search service's tools, which is how one is checked. */
const listServer = vi.hoisted(() => vi.fn())
vi.mock('@/mcp/client.js', async importOriginal => ({
  .../** @type {any} */ (await importOriginal()),
  listServer,
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

  describe('Web', () => {
    const webSwitch = wrapper => wrapper.findComponent('[data-extension-switch="web"]')
    const choice = wrapper => wrapper.findComponent('[data-web-service-choice]')
    const problem = wrapper => wrapper.find('[data-web-service-problem]')

    beforeEach(() => {
      listServer.mockReset()
      listServer.mockResolvedValue({ tools: [] })
      // App-wide, so one test's check would show in the next.
      useWebSearch().checks.value = {}
      const panel = useSettingsPanel()
      panel.takeSection()
      panel.takePart()
      panel.close()
    })

    afterEach(() => setWebSearch(null))

    it('comes after Roleplay, and is on from the start', async () => {
      const wrapper = await mountSection()

      expect(
        wrapper.findAll('[data-extension]').map(one => one.attributes('data-extension'))
      ).toEqual(['roleplay', 'web'])
      expect(webSwitch(wrapper).props('modelValue')).toBe(true)
      expect(
        wrapper.find('[data-extension="web"] [aria-expanded]').attributes('aria-disabled')
      ).toBeUndefined()
      expect(useApplicationState().webSearch.value).toBe(true)
    })

    it('switches off, shut while it is, and back on', async () => {
      const wrapper = await mountSection()

      await webSwitch(wrapper).vm.$emit('update:modelValue', false)

      expect(useApplicationState().extensionOn('web')).toBe(false)
      expect(useApplicationState().webSearch.value).toBe(false)
      expect(webSwitch(wrapper).props('modelValue')).toBe(false)
      expect(wrapper.find('[data-extension="web"] [aria-expanded]').attributes()).toMatchObject({
        'aria-expanded': 'false',
        'aria-disabled': 'true',
      })

      await webSwitch(wrapper).vm.$emit('update:modelValue', true)
      expect(useApplicationState().webSearch.value).toBe(true)
    })

    it('offers the services that can be reached from here to search with, none chosen yet', async () => {
      const wrapper = await mountSection()

      expect(
        choice(wrapper)
          .props('options')
          .map(service => service.name)
      ).toEqual(['Exa', 'Kagi'])
      expect(choice(wrapper).props()).toMatchObject({
        modelValue: null,
        placeholder: 'Choose a service',
        ariaLabel: 'Search with',
      })
      expect(problem(wrapper).exists()).toBe(false)
    })

    it('offers Brave too in the desktop app', async () => {
      globalThis.__INKSPRITE_DESKTOP__ = {}
      try {
        const wrapper = await mountSection()
        expect(
          choice(wrapper)
            .props('options')
            .map(service => service.id)
        ).toEqual(['exa', 'kagi', 'brave'])
      } finally {
        delete globalThis.__INKSPRITE_DESKTOP__
      }
    })

    it('searches with the service picked, checked as it is, and says nothing of one that answers', async () => {
      const wrapper = await mountSection()

      await choice(wrapper).vm.$emit('update:modelValue', 'exa')
      await flushPromises()

      expect(useWebSearchStore().setup.service).toBe('exa')
      expect(listServer).toHaveBeenCalledOnce()
      expect(choice(wrapper).props('modelValue')).toBe('exa')
      expect(problem(wrapper).exists()).toBe(false)
    })

    it('says a chosen service has no key, where it needs one, with the way to Connections', async () => {
      useWebSearchStore().update({ service: 'kagi' })
      const wrapper = await mountSection()

      expect(problem(wrapper).text()).toMatch(/^Kagi needs a key\.\s+Open Connections$/)

      await problem(wrapper).find('[data-action="open-connections"]').trigger('click')
      const panel = useSettingsPanel()
      expect(panel.visible.value).toBe(true)
      expect(panel.requestedSection.value).toBe('connections')
      expect(panel.requestedPart.value).toBe('web')

      // Given one, it says no more.
      useWebSearchStore().update({ keys: { kagi: 'k1' } })
      await flushPromises()
      expect(problem(wrapper).exists()).toBe(false)
    })

    it('says a chosen service refused its key, as the check found, with the way to Connections', async () => {
      listServer.mockRejectedValue(Object.assign(new Error('Unauthorized'), { code: 401 }))
      const wrapper = await mountSection()

      await choice(wrapper).vm.$emit('update:modelValue', 'exa')
      await flushPromises()

      expect(problem(wrapper).text()).toContain('Exa refused the key.')
      expect(problem(wrapper).find('[data-action="open-connections"]').text()).toBe(
        'Open Connections'
      )
    })

    it('says nothing of a refusal by a service that is not the one chosen', async () => {
      useWebSearchStore().update({ service: 'exa' })
      useWebSearch().checks.value = { kagi: { error: 'Kagi refused the key.' } }
      const wrapper = await mountSection()

      expect(problem(wrapper).exists()).toBe(false)
    })

    it('shows none chosen where the one chosen can’t be reached from here', async () => {
      useWebSearchStore().update({ service: 'brave', keys: { brave: 'k1' } })
      const wrapper = await mountSection()

      expect(choice(wrapper).props('modelValue')).toBeNull()
      expect(problem(wrapper).exists()).toBe(false)
    })

    it('holds no service’s key: those are in Connections', async () => {
      const wrapper = await mountSection()
      expect(wrapper.find('[data-extension="web"] input[type="password"]').exists()).toBe(false)
      expect(wrapper.find('[data-field="web-key"]').exists()).toBe(false)
    })

    describe('what reading asks first', () => {
      /** A row's select, by the row's id. */
      const reading = (wrapper, id) =>
        wrapper.find(`[data-web-reading="${id}"]`).findComponent({ name: 'Select' })
      const labels = select => select.props('options').map(option => option.label)

      /** Answer the question a change asked, as the writer would. */
      const answer = async accepted => {
        const question = require.mock.calls.at(-1)[0]
        if (accepted) question.accept()
        else question.reject()
        await flushPromises()
      }

      it('is called Web, with a row for pages and one for pages on the writer’s network', async () => {
        const wrapper = await mountSection()
        const section = wrapper
          .findAllComponents({ name: 'ExpandableSection' })
          .find(one => one.attributes('data-extension') === 'web')

        expect(section.props('title')).toBe('Web')
        expect(
          wrapper
            .findAll('[data-web-reading]')
            .map(row => [row.attributes('data-web-reading'), row.find('label').text()])
        ).toEqual([
          ['web', 'Read pages'],
          ['local', 'Read pages on my network'],
        ])
        expect(labels(reading(wrapper, 'web'))).toEqual(['Off', 'Ask first', 'Always allow'])
        expect(labels(reading(wrapper, 'local'))).toEqual(['Off', 'Ask first', 'Always allow'])
        expect(reading(wrapper, 'web').props('modelValue')).toBe('ask')
        expect(reading(wrapper, 'local').props('modelValue')).toBe('ask')
      })

      it('has no row for searching or for saving pages: those are among a chat’s tools', async () => {
        const wrapper = await mountSection()
        const rows = wrapper.findAll('[data-web-reading] label').map(label => label.text())

        expect(rows).not.toContain('Search')
        expect(rows).not.toContain('Save pages')
      })

      it('asks before pages are always read, and reads them so once the writer says', async () => {
        const wrapper = await mountSection()

        await reading(wrapper, 'web').vm.$emit('update:modelValue', 'always')
        await flushPromises()

        expect(require).toHaveBeenCalledOnce()
        expect(require.mock.calls[0][0]).toMatchObject({
          header: 'Always allow reading pages?',
          acceptProps: { label: 'Always allow' },
        })
        expect(useWebSearchStore().setup.readWithoutAsking).toBeUndefined()

        await answer(true)
        expect(useWebSearchStore().setup.readWithoutAsking).toBe(true)
        expect(reading(wrapper, 'web').props('modelValue')).toBe('always')
      })

      it('leaves reading pages as it was when the writer says no', async () => {
        const wrapper = await mountSection()

        await reading(wrapper, 'web').vm.$emit('update:modelValue', 'always')
        await answer(false)

        expect(useWebSearchStore().setup.readWithoutAsking).toBeUndefined()
        expect(reading(wrapper, 'web').props('modelValue')).toBe('ask')
      })

      it('leaves it as it was when the question is closed unanswered', async () => {
        const wrapper = await mountSection()

        await reading(wrapper, 'local').vm.$emit('update:modelValue', 'always')
        require.mock.calls[0][0].onHide()
        await flushPromises()

        expect(useWebSearchStore().setup.readLocalWithoutAsking).toBeUndefined()
        expect(reading(wrapper, 'local').props('modelValue')).toBe('ask')
      })

      it('asks before pages on the writer’s network are always read, by its own question', async () => {
        const wrapper = await mountSection()

        await reading(wrapper, 'local').vm.$emit('update:modelValue', 'always')
        await flushPromises()

        expect(require.mock.calls[0][0].header).toBe('Always allow reading pages on your network?')
        await answer(true)

        expect(useWebSearchStore().setup.readLocalWithoutAsking).toBe(true)
        expect(useWebSearchStore().setup.readWithoutAsking).toBeUndefined()
        expect(reading(wrapper, 'local').props('modelValue')).toBe('always')
      })

      it('goes back to asking first, and switches reading off, without a question', async () => {
        useWebSearchStore().update({ readWithoutAsking: true, readLocalWithoutAsking: true })
        const wrapper = await mountSection()
        expect(reading(wrapper, 'web').props('modelValue')).toBe('always')

        await reading(wrapper, 'web').vm.$emit('update:modelValue', 'ask')
        await reading(wrapper, 'local').vm.$emit('update:modelValue', 'ask')
        await flushPromises()

        expect(useWebSearchStore().setup).toMatchObject({
          readWithoutAsking: false,
          readLocalWithoutAsking: false,
        })

        await reading(wrapper, 'web').vm.$emit('update:modelValue', 'off')
        await flushPromises()

        expect(reading(wrapper, 'web').props('modelValue')).toBe('off')
        expect(require).not.toHaveBeenCalled()
      })

      it('opens the sites always allowed from its button', async () => {
        const wrapper = await mountSection()
        const dialog = () => wrapper.findComponent(AllowedSitesDialog)
        expect(dialog().props('visible')).toBe(false)

        const manage = wrapper.find('[data-manage-sites]')
        expect(manage.text()).toBe('Manage allowed sites')
        await manage.trigger('click')

        expect(dialog().props('visible')).toBe(true)
      })
    })
  })

  describe('Python', () => {
    beforeEach(() => {
      globalThis.__INKSPRITE_DESKTOP__ = { python: { run: vi.fn(), stop: vi.fn() } }
    })

    afterEach(() => {
      delete globalThis.__INKSPRITE_DESKTOP__
    })

    it('is there only in the desktop app', async () => {
      expect((await mountSection()).find('[data-extension="python"]').exists()).toBe(true)
      delete globalThis.__INKSPRITE_DESKTOP__
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

    it('switches on, and says nothing of which chats run it: each chat’s tools say', async () => {
      const wrapper = await mountSection()
      await wrapper
        .findComponent('[data-extension-switch="python"]')
        .vm.$emit('update:modelValue', true)

      expect(useApplicationState().extensionOn('python')).toBe(true)
      expect(wrapper.find('[data-python-profile]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Used in chats on')
    })
  })

  describe('Terminal', () => {
    const row = wrapper => wrapper.find('[data-extension="terminal"]')
    const terminalSwitch = wrapper => wrapper.findComponent('[data-extension-switch="terminal"]')

    beforeEach(() => {
      globalThis.__INKSPRITE_DESKTOP__ = { terminals: { create: vi.fn(), list: vi.fn() } }
    })

    afterEach(() => {
      delete globalThis.__INKSPRITE_DESKTOP__
    })

    it('is there only in the desktop app, and one new enough to have terminals', async () => {
      expect(row(await mountSection()).exists()).toBe(true)

      globalThis.__INKSPRITE_DESKTOP__ = {}
      expect(row(await mountSection()).exists()).toBe(false)

      delete globalThis.__INKSPRITE_DESKTOP__
      expect(row(await mountSection()).exists()).toBe(false)
    })

    it('comes last, and is off to start', async () => {
      const wrapper = await mountSection()

      expect(
        wrapper
          .findAll('[data-extension]')
          .map(one => one.attributes('data-extension'))
          .at(-1)
      ).toBe('terminal')
      expect(row(wrapper).find('[aria-expanded]').text()).toBe('Terminal')
      expect(terminalSwitch(wrapper).props('modelValue')).toBe(false)
      expect(useApplicationState().terminal.value).toBe(false)
    })

    it('switches on, and off again', async () => {
      const wrapper = await mountSection()

      await terminalSwitch(wrapper).vm.$emit('update:modelValue', true)

      expect(useApplicationState().extensionOn('terminal')).toBe(true)
      expect(useApplicationState().terminal.value).toBe(true)
      expect(terminalSwitch(wrapper).props('modelValue')).toBe(true)

      await terminalSwitch(wrapper).vm.$emit('update:modelValue', false)

      expect(useApplicationState().extensionOn('terminal')).toBe(false)
      expect(useApplicationState().terminal.value).toBe(false)
      expect(terminalSwitch(wrapper).props('modelValue')).toBe(false)
    })

    it('has no settings of its own to open, on or off', async () => {
      useApplicationState().setExtension('terminal', true)
      const wrapper = await mountSection()

      expect(row(wrapper).find('[aria-expanded]').attributes()).toMatchObject({
        'aria-expanded': 'false',
        'aria-disabled': 'true',
      })
      await row(wrapper).find('[aria-expanded]').trigger('click')
      expect(row(wrapper).find('[aria-expanded]').attributes('aria-expanded')).toBe('false')
    })
  })
})
