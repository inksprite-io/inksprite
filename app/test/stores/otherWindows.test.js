import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useStoriesStore } from '@/stores/storiesStore'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useProjectViewsStore } from '@/stores/projectViewsStore.js'
import { useAIPromptStore } from '@/stores/aiPromptStore'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

// The stores, after another window of the app changed what they hold: the
// database as that window left it.
const db = vi.hoisted(() => ({
  stories: /** @type {any[]} */ ([]),
  documents: /** @type {any[]} */ ([]),
  projectViews: /** @type {any[]} */ ([]),
  aiPrompts: /** @type {any[]} */ ([]),
}))
vi.mock('@/stores/db', () => ({
  default: {
    stories: {
      toArray: vi.fn(async () => db.stories),
      get: vi.fn(async id => db.stories.find(story => story.id === id)),
    },
    documents: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
      bulkGet: vi.fn(async ids => ids.map(id => db.documents.find(row => row.id === id))),
    },
    projectViews: { toArray: vi.fn(async () => db.projectViews) },
    aiPrompts: { toArray: vi.fn(async () => db.aiPrompts) },
  },
}))

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn(), processSync: vi.fn() }),
}))

// What the other windows tell this one, and which projects it holds.
const windows = vi.hoisted(() => ({
  /** @type {Map<string, Function>} */
  tables: new Map(),
  held: /** @type {string[]} */ ([]),
}))
vi.mock('@/platform/windows.js', async importOriginal => ({
  ...(await importOriginal()),
  onTablesWritten: (tables, reload) => {
    for (const table of tables) windows.tables.set(table, reload)
    return () => {}
  },
  heldProjects: () => windows.held,
}))

/** Another window wrote rows of a table. */
const writtenElsewhere = table => windows.tables.get(table)?.()

const story = (id, fields = {}) => ({ id, version: 1, created: 1, updated: 1, ...fields })
const root = (storyId, title) => ({
  id: rootIdFor(storyId),
  storyId,
  parentId: storyId,
  type: 'folder',
  title,
})

beforeEach(() => {
  setActivePinia(createPinia())
  db.stories = []
  db.documents = []
  db.projectViews = []
  db.aiPrompts = []
  windows.tables.clear()
  windows.held = []
})

describe('the list of projects, read again', () => {
  it('takes the projects come and gone and their records, but leaves the one open here', async () => {
    db.stories = [story('s1'), story('s2', { overview: 'Here' })]
    const stories = useStoriesStore()
    await stories.ensureInitialized()

    db.stories = [
      story('s2', { overview: 'Changed there' }),
      story('s3'),
      story('s4', { overview: 'Gone from here' }),
    ]
    stories.stories.delete('s4')
    stories.stories.set('s4', story('s4', { overview: 'Open here' }))
    await stories.refresh(['s4'])

    expect([...stories.stories.keys()].sort()).toEqual(['s2', 's3', 's4'])
    expect(stories.getStory('s2').overview).toBe('Changed there')
    expect(stories.getStory('s4').overview).toBe('Open here')
  })

  it('takes the names of the projects other windows renamed', async () => {
    db.documents = [root('s1', 'First')]
    const documents = useDocumentsStore()
    await documents.loadRoots(['s1'])

    db.documents = [root('s1', 'Renamed')]
    await documents.loadRoots(['s1'])
    expect(documents.getRoot('s1').title).toBe('First')
    await documents.refreshRoots(['s1'])
    expect(documents.getRoot('s1').title).toBe('Renamed')
  })
})

describe('a project taken up afresh', () => {
  it('has its record and root as the database has them now', async () => {
    db.stories = [story('s1')]
    db.documents = [root('s1', 'Mine')]
    const stories = useStoriesStore()
    const documents = useDocumentsStore()
    await stories.ensureInitialized()
    await documents.loadRoots(['s1'])

    db.stories = [story('s1', { overview: 'Written in another window' })]
    db.documents = [root('s1', 'Renamed there')]
    await stories.readAfresh('s1')

    expect(stories.getStory('s1').overview).toBe('Written in another window')
    expect(documents.getRoot('s1').title).toBe('Renamed there')
  })

  it('keeps a project this window made and has yet to save', async () => {
    const stories = useStoriesStore()
    const made = await stories.createStory('New')

    await stories.readAfresh(made.id)
    expect(stories.getStory(made.id)).toEqual(made)
    expect(useDocumentsStore().getRoot(made.id)?.title).toBe('New')
  })
})

describe('what another window wrote of the app’s own tables', () => {
  it('is read again once read here', async () => {
    db.aiPrompts = [{ id: 'p1', name: 'One' }]
    const prompts = useAIPromptStore()
    await prompts.ensureInitialized()

    db.aiPrompts = [{ id: 'p2', name: 'Two' }]
    await writtenElsewhere('aiPrompts')
    expect([...prompts.prompts.values()].map(prompt => prompt.name)).toEqual(['Two'])
  })

  it('keeps where this window is in the projects it has open', async () => {
    db.projectViews = [
      { id: 's1', layout: { chat: false }, updated: 1 },
      { id: 's2', layout: { chat: false }, updated: 1 },
    ]
    const views = useProjectViewsStore()
    await views.ensureInitialized()
    views.updateView('s1', { layout: { chat: true } })
    windows.held = ['s1']

    db.projectViews = [
      { id: 's1', layout: { chat: false }, updated: 2 },
      { id: 's2', layout: { chat: true }, updated: 2 },
    ]
    await writtenElsewhere('projectViews')
    expect(views.getView('s1').layout).toEqual({ chat: true })
    expect(views.getView('s2').layout).toEqual({ chat: true })
  })
})
