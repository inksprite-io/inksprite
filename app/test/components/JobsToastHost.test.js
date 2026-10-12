import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import JobsToastHost from '@/components/writer/jobs/JobsToastHost.vue'
import { useJobsStore } from '@/stores/jobsStore.js'
import { useJobsToast } from '@/composables/useJobsToast.js'

vi.mock('@/stores/db', () => ({
  default: {
    jobs: { put: vi.fn(async () => undefined), bulkDelete: vi.fn(async () => undefined) },
  },
}))

const mountHost = () =>
  mount(JobsToastHost, {
    global: { plugins: [PrimeVue, ToastService], stubs: { Toast: true } },
  })

describe('JobsToastHost', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('puts the toast away once the last job is cleared', async () => {
    const { state, show, closed } = useJobsToast()
    closed()
    const store = useJobsStore()
    const plan = { storyId: 's1', kind: 'convert', workflow: 'convert', steps: [] }
    const one = await store.createJob({ ...plan, title: 'One' })
    const two = await store.createJob({ ...plan, title: 'Two' })
    const wrapper = mountHost()
    show()
    await wrapper.vm.$nextTick()

    await store.deleteJob(one.id)
    await wrapper.vm.$nextTick()
    expect(state.open).toBe(true)

    await store.deleteJob(two.id)
    await wrapper.vm.$nextTick()
    expect(state.open).toBe(false)
  })
})
