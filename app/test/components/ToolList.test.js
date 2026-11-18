import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ToolList from '@/components/writer/tools/ToolList.vue'
import { useApplicationState } from '@/composables/useApplicationState'
import { useMcpServerStore } from '@/stores/mcpServerStore.js'
import { useWebSearchStore } from '@/stores/webSearchStore.js'
import { setServers } from '@/mcp/servers.js'
import { setWebSearch } from '@/web/config.js'

/*
 * The list of what a chat's model can reach for, mounted on its own: what
 * each group and row shows, what it emits, and what it writes for the whole
 * app. What a chat and its profile keep of a switch is
 * SettingsChatSections.test.js's.
 */

/** The writer's servers, as storage holds them. */
const storedServers = vi.hoisted(() => /** @type {any[]} */ ([]))

vi.mock('@/storage/index.js', () => ({
  storage: {
    get: vi.fn(async () => undefined),
    all: vi.fn(async table => (table === 'mcpServers' ? [...storedServers] : [])),
  },
}))
vi.mock('@/stores/syncStore.js', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

/** Each question asked, answered by the test. */
const require = vi.fn()
vi.mock('primevue/useconfirm', () => ({ useConfirm: () => ({ require }) }))

/** A server with a tool that only reads and one that may change something. */
const wiki = {
  id: 'mcp_wiki',
  name: 'Wiki',
  prefix: 'wiki',
  url: 'https://wiki.example/mcp',
  tools: [
    {
      name: 'search',
      title: 'Search the wiki',
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

/**
 * @param {Record<string, any>} [props]
 */
const mountList = async (props = {}) => {
  const wrapper = mount(ToolList, {
    props,
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: {} },
      // Stubbed open, so every group's rows are there to find.
      stubs: {
        ExpandableSection: {
          props: ['title'],
          template: '<div :data-group="title"><slot name="actions" /><slot /></div>',
        },
      },
    },
  })
  await flushPromises()
  return wrapper
}

/** @typedef {Awaited<ReturnType<typeof mountList>>} Wrapper */

/** The groups listed, by name. @param {Wrapper} wrapper */
const groups = wrapper => wrapper.findAll('[data-group]').map(one => one.attributes('data-group'))

/** A group's switch. @param {Wrapper} wrapper @param {string} id */
const groupSwitch = (wrapper, id) => wrapper.findComponent(`[data-tool-group="${id}"]`)

/** A row's select. @param {Wrapper} wrapper @param {string} name */
const setting = (wrapper, name) =>
  wrapper.find(`[data-tool="${name}"]`).findComponent({ name: 'Select' })

/** What a row can be set to, as it reads. @param {Wrapper} wrapper @param {string} name */
const choices = (wrapper, name) =>
  setting(wrapper, name)
    .props('options')
    .map(option => option.label)

/** The rows of a group, as they read. @param {Wrapper} wrapper @param {string} title */
const rows = (wrapper, title) =>
  wrapper.findAll(`[data-group="${title}"] [data-tool] > span`).map(label => label.text())

describe('ToolList', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    storedServers.splice(0, storedServers.length)
    useApplicationState().resetState()
  })

  afterEach(() => {
    delete globalThis.__INKSPRITE_DESKTOP__
    setWebSearch(null)
    setServers([])
    useApplicationState().resetState()
  })

  it('lists the documents, the skills and the RPG tools, each under a switch that is on', async () => {
    const wrapper = await mountList()

    expect(groups(wrapper)).toEqual(expect.arrayContaining(['Documents', 'RPG Tools']))
    expect(groups(wrapper)).not.toContain('Web')
    expect(groupSwitch(wrapper, 'documents').props()).toMatchObject({
      modelValue: true,
      disabled: false,
      ariaLabel: 'Documents tools',
    })
    expect(groupSwitch(wrapper, 'rpg').props('ariaLabel')).toBe('RPG Tools')
    expect(wrapper.findComponent('[data-tools-switch]').props('modelValue')).toBe(true)
  })

  it('says which group a switch was thrown on, and which way', async () => {
    const wrapper = await mountList()

    await groupSwitch(wrapper, 'rpg').vm.$emit('update:modelValue', false)
    await groupSwitch(wrapper, 'documents').vm.$emit('update:modelValue', true)

    expect(wrapper.emitted('groups')).toEqual([
      [['rpg'], false],
      [['documents'], true],
    ])
  })

  it('shows a group off that the choice switched off, its rows greyed and as they were set', async () => {
    const wrapper = await mountList({ choice: { disabledToolGroups: ['rpg'] } })

    expect(groupSwitch(wrapper, 'rpg').props('modelValue')).toBe(false)
    expect(setting(wrapper, 'roll_dice').props()).toMatchObject({
      disabled: true,
      modelValue: 'on',
    })
    expect(wrapper.find('[data-tool="roll_dice"] > span').classes()).toContain('opacity-50')
    expect(setting(wrapper, 'read').props('disabled')).toBe(false)
  })

  it('says Enable tools was switched', async () => {
    const wrapper = await mountList()

    await wrapper.findComponent('[data-tools-switch]').vm.$emit('update:modelValue', false)

    expect(wrapper.emitted('all')).toEqual([[false]])
  })

  describe('a row’s setting', () => {
    it('is Off or On for a tool that never asks, and is kept for the whole app', async () => {
      const wrapper = await mountList()

      expect(wrapper.find('[data-tool="roll_dice"] > span').text()).toBe('Roll dice')
      expect(choices(wrapper, 'roll_dice')).toEqual(['Off', 'On'])
      expect(setting(wrapper, 'roll_dice').props('modelValue')).toBe('on')

      await setting(wrapper, 'roll_dice').vm.$emit('update:modelValue', 'off')

      expect(useApplicationState().toolsOff.value).toEqual(['roll_dice'])
      expect(setting(wrapper, 'roll_dice').props('modelValue')).toBe('off')
      expect(wrapper.emitted()).toEqual({})

      await setting(wrapper, 'roll_dice').vm.$emit('update:modelValue', 'on')
      expect(useApplicationState().toolsOff.value).toEqual([])
    })

    it('is Off, Ask first or Always allow for a server’s tool, kept on the server', async () => {
      storedServers.push(wiki)
      const wrapper = await mountList()

      expect(groupSwitch(wrapper, 'mcp:mcp_wiki').props('ariaLabel')).toBe('Wiki tools')
      expect(rows(wrapper, 'Wiki')).toEqual(['Search the wiki', 'edit'])
      expect(choices(wrapper, 'wiki__edit')).toEqual(['Off', 'Ask first', 'Always allow'])
      // One that says it only reads is allowed from the start.
      expect(setting(wrapper, 'wiki__search').props('modelValue')).toBe('always')
      expect(setting(wrapper, 'wiki__edit').props('modelValue')).toBe('ask')

      await setting(wrapper, 'wiki__edit').vm.$emit('update:modelValue', 'always')
      await flushPromises()

      expect(useMcpServerStore().getServer('mcp_wiki').allowed).toEqual(['edit'])
      expect(setting(wrapper, 'wiki__edit').props('modelValue')).toBe('always')
      expect(require).not.toHaveBeenCalled()

      await setting(wrapper, 'wiki__edit').vm.$emit('update:modelValue', 'off')
      await flushPromises()

      expect(useMcpServerStore().getServer('mcp_wiki').off).toEqual(['edit'])
      expect(setting(wrapper, 'wiki__edit').props('modelValue')).toBe('off')
    })

    it('is what the model does with the documents: Read, Edit and Comment', async () => {
      const wrapper = await mountList({ editing: 'ask' })

      expect(rows(wrapper, 'Documents')).toEqual(['Read', 'Edit mode', 'Comment'])
      expect(choices(wrapper, 'read')).toEqual(['Off', 'On'])
      expect(choices(wrapper, 'edit')).toEqual(['Off', 'Suggesting', 'Editing'])
      expect(choices(wrapper, 'comment')).toEqual(['Off', 'On'])
      expect(setting(wrapper, 'edit').props('modelValue')).toBe('ask')
    })

    it('says how the documents are to be edited, and which of the other rows was switched', async () => {
      const wrapper = await mountList()
      expect(setting(wrapper, 'edit').props('modelValue')).toBe('auto')

      await setting(wrapper, 'edit').vm.$emit('update:modelValue', 'ask')
      await setting(wrapper, 'edit').vm.$emit('update:modelValue', 'off')
      await setting(wrapper, 'read').vm.$emit('update:modelValue', 'off')
      await setting(wrapper, 'comment').vm.$emit('update:modelValue', 'on')

      expect(wrapper.emitted('editing')).toEqual([['ask'], ['off']])
      expect(wrapper.emitted('row')).toEqual([
        ['read', false],
        ['comment', true],
      ])
      expect(useApplicationState().toolsOff.value).toEqual([])
    })

    it('shows reading off, and commenting with it, where the choice has reading off', async () => {
      const wrapper = await mountList({
        choice: {
          disabledTools: [
            'list_documents',
            'read_document',
            'describe_document',
            'search_documents',
            'explore_documents',
          ],
        },
      })

      expect(setting(wrapper, 'read').props('modelValue')).toBe('off')
      expect(setting(wrapper, 'comment').props('modelValue')).toBe('off')
    })
  })

  describe('with Enable tools off', () => {
    it('greys every switch and row, each left as it was set', async () => {
      useApplicationState().setToolOff('draw_tarot', true)
      const wrapper = await mountList({ choice: { toolsOff: true }, editing: 'ask' })

      const enable = wrapper.findComponent('[data-tools-switch]')
      expect(enable.props()).toMatchObject({ modelValue: false, disabled: false })
      for (const id of ['documents', 'rpg']) {
        expect(groupSwitch(wrapper, id).props()).toMatchObject({ modelValue: true, disabled: true })
      }
      for (const select of wrapper.findAllComponents({ name: 'Select' })) {
        expect(select.props('disabled')).toBe(true)
      }
      for (const label of wrapper.findAll('[data-tool] > span')) {
        expect(label.classes()).toContain('opacity-50')
      }
      expect(setting(wrapper, 'edit').props('modelValue')).toBe('ask')
      expect(setting(wrapper, 'roll_dice').props('modelValue')).toBe('on')
      expect(setting(wrapper, 'draw_tarot').props('modelValue')).toBe('off')
    })

    it('reads as off throughout, and can’t be switched, for a model that can’t be offered tools', async () => {
      const wrapper = await mountList({ disabled: true })

      expect(wrapper.findComponent('[data-tools-switch]').props()).toMatchObject({
        modelValue: false,
        disabled: true,
      })
      expect(groupSwitch(wrapper, 'documents').props()).toMatchObject({
        modelValue: false,
        disabled: true,
      })
      for (const select of wrapper.findAllComponents({ name: 'Select' })) {
        expect(select.props()).toMatchObject({ modelValue: 'off', disabled: true })
      }
    })
  })

  describe('the Web group', () => {
    /** Answer the question a change asked, as the writer would. */
    const answer = async accepted => {
      const question = require.mock.calls.at(-1)[0]
      if (accepted) question.accept()
      else question.reject()
      await flushPromises()
    }

    /** The desktop app, which reads a page itself where no service does. */
    const onDesktop = () => {
      globalThis.__INKSPRITE_DESKTOP__ = {}
    }

    it('is not listed in a browser with no service to search with', async () => {
      expect(groups(await mountList())).not.toContain('Web')
    })

    it('has Search, Read pages and Save pages where a service is set up', async () => {
      useWebSearchStore().update({ service: 'exa' })
      const wrapper = await mountList()

      expect(rows(wrapper, 'Web')).toEqual(['Search', 'Read pages', 'Save pages'])
      expect(choices(wrapper, 'web_search')).toEqual(['Off', 'On'])
      expect(choices(wrapper, 'read_web_page')).toEqual(['Off', 'Ask first', 'Always allow'])
      expect(choices(wrapper, 'save_web_page')).toEqual(['Off', 'Ask first', 'Always allow'])
      expect(setting(wrapper, 'read_web_page').props('modelValue')).toBe('ask')
      expect(setting(wrapper, 'save_web_page').props('modelValue')).toBe('ask')
    })

    it('has Read pages and Save pages without Search in the desktop app with no service', async () => {
      onDesktop()
      const wrapper = await mountList()

      expect(groups(wrapper)).toContain('Web')
      expect(rows(wrapper, 'Web')).toEqual(['Read pages', 'Save pages'])
    })

    it('goes with the Web extension switched off', async () => {
      onDesktop()
      useApplicationState().setExtension('web', false)

      expect(groups(await mountList())).not.toContain('Web')
    })

    it('asks before pages are always read, and reads them so once the writer says', async () => {
      onDesktop()
      const wrapper = await mountList()

      await setting(wrapper, 'read_web_page').vm.$emit('update:modelValue', 'always')
      await flushPromises()

      expect(require).toHaveBeenCalledOnce()
      expect(require.mock.calls[0][0]).toMatchObject({
        header: 'Always allow reading pages?',
        acceptProps: { label: 'Always allow' },
      })
      expect(useWebSearchStore().setup.readWithoutAsking).toBeUndefined()

      await answer(true)
      expect(useWebSearchStore().setup.readWithoutAsking).toBe(true)
      expect(setting(wrapper, 'read_web_page').props('modelValue')).toBe('always')
    })

    it('leaves reading pages asking first when the writer says no', async () => {
      onDesktop()
      const wrapper = await mountList()

      await setting(wrapper, 'read_web_page').vm.$emit('update:modelValue', 'always')
      await answer(false)

      expect(useWebSearchStore().setup.readWithoutAsking).toBeUndefined()
      expect(setting(wrapper, 'read_web_page').props('modelValue')).toBe('ask')
    })

    it('asks nothing to go back to asking first, to switch reading off, or to keep pages unasked', async () => {
      onDesktop()
      useWebSearchStore().update({ readWithoutAsking: true })
      const wrapper = await mountList()
      expect(setting(wrapper, 'read_web_page').props('modelValue')).toBe('always')

      await setting(wrapper, 'read_web_page').vm.$emit('update:modelValue', 'ask')
      await flushPromises()
      expect(useWebSearchStore().setup.readWithoutAsking).toBe(false)

      await setting(wrapper, 'read_web_page').vm.$emit('update:modelValue', 'off')
      await flushPromises()
      expect(useApplicationState().toolsOff.value).toEqual(['read_web_page'])

      await setting(wrapper, 'save_web_page').vm.$emit('update:modelValue', 'always')
      await flushPromises()
      expect(useWebSearchStore().setup.saveWithoutAsking).toBe(true)

      expect(require).not.toHaveBeenCalled()
    })
  })
})
