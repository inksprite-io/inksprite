import { describe, it, expect, beforeEach, vi } from 'vitest'

const jobs = vi.hoisted(() => ({
  planExploring: vi.fn(),
  startExplore: vi.fn(),
  exploreAndWait: vi.fn(),
  exploreNode: vi.fn(),
}))
vi.mock('@/jobs/index.js', () => jobs)
const show = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useJobsToast.js', () => ({ useJobsToast: () => ({ show }) }))
const asking = vi.hoisted(() => ({ value: true, set: vi.fn() }))
vi.mock('@/composables/useApplicationState.js', () => ({
  useApplicationState: () => ({
    askBeforeExploring: { value: asking.value },
    setAskBeforeExploring: asking.set,
  }),
}))

const { ASK_FROM_TOKENS, askToExplore, exploreNow, exploreQuestion, exploredName, tokenCount } =
  await import('@/composables/useExplore.js')

/** A plan of so many steps over so many documents and characters. */
const plan = (steps, documents, chars) => ({
  plan: { rootId: 'f', budget: 48000, work: {} },
  steps: Array.from({ length: steps }, (_, at) => ({ id: `s${at}`, label: '', status: 'pending' })),
  documents,
  chars,
})

describe('how much exploring reads', () => {
  it('counts tokens the way the question says them', () => {
    expect(tokenCount(812)).toBe('800')
    expect(tokenCount(9_981)).toBe('10k')
    expect(tokenCount(12)).toBe('100')
    expect(tokenCount(12_400)).toBe('12k')
    expect(tokenCount(1_520_000)).toBe('1.5M')
    expect(tokenCount(2_000_000)).toBe('2M')
  })

  it('asks what it would explore, and about how many tokens', () => {
    const notes = { id: 'n', path: 'Notes', type: 'folder', title: 'Notes', children: [] }
    expect(exploreQuestion(notes, plan(34, 60, 240_000))).toBe('Explore Notes/ (~60k tokens)?')
    expect(exploreQuestion({ ...notes, path: '/' }, plan(34, 60, 6_000_000))).toBe(
      'Explore the project (~1.5M tokens)?'
    )
  })
})

describe('askToExplore', () => {
  /** The question asked, and the answer the writer gives it. */
  let asked
  const answering = yes => options => {
    asked = options
    if (yes) options.accept()
    else options.reject()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    asked = null
    asking.value = true
    jobs.exploreNode.mockReturnValue({
      id: 'f',
      path: 'Research',
      title: 'Research',
      type: 'folder',
      children: [],
    })
    jobs.planExploring.mockResolvedValue(plan(3, 5, 40_000))
    jobs.startExplore.mockResolvedValue({ id: 'job_1' })
  })

  it('starts a small one without asking, and shows the jobs', async () => {
    const require = vi.fn()
    const outcome = await askToExplore('s1', 'f', { require })

    // Outside a chat, on the model a new chat runs on.
    expect(jobs.planExploring).toHaveBeenCalledWith('f')
    expect(require).not.toHaveBeenCalled()
    expect(jobs.startExplore).toHaveBeenCalledWith(
      's1',
      'f',
      expect.objectContaining({ documents: 5 })
    )
    expect(outcome).toMatchObject({ job: { id: 'job_1' } })
    expect(show).toHaveBeenCalled()
  })

  it('asks about a large one with what it costs, then starts it', async () => {
    jobs.planExploring.mockResolvedValue(plan(34, 60, (ASK_FROM_TOKENS + 10_000) * 4))
    const outcome = await askToExplore('s1', 'f', { require: answering(true) })

    expect(asked.header).toBe('Explore Research/ (~60k tokens)?')
    expect(asked.message).toBeUndefined()
    expect(outcome).toMatchObject({ job: { id: 'job_1' } })
  })

  it('starts nothing when the writer says no', async () => {
    jobs.planExploring.mockResolvedValue(plan(34, 60, (ASK_FROM_TOKENS + 10_000) * 4))
    expect(await askToExplore('s1', 'f', { require: answering(false) })).toEqual({ declined: true })
    expect(jobs.startExplore).not.toHaveBeenCalled()
  })

  it('asks nothing about a large one once the writer has said to always allow it', async () => {
    asking.value = false
    jobs.planExploring.mockResolvedValue(plan(34, 60, (ASK_FROM_TOKENS + 10_000) * 4))
    const require = vi.fn()

    expect(await askToExplore('s1', 'f', { require })).toMatchObject({ job: { id: 'job_1' } })
    expect(require).not.toHaveBeenCalled()
  })

  it('does nothing when there is nothing to do', async () => {
    jobs.planExploring.mockResolvedValue(plan(0, 0, 0))
    const require = vi.fn()

    expect(await askToExplore('s1', 'f', { require })).toEqual({ nothing: true })
    expect(require).not.toHaveBeenCalled()
    expect(jobs.startExplore).not.toHaveBeenCalled()
  })
})

