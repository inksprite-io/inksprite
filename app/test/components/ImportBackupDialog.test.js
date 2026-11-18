import { describe, it, expect } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ImportBackupDialog from '@/components/writer/settings/ImportBackupDialog.vue'

/**
 * A project as a backup holds it: its row, and its documents, the root's
 * title being its name.
 * @param {string} id
 * @param {string} name
 */
const project = (id, name) => ({
  story: { id },
  documents: [{ id: `root_${id}`, storyId: id, title: name }],
})

const thief = project('story_thief', 'Thief')
const letters = project('story_letters', 'Letters')
const atlas = project('story_atlas', 'atlas')

/** The library's cards, as a backup holds them. */
const cards = {
  rows: [
    { id: 'libcard_wren', title: 'Wren' },
    { id: 'libcard_ost', name: 'Ost' },
    { id: 'libcard_blank' },
  ],
  files: [{ id: 'libcard_wren', card: {}, image: null }],
}

/**
 * What a backup's settings would do here.
 * @param {{added?: string[], changed?: string[]}} [items]
 */
const plan = ({ added = [], changed = [] } = {}) => ({
  rows: {},
  settings: {},
  added: added.map(name => ({ name })),
  changed: changed.map(name => ({ name })),
  fingerprints: {},
})

/** The dialog's frame, which opens it as the real one does when it shows. */
const Dialog = {
  props: ['visible'],
  emits: ['show', 'update:visible'],
  mounted() {
    if (this.visible) this.$emit('show')
  },
  template: '<div v-if="visible"><slot /><slot name="footer" /></div>',
}

/**
 * @param {Record<string, any>} [props]
 */
const mountDialog = async (props = {}) => {
  const wrapper = mount(ImportBackupDialog, {
    props: {
      visible: true,
      message: 'This backup holds 3 projects and 3 character cards.',
      addable: { projects: [thief, letters, atlas], cards },
      here: [],
      plan: plan(),
      ...props,
    },
    global: { plugins: [PrimeVue], stubs: { Dialog } },
  })
  await flushPromises()
  return wrapper
}

/** @typedef {Awaited<ReturnType<typeof mountDialog>>} Wrapper */

/** @param {Wrapper} wrapper */
const tree = wrapper => wrapper.findComponent({ name: 'Tree' })

/** What is ticked, by key, the groups' own ticks aside. @param {Wrapper} wrapper */
const ticked = wrapper =>
  Object.entries(tree(wrapper).props('selectionKeys'))
    .filter(([key, tick]) => tick.checked && key.includes(':'))
    .map(([key]) => key)

/** How a row of the tree stands: ticked, half ticked, or not at all. */
const tickOf = (wrapper, key) => tree(wrapper).props('selectionKeys')[key]

/**
 * Tick these and nothing else, as clicks in the tree leave it.
 * @param {Wrapper} wrapper
 * @param {string[]} keys
 */
const tick = (wrapper, keys) =>
  tree(wrapper).vm.$emit(
    'update:selectionKeys',
    Object.fromEntries(keys.map(key => [key, { checked: true }]))
  )

/** @param {Wrapper} wrapper */
const addButton = wrapper => wrapper.find('[data-action="add"]')

