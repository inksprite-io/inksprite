import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatCommandMenu from '../../src/components/writer/chats/ChatCommandMenu.vue'
import { matchCommands } from '../../src/ai/commands.js'

const mountMenu = (props = {}) =>
  mount(ChatCommandMenu, {
    props: { id: 'menu', entries: matchCommands(''), active: 0, ...props },
    global: { directives: { tooltip: {} } },
  })

describe('ChatCommandMenu', () => {
  it('lists each command with what is left to type and what it does', () => {
    const wrapper = mountMenu({ entries: matchCommands('ora') })
    const row = wrapper.find('[data-command="oracle"]')

    expect(row.text()).toContain('/oracle')
    expect(row.text()).toContain('(<likelihood>) <question>')
    expect(row.text()).toContain('Ask a yes-or-no question')
  })

  it('marks the commands that call the model, and only those', () => {
    const wrapper = mountMenu()

    expect(wrapper.find('[data-command="write"] [data-consults]').exists()).toBe(true)
    expect(wrapper.find('[data-command="roll"] [data-consults]').exists()).toBe(false)
  })

  it('is a listbox whose highlighted row is the selected option', () => {
    const wrapper = mountMenu({ entries: matchCommands('ro'), active: 1 })
    const rows = wrapper.findAll('[role="option"]')

    expect(wrapper.attributes('role')).toBe('listbox')
    expect(rows.map(row => row.attributes('aria-selected'))).toEqual(['false', 'true'])
    expect(rows[1].attributes('id')).toBe('menu-roll-table')
  })

  it('says which row was picked', async () => {
    const wrapper = mountMenu({ entries: matchCommands('ro') })
    await wrapper.find('[data-command="roll-table"]').trigger('click')

    expect(wrapper.emitted('pick')).toEqual([[1]])
  })

  it('keeps the field focused when a row is pressed', async () => {
    // The press's default is what would move the focus out of the field, and
    // with it the caret the pick is about to put back.
    const wrapper = mountMenu()
    const press = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true })
    wrapper.find('[data-command="roll"]').element.dispatchEvent(press)

    expect(press.defaultPrevented).toBe(true)
  })

  it('follows the mouse when it moves over another row', async () => {
    const wrapper = mountMenu({ entries: matchCommands('ro') })
    await wrapper.find('[data-command="roll-table"]').trigger('mousemove')
    await wrapper.find('[data-command="roll"]').trigger('mousemove')

    expect(wrapper.emitted('hover')).toEqual([[1]])
  })
})
