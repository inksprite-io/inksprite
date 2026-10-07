import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import MobileTopBar from '@/components/writer/layout/MobileTopBar.vue'
import { useJobsStore } from '@/stores/jobsStore.js'
import { useJobsToast } from '@/composables/useJobsToast.js'

vi.mock('@/stores/db', () => ({ default: { jobs: { put: vi.fn(async () => undefined) } } }))

const mountBar = props => mount(MobileTopBar, { props: { activeMobileTab: 'write', ...props } })

describe('MobileTopBar', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('is made of named buttons, one of them pressed', () => {
    const wrapper = mountBar({ hasStory: true })
    const buttons = wrapper.findAll('button')

    expect(buttons.map(button => button.attributes('aria-label'))).toEqual([
      'Write',
      'Outline',
      'Chat',
      'Narration',
      'Jobs',
      'Settings',
    ])
    expect(wrapper.find('[data-tab="write"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-tab="chat"]').attributes('aria-pressed')).toBe('false')
  })

  it('asks for the view picked', async () => {
    const wrapper = mountBar({ hasStory: true })
    await wrapper.find('[data-tab="outline"]').trigger('click')
    expect(wrapper.emitted('update:activeMobileTab')).toEqual([['outline']])
  })

  it('offers only the writing view, which says there is no project, and the settings with no project open', async () => {
    const wrapper = mountBar({ hasStory: false, activeMobileTab: 'settings' })

    expect(wrapper.find('[data-tab="outline"]').attributes('aria-disabled')).toBe('true')
    expect(wrapper.find('[data-tab="write"]').attributes('aria-disabled')).toBeUndefined()

    await wrapper.find('[data-tab="outline"]').trigger('click')
    expect(wrapper.emitted('update:activeMobileTab')).toBeUndefined()

    await wrapper.find('[data-tab="write"]').trigger('click')
    expect(wrapper.emitted('update:activeMobileTab')).toEqual([['write']])
  })

  it('opens and closes the jobs toast, with the running count on its button', async () => {
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
    const jobs = wrapper.find('[data-action="jobs"]')
    expect(jobs.find('[data-rail-badge]').exists()).toBe(false)

    await store.updateJob(job.id, { status: 'running' })
    await wrapper.vm.$nextTick()
    expect(jobs.find('[data-rail-badge]').text()).toBe('1')

    await jobs.trigger('click')
    expect(state.open).toBe(true)
    expect(jobs.attributes('aria-pressed')).toBe('true')
    await jobs.trigger('click')
    expect(state.open).toBe(false)
    expect(wrapper.emitted('update:activeMobileTab')).toBeUndefined()
  })
})
