import { describe, it, expect, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import LinkPopover from '@/components/writer/editor/LinkPopover.vue'

/** @type {import('@vue/test-utils').VueWrapper|null} */
let wrapper = null

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

/** @param {Record<string, unknown>} props */
const show = async props => {
  wrapper = mount(LinkPopover, {
    props: { href: 'https://example.com/log', left: 10, top: 20, ...props },
    global: { plugins: [PrimeVue], directives: { tooltip: Tooltip } },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

describe('LinkPopover', () => {
  it('shows the link with its address, to open, copy, edit or remove', async () => {
    const popover = await show({})
    expect(popover.find('[data-action="open-link"]').text()).toBe('https://example.com/log')
    await popover.find('[data-action="open-link"]').trigger('click')
    await popover.find('[data-action="copy-link"]').trigger('click')
    await popover.find('[data-action="edit-link"]').trigger('click')
    await popover.find('[data-action="remove-link"]').trigger('click')
    expect(Object.keys(popover.emitted())).toEqual(
      expect.arrayContaining(['open', 'copy', 'edit', 'remove'])
    )
    // Each by its icon, named for a screen reader.
    expect(popover.find('[data-action="copy-link"] .pi-copy').exists()).toBe(true)
    expect(popover.find('[data-action="edit-link"] .pi-pencil').exists()).toBe(true)
    expect(popover.find('[data-action="remove-link"] .pi-times').exists()).toBe(true)
    expect(popover.find('[data-action="edit-link"]').attributes('aria-label')).toBe('Edit link')
  })

  it('opens its own menu on a right press, and stays', async () => {
    const popover = await show({})
    const press = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    popover.find('[data-action="open-link"]').element.dispatchEvent(press)
    await flushPromises()
    expect(press.defaultPrevented).toBe(true)
    expect(popover.emitted('menu')).toEqual([[true]])
    const items = popover.findComponent({ name: 'ContextMenu' }).props('model')
    expect(items.map(item => item.label)).toEqual([
      'Open link',
      'Copy link',
      'Edit link…',
      'Remove link',
    ])
    items[1].command()
    expect(popover.emitted('copy')).toHaveLength(1)
  })

  it('names the document a link to one goes to, with the link to hover', async () => {
    const popover = await show({ href: '../Notes/Cast%20list.md', document: 'Cast list' })
    const open = popover.find('[data-action="open-link"]')
    expect(open.text()).toBe('Cast list')
    expect(open.attributes('title')).toBe('../Notes/Cast%20list.md')
    expect(popover.find('.pi-file').exists()).toBe(true)
  })

  it('keeps the caret in the editor when pressed', async () => {
    const popover = await show({})
    const press = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true })
    popover.find('[data-action="edit-link"]').element.dispatchEvent(press)
    expect(press.defaultPrevented).toBe(true)
  })

  it('opens the field on the address, and applies what is typed', async () => {
    const popover = await show({ editing: true })
    const field = /** @type {HTMLInputElement} */ (popover.find('[data-link-address]').element)
    expect(document.activeElement).toBe(field)
    expect(field.value).toBe('https://example.com/log')
    expect(popover.find('[data-link-text]').exists()).toBe(false)
    await popover.find('[data-link-address]').setValue('example.org')
    await popover.find('form').trigger('submit')
    expect(popover.emitted('apply')).toEqual([[{ href: 'example.org', text: '' }]])
  })

  it('lists the documents typed for, to pick with the keys or a click', async () => {
    const entries = [
      { key: 'cast', title: 'Cast list', detail: 'Notes', href: '../Notes/Cast%20list.md' },
      { key: 'one', title: 'Chapter 1', detail: 'Drafts', href: '../Drafts/Chapter%201.md' },
    ]
    const asked = []
    const suggest = query => {
      asked.push(query)
      return entries
    }
    const popover = await show({ editing: true, withText: true, href: '', suggest })
    // Nothing for what it opened with, nor for a web address.
    expect(popover.find('[data-link-suggestions]').exists()).toBe(false)
    await popover.find('[data-link-address]').setValue('https://c')
    await popover.find('[data-link-address]').trigger('input')
    expect(popover.find('[data-link-suggestions]').exists()).toBe(false)
    await popover.find('[data-link-address]').setValue('c')
    await popover.find('[data-link-address]').trigger('input')
    expect(asked.at(-1)).toBe('c')
    expect(popover.findAll('[role="option"]').map(row => row.text())).toEqual([
      'Cast listNotes',
      'Chapter 1Drafts',
    ])
    await popover.find('form').trigger('keydown', { key: 'ArrowDown' })
    await popover.find('form').trigger('submit')
    expect(popover.emitted('apply')).toEqual([
      [{ href: '../Drafts/Chapter%201.md', text: 'Chapter 1' }],
    ])
    await popover.find('[role="option"]').trigger('click')
    expect(popover.emitted('apply')?.[1]).toEqual([
      { href: '../Notes/Cast%20list.md', text: 'Cast list' },
    ])
  })

  it('puts the list away on Escape before the field', async () => {
    const entries = [{ key: 'cast', title: 'Cast list', detail: '', href: 'Cast%20list.md' }]
    const popover = await show({ editing: true, suggest: () => entries })
    await popover.find('[data-link-address]').setValue('ca')
    await popover.find('[data-link-address]').trigger('input')
    await popover.find('[data-link-address]').trigger('keydown', { key: 'Escape' })
    expect(popover.find('[data-link-suggestions]').exists()).toBe(false)
    expect(popover.emitted('close')).toBeUndefined()
    await popover.find('[data-link-address]').trigger('keydown', { key: 'Escape' })
    expect(popover.emitted('close')).toEqual([[true]])
  })

  it('opens on the words of a link there, to change with its address', async () => {
    const popover = await show({ editing: true, withText: true, text: 'the log' })
    const words = /** @type {HTMLInputElement} */ (popover.find('[data-link-text]').element)
    expect(words.value).toBe('the log')
    await popover.find('[data-link-text]').setValue('the diary')
    await popover.find('[data-link-address]').setValue('example.org/diary')
    await popover.find('form').trigger('submit')
    expect(popover.emitted('apply')).toEqual([[{ href: 'example.org/diary', text: 'the diary' }]])
  })

  it('asks for the words too for a new link', async () => {
    const popover = await show({ editing: true, withText: true, href: '' })
    await popover.find('[data-link-text]').setValue('the log')
    await popover.find('[data-link-address]').setValue('example.org')
    await popover.find('form').trigger('submit')
    expect(popover.emitted('apply')).toEqual([[{ href: 'example.org', text: 'the log' }]])
  })

  it('goes back to the text on Escape, and just closes when the focus goes elsewhere', async () => {
    const popover = await show({ editing: true })
    await popover.find('[data-link-address]').trigger('keydown', { key: 'Escape' })
    await popover.find('[data-link-address]').trigger('focusout', { relatedTarget: null })
    expect(popover.emitted('close')).toEqual([[true], [false]])
  })
})
