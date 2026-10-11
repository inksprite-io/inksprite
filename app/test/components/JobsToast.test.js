import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import JobsToast from '@/components/writer/jobs/JobsToast.vue'
import { formatElapsed, progressOf } from '@/composables/useJobs.js'
import { useJobsToast } from '@/composables/useJobsToast.js'

const jobs = ref([])
const activity = reactive({})
const actions = {
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
  load: vi.fn(),
  openResult: vi.fn(async () => true),
}
const router = { push: vi.fn() }
vi.mock('vue-router', () => ({ useRouter: () => router }))
const projects = { s1: 'Rulebooks', s2: 'Novel' }
vi.mock('@/composables/useJobs.js', async importOriginal => {
  const original = await importOriginal()
  return {
    ...original,
    useJobs: () => ({
      jobs,
      ...actions,
      progressOf: original.progressOf,
      projectOf: job => projects[job.storyId],
      activity,
    }),
  }
})

const job = (status, steps, extra = {}) => ({
  id: `job_${status}`,
  storyId: 's1',
  kind: 'convert',
  workflow: 'convert',
  title: 'Convert Rules to Markdown',
  status,
  steps,
  created: 1,
  updated: 1,
  ...extra,
})

const mountToast = () => mount(JobsToast, { global: { plugins: [PrimeVue, ToastService] } })

describe('the jobs toast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jobs.value = []
    for (const id of Object.keys(activity)) delete activity[id]
  })

  it('opens when a job starts, and opens and closes from the rail', () => {
    const toast = useJobsToast()
    toast.closed()
    toast.show()
    expect(toast.state.open).toBe(true)
    toast.toggle()
    expect(toast.state.open).toBe(false)
    toast.toggle()
    toast.closed()
    expect(toast.state.open).toBe(false)
  })

  it('reads the jobs in, and says there are none when there are none', () => {
    const wrapper = mountToast()
    expect(actions.load).toHaveBeenCalled()
    expect(wrapper.find('[data-jobs-empty]').text()).toBe('No running jobs')
    expect(wrapper.find('[data-jobs-running]').exists()).toBe(false)
  })

  it('shows every job with its project, progress and what it is doing, and one spinner a job', () => {
    jobs.value = [
      job('running', [
        { id: 'a', label: 'Pages 1–8', status: 'done' },
        { id: 'b', label: 'Pages 9–16', status: 'running' },
        { id: 'c', label: 'Pages 17–24', status: 'pending' },
      ]),
      { ...job('done', [{ id: 'a', label: 'a', status: 'done' }]), storyId: 's2', elapsed: 65000 },
    ]
    const wrapper = mountToast()

    expect(wrapper.find('[data-jobs-running]').text()).toBe('1 running')
    const where = id => wrapper.find(`[data-job-id="${id}"] [data-job-where]`).text()
    expect(where('job_running')).toBe('Rulebooks · 1 of 3 steps done')
    expect(where('job_done')).toBe('Novel · 1 of 1 step done in 1m 05s')
    expect(wrapper.find('[data-job-id="job_running"] [data-job-status-line]').text()).toContain(
      'Pages 9–16'
    )
    // The header has no spinner of its own; the running job's line has one.
    expect(wrapper.findAll('.pi-spinner')).toHaveLength(1)
  })

  it('offers pause while running, resume when paused, retry when failed, clear when over', async () => {
    jobs.value = [
      job('running', [{ id: 'a', label: 'a', status: 'running' }]),
      job('paused', [{ id: 'a', label: 'a', status: 'pending' }]),
      job('failed', [{ id: 'a', label: 'a', status: 'failed' }], { error: 'flaky' }),
      job('done', [{ id: 'a', label: 'a', status: 'done' }]),
      job('cancelled', [{ id: 'a', label: 'a', status: 'pending' }]),
    ]
    const wrapper = mountToast()
    const labels = id =>
      wrapper
        .find(`[data-job-id="${id}"]`)
        .findAll('button')
        .map(button => button.text())

    expect(labels('job_running')).toEqual(['Pause', 'Cancel'])
    expect(labels('job_paused')).toEqual(['Resume', 'Cancel'])
    expect(labels('job_failed')).toEqual(['Retry', 'Cancel'])
    expect(labels('job_done')).toEqual(['Clear'])
    expect(labels('job_cancelled')).toEqual(['Clear'])
    expect(wrapper.find('[data-job-error]').text()).toBe('flaky')

    const click = async (id, at) =>
      wrapper.find(`[data-job-id="${id}"]`).findAll('button')[at].trigger('click')
    await click('job_running', 0)
    expect(actions.pause).toHaveBeenCalledWith('job_running')
    await click('job_failed', 0)
    expect(actions.resume).toHaveBeenCalledWith('job_failed')
    await click('job_paused', 1)
    expect(actions.cancel).toHaveBeenCalledWith('job_paused')
    await click('job_done', 0)
    expect(actions.remove).toHaveBeenCalledWith('job_done')
  })

  it('says how far a job got the same way before and after it is done', () => {
    jobs.value = [
      job(
        'paused',
        [
          { id: 'a', label: 'a', status: 'done' },
          { id: 'b', label: 'b', status: 'pending' },
        ],
        { elapsed: 5000 }
      ),
      job('done', [
        { id: 'a', label: 'a', status: 'done' },
        { id: 'b', label: 'b', status: 'done' },
      ]),
    ]
    const wrapper = mountToast()
    const where = id => wrapper.find(`[data-job-id="${id}"] [data-job-where]`).text()

    expect(where('job_paused')).toBe('Rulebooks · 1 of 2 steps done · 5s')
    expect(where('job_done')).toBe('Rulebooks · 2 of 2 steps done')
  })

  it('opens what a finished job wrote, in its project', async () => {
    jobs.value = [
      job('done', [{ id: 'a', label: 'a', status: 'done' }], { resultId: 'doc_copy' }),
      { ...job('cancelled', [{ id: 'a', label: 'a', status: 'pending' }]) },
    ]
    const wrapper = mountToast()

    expect(
      wrapper.find('[data-job-id="job_cancelled"] [data-action="open-job-result"]').exists()
    ).toBe(false)
    await wrapper.find('[data-job-id="job_done"] [data-action="open-job-result"]').trigger('click')
    await flushPromises()

    expect(actions.openResult).toHaveBeenCalledWith(expect.objectContaining({ id: 'job_done' }))
    expect(router.push).toHaveBeenCalledWith('/project/s1')
  })

  it('stays where it is when what the job wrote has since been deleted', async () => {
    actions.openResult.mockResolvedValueOnce(false)
    jobs.value = [job('done', [{ id: 'a', label: 'a', status: 'done' }], { resultId: 'doc_gone' })]
    const wrapper = mountToast()

    await wrapper.find('[data-action="open-job-result"]').trigger('click')
    await flushPromises()

    expect(router.push).not.toHaveBeenCalled()
  })

  it('asks to be closed from its own button', async () => {
    const wrapper = mountToast()
    await wrapper.find('[data-action="close-jobs-toast"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('measures progress as steps done over steps in all, and says a length of time', () => {
    expect(
      progressOf(job('running', [{ status: 'done' }, { status: 'done' }, { status: 'pending' }]))
    ).toEqual({ done: 2, total: 3, fraction: 2 / 3 })
    expect(formatElapsed(45000)).toBe('45s')
    expect(formatElapsed(3720000)).toBe('1h 02m')
  })
})
