import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useJobsStore } from '@/stores/jobsStore.js'
import { useJobsToast } from '@/composables/useJobsToast.js'
import PrimeVue from 'primevue/config'
import AppNavbar from '@/components/writer/layout/AppNavbar.vue'
import { DEFAULT_LAYOUT, NO_PROJECT_LAYOUT } from '@/components/writer/layout/layout.js'

vi.mock('@/stores/db', () => ({ default: { jobs: { put: vi.fn(async () => undefined) } } }))

const mountRail = (layout, props = {}) =>
  mount(AppNavbar, {
    props: { layout, ...props },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })

const tab = (wrapper, id) => wrapper.find(`[data-tab="${id}"]`)

describe('AppNavbar', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('counts the jobs running on the Jobs button, and shows nothing when none are', async () => {
    const store = useJobsStore()
    const steps = [{ id: 'a', label: 'a', status: 'running' }]
    await store.createJob({
      storyId: 's1',
      kind: 'convert',
      workflow: 'convert',
      title: 'One',
      steps,
    })
    const job = await store.createJob({
      storyId: 's1',
      kind: 'convert',
      workflow: 'convert',
      title: 'Two',
      steps,
    })
    await store.updateJob(job.id, { status: 'running' })

    const wrapper = mountRail(DEFAULT_LAYOUT)

    expect(wrapper.find('[data-action="jobs"] [data-rail-badge]').text()).toBe('1')
    expect(wrapper.find('[data-tab="outline"] [data-rail-badge]').exists()).toBe(false)
  })

  it('opens and closes the jobs toast from the Jobs button, with or without a project', async () => {
    const { state, closed } = useJobsToast()
    closed()
    const wrapper = mountRail(NO_PROJECT_LAYOUT, { hasStory: false })
    const jobs = wrapper.find('[data-action="jobs"]')
    expect(jobs.attributes('disabled')).toBeUndefined()
    // At the foot of the rail, just above the settings
    const order = wrapper
      .findAll('button')
      .map(button => button.attributes('data-tab') || button.attributes('data-action'))
    expect(order.slice(-2)).toEqual(['jobs', 'settings'])

    await jobs.trigger('click')
    expect(state.open).toBe(true)
    expect(jobs.attributes('aria-pressed')).toBe('true')
    await jobs.trigger('click')
    expect(state.open).toBe(false)
    expect(wrapper.emitted('select-tab')).toBeUndefined()
  })

  it('is made of buttons the keyboard reaches and a screen reader can name', () => {
    const wrapper = mountRail(DEFAULT_LAYOUT)

    for (const button of wrapper.findAll('[data-tab], [data-action]')) {
      expect(button.element.tagName).toBe('BUTTON')
      expect(button.attributes('aria-label')).toBeTruthy()
    }
    expect(tab(wrapper, 'chats').attributes('aria-label')).toBe('Chats')
    // The settings open something; they are not on or off.
    expect(wrapper.find('[data-action="settings"]').attributes('aria-pressed')).toBeUndefined()
  })

  it('asks for a list to be shown', async () => {
    const wrapper = mountRail(DEFAULT_LAYOUT)
    await tab(wrapper, 'chats').trigger('click')
    await tab(wrapper, 'narration').trigger('click')
    await tab(wrapper, 'projects').trigger('click')
    expect(wrapper.emitted('select-tab')).toEqual([['chats'], ['narration'], ['projects']])
  })

  it('marks the list showing, and none while the sidebar is hidden', () => {
    const showing = mountRail({ ...DEFAULT_LAYOUT, sidebarTab: 'chats' })
    expect(tab(showing, 'chats').attributes('aria-pressed')).toBe('true')
    expect(tab(showing, 'outline').attributes('aria-pressed')).toBe('false')

    const hidden = mountRail({ ...DEFAULT_LAYOUT, sidebar: false, sidebarTab: 'chats' })
    expect(tab(hidden, 'chats').attributes('aria-pressed')).toBe('false')
  })

  it('has nothing for the panels: the editor and the chat hide each other', () => {
    const wrapper = mountRail(DEFAULT_LAYOUT)
    expect(wrapper.findAll('button')).toHaveLength(6)
    expect(wrapper.find('[data-panel]').exists()).toBe(false)
  })

  it('offers only the projects and the settings with no project open', async () => {
    const wrapper = mountRail(NO_PROJECT_LAYOUT, { hasStory: false })

    expect(tab(wrapper, 'projects').attributes('aria-pressed')).toBe('true')
    expect(tab(wrapper, 'outline').attributes('aria-disabled')).toBe('true')
    expect(tab(wrapper, 'chats').attributes('aria-disabled')).toBe('true')
    expect(tab(wrapper, 'narration').attributes('aria-disabled')).toBe('true')

    await tab(wrapper, 'outline').trigger('click')
    expect(wrapper.emitted('select-tab')).toBeUndefined()

    await wrapper.find('[data-action="settings"]').trigger('click')
    expect(wrapper.emitted('open-settings')).toHaveLength(1)
  })
})
