import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ExpandableSection from '@/components/common/ExpandableSection.vue'

const show = (props = {}, slots = {}) =>
  mount(ExpandableSection, {
    props: { title: 'Tools', ...props },
    slots: { default: '<p data-content>Inside</p>', ...slots },
  })

describe('ExpandableSection', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('makes its title a button a keyboard can reach, saying whether it is open', async () => {
    const wrapper = show()
    const button = wrapper.find('h3 button')

    expect(button.text()).toBe('Tools')
    expect(button.attributes('aria-expanded')).toBe('false')
    expect(button.attributes('aria-controls')).toBe(
      wrapper.find('[data-content]').element.parentElement.id
    )

    await button.trigger('click')
    expect(button.attributes('aria-expanded')).toBe('true')
  })

  it('opens once for a click on its title, not again as the click reaches the row', async () => {
    const wrapper = show()

    await wrapper.find('h3 button').trigger('click')
    expect(wrapper.find('h3 button').attributes('aria-expanded')).toBe('true')
  })

  it('still opens from anywhere on the row', async () => {
    const wrapper = show()

    await wrapper.find('.cursor-pointer').trigger('click')
    expect(wrapper.find('h3 button').attributes('aria-expanded')).toBe('true')
  })

  it('leaves a click on its actions to them', async () => {
    const wrapper = show({}, { actions: '<input type="checkbox" data-switch />' })

    await wrapper.find('[data-switch]').trigger('click')
    expect(wrapper.find('h3 button').attributes('aria-expanded')).toBe('false')
  })
})
