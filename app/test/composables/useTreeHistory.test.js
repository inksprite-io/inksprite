import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDocuments, clearDocumentInstances } from '@/composables/useDocuments'
import { LIMIT, undoKeyOf, useTreeHistory } from '@/composables/useTreeHistory.js'
import { useDocumentsStore } from '@/stores/documentsStore'

vi.mock('@/stores/db', () => ({
  default: {
    documents: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
    },
    stories: { toArray: vi.fn(async () => []) },
  },
}))

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

vi.mock('@/composables/useEditor.js', () => ({
  useEditor: () => ({
    holds: () => false,
    markdown: () => '',
    close: vi.fn(),
    discard: vi.fn(),
    focus: vi.fn(),
  }),
}))

vi.mock('@/stores/storiesStore', () => ({
  useStoriesStore: () => ({
    getStory: id => (id === 'story_1' ? { id, title: 'My Novel' } : null),
    freeName: title => title,
  }),
}))

vi.mock('@/stores/projectViewsStore.js', () => ({
  useProjectViewsStore: () => ({
    ensureInitialized: async () => {},
    getView: () => undefined,
    updateView: vi.fn(),
  }),
}))

describe('useTreeHistory', () => {
  /** @type {ReturnType<typeof useDocuments>} */
  let api
  /** @type {ReturnType<typeof useTreeHistory>} */
  let history

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    api = useDocuments('story_1')
    await api.init()
    const store = useDocumentsStore()
    for (const [id, ordered] of [
      ['manuscript_story_1', true],
      ['notes_story_1', false],
    ]) {
      store.createDocument({
        id,
        storyId: 'story_1',
        parentId: 'root_story_1',
        type: 'folder',
        title: id.split('_')[0],
        ordered,
      })
    }
    history = useTreeHistory('story_1')
  })

  const ids = folderId => api.childrenOf(folderId).map(child => child.id)

  it('starts with nothing to undo or redo, and is one history for the project', () => {
    expect(history.nextUndo()).toBeNull()
    expect(history.nextRedo()).toBeNull()
    expect(history.undo()).toBeNull()
    expect(useTreeHistory('story_1')).toBe(history)
  })

  describe('a rename', () => {
    it('is undone and redone', () => {
      const chapter = api.createTextDocument('notes_story_1', 'Elara')
      expect(history.rename(chapter.id, 'Mira')).toBe(true)
      expect(history.labelOf(history.nextUndo())).toBe('Rename “Mira”')

      expect(history.undo()).toEqual({ documentId: chapter.id, done: true })
      expect(api.get(chapter.id).title).toBe('Elara')
      expect(history.nextRedo()).not.toBeNull()

      history.redo()
      expect(api.get(chapter.id).title).toBe('Mira')
    })

    it('is not kept when it is refused, or changes nothing', () => {
      api.createTextDocument('notes_story_1', 'Mira')
      const chapter = api.createTextDocument('notes_story_1', 'Elara')

      expect(history.rename(chapter.id, 'Mira')).toBe(false)
      history.rename(chapter.id, 'Elara')
      expect(history.nextUndo()).toBeNull()
    })

    it('is let go of when the document has been renamed since', () => {
      const chapter = api.createTextDocument('notes_story_1', 'Elara')
      history.rename(chapter.id, 'Mira')
      api.rename(chapter.id, 'Vess')

      expect(history.undo()).toMatchObject({ done: false })
      expect(api.get(chapter.id).title).toBe('Vess')
      expect(history.nextUndo()).toBeNull()
      expect(history.nextRedo()).toBeNull()
    })
  })

  describe('a delete', () => {
    it('is undone out of the trash, and redone into it', () => {
      const folder = api.createFolder('notes_story_1', 'Places')
      const inside = api.createTextDocument(folder.id, 'Harbor')
      history.trash(folder.id)
      expect(api.get(inside.id)).toBeNull()

      history.undo()
      expect(api.get(folder.id)?.parentId).toBe('notes_story_1')
      expect(api.get(inside.id)?.parentId).toBe(folder.id)

      history.redo()
      expect(api.get(folder.id)).toBeNull()
      expect(api.trashed.value.map(doc => doc.id)).toEqual([folder.id])
    })

    it('is let go of once the trash has been emptied of it', () => {
      const chapter = api.createTextDocument('notes_story_1', 'Elara')
      history.trash(chapter.id)
      api.deleteTrashed(chapter.id)

      expect(history.undo()).toMatchObject({ done: false })
    })
  })

  describe('a document made', () => {
    it('is undone into the trash, and redone out of it', () => {
      const chapter = api.createTextDocument('notes_story_1', '')
      history.created(chapter.id)
      api.rename(chapter.id, 'Elara')

      expect(history.labelOf(history.nextUndo())).toBe('Create “Elara”')

      history.undo()
      expect(api.get(chapter.id)).toBeNull()
      expect(api.trashed.value.map(doc => doc.id)).toEqual([chapter.id])

      history.redo()
      expect(api.get(chapter.id)?.title).toBe('Elara')
    })

    it('is named for how it was made', () => {
      const chapter = api.createTextDocument('notes_story_1', 'Elara')
      history.created(chapter.id, 'Duplicate')
      expect(history.labelOf(history.nextUndo())).toBe('Duplicate “Elara”')
    })
  })

  describe('a move', () => {
    it('is one step for a drag, put back into its folder in its place and under its name', () => {
      const a = api.createTextDocument('manuscript_story_1', 'One')
      const b = api.createTextDocument('manuscript_story_1', 'Two')
      const c = api.createTextDocument('manuscript_story_1', 'Three')
      api.createTextDocument('notes_story_1', 'Two')

      history.beginMove(b.id)
      // A drag between folders writes both.
      api.reorder('manuscript_story_1', [a.id, c.id])
      api.reorder('notes_story_1', [...ids('notes_story_1'), b.id])
      history.endMove()
      expect(api.get(b.id).title).toBe('Two (2)')

      history.undo()
      expect(ids('manuscript_story_1')).toEqual([a.id, b.id, c.id])
      expect(api.get(b.id).title).toBe('Two')
      expect(history.nextUndo()).toBeNull()

      history.redo()
      expect(api.get(b.id)).toMatchObject({ parentId: 'notes_story_1', title: 'Two (2)' })
    })

    it('puts a new order in a folder back', () => {
      const a = api.createTextDocument('manuscript_story_1', 'One')
      const b = api.createTextDocument('manuscript_story_1', 'Two')

      history.beginMove(b.id)
      api.reorder('manuscript_story_1', [b.id, a.id])
      history.endMove()

      history.undo()
      expect(ids('manuscript_story_1')).toEqual([a.id, b.id])
      history.redo()
      expect(ids('manuscript_story_1')).toEqual([b.id, a.id])
    })

    it('keeps what has come into the folder since, and leaves out what has gone', () => {
      const a = api.createTextDocument('manuscript_story_1', 'One')
      const b = api.createTextDocument('manuscript_story_1', 'Two')
      const c = api.createTextDocument('manuscript_story_1', 'Three')

      history.beginMove(b.id)
      api.moveInto('notes_story_1', b.id)
      history.endMove()
      api.moveInto('notes_story_1', c.id)
      const d = api.createTextDocument('manuscript_story_1', 'Four')

      history.undo()
      expect(ids('manuscript_story_1')).toEqual([a.id, b.id, d.id])
      expect(api.get(c.id).parentId).toBe('notes_story_1')
    })

    it('cannot be undone into a folder that has gone', () => {
      const a = api.createTextDocument('manuscript_story_1', 'One')
      history.beginMove(a.id)
      api.moveInto('notes_story_1', a.id)
      history.endMove()
      useDocumentsStore().deleteDocument('manuscript_story_1')

      expect(history.undo()).toMatchObject({ done: false })
      expect(api.get(a.id).parentId).toBe('notes_story_1')
    })

    it('keeps nothing for a drag that changed nothing', () => {
      const a = api.createTextDocument('manuscript_story_1', 'One')
      history.beginMove(a.id)
      history.endMove()
      expect(history.nextUndo()).toBeNull()
    })

    it('is let go of when the document has been moved since', () => {
      const a = api.createTextDocument('manuscript_story_1', 'One')
      history.beginMove(a.id)
      api.moveInto('notes_story_1', a.id)
      history.endMove()
      api.moveInto('root_story_1', a.id)

      expect(history.undo()).toMatchObject({ done: false })
      expect(api.get(a.id).parentId).toBe('root_story_1')
    })
  })

  it('forgets what was undone once something new is done', () => {
    const chapter = api.createTextDocument('notes_story_1', 'Elara')
    history.rename(chapter.id, 'Mira')
    history.undo()
    history.rename(chapter.id, 'Vess')

    expect(history.nextRedo()).toBeNull()
  })

  it('keeps the last steps, so many and no more', () => {
    const chapter = api.createTextDocument('notes_story_1', 'Name 0')
    for (let at = 1; at <= LIMIT + 5; at++) history.rename(chapter.id, `Name ${at}`)

    let undone = 0
    while (history.undo()) undone++
    expect(undone).toBe(LIMIT)
    expect(api.get(chapter.id).title).toBe('Name 5')
  })
})

describe('undoKeyOf', () => {
  /** @param {Partial<KeyboardEvent>} fields */
  const key = fields => /** @type {KeyboardEvent} */ ({ ctrlKey: false, metaKey: false, ...fields })

  // The tests run off a Mac, so the key is Control's.
  it('reads Control-Z as undo, and Shift-Control-Z and Control-Y as redo', () => {
    expect(undoKeyOf(key({ key: 'z', ctrlKey: true }))).toBe('undo')
    expect(undoKeyOf(key({ key: 'Z', ctrlKey: true, shiftKey: true }))).toBe('redo')
    expect(undoKeyOf(key({ key: 'y', ctrlKey: true }))).toBe('redo')
  })

  it('reads nothing else', () => {
    expect(undoKeyOf(key({ key: 'z' }))).toBeNull()
    expect(undoKeyOf(key({ key: 'z', ctrlKey: true, altKey: true }))).toBeNull()
    expect(undoKeyOf(key({ key: 'x', ctrlKey: true }))).toBeNull()
  })
})
