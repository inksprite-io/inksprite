import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Tree from 'primevue/tree'
import ImportBackupDialog from '../../src/components/writer/settings/ImportBackupDialog.vue'

/** A project of the backup, named as its root is. */
const project = (id, title) => ({
  story: { id },
  documents: [{ id: `root_${id}`, storyId: id, title }],
  files: [],
  chats: [],
  messages: [],
  profiles: [],
})

const ADDABLE = {
  projects: [project('story_b', 'Thief'), project('story_a', 'Field notes')],
  cards: { rows: [{ id: 'libcard_wren', title: 'Wren' }], files: [{ id: 'libcard_wren' }] },
}

const mountDialog = async (addable = ADDABLE) => {
  const wrapper = mount(ImportBackupDialog, {
    props: { visible: true, message: 'This backup holds 2 projects.', addable },
    global: {
      plugins: [PrimeVue],
      stubs: {
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

const button = (wrapper, label) => wrapper.findAll('button').find(b => b.text() === label)

/** The labels of a tree, nested as it is. */
const shape = nodes =>
  nodes.map(node => (node.children ? { [node.label]: shape(node.children) } : node.label))

describe('ImportBackupDialog', () => {
  it('says what the backup holds, and offers its projects and cards in view, none ticked', async () => {
    const wrapper = await mountDialog()
    expect(wrapper.text()).toContain('This backup holds 2 projects.')
    expect(wrapper.text()).toContain('Replace deletes everything in inksprite now.')
    expect(shape(wrapper.findComponent(Tree).props('value'))).toEqual([
      { Projects: ['Field notes', 'Thief'] },
      { 'Character cards': ['Wren'] },
    ])
    expect(button(wrapper, 'Add').attributes('disabled')).toBeDefined()
    expect(wrapper.findComponent(Tree).props('expandedKeys')).toEqual({
      projects: true,
      cards: true,
    })
  })

  it('adds what is ticked, the cards with their files', async () => {
    const wrapper = await mountDialog()
    const ticked = { checked: true, partialChecked: false }
    await wrapper
      .findComponent(Tree)
      .vm.$emit('update:selectionKeys', { 'project:story_b': ticked, 'card:libcard_wren': ticked })
    await flushPromises()

    await button(wrapper, 'Add').trigger('click')

    expect(wrapper.emitted('add')[0][0]).toEqual({
      projects: [ADDABLE.projects[0]],
      cards: { rows: ADDABLE.cards.rows, files: ADDABLE.cards.files },
    })
    expect(wrapper.emitted('update:visible').at(-1)).toEqual([false])
    expect(wrapper.emitted('replace')).toBeUndefined()
  })

  it('replaces everything when asked to', async () => {
    const wrapper = await mountDialog()
    await button(wrapper, 'Replace').trigger('click')
    expect(wrapper.emitted('replace')).toHaveLength(1)
    expect(wrapper.emitted('add')).toBeUndefined()
  })

  it('offers nothing to add from a backup of settings alone', async () => {
    const wrapper = await mountDialog({ projects: [], cards: { rows: [], files: [] } })
    expect(wrapper.findComponent(Tree).exists()).toBe(false)
    expect(button(wrapper, 'Add').attributes('disabled')).toBeDefined()
    expect(button(wrapper, 'Replace').attributes('disabled')).toBeUndefined()
  })
})
