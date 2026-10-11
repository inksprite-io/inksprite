import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Menu from 'primevue/menu'
import MobileTopBar from '@/components/writer/layout/MobileTopBar.vue'
import { useJobsStore } from '@/stores/jobsStore.js'
import { useJobsToast } from '@/composables/useJobsToast.js'

vi.mock('@/stores/db', () => ({ default: { jobs: { put: vi.fn(async () => undefined) } } }))

const mountBar = props =>
  mount(MobileTopBar, {
    props: { activeMobileTab: 'write', ...props },
    global: { plugins: [PrimeVue] },
  })

/** @param {import('@vue/test-utils').VueWrapper} wrapper */
const items = wrapper => wrapper.findComponent(Menu).props('model')

/**
 * @param {import('@vue/test-utils').VueWrapper} wrapper
 * @param {string} id
 */
const item = (wrapper, id) => items(wrapper).find(entry => entry.id === id)

describe('MobileTopBar', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('is the writing, the outline and the chat, and a menu of the rest', () => {
    const wrapper = mountBar({ hasStory: true })
    const buttons = wrapper.findAll('button')

    expect(buttons.map(button => button.attributes('aria-label'))).toEqual([
      'Write',
      'Outline',
      'Chat',
      'More',
    ])
    expect(buttons.every(button => button.text() === '')).toBe(true)
    expect(items(wrapper).map(entry => entry.label)).toEqual([
      'Narration',
      'Comments',
      'Jobs',
      'Settings',
    ])
    expect(wrapper.find('[data-tab="write"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-tab="chat"]').attributes('aria-pressed')).toBe('false')
  })

  it('asks for the view picked, from the bar or the menu', async () => {
    const wrapper = mountBar({ hasStory: true })
    await wrapper.find('[data-tab="outline"]').trigger('click')
    item(wrapper, 'comments').command()

    expect(wrapper.emitted('update:activeMobileTab')).toEqual([['outline'], ['comments']])
  })

  it('shows the menu as the one in use while one of its views is', async () => {
    const wrapper = mountBar({ hasStory: true, activeMobileTab: 'narration' })
    const more = wrapper.find('[data-action="more"]')

    expect(more.classes()).toContain('bg-surface-300')
    expect(item(wrapper, 'narration').current).toBe(true)
    expect(item(wrapper, 'settings').current).toBe(false)

    await wrapper.setProps({ activeMobileTab: 'chat' })
    expect(more.classes()).not.toContain('bg-surface-300')
  })

  it('offers only the writing view, which says there is no project, and the settings with no project open', async () => {
    const wrapper = mountBar({ hasStory: false, activeMobileTab: 'settings' })

    expect(wrapper.find('[data-tab="outline"]').attributes('aria-disabled')).toBe('true')
    expect(wrapper.find('[data-tab="write"]').attributes('aria-disabled')).toBeUndefined()
    expect(item(wrapper, 'narration').disabled).toBe(true)
    expect(item(wrapper, 'settings').disabled).toBe(false)

    await wrapper.find('[data-tab="outline"]').trigger('click')
    expect(wrapper.emitted('update:activeMobileTab')).toBeUndefined()

    await wrapper.find('[data-tab="write"]').trigger('click')
    expect(wrapper.emitted('update:activeMobileTab')).toEqual([['write']])
  })

  it('opens and closes the jobs toast from the menu, with the running count on the menu', async () => {
    const { state, closed } = useJobsToast()
    closed()
    const store = useJobsStore()
    const steps = [{ id: 'a', label: 'a', status: 'running' }]
    const job = await store.createJob({
      storyId: 's1',
      kind: 'convert',
      workflow: 'convert',
      title: 'One',
      steps,
    })
    const wrapper = mountBar({ hasStory: false, activeMobileTab: 'write' })
    const more = wrapper.find('[data-action="more"]')
    expect(more.find('[data-rail-badge]').exists()).toBe(false)

    await store.updateJob(job.id, { status: 'running' })
    await wrapper.vm.$nextTick()
    expect(more.find('[data-rail-badge]').text()).toBe('1')
    expect(item(wrapper, 'jobs').count).toBe(1)

    item(wrapper, 'jobs').command()
    expect(state.open).toBe(true)
    await wrapper.vm.$nextTick()
    expect(item(wrapper, 'jobs').current).toBe(true)
    item(wrapper, 'jobs').command()
    expect(state.open).toBe(false)
    expect(wrapper.emitted('update:activeMobileTab')).toBeUndefined()
  })
})
