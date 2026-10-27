import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Checkbox from 'primevue/checkbox'
import ExportDialog from '../../src/components/writer/settings/ExportDialog.vue'

const mountDialog = async () => {
  const wrapper = mount(ExportDialog, {
    props: { visible: true },
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

const exportButton = wrapper => wrapper.findAll('button').find(b => b.text() === 'Export')

describe('ExportDialog', () => {
  it('backs up everything without keys, and closes', async () => {
    const wrapper = await mountDialog()
    await exportButton(wrapper).trigger('click')
    expect(wrapper.emitted('export')[0][0]).toEqual({ includeApiKeys: false })
    expect(wrapper.emitted('update:visible').at(-1)).toEqual([false])
  })

  it('includes keys when the box is ticked', async () => {
    const wrapper = await mountDialog()
    await wrapper.findComponent(Checkbox).vm.$emit('update:modelValue', true)
    await exportButton(wrapper).trigger('click')
    expect(wrapper.emitted('export')[0][0]).toEqual({ includeApiKeys: true })
  })
})
