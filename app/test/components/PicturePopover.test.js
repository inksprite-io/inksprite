/* global FocusEvent */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import PrimeVue from 'primevue/config'
import PicturePopover from '@/components/writer/editor/PicturePopover.vue'

const mountPopover = (props = {}) =>
  mount(PicturePopover, {
    props: { alt: 'The north gate', left: 10, top: 20, ...props },
    global: { plugins: [PrimeVue] },
    attachTo: document.body,
  })

const field = wrapper => wrapper.find('[data-picture-alt]')

describe('PicturePopover', () => {
  it('shows the alt text, and keeps a change on Enter, back to the text', async () => {
    const wrapper = mountPopover()
    expect(field(wrapper).element.value).toBe('The north gate')

    await field(wrapper).setValue('  The north gate at dusk ')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('apply')).toEqual([['The north gate at dusk', true]])
    wrapper.unmount()
  })

  it('keeps a change when the focus goes elsewhere, and says nothing of none', async () => {
    const wrapper = mountPopover()
    await field(wrapper).setValue('A gate')
    field(wrapper).element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    expect(wrapper.emitted('apply')).toEqual([['A gate', false]])
    wrapper.unmount()

    const untouched = mountPopover()
    field(untouched).element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    expect(untouched.emitted('apply')).toBeUndefined()
    expect(untouched.emitted('close')).toEqual([[false]])
    untouched.unmount()
  })

  it('goes back to the text as it was on Escape', async () => {
    const wrapper = mountPopover()
    await field(wrapper).setValue('Changed')
    await wrapper.find('form').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toEqual([[true]])
    expect(wrapper.emitted('apply')).toBeUndefined()
    wrapper.unmount()
  })

  it('takes the focus when asked for from the menu, and says when it has it', async () => {
    const wrapper = mountPopover({ editing: true })
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(field(wrapper).element)
    expect(wrapper.emitted('edit')).toBeTruthy()
    wrapper.unmount()
  })

  it('asks to see the picture at its own size', async () => {
    const wrapper = mountPopover()
    await wrapper.find('[data-action="view-picture"]').trigger('click')
    expect(wrapper.emitted('view')).toHaveLength(1)
    wrapper.unmount()
  })
})
