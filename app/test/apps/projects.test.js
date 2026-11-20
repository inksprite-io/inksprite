import { describe, it, expect, beforeEach, vi } from 'vitest'

const stories = vi.hoisted(() => ({
  /** @type {Map<string, object>} */
  known: new Map(),
  ensureInitialized: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}),
  readAfresh: vi.fn(async () => {}),
}))
vi.mock('@/stores/storiesStore', () => ({
  useStoriesStore: () => ({
    ensureInitialized: stories.ensureInitialized,
    refresh: stories.refresh,
    readAfresh: stories.readAfresh,
    getStory: id => stories.known.get(id) ?? null,
  }),
}))

const documents = vi.hoisted(() => ({
  /** @type {Map<string, object>} */
  roots: new Map(),
  refreshRoots: vi.fn(async () => {}),
  loadRoots: vi.fn(async () => {}),
}))
vi.mock('@/stores/documentsStore', () => ({
  useDocumentsStore: () => ({
    refreshRoots: documents.refreshRoots,
    loadRoots: documents.loadRoots,
    getRoot: id => documents.roots.get(id),
  }),
}))

const windows = vi.hoisted(() => ({
  heldProjects: vi.fn(() => []),
  holdsProject: vi.fn(() => false),
  takeProject: vi.fn(async () => ({ held: true, stale: false, first: false })),
  letGoOfProject: vi.fn(),
}))
vi.mock('@/platform/windows.js', () => windows)

import { findProject, inProject, projectsOf } from '@/apps/projects.js'

const app = (projects = ['story_a', 'story_b']) => ({
  id: 'app_1',
  name: 'Claude Code',
  projects,
  edit: 'suggesting',
  comment: true,
})

beforeEach(() => {
  vi.clearAllMocks()
  stories.known = new Map([
    ['story_a', { id: 'story_a' }],
    ['story_b', { id: 'story_b' }],
    ['story_c', { id: 'story_c' }],
  ])
  documents.roots = new Map([
    ['story_a', { title: 'Thief', summary: 'A heist in a walled city.' }],
    ['story_b', { title: ' Designs ', summary: '' }],
    ['story_c', { title: 'Private' }],
  ])
  windows.heldProjects.mockReturnValue([])
  windows.holdsProject.mockReturnValue(false)
  windows.takeProject.mockResolvedValue({ held: true, stale: false, first: false })
})

describe('projectsOf', () => {
  it('names the projects ticked for the app, and no other', async () => {
    expect(await projectsOf(app())).toEqual([
      { id: 'story_a', name: 'Thief', summary: 'A heist in a walled city.' },
      { id: 'story_b', name: 'Designs', summary: '' },
    ])
  })

  it('leaves out a project in the trash, and one that is gone', async () => {
    stories.known.set('story_b', { id: 'story_b', trashed: 5 })
    expect((await projectsOf(app(['story_a', 'story_b', 'story_gone']))).map(p => p.id)).toEqual([
      'story_a',
    ])
  })

  it('reads the list again for a project this window has not heard of', async () => {
    windows.heldProjects.mockReturnValue(['story_a'])
    stories.known.delete('story_b')
    stories.refresh.mockImplementation(async () => {
      stories.known.set('story_b', { id: 'story_b' })
    })

    expect((await projectsOf(app())).map(p => p.id)).toEqual(['story_a', 'story_b'])
    expect(stories.refresh).toHaveBeenCalledWith(['story_a'])
  })

  it('does not read the list again when it knows every project', async () => {
    await projectsOf(app())
    expect(stories.refresh).not.toHaveBeenCalled()
  })

  it('reads again the names of projects not in this window, which another may have changed', async () => {
    windows.holdsProject.mockImplementation(id => id === 'story_a')
    await projectsOf(app())
    expect(documents.refreshRoots).toHaveBeenCalledWith(['story_b'])
    expect(documents.loadRoots).toHaveBeenCalledWith(['story_a', 'story_b'])
  })

  it('calls a project with no name Untitled, and cuts a long summary', async () => {
    documents.roots.set('story_a', { title: '', summary: 'word '.repeat(400) })
    const [project] = await projectsOf(app(['story_a']))
    expect(project.name).toBe('Untitled')
    expect(project.summary.length).toBeLessThanOrEqual(601)
    expect(project.summary.endsWith('…')).toBe(true)
  })
})

