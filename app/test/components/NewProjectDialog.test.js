import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import NewProjectDialog from '@/components/writer/projects/NewProjectDialog.vue'

const Dialog = {
  props: ['header'],
  template: '<div><h2>{{ header }}</h2><slot /><slot name="footer" /></div>',
}

const mountDialog = () =>
  mount(NewProjectDialog, {
    props: { visible: true },
    global: { plugins: [PrimeVue], stubs: { Dialog } },
  })

describe('NewProjectDialog', () => {
  it('names the title field by its label, and has the focus go to it', () => {
    const wrapper = mountDialog()
    const input = wrapper.find('input')
    const label = wrapper.find('label')

    expect(label.attributes('for')).toBe(input.attributes('id'))
    expect(input.attributes('autofocus')).toBeDefined()
    expect(wrapper.find('h2').text()).toBe('New project')
  })

  it('creates the project under the title typed', async () => {
    const wrapper = mountDialog()
    await wrapper.find('input').setValue('  Harbour  ')
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('create')).toEqual([[{ title: 'Harbour' }]])
  })
})
