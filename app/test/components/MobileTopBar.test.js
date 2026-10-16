import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Menu from 'primevue/menu'
import MobileTopBar from '@/components/writer/layout/MobileTopBar.vue'
import { useJobsStore } from '@/stores/jobsStore.js'
import { useJobsToast } from '@/composables/useJobsToast.js'
import { useApplicationState } from '@/composables/useApplicationState'
import { useCardLibraryPanel } from '@/composables/useCardLibraryPanel.js'

vi.mock('@/stores/db', () => ({
  default: {
    jobs: { put: vi.fn(async () => undefined), bulkDelete: vi.fn(async () => undefined) },
  },
}))

const STEPS = [{ id: 'a', label: 'a', status: 'running' }]

/** @param {string} title */
const addJob = title =>
  useJobsStore().createJob({
    storyId: 's1',
    kind: 'convert',
    workflow: 'convert',
    title,
    steps: STEPS,
  })

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
  beforeEach(() => {
    setActivePinia(createPinia())
    useApplicationState().resetState()
  })

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
    expect(items(wrapper).map(entry => entry.label)).toEqual(['Narration', 'Comments', 'Settings'])
    expect(wrapper.find('[data-tab="write"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-tab="chat"]').attributes('aria-pressed')).toBe('false')
  })

  it('has no chat and no narration with the AI switched off', () => {
    useApplicationState().setAiEnabled(false)
    const wrapper = mountBar({ hasStory: true })

    expect(wrapper.findAll('button').map(button => button.attributes('aria-label'))).toEqual([
      'Write',
      'Outline',
      'More',
    ])
    expect(items(wrapper).map(entry => entry.label)).toEqual(['Comments', 'Settings'])
  })

  it('has the card library first in the menu while roleplay is on, which opens it', async () => {
    useApplicationState().setExtension('roleplay', true)
    const wrapper = mountBar({ hasStory: true })
    expect(items(wrapper).map(entry => entry.label)).toEqual([
      'Character cards',
      'Narration',
      'Comments',
      'Settings',
    ])

    item(wrapper, 'cards').command()
    expect(useCardLibraryPanel().visible.value).toBe(true)
    useCardLibraryPanel().close()
  })

  it('has the jobs in the menu, before the settings, only while there are jobs', async () => {
    const wrapper = mountBar({ hasStory: true })
    const job = await addJob('One')
    await wrapper.vm.$nextTick()
    expect(items(wrapper).map(entry => entry.label)).toEqual([
      'Narration',
      'Comments',
      'Jobs',
      'Settings',
    ])

    await useJobsStore().deleteJob(job.id)
    await wrapper.vm.$nextTick()
    expect(item(wrapper, 'jobs')).toBeUndefined()
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
    const job = await addJob('One')
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