describe('exploredName', () => {
  it('calls a folder by its path and a slash, a document by its path, the root the project', () => {
    expect(exploredName({ path: 'Notes', type: 'folder' })).toBe('Notes/')
    expect(exploredName({ path: 'Notes/Elara', type: 'text' })).toBe('Notes/Elara')
    expect(exploredName({ path: '/', type: 'folder' })).toBe('the project')
  })
})

describe('exploreNow', () => {
  const tokens = n => n * 4

  beforeEach(() => {
    vi.clearAllMocks()
    jobs.exploreNode.mockReturnValue({ id: 'f', path: 'Research', type: 'folder', children: [] })
    asking.value = true
    jobs.exploreAndWait.mockImplementation(async (storyId, id, planned, { progress }) => {
      progress(0, planned.steps.length)
      progress(planned.steps.length, planned.steps.length)
      return {}
    })
  })

  it('explores on the model of the chat that asks', async () => {
    jobs.planExploring.mockResolvedValue(plan(2, 5, 8000))
    const preset = { id: 'preset_chat', providerId: 'p1', model: 'chat-model' }

    expect(await exploreNow('s1', 'f', { preset })).toEqual({ done: true })
    expect(jobs.planExploring).toHaveBeenCalledWith('f', preset)
    // What was planned is what runs: the model goes with the plan.
    expect(jobs.exploreAndWait).toHaveBeenCalledWith(
      's1',
      'f',
      await jobs.planExploring.mock.results[0].value,
      expect.anything()
    )
  })

  it('explores what reads little without asking, saying how far it has got', async () => {
    jobs.planExploring.mockResolvedValue(plan(2, 5, tokens(ASK_FROM_TOKENS)))
    const approve = vi.fn()
    const progress = vi.fn()

    expect(await exploreNow('s1', 'f', { approve, progress })).toEqual({ done: true })
    expect(approve).not.toHaveBeenCalled()
    expect(progress.mock.calls.map(([said]) => said)).toEqual([
      '0 of 2 requests',
      '2 of 2 requests',
    ])
  })

  it('asks first about one that reads a lot, with what it costs', async () => {
    jobs.planExploring.mockResolvedValue(plan(34, 60, 6_000_000))
    const approve = vi.fn(async () => 'deny')

    expect(await exploreNow('s1', 'f', { approve })).toEqual({ declined: true })
    expect(approve).toHaveBeenCalledWith('Explore Research/ (~1.5M tokens)?')
    expect(jobs.exploreAndWait).not.toHaveBeenCalled()

    approve.mockResolvedValue('allow')
    expect(await exploreNow('s1', 'f', { approve })).toEqual({ done: true })
    expect(asking.set).not.toHaveBeenCalled()
  })

  it('stops asking when the writer says always, and asks nothing once it is off', async () => {
    jobs.planExploring.mockResolvedValue(plan(34, 60, 6_000_000))

    expect(await exploreNow('s1', 'f', { approve: async () => 'always' })).toEqual({ done: true })
    expect(asking.set).toHaveBeenCalledWith(false)

    asking.value = false
    const approve = vi.fn()
    expect(await exploreNow('s1', 'f', { approve })).toEqual({ done: true })
    expect(approve).not.toHaveBeenCalled()
  })

  it('does not start a big one with no way to ask', async () => {
    jobs.planExploring.mockResolvedValue(plan(34, 60, 6_000_000))
    expect(await exploreNow('s1', 'f')).toEqual({ declined: true })
    expect(jobs.exploreAndWait).not.toHaveBeenCalled()
  })

  it('is done at once when everything is current, and says why it stopped early', async () => {
    jobs.planExploring.mockResolvedValue(plan(0, 0, 0))
    expect(await exploreNow('s1', 'f')).toEqual({ done: true })
    expect(jobs.exploreAndWait).not.toHaveBeenCalled()

    jobs.planExploring.mockResolvedValue(plan(1, 1, 2000))
    jobs.exploreAndWait.mockResolvedValue({ error: 'Stopped.' })
    expect(await exploreNow('s1', 'f')).toEqual({ error: 'Stopped.' })
  })
})
