/* global AbortController */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const jobs = vi.hoisted(() => ({ exploreNode: vi.fn() }))
vi.mock('@/jobs/index.js', () => jobs)

const explore = vi.hoisted(() => ({ exploreNow: vi.fn() }))
vi.mock('@/composables/useExplore.js', async importOriginal => ({
  ...(await importOriginal()),
  ...explore,
}))

const documents = vi.hoisted(() => ({
  documentForChat: vi.fn(),
  executeListDocuments: vi.fn(),
}))
vi.mock('@/ai/tools/documents.js', async importOriginal => ({
  ...(await importOriginal()),
  ...documents,
}))

const { executeExploreDocuments, exploreFor, exploredText, outline } = await import(
  '@/ai/tools/explore.js'
)

/** The tree as the tools see it: a path for each id, and a digest where there is one. */
const tree = {
  root: { id: 'root', path: '/', type: 'folder', digest: 'A novel and its notes.' },
  notes: { id: 'notes', path: 'Notes', type: 'folder', digest: 'The cast, one entry each.' },
  elara: { id: 'elara', path: 'Notes/Elara', type: 'text', digest: 'A knight of the north.' },
  code: { id: 'code', path: 'Code', type: 'folder', leftOut: 'a codebase' },
}

/** @param {string} path */
const byPath = path =>
  Object.values(tree).find(
    entry => entry.path === path.replace(/\/$/, '') || (path === '/' && entry.id === 'root')
  )

