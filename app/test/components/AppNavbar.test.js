import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useJobsStore } from '@/stores/jobsStore.js'
import { useJobsToast } from '@/composables/useJobsToast.js'
import { useApplicationState } from '@/composables/useApplicationState'
import { useCardLibraryPanel } from '@/composables/useCardLibraryPanel.js'
import PrimeVue from 'primevue/config'
import AppNavbar from '@/components/writer/layout/AppNavbar.vue'
import { DEFAULT_LAYOUT, NO_PROJECT_LAYOUT } from '@/components/writer/layout/layout.js'

let storedJobs = 0
vi.mock('@/stores/db', () => ({
  default: {
    jobs: {
      put: vi.fn(async () => undefined),
      bulkDelete: vi.fn(async () => undefined),
      count: vi.fn(async () => storedJobs),
    },
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

const mountRail = (layout, props = {}) =>
  mount(AppNavbar, {
    props: { layout, ...props },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })

const tab = (wrapper, id) => wrapper.find(`[data-tab="${id}"]`)

describe('AppNavbar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    storedJobs = 0
    useApplicationState().resetState()
    useCardLibraryPanel().close()
  })

  it('counts the jobs running on the Jobs button, and shows nothing when none are', async () => {
    const store = useJobsStore()
    await addJob('One')
    const job = await addJob('Two')
    await store.updateJob(job.id, { status: 'running' })

    const wrapper = mountRail(DEFAULT_LAYOUT)

    expect(wrapper.find('[data-action="jobs"] [data-rail-badge]').text()).toBe('1')
    expect(wrapper.find('[data-tab="outline"] [data-rail-badge]').exists()).toBe(false)
  })

  it('has a Jobs button only while there are jobs', async () => {
    const wrapper = mountRail(DEFAULT_LAYOUT)
    expect(wrapper.find('[data-action="jobs"]').exists()).toBe(false)

    const job = await addJob('One')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-action="jobs"]').exists()).toBe(true)

    await useJobsStore().deleteJob(job.id)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-action="jobs"]').exists()).toBe(false)
  })

  it('has the card library under the chats while roleplay is on, which opens it', async () => {
    expect(mountRail(DEFAULT_LAYOUT).find('[data-action="cards"]').exists()).toBe(false)

    // An empty library too: the button is how the first card comes in.
    useApplicationState().setExtension('roleplay', true)
    const wrapper = mountRail(DEFAULT_LAYOUT)
    const order = wrapper
      .findAll('[data-tab], [data-action="cards"]')
      .map(button => button.attributes('data-tab') || button.attributes('data-action'))
    expect(order.slice(0, 4)).toEqual(['outline', 'search', 'chats', 'cards'])

    await wrapper.find('[data-action="cards"]').trigger('click')
    expect(useCardLibraryPanel().visible.value).toBe(true)
    expect(useCardLibraryPanel().into.value).toBeNull()
  })

  it('has no card library with the AI off', () => {
    useApplicationState().setExtension('roleplay', true)
    useApplicationState().setAiEnabled(false)
    expect(mountRail(DEFAULT_LAYOUT).find('[data-action="cards"]').exists()).toBe(false)
  })

  it('has the Jobs button for jobs kept from before, before they are read in', async () => {
    storedJobs = 2
    await useJobsStore().countJobs()
    const wrapper = mountRail(DEFAULT_LAYOUT)
    expect(wrapper.find('[data-action="jobs"]').exists()).toBe(true)
  })

  it('opens and closes the jobs toast from the Jobs button, with or without a project', async () => {
    const { state, closed } = useJobsToast()
    closed()
    await addJob('One')
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
    expect(wrapper.emitted('select-tab')).toEqual([['chats'], ['narration']])
  })

  it('marks the list showing, and none while the sidebar is hidden', () => {
    const showing = mountRail({ ...DEFAULT_LAYOUT, sidebarTab: 'chats' })
    expect(tab(showing, 'chats').attributes('aria-pressed')).toBe('true')
    expect(tab(showing, 'outline').attributes('aria-pressed')).toBe('false')

    const hidden = mountRail({ ...DEFAULT_LAYOUT, sidebar: false, sidebarTab: 'chats' })
    expect(tab(hidden, 'chats').attributes('aria-pressed')).toBe('false')
  })

  it('has nothing for the panels: the editor and the chat hide each other', async () => {
    await addJob('One')
    const wrapper = mountRail(DEFAULT_LAYOUT)
    expect(wrapper.findAll('button')).toHaveLength(7)
    expect(wrapper.find('[data-panel]').exists()).toBe(false)
  })

  it('has no chats and no narration with the AI switched off', () => {
    useApplicationState().setAiEnabled(false)
    const wrapper = mountRail(DEFAULT_LAYOUT)

    expect(wrapper.findAll('[data-tab]').map(button => button.attributes('data-tab'))).toEqual([
      'outline',
      'search',
      'comments',
    ])
  })

  it('has no projects list: they are switched from the outline', () => {
    const wrapper = mountRail(DEFAULT_LAYOUT)
    expect(tab(wrapper, 'projects').exists()).toBe(false)
  })

  it('offers only the jobs and the settings with no project open', async () => {
    const wrapper = mountRail(NO_PROJECT_LAYOUT, { hasStory: false })

    expect(wrapper.find('[aria-pressed="true"]').exists()).toBe(false)
    expect(tab(wrapper, 'outline').attributes('aria-disabled')).toBe('true')
    expect(tab(wrapper, 'chats').attributes('aria-disabled')).toBe('true')
    expect(tab(wrapper, 'narration').attributes('aria-disabled')).toBe('true')

    await tab(wrapper, 'outline').trigger('click')
    expect(wrapper.emitted('select-tab')).toBeUndefined()

    await wrapper.find('[data-action="settings"]').trigger('click')
    expect(wrapper.emitted('open-settings')).toHaveLength(1)
  })
})
