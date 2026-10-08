import { describe, it, expect, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
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
    global: { plugins: [PrimeVue] },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

describe('LinkPopover', () => {
  it('shows the link with its address, to open, edit or remove', async () => {
    const popover = await show({})
    expect(popover.find('[data-action="open-link"]').text()).toBe('https://example.com/log')
    await popover.find('[data-action="open-link"]').trigger('click')
    await popover.find('[data-action="edit-link"]').trigger('click')
    await popover.find('[data-action="remove-link"]').trigger('click')
    expect(Object.keys(popover.emitted())).toEqual(
      expect.arrayContaining(['open', 'edit', 'remove'])
    )
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