describe('explore_documents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    documents.documentForChat.mockImplementation(async (storyId, chatId, path) => {
      const entry = byPath(path)
      if (!entry) return null
      return {
        document: {
          id: entry.id,
          ...(entry.digest ? { digest: { line: '', text: entry.digest, of: 'x', made: 1 } } : {}),
        },
        path: entry.path,
      }
    })
    jobs.exploreNode.mockImplementation(id => {
      const entry = Object.values(tree).find(one => one.id === id)
      return entry ? { ...entry, children: [] } : null
    })
    explore.exploreNow.mockResolvedValue({ done: true })
    documents.executeListDocuments.mockResolvedValue('Notes/Elara — 5 words\n  A knight.')
  })

  it('explores a folder, shows the writer what came of it, and answers with the same', async () => {
    const show = vi.fn()
    const preset = { id: 'preset_chat', providerId: 'p1', model: 'chat-model' }
    const context = {
      storyId: 's1',
      chatId: 'c1',
      show,
      signal: new AbortController().signal,
      preset,
    }

    const answer = await executeExploreDocuments({ path: 'Notes' }, context)

    // On the model the chat runs on.
    expect(explore.exploreNow).toHaveBeenCalledWith('s1', 'notes', {
      signal: context.signal,
      progress: undefined,
      approve: undefined,
      preset,
    })
    expect(documents.executeListDocuments).toHaveBeenCalledWith({ path: 'Notes' }, context)
    expect(answer).toEqual({
      path: 'Notes/',
      about: 'The cast, one entry each.',
      listing: 'Notes/Elara — 5 words\n  A knight.',
      note: 'The user sees this too.',
    })
    expect(show).toHaveBeenCalledWith({
      title: 'Explored Notes/',
      icon: 'pi-compass',
      text: 'The cast, one entry each.',
      more: { title: 'Listing', text: 'Notes/Elara — 5 words\n  A knight.' },
    })
  })

  it('explores the whole project when it is given no path, and one document alone', async () => {
    const show = vi.fn()
    expect(await executeExploreDocuments({}, { storyId: 's1', show })).toMatchObject({
      path: '/',
      about: 'A novel and its notes.',
    })
    expect(show).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Explored the project' })
    )

    const one = await executeExploreDocuments({ path: 'Notes/Elara' }, { storyId: 's1', show })
    expect(one).toEqual({
      path: 'Notes/Elara',
      about: 'A knight of the north.',
      note: 'The user sees this too.',
    })
    expect(show).toHaveBeenLastCalledWith(expect.not.objectContaining({ more: expect.anything() }))
  })

  it('answers for a document with its sections, a line on each long one', async () => {
    documents.documentForChat.mockImplementation(async (storyId, chatId, path) => ({
      document: {
        id: 'elara',
        content: '# Early life\n\nThe docks.\n\n# The Gull\n\nHer ship.',
        digest: {
          line: '',
          text: 'A knight of the north.',
          of: 'x',
          made: 1,
          sections: [{ link: 'the-gull', line: 'Her ship, and the hold in it.' }],
        },
      },
      path,
    }))
    const show = vi.fn()

    const answer = await executeExploreDocuments({ path: 'Notes/Elara' }, { storyId: 's1', show })

    // Only what was described: describe_document gives the whole tree.
    expect(answer.sections).toEqual([
      { link: 'the-gull', title: 'The Gull', words: 5, about: 'Her ship, and the hold in it.' },
    ])
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({
        more: { title: 'Sections', text: 'The Gull — Her ship, and the hold in it.' },
      })
    )
  })

  it('gives no sections for a document none of whose sections is long', async () => {
    documents.documentForChat.mockImplementation(async (storyId, chatId, path) => ({
      document: {
        id: 'elara',
        content: '# Early life\n\nThe docks.',
        digest: { line: '', text: 'A knight.', of: 'x', made: 1 },
      },
      path,
    }))

    const answer = await executeExploreDocuments({ path: 'Notes/Elara' }, { storyId: 's1' })

    expect(answer).not.toHaveProperty('sections')
  })

  it('says when the user would not have it, or could not be asked', async () => {
    explore.exploreNow.mockResolvedValue({ declined: true })

    expect(
      await executeExploreDocuments({ path: 'Notes' }, { storyId: 's1', approve: vi.fn() })
    ).toEqual({ error: 'The user chose not to explore it.' })
    expect(await executeExploreDocuments({ path: 'Notes' }, { storyId: 's1' })).toEqual({
      error: 'It reads too much to explore without asking the user.',
    })
  })

  it('names what it cannot explore, and why it stopped', async () => {
    const show = vi.fn()
    expect(await executeExploreDocuments({ path: 'Nowhere' }, { storyId: 's1', show })).toEqual({
      error: 'There is nothing at "Nowhere".',
    })
    expect(await executeExploreDocuments({ path: 'Code' }, { storyId: 's1', show })).toEqual({
      error: '"Code" is a codebase, which explore leaves out.',
    })

    explore.exploreNow.mockResolvedValue({ error: 'Stopped.' })
    expect(await executeExploreDocuments({ path: 'Notes' }, { storyId: 's1', show })).toEqual({
      error: 'Stopped. What it had described is kept; exploring again goes on.',
    })
    expect(show).not.toHaveBeenCalled()
  })
})

describe('what /explore puts in the writer’s turn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    explore.exploreNow.mockResolvedValue({ done: true })
  })

  it('lays a document’s sections out by depth', () => {
    expect(
      outline([
        {
          link: 'a',
          title: 'Spells',
          words: 900,
          about: 'Every spell.',
          sections: [{ link: 'b', title: 'Fire', words: 30, entries: 40, range: 'Ash … Ember' }],
        },
      ])
    ).toBe('Spells — Every spell.\n  Fire (40 entries: Ash … Ember)')
  })

  it('is the paragraph, and what a folder holds under it', () => {
    expect(exploredText({ path: 'Notes/Elara', name: 'Notes/Elara', about: 'A knight.' })).toBe(
      'A knight.'
    )
    expect(
      exploredText({ path: 'Notes/', name: 'Notes/', about: 'The cast.', listing: 'Notes/Elara' })
    ).toBe('The cast.\n\n```\nNotes/Elara\n```')
  })

  it('has no project to explore outside one', async () => {
    expect(await exploreFor('', {})).toEqual({ error: 'There is no project to explore.' })
  })
})
