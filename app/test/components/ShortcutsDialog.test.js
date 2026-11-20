import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import ShortcutsDialog from '@/components/writer/editor/ShortcutsDialog.vue'

/** Whether the app is in its desktop window, where the menu has keys of its own. */
const desktop = { value: false }
vi.mock('@/platform/menu.js', () => ({ hasMenuCommands: () => desktop.value }))

const aiEnabled = ref(true)
vi.mock('@/composables/useApplicationState.js', () => ({
  useApplicationState: () => ({ aiEnabled }),
}))

const Dialog = {
  name: 'Dialog',
  props: ['visible', 'header'],
  template: '<div v-if="visible" role="dialog"><slot /></div>',
}

const mountDialog = () =>
  mount(ShortcutsDialog, { props: { visible: true }, global: { stubs: { Dialog } } })

/** The groups listed, by their headings. */
const groups = wrapper => wrapper.findAll('[data-shortcut-group] h3').map(heading => heading.text())

/** What a group lists, as each action and its keys. */
const listed = (wrapper, title) =>
  wrapper
    .findAll('[data-shortcut-group]')
    .find(group => group.find('h3').text() === title)
    .findAll('dl > div')
    .map(row => [row.find('dt').text(), row.find('kbd').text()])

describe('ShortcutsDialog', () => {
  beforeEach(() => {
    desktop.value = false
    aiEnabled.value = true
  })

  it('lists the editor’s keys, and in a browser no more: the tabs’ keys are the browser’s there', () => {
    const wrapper = mountDialog()
    expect(groups(wrapper)).toEqual(['Text', 'Blocks', 'Editing', 'As you type'])
    expect(listed(wrapper, 'Text')[0]).toEqual(['Bold', 'Ctrl+B'])
  })

  it('ends with the keys for tabs and windows in the desktop app', () => {
    desktop.value = true
    const wrapper = mountDialog()

    expect(groups(wrapper).at(-1)).toBe('Tabs and windows')
    const keys = Object.fromEntries(listed(wrapper, 'Tabs and windows'))
    expect(keys).toMatchObject({
      'New document': 'Ctrl+N',
      'New chat': 'Ctrl+T',
      'Close tab': 'Ctrl+W',
      'Reopen closed tab': 'Ctrl+Shift+T',
      'Next tab': 'Ctrl+Tab',
      'Close window': 'Ctrl+Shift+W',
    })
  })

  it('leaves out the new chat with the AI switched off', () => {
    desktop.value = true
    aiEnabled.value = false

    const actions = listed(mountDialog(), 'Tabs and windows').map(([action]) => action)
    expect(actions).not.toContain('New chat')
    expect(actions).toContain('New document')
  })
})
