import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PanelHeader from '@/components/writer/layout/PanelHeader.vue'
import HeaderButton from '@/components/writer/layout/HeaderButton.vue'

const global = { directives: { tooltip: {} } }

describe('PanelHeader', () => {
  it('says what the list is, with its buttons at the end', () => {
    const wrapper = mount(PanelHeader, {
      props: { title: 'Chats' },
      slots: { default: '<button data-end />' },
      global,
    })
    expect(wrapper.find('h2').text()).toBe('Chats')
    expect(wrapper.find('[data-end]').exists()).toBe(true)
  })

  it('leaves the strip to the buttons without a title', () => {
    const wrapper = mount(PanelHeader, { slots: { default: '<button data-end />' }, global })
    expect(wrapper.find('h2').exists()).toBe(false)
    expect(wrapper.find('[data-end]').exists()).toBe(true)
  })
})

describe('HeaderButton', () => {
  it('is a button named by its label, passing the click on', async () => {
    const wrapper = mount(HeaderButton, {
      props: { icon: 'pi pi-plus', label: 'New chat' },
      attrs: { 'data-action': 'new' },
      global,
    })
    expect(wrapper.element.tagName).toBe('BUTTON')
    expect(wrapper.attributes('aria-label')).toBe('New chat')
    expect(wrapper.attributes('data-action')).toBe('new')
    expect(wrapper.find('i').classes()).toContain('pi-plus')

    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('spins and takes no clicks while busy', async () => {
    const wrapper = mount(HeaderButton, {
      props: { icon: 'pi pi-upload', label: 'Import a chat', loading: true },
      global,
    })
    expect(wrapper.find('i').classes()).toContain('pi-spinner')
    expect(wrapper.attributes('disabled')).toBeDefined()
    expect(wrapper.attributes('aria-busy')).toBe('true')
  })
})
