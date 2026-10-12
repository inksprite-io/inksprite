import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import NarrationFilters from '@/components/writer/narration/NarrationFilters.vue'

const mountFilters = props => mount(NarrationFilters, { props, global: { plugins: [PrimeVue] } })

describe('NarrationFilters', () => {
  it('passes the filters on as they are typed', async () => {
    const wrapper = mountFilters({ filters: '' })
    await wrapper.find('[data-filters]').setValue('^Page \\d+$')
    expect(wrapper.emitted('update:filters')).toEqual([['^Page \\d+$']])
  })

  it('marks the field while a line is not a regular expression', () => {
    expect(mountFilters({ filters: '^Page \\d+$' }).find('[data-filters]').classes()).not.toContain(
      'p-invalid'
    )
    expect(mountFilters({ filters: '^Page \\d+$\n[1' }).find('[data-filters]').classes()).toContain(
      'p-invalid'
    )
  })
})
