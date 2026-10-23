import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Checkbox from 'primevue/checkbox'
import Tree from 'primevue/tree'
import ExportDialog from '../../src/components/writer/settings/ExportDialog.vue'

const { backup, toast } = vi.hoisted(() => ({
  backup: { listExportable: vi.fn(), readProjectContents: vi.fn() },
  toast: { error: vi.fn() },
}))

vi.mock('@/composables/useBackup', () => ({ useBackup: () => backup }))
vi.mock('@/composables/useToast', () => ({ useToast: () => toast }))

const SETTINGS = [
  { key: 'aiProviders/provider_proxy', kind: 'aiProviders', name: 'Team proxy', picked: true },
  {
    key: 'aiProfiles/profile_team',
    kind: 'aiProfiles',
    name: 'Team',
    picked: true,
    needs: ['aiProviders/provider_proxy'],
  },
  { key: 'settings/preferences', kind: 'settings', name: 'Preferences', picked: false },
]

const EXPORTABLE = {
  projects: [{ id: 'story_a', title: 'Thief' }],
  cards: [{ id: 'libcard_wren', title: 'Wren' }],
  settings: SETTINGS,
}

const CONTENTS = {
  documents: [
    { id: 'root_story_a', storyId: 'story_a', parentId: 'story_a', title: 'Thief', type: 'folder' },
    {
      id: 'doc_one',
      storyId: 'story_a',
      parentId: 'root_story_a',
      title: 'Prologue',
      type: 'text',
    },
  ],
  chats: [{ id: 'chat_one', storyId: 'story_a', title: 'Ideas', lastMessageAt: 1 }],
}

const mountDialog = async () => {
  const wrapper = mount(ExportDialog, {
    props: { visible: true },
    global: {
      plugins: [PrimeVue],
      stubs: {
        // Shown as the real one is, saying so as it opens.
        Dialog: {
          props: ['visible'],
          emits: ['show'],
          mounted() {
            this.$emit('show')
          },
          template: '<div v-if="visible" data-dialog><slot /><slot name="footer" /></div>',
        },
      },
    },
  })
  await flushPromises()
  return wrapper
}

const tree = wrapper => wrapper.findComponent(Tree)

/** Whether a box shows ticked. */
const isTicked = (wrapper, key) => Boolean(tree(wrapper).props('selectionKeys')[key]?.checked)

/** Tick boxes as the tree reports a click: the ticks as they now stand. */
const setTicks = async (wrapper, keys) => {
  await tree(wrapper).vm.$emit('update:selectionKeys', keys)
  await flushPromises()
}

const exportButton = wrapper => wrapper.find('[data-action="export"]')

const exported = async wrapper => {
  await exportButton(wrapper).trigger('click')
  return wrapper.emitted('export')[0][0]
}

describe('ExportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    backup.listExportable.mockResolvedValue(EXPORTABLE)
    backup.readProjectContents.mockResolvedValue(CONTENTS)
  })

  it('opens on the projects, the cards and the settings, all of them ticked', async () => {
    const wrapper = await mountDialog()

    expect(
      tree(wrapper)
        .props('value')
        .map(node => node.label)
    ).toEqual(['Projects', 'Character cards', 'Settings'])
    for (const key of ['projects', 'cards', 'settings', 'setting:settings/preferences']) {
      expect(isTicked(wrapper, key)).toBe(true)
    }
  })

  it('saves everything, without keys unless ticked, and closes', async () => {
    const wrapper = await mountDialog()

    const choice = await exported(wrapper)
    expect(choice.pick.everything).toBe(true)
    expect(choice.includeApiKeys).toBe(false)
    expect(wrapper.emitted('update:visible')).toEqual([[false]])
  })

  it('includes keys when the box is ticked', async () => {
    const wrapper = await mountDialog()

    const keys = wrapper
      .findAllComponents(Checkbox)
      .find(box => box.props('inputId') === 'export-include-api-keys')
    await keys.vm.$emit('update:modelValue', true)

    expect((await exported(wrapper)).includeApiKeys).toBe(true)
  })

  it('hands over what is left ticked', async () => {
    const wrapper = await mountDialog()
    await setTicks(wrapper, {
      'card:libcard_wren': { checked: true },
      'setting:aiProfiles/profile_team': { checked: true },
      'setting:aiProviders/provider_proxy': { checked: true },
    })

    const { pick } = await exported(wrapper)
    expect(pick.everything).toBe(false)
    expect(pick.projects).toEqual([])
    expect(pick.cardIds).toEqual(['libcard_wren'])
    expect([...pick.settings].sort()).toEqual([
      'aiProfiles/profile_team',
      'aiProviders/provider_proxy',
    ])
  })

  it('ticks what a setting needs along with it', async () => {
    const wrapper = await mountDialog()
    await setTicks(wrapper, {})
    expect(isTicked(wrapper, 'setting:aiProviders/provider_proxy')).toBe(false)

    await setTicks(wrapper, { 'setting:aiProfiles/profile_team': { checked: true } })
    expect(isTicked(wrapper, 'setting:aiProviders/provider_proxy')).toBe(true)
    expect(tree(wrapper).props('selectionKeys')['kind:aiProviders']).toEqual({
      checked: true,
      partialChecked: false,
    })
  })

  it('reads a project’s documents and chats when it is opened, ticked as it was', async () => {
    const wrapper = await mountDialog()
    const [project] = tree(wrapper).props('value')[0].children
    expect(project.leaf).toBe(false)

    await tree(wrapper).vm.$emit('node-expand', project)
    await flushPromises()

    expect(backup.readProjectContents).toHaveBeenCalledWith('story_a')
    const opened = tree(wrapper).props('value')[0].children[0]
    expect(opened.children.map(node => node.label)).toEqual(['Documents', 'Chats'])
    expect(isTicked(wrapper, 'document:doc_one')).toBe(true)
    expect(isTicked(wrapper, 'chat:chat_one')).toBe(true)

    await tree(wrapper).vm.$emit('node-expand', opened)
    expect(backup.readProjectContents).toHaveBeenCalledTimes(1)
  })

  it('keeps an empty project open on a line saying so, the project still ticked', async () => {
    backup.readProjectContents.mockResolvedValue({
      documents: CONTENTS.documents.slice(0, 1),
      chats: [],
    })
    const wrapper = await mountDialog()
    const [project] = tree(wrapper).props('value')[0].children

    await tree(wrapper).vm.$emit('node-expand', project)
    await flushPromises()

    const opened = tree(wrapper).props('value')[0].children[0]
    expect(opened.leaf).toBe(false)
    expect(opened.children).toEqual([{ key: 'empty:story_a', label: 'Empty', selectable: false }])
    expect(isTicked(wrapper, 'project:story_a')).toBe(true)
    expect((await exported(wrapper)).pick.everything).toBe(true)
  })

  it('exports nothing with nothing ticked', async () => {
    const wrapper = await mountDialog()
    await setTicks(wrapper, {})

    expect(exportButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('says so when what there is can’t be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    backup.listExportable.mockRejectedValue(new Error('closed'))
    const wrapper = await mountDialog()

    expect(toast.error).toHaveBeenCalledWith("The projects and settings couldn't be read. closed")
    expect(tree(wrapper).exists()).toBe(false)
    expect(exportButton(wrapper).attributes('disabled')).toBeDefined()
  })
})
