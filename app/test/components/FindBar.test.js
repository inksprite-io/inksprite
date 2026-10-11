import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import FindBar from '@/components/common/FindBar.vue'

/** @param {Record<string, any>} props */
const mountBar = props =>
  mount(FindBar, {
    props: { query: 'he', count: 3, current: 0, ...props },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })

const status = wrapper => wrapper.find('[data-find-status]').text()

describe('FindBar', () => {
  it('offers matching case and whole words only to a panel that can', () => {
    expect(mountBar({}).find('[data-action="match-case"]').exists()).toBe(false)
    expect(mountBar({ refinable: true }).find('[data-action="match-case"]').exists()).toBe(true)
  })

  it('says whether each is on, and asks to turn it over', async () => {
    const wrapper = mountBar({ refinable: true, matchCase: true })
    const matchCase = wrapper.find('[data-action="match-case"]')
    const wholeWord = wrapper.find('[data-action="whole-word"]')

    expect(matchCase.attributes('aria-pressed')).toBe('true')
    expect(wholeWord.attributes('aria-pressed')).toBe('false')

    await matchCase.trigger('click')
    await wholeWord.trigger('click')

    expect(wrapper.emitted('update:matchCase')).toEqual([[false]])
    expect(wrapper.emitted('update:wholeWord')).toEqual([[true]])
  })

  it('says how many Replace all replaced, until the writer is on a match again', async () => {
    const wrapper = mountBar({ replaceable: true })
    await wrapper.find('[data-action="toggle-replace"]').trigger('click')

    await wrapper.find('[data-action="replace-all"]').trigger('click')
    await wrapper.setProps({ count: 0, current: -1 })

    expect(wrapper.emitted('replace-all')).toHaveLength(1)
    expect(status(wrapper)).toBe('Replaced 3')

    await wrapper.setProps({ count: 1, current: 0 })
    expect(status(wrapper)).toBe('1 of 1')
  })

  it('forgets how many it replaced when the search changes', async () => {
    const wrapper = mountBar({ replaceable: true })
    await wrapper.find('[data-action="toggle-replace"]').trigger('click')
    await wrapper.find('[data-action="replace-all"]').trigger('click')
    await wrapper.setProps({ count: 0, current: -1 })

    await wrapper.setProps({ query: 'she' })

    expect(status(wrapper)).toBe('No results')
  })
})