describe('findProject', () => {
  it('finds a project by its name, whatever its case', async () => {
    expect(await findProject(app(), 'Thief')).toMatchObject({ id: 'story_a' })
    expect(await findProject(app(), ' designs ')).toMatchObject({ id: 'story_b' })
  })

  it('takes the only project when none is named', async () => {
    expect(await findProject(app(['story_b']), undefined)).toMatchObject({ id: 'story_b' })
    expect(await findProject(app(['story_b']), '')).toMatchObject({ id: 'story_b' })
  })

  it('asks which, by their names, when there are several and none is named', async () => {
    expect(await findProject(app(), undefined)).toEqual({
      error: 'Say which project. The projects are: "Thief", "Designs".',
    })
  })

  it('says a project not ticked for the app is not there, as one that does not exist is', async () => {
    const notTicked = await findProject(app(), 'Private')
    const noSuch = await findProject(app(), 'Nothing')
    expect(notTicked).toEqual({
      error: 'No project named "Private". The projects are: "Thief", "Designs".',
    })
    expect(noSuch.error).toBe(notTicked.error.replace('Private', 'Nothing'))
  })

  it('says where projects are ticked when the app has none', async () => {
    const found = await findProject(app([]), 'Thief')
    expect(found.error).toContain('No project is open to this connection')
    expect(found.error).toContain('Settings › Connections › Connected apps')
  })
})

describe('inProject', () => {
  it('holds the project while the work is done, and lets go after', async () => {
    const work = vi.fn(async () => {
      expect(windows.letGoOfProject).not.toHaveBeenCalled()
      return 'done'
    })

    expect(await inProject('story_a', work)).toEqual({ value: 'done' })

    const [storyId, reason] = windows.takeProject.mock.calls[0]
    expect(storyId).toBe('story_a')
    expect(reason).toMatch(/^app:\d+$/)
    expect(windows.letGoOfProject).toHaveBeenCalledWith('story_a', reason)
    expect(stories.readAfresh).not.toHaveBeenCalled()
  })

  it('reads the project afresh when this window had not had it', async () => {
    windows.takeProject.mockResolvedValue({ held: true, stale: false, first: true })
    const work = vi.fn(async () => {
      expect(stories.readAfresh).toHaveBeenCalledWith('story_a')
      return 1
    })
    expect(await inProject('story_a', work)).toEqual({ value: 1 })
  })

  it('passes when another window has the project', async () => {
    windows.takeProject.mockResolvedValue({ held: false, stale: false, first: false })
    const work = vi.fn()

    expect(await inProject('story_a', work)).toEqual({ pass: 'elsewhere' })
    expect(work).not.toHaveBeenCalled()
    expect(windows.letGoOfProject).not.toHaveBeenCalled()
  })

  it('passes, and lets go, when another window has had the project since', async () => {
    windows.takeProject.mockResolvedValue({ held: true, stale: true, first: false })
    const work = vi.fn()

    expect(await inProject('story_a', work)).toEqual({ pass: 'behind' })
    expect(work).not.toHaveBeenCalled()
    expect(windows.letGoOfProject).toHaveBeenCalledTimes(1)
  })

  it('lets go when the work fails', async () => {
    await expect(
      inProject('story_a', async () => {
        throw new Error('broke')
      })
    ).rejects.toThrow('broke')
    expect(windows.letGoOfProject).toHaveBeenCalledTimes(1)
  })

  it('does what is asked of one project one thing at a time, in the order asked', async () => {
    /** @type {string[]} */
    const order = []
    /** @type {() => void} */
    let finishFirst = () => {}
    const first = inProject('story_a', async () => {
      order.push('first starts')
      await new Promise(resolve => (finishFirst = resolve))
      order.push('first ends')
    })
    const second = inProject('story_a', async () => {
      order.push('second')
    })
    const other = inProject('story_b', async () => {
      order.push('another project')
    })

    await other
    expect(order).toEqual(['first starts', 'another project'])
    finishFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first starts', 'another project', 'first ends', 'second'])
  })

  it('goes on to the next when one fails', async () => {
    const failing = inProject('story_a', async () => {
      throw new Error('broke')
    })
    const next = inProject('story_a', async () => 'after')

    await expect(failing).rejects.toThrow('broke')
    expect(await next).toEqual({ value: 'after' })
  })
})
