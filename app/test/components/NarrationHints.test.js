import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import NarrationHints from '@/components/writer/narration/NarrationHints.vue'

const mountHints = props => mount(NarrationHints, { props, global: { plugins: [PrimeVue] } })

describe('NarrationHints', () => {
  it('offers to read the hinted words once there are any', async () => {
    const empty = mountHints({ hints: '# a comment, and a line with no respelling\nquinoa' })
    expect(empty.find('[data-action="preview-hints"]').attributes('disabled')).toBeDefined()

    const wrapper = mountHints({ hints: 'quinoa:keenwah' })
    const preview = wrapper.find('[data-action="preview-hints"]')
    expect(preview.attributes('disabled')).toBeUndefined()
    await preview.trigger('click')
    expect(wrapper.emitted('preview')).toHaveLength(1)
  })

  it('passes the hints on as they are typed', async () => {
    const wrapper = mountHints({ hints: '' })
    await wrapper.find('[data-hints]').setValue('Eleanor:ellinore')
    expect(wrapper.emitted('update:hints')).toEqual([['Eleanor:ellinore']])
  })
})
