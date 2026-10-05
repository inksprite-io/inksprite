import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ToastContent from '../../src/components/common/ToastContent.vue'

const remove = vi.fn()
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ remove }) }))

const show = message => mount(ToastContent, { props: { message }, global: { plugins: [PrimeVue] } })

describe('ToastContent', () => {
  beforeEach(() => remove.mockClear())

  it('says what any toast says, under the classes the theme styles', () => {
    const wrapper = show({ severity: 'success', summary: 'Saved', detail: 'All of it.' })

    expect(wrapper.find('.p-toast-message-icon').exists()).toBe(true)
    expect(wrapper.find('.p-toast-summary').text()).toBe('Saved')
    expect(wrapper.find('.p-toast-detail').text()).toBe('All of it.')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('leaves out a title it was not given, so the detail sits beside the icon', () => {
    const wrapper = show({ severity: 'info', detail: 'Rewritten.' })

    expect(wrapper.find('.p-toast-summary').exists()).toBe(false)
    expect(wrapper.find('.p-toast-detail').text()).toBe('Rewritten.')
  })

  it('does what it offers, and goes', async () => {
    const message = {
      severity: 'info',
      detail: 'Rewritten.',
      action: { label: 'Undo', command: vi.fn() },
    }
    const wrapper = show(message)

    const undo = wrapper.find('[data-action="toast-action"]')
    expect(undo.text()).toBe('Undo')
    await undo.trigger('click')

    expect(message.action.command).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith(message)
  })

  it('offers no changes to look at when it has none', () => {
    const wrapper = show({
      severity: 'info',
      detail: 'Done.',
      action: { label: 'Undo', command: vi.fn() },
    })

    expect(wrapper.find('[data-action="toast-changes"]').exists()).toBe(false)
  })

  it('keeps the changes folded away until asked for', async () => {
    const wrapper = show({
      severity: 'info',
      detail: 'Rewritten.',
      action: { label: 'Undo', command: vi.fn() },
      changes: [
        { removed: ['* one'], added: ['- one'] },
        { removed: ['', ''], added: [] },
      ],
    })
    const toggle = wrapper.find('[data-action="toast-changes"]')
    expect(toggle.text()).toBe('What changed?')
    expect(wrapper.find('[data-changes]').exists()).toBe(false)

    await toggle.trigger('click')

    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('[data-removed]').map(line => line.text())).toEqual([
      '- * one',
      '-',
      '-',
    ])
    expect(wrapper.findAll('[data-added]').map(line => line.text())).toEqual(['+ - one'])

    await toggle.trigger('click')
    expect(wrapper.find('[data-changes]').exists()).toBe(false)
  })

  it('asks to be kept once its changes are opened, and not before', async () => {
    const wrapper = show({
      severity: 'info',
      detail: 'Rewritten.',
      action: { label: 'Undo', command: vi.fn() },
      changes: [{ removed: ['* one'], added: ['- one'] }],
    })
    expect(wrapper.emitted('keep')).toBeUndefined()

    await wrapper.find('[data-action="toast-changes"]').trigger('click')

    expect(wrapper.emitted('keep')).toHaveLength(1)
  })
})