describe('ImportBackupDialog', () => {
  it('says what the backup holds, and lists its projects and cards by name', async () => {
    const wrapper = await mountDialog()

    expect(wrapper.find('[data-backup-contents]').text()).toBe(
      'This backup holds 3 projects and 3 character cards.'
    )
    expect(tree(wrapper).props('value')).toEqual([
      {
        key: 'projects',
        label: 'Projects',
        children: [
          { key: 'project:story_atlas', label: 'atlas' },
          { key: 'project:story_letters', label: 'Letters' },
          { key: 'project:story_thief', label: 'Thief' },
        ],
      },
      {
        key: 'cards',
        label: 'Character cards',
        children: [
          { key: 'card:libcard_ost', label: 'Ost' },
          { key: 'card:libcard_blank', label: 'Untitled' },
          { key: 'card:libcard_wren', label: 'Wren' },
        ],
      },
    ])
    expect(tree(wrapper).props('expandedKeys')).toEqual({ projects: true, cards: true })
  })

  it('opens with every project and card ticked where none of them is here', async () => {
    const wrapper = await mountDialog()

    expect(ticked(wrapper)).toEqual([
      'project:story_thief',
      'project:story_letters',
      'project:story_atlas',
      'card:libcard_wren',
      'card:libcard_ost',
      'card:libcard_blank',
    ])
    expect(tickOf(wrapper, 'projects')).toEqual({ checked: true, partialChecked: false })
    expect(tickOf(wrapper, 'cards')).toEqual({ checked: true, partialChecked: false })
  })

  it('opens with a project that is here already not ticked, and Projects half ticked', async () => {
    const wrapper = await mountDialog({ here: ['story_thief'] })

    expect(ticked(wrapper)).toEqual([
      'project:story_letters',
      'project:story_atlas',
      'card:libcard_wren',
      'card:libcard_ost',
      'card:libcard_blank',
    ])
    expect(tickOf(wrapper, 'projects')).toEqual({ checked: false, partialChecked: true })
  })

  it('leaves Projects unticked where every project is here', async () => {
    const wrapper = await mountDialog({
      here: ['story_thief', 'story_letters', 'story_atlas'],
      addable: { projects: [thief, letters, atlas], cards: { rows: [], files: [] } },
    })

    expect(ticked(wrapper)).toEqual([])
    expect(tickOf(wrapper, 'projects')).toBeUndefined()
    expect(addButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('has no Settings row where the backup’s settings would change nothing', async () => {
    const wrapper = await mountDialog()

    expect(
      tree(wrapper)
        .props('value')
        .map(node => node.key)
    ).toEqual(['projects', 'cards'])
    expect(await mountDialog({ plan: null }).then(ticked)).not.toContain('settings')
  })

  it('has a Settings row, ticked, where the backup’s settings only add', async () => {
    const wrapper = await mountDialog({ plan: plan({ added: ['Wiki'] }) })

    expect(tree(wrapper).props('value').at(-1)).toEqual({ key: 'settings', label: 'Settings' })
    expect(tickOf(wrapper, 'settings')).toEqual({ checked: true })
  })

  it('has the Settings row not ticked where the settings would change some that are here', async () => {
    const wrapper = await mountDialog({ plan: plan({ added: ['Wiki'], changed: ['Default'] }) })

    expect(tree(wrapper).props('value').at(-1)).toEqual({ key: 'settings', label: 'Settings' })
    expect(tickOf(wrapper, 'settings')).toBeUndefined()
  })

  it('lists the settings alone for a backup with nothing else to add', async () => {
    const wrapper = await mountDialog({
      addable: { projects: [], cards: { rows: [], files: [] } },
      plan: plan({ added: ['Wiki'] }),
    })

    expect(tree(wrapper).props('value')).toEqual([{ key: 'settings', label: 'Settings' }])
    expect(addButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('adds what is ticked as it opened, the cards’ files with them, and closes', async () => {
    const wrapper = await mountDialog({ here: ['story_thief'], plan: plan({ added: ['Wiki'] }) })

    await addButton(wrapper).trigger('click')

    expect(wrapper.emitted('add')).toEqual([
      [
        {
          projects: [letters, atlas],
          cards: { rows: cards.rows, files: cards.files },
          settings: true,
        },
      ],
    ])
    expect(wrapper.emitted('update:visible')).toEqual([[false]])
  })

  it('adds what the writer left ticked: a project that is here as well, and no settings', async () => {
    const wrapper = await mountDialog({ here: ['story_thief'], plan: plan({ added: ['Wiki'] }) })

    await tick(wrapper, ['project:story_thief', 'card:libcard_ost'])
    await addButton(wrapper).trigger('click')

    expect(wrapper.emitted('add')).toEqual([
      [
        {
          projects: [thief],
          cards: { rows: [{ id: 'libcard_ost', name: 'Ost' }], files: cards.files },
          settings: false,
        },
      ],
    ])
  })

  it('has nothing to add with nothing ticked', async () => {
    const wrapper = await mountDialog()

    await tick(wrapper, [])

    expect(addButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('adds nothing when cancelled, and offers no way to replace what is here', async () => {
    const wrapper = await mountDialog()
    const buttons = wrapper.findAll('button').map(button => button.text())

    expect(buttons.filter(Boolean)).toEqual(expect.arrayContaining(['Cancel', 'Import']))
    expect(wrapper.text()).not.toContain('Replace')

    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Cancel')
      .trigger('click')

    expect(wrapper.emitted('add')).toBeUndefined()
    expect(wrapper.emitted('update:visible')).toEqual([[false]])
  })

  it('shows no tree for a backup with nothing to add', async () => {
    const wrapper = await mountDialog({ addable: null, plan: null })

    expect(tree(wrapper).exists()).toBe(false)
    expect(addButton(wrapper).attributes('disabled')).toBeDefined()
  })
})
