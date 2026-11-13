import { describe, it, expect, beforeEach, vi } from 'vitest'

const jobs = vi.hoisted(() => ({
  planExploring: vi.fn(),
  exploreAndWait: vi.fn(),
  exploreNode: vi.fn(),
}))
vi.mock('@/jobs/index.js', () => jobs)
const asking = vi.hoisted(() => ({ value: true, set: vi.fn() }))
vi.mock('@/composables/useApplicationState.js', () => ({
  useApplicationState: () => ({
    askBeforeExploring: { value: asking.value },
    setAskBeforeExploring: asking.set,
  }),
}))

const { ASK_FROM_TOKENS, exploreNow, exploreQuestion, exploredName, tokenCount } = await import(
  '@/composables/useExplore.js'
)

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
