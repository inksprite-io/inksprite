import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import AppToast from '../../src/components/common/AppToast.vue'

/** The toast, reduced to the handlers it is handed and one message to draw. */
const message = { severity: 'info', detail: 'Rewritten.', life: 8000 }
const Toast = {
  props: ['onMouseEnter', 'onMouseLeave'],
  template: '<div><slot name="message" :message="message" /></div>',
  setup: () => ({ message }),
}
const ToastContent = { props: ['message'], emits: ['keep'], template: '<div />' }

const show = () =>
  mount(AppToast, { global: { plugins: [PrimeVue], stubs: { Toast, ToastContent } } })

describe('AppToast', () => {
  it('hands the toast a handler for each way the pointer goes, so it pauses under it', () => {
    const toast = show().findComponent(Toast)

    expect(toast.props('onMouseEnter')).toBeTypeOf('function')
    expect(toast.props('onMouseLeave')).toBeTypeOf('function')
  })

  it('keeps a toast that asks to be kept', async () => {
    const wrapper = show()

    await wrapper.findComponent(ToastContent).vm.$emit('keep')

    expect(message.life).toBeNull()
  })
})
