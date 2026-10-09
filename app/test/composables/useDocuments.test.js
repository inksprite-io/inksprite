import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reactive } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useDocuments, clearDocumentInstances } from '@/composables/useDocuments'
import { useDocumentsStore } from '@/stores/documentsStore'
import { settleMarkdown } from '@/editor/markdown.js'

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

const mockEditor = vi.hoisted(() => ({
  holds: vi.fn(() => false),
  markdown: vi.fn(() => ''),
  replaceContent: vi.fn(),
  appendContent: vi.fn(),
  close: vi.fn(),
  discard: vi.fn(),
  convert: vi.fn(),
  focus: vi.fn(),
}))
vi.mock('@/composables/useEditor.js', () => ({ useEditor: () => mockEditor }))

const mockStory = reactive({ id: 'story_1', title: 'My Novel', lastDocumentId: null })
const mockUpdateStory = vi.fn((_id, updates) => Object.assign(mockStory, updates))

/** A story as it was before tabs, or as it was left. */
const rememberStory = fields => {
  delete mockStory.openDocumentIds
  Object.assign(mockStory, { lastDocumentId: null }, fields)
}
vi.mock('@/stores/storiesStore', () => ({
  useStoriesStore: () => ({
    getStory: id => (id === 'story_1' ? mockStory : null),
    updateStory: mockUpdateStory,
  }),
}))

describe('useDocuments', () => {
  /** @type {ReturnType<typeof useDocuments>} */
  let api
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    vi.clearAllMocks()
    rememberStory({})

    store = useDocumentsStore()
    api = useDocuments('story_1')
    await api.init()

    // A project's folders come from the template it was created with, not from
    // init, so the tree these tests work in is laid down here.
    store.createDocument({
      id: 'manuscript_story_1',
      storyId: 'story_1',
      parentId: 'root_story_1',
      type: 'folder',
      title: 'manuscript',
      ordered: true,
    })
    store.createDocument({
      id: 'notes_story_1',
      storyId: 'story_1',
      parentId: 'root_story_1',
      type: 'folder',
      title: 'notes',
    })
  })

  describe('where content goes', () => {
    beforeEach(() => {
      mockEditor.holds.mockReturnValue(false)
      store.createDocument({
        id: 'sc_1',
        storyId: 'story_1',
        parentId: 'manuscript_story_1',
        type: 'text',
        title: 'Chapter 1',
        content: 'Snow fell.',
      })
    })

    it('writes the store when the document is not open', () => {
      api.setContent('sc_1', 'Rain fell.')
      expect(store.getDocument('sc_1').content).toBe('Rain fell.')
      expect(mockEditor.replaceContent).not.toHaveBeenCalled()
    })

    it('appends to the store as a block of its own when the document is not open', () => {
      api.appendContent('sc_1', 'Then hail.')
      expect(store.getDocument('sc_1').content).toBe('Snow fell.\n\nThen hail.')
      expect(mockEditor.appendContent).not.toHaveBeenCalled()
    })

    it('reads the body from the store when the document is not open', () => {
      expect(api.currentContent('sc_1')).toBe('Snow fell.')
      expect(api.currentContent('nobody')).toBe('')
    })

    it('reads the body from the editor when it holds the document, since the store lags it', () => {
      mockEditor.holds.mockImplementation(id => id === 'sc_1')
      mockEditor.markdown.mockReturnValue('Snow fell. And more, unflushed.')

      expect(api.currentContent('sc_1')).toBe('Snow fell. And more, unflushed.')
    })

    it('replaces one passage in the store when the document is not open', () => {
      expect(api.replaceText('sc_1', 'Snow', 'Rain')).toEqual({ applied: true, count: 1 })
      expect(store.getDocument('sc_1').content).toBe('Rain fell.')
    })

    it('replaces the passage in what the editor holds, through the editor', () => {
      mockEditor.holds.mockImplementation(id => id === 'sc_1')
      mockEditor.markdown.mockReturnValue('Snow fell. Then hail.')

      expect(api.replaceText('sc_1', 'hail', 'sleet')).toEqual({ applied: true, count: 1 })
      expect(mockEditor.replaceContent).toHaveBeenCalledWith('sc_1', 'Snow fell. Then sleet.')
      expect(store.getDocument('sc_1').content).toBe('Snow fell.')
    })

    it('changes nothing when the passage is missing or ambiguous', () => {
      expect(api.replaceText('sc_1', 'Rain', 'x')).toEqual({ applied: false, count: 0 })
      expect(api.replaceText('sc_1', '', 'x')).toEqual({ applied: false, count: 0 })
      store.updateDocument('sc_1', { content: 'a a' })
      expect(api.replaceText('sc_1', 'a', 'x')).toEqual({ applied: false, count: 2 })
      expect(store.getDocument('sc_1').content).toBe('a a')
      expect(mockEditor.replaceContent).not.toHaveBeenCalled()
    })

    describe('revertEdit', () => {
      const edit = {
        documentId: 'sc_1',
        path: 'p',
        tool: 'edit_document',
        old: 'Rain',
        new: 'Snow',
      }

      it('puts a passage back when the document still says what the tool left', () => {
        expect(api.revertEdit(edit)).toBe(true)
        expect(store.getDocument('sc_1').content).toBe('Rain fell.')
      })

      it('leaves a passage the writer has edited since, and says so', () => {
        store.updateDocument('sc_1', { content: 'Sleet fell.' })
        expect(api.revertEdit(edit)).toBe(false)
        expect(store.getDocument('sc_1').content).toBe('Sleet fell.')
      })

      it('takes an append off the end', () => {
        store.updateDocument('sc_1', { content: 'Snow fell.\n\nThen hail.' })
        const append = { ...edit, tool: 'append_document', old: '', new: '\n\nThen hail.' }
        expect(api.revertEdit(append)).toBe(true)
        expect(store.getDocument('sc_1').content).toBe('Snow fell.')
      })

      it('removes a created document while it still says what was created', () => {
        const created = { ...edit, tool: 'create_document', old: '', new: 'Snow fell.' }
        expect(api.revertEdit(created)).toBe(true)
        expect(store.getDocument('sc_1')).toBeNull()
      })

      it('keeps a created document the writer has written into', () => {
        const created = { ...edit, tool: 'create_document', old: '', new: 'Once.' }
        expect(api.revertEdit(created)).toBe(false)
        expect(store.getDocument('sc_1')).not.toBeNull()
      })

      it('has nothing to do for a document that is gone', () => {
        expect(api.revertEdit({ ...edit, documentId: 'nobody' })).toBe(false)
      })

      it('goes through the editor when it holds the document', () => {
        mockEditor.holds.mockImplementation(id => id === 'sc_1')
        mockEditor.markdown.mockReturnValue('Snow fell. Unflushed.')
        expect(api.revertEdit(edit)).toBe(true)
        expect(mockEditor.replaceContent).toHaveBeenCalledWith('sc_1', 'Rain fell. Unflushed.')
      })
    })

    describe('reapplyEdit', () => {
      const edit = {
        documentId: 'sc_1',
        path: 'p',
        tool: 'edit_document',
        old: 'Rain',
        new: 'Snow',
      }

      it('makes a change again where the document still says what it replaced', async () => {
        store.updateDocument('sc_1', { content: 'Rain fell.' })
        expect(await api.reapplyEdit(edit)).toBe(true)
        expect(store.getDocument('sc_1').content).toBe('Snow fell.')
      })

      it('leaves a passage the writer has changed since, and says so', async () => {
        store.updateDocument('sc_1', { content: 'Sleet fell.' })
        expect(await api.reapplyEdit(edit)).toBe(false)
        expect(store.getDocument('sc_1').content).toBe('Sleet fell.')
      })

      it('puts an append back on the end', async () => {
        const append = { ...edit, tool: 'append_document', old: '', new: '\n\nThen hail.' }
        expect(await api.reapplyEdit(append)).toBe(true)
        expect(store.getDocument('sc_1').content).toBe('Snow fell.\n\nThen hail.')
      })

      it('brings back a created document that was undone, at its path and with its id', async () => {
        store.deleteDocument('sc_1')
        const created = {
          ...edit,
          tool: 'create_document',
          path: 'manuscript/Chapter 1',
          old: '',
          new: 'Snow fell.',
        }

        expect(await api.reapplyEdit(created)).toBe(true)
        // The undo took the row with it; the edit holds everything to make it
        // again, under the same id so the chat's links still point at it.
        expect(store.getDocument('sc_1')).toMatchObject({
          id: 'sc_1',
          parentId: 'manuscript_story_1',
          type: 'text',
          title: 'Chapter 1',
          content: 'Snow fell.',
        })
      })

      it('puts a created document under the root when its folder is gone too', async () => {
        const created = {
          ...edit,
          documentId: 'sc_9',
          tool: 'create_document',
          path: 'lost/Chapter 9',
          old: '',
          new: 'Once.',
        }

        expect(await api.reapplyEdit(created)).toBe(true)
        expect(store.getDocument('sc_9')).toMatchObject({
          parentId: 'root_story_1',
          title: 'Chapter 9',
          content: 'Once.',
        })
      })

      it('has nothing to do for a created document still there as created', async () => {
        const created = { ...edit, tool: 'create_document', old: '', new: 'Snow fell.' }
        expect(await api.reapplyEdit(created)).toBe(true)
        expect(await api.reapplyEdit({ ...created, new: 'Once.' })).toBe(false)
      })

      it('has nothing to do for a document that is gone', async () => {
        expect(await api.reapplyEdit({ ...edit, documentId: 'nobody' })).toBe(false)
      })

      it('goes through the editor when it holds the document', async () => {
        mockEditor.holds.mockImplementation(id => id === 'sc_1')
        mockEditor.markdown.mockReturnValue('Rain fell. Unflushed.')
        expect(await api.reapplyEdit(edit)).toBe(true)
        expect(mockEditor.replaceContent).toHaveBeenCalledWith('sc_1', 'Snow fell. Unflushed.')
      })
    })

    it('stores text from outside in the form the editor would write', () => {
      api.setContent('sc_1', '* star bullet\n\nRain fell.\n')
      expect(store.getDocument('sc_1').content).toBe('- star bullet\n\nRain fell.')

      api.appendContent('sc_1', '* and hail\n')
      expect(store.getDocument('sc_1').content).toBe('- star bullet\n\nRain fell.\n\n- and hail')

      const created = api.createTextDocument('manuscript_story_1', 'New', 'Text.\n')
      expect(created.content).toBe('Text.')
    })

    it('reverts an edit recorded before the document was opened', () => {
      // The model wrote with a star bullet; the store kept the editor's form.
      api.setContent('sc_1', 'Snow fell.\n\n* a torch')
      const stored = store.getDocument('sc_1').content
      const edit = {
        documentId: 'sc_1',
        path: 'x',
        tool: 'update_document',
        old: 'Snow fell.',
        new: stored,
      }

      // Opening the document changes nothing about how it reads: the editor
      // serializes exactly the form the store kept.
      mockEditor.holds.mockImplementation(id => id === 'sc_1')
      mockEditor.markdown.mockReturnValue(settleMarkdown(stored))

      expect(api.revertEdit(edit)).toBe(true)
      expect(mockEditor.replaceContent).toHaveBeenCalledWith('sc_1', 'Snow fell.')
    })

    it('dispatches to the editor when it holds the document', () => {
      mockEditor.holds.mockImplementation(id => id === 'sc_1')

      api.setContent('sc_1', 'Rain fell.')
      api.appendContent('sc_1', 'Then hail.')

      expect(mockEditor.replaceContent).toHaveBeenCalledWith('sc_1', 'Rain fell.')
      expect(mockEditor.appendContent).toHaveBeenCalledWith('sc_1', 'Then hail.')
      // The editor's projection writes the store, not this.
      expect(store.getDocument('sc_1').content).toBe('Snow fell.')
    })
  })

  describe('plain documents', () => {
    beforeEach(() => {
      mockEditor.holds.mockReturnValue(false)
      store.createDocument({
        id: 'p_1',
        storyId: 'story_1',
        parentId: 'manuscript_story_1',
        type: 'text',
        title: 'Prompt',
        content: '* one',
      })
      store.updateDocument('p_1', { plain: true })
      store.createDocument({
        id: 'd_1',
        storyId: 'story_1',
        parentId: 'manuscript_story_1',
        type: 'text',
        title: 'Chapter',
        content: '- a',
      })
    })

    it('knows which documents are plain', () => {
      expect(api.isPlain('p_1')).toBe(true)
      expect(api.isPlain('d_1')).toBe(false)
      expect(api.isPlain(null)).toBe(false)
    })

    it('stores what is written to a plain document as written', () => {
      api.setContent('p_1', '* two\n\n<x>')
      expect(store.getDocument('p_1').content).toBe('* two\n\n<x>')

      api.appendContent('p_1', '{{y}}')
      expect(store.getDocument('p_1').content).toBe('* two\n\n<x>\n\n{{y}}')
    })

    it('makes a document plain without touching its text', () => {
      api.setPlain('d_1', true)
      expect(store.getDocument('d_1').plain).toBe(true)
      expect(store.getDocument('d_1').content).toBe('- a')
    })

    it('says when making a document structured would change it, and then does', () => {
      expect(api.wouldSettle('p_1')).toBe(true)
      expect(api.wouldSettle('d_1')).toBe(false)

      api.setPlain('p_1', false)

      expect(store.getDocument('p_1').plain).toBe(false)
      expect(store.getDocument('p_1').content).toBe('- one')
      expect(api.wouldSettle('p_1')).toBe(false)
    })

    it('turns an open document in the editor rather than the store', () => {
      mockEditor.holds.mockImplementation(id => id === 'p_1')
      api.setPlain('p_1', false)

      expect(store.getDocument('p_1').plain).toBe(false)
      expect(store.getDocument('p_1').content).toBe('* one')
      expect(mockEditor.convert).toHaveBeenCalledWith('p_1', false)
    })

    it('does nothing for a folder, or a document already of that kind', () => {
      api.setPlain('manuscript_story_1', true)
      expect(store.getDocument('manuscript_story_1').plain).toBeUndefined()

      api.setPlain('p_1', true)
      expect(mockEditor.convert).not.toHaveBeenCalled()
    })
  })

  describe('the tabs', () => {
    const text = id =>
      store.createDocument({
        id,
        storyId: 'story_1',
        parentId: 'manuscript_story_1',
        type: 'text',
        title: id,
      })

    beforeEach(() => {
      text('doc_1')
      text('doc_2')
      text('doc_3')
    })

    it('start empty for a project never opened', () => {
      expect(api.tabs.value).toEqual({ open: [], active: null, preview: null })
      expect(api.activeDocumentId.value).toBe('')
    })

    it('puts the caret in the document showing, and in no other', () => {
      api.open('doc_1')
      api.open('doc_2')

      api.focus('doc_1')
      expect(mockEditor.focus).not.toHaveBeenCalled()

      api.focus('doc_2')
      expect(mockEditor.focus).toHaveBeenCalledWith('doc_2')
    })

    it('opens a document in a tab of its own, showing', () => {
      api.open('doc_1')
      api.open('doc_2')

      expect(mockUpdateStory).toHaveBeenLastCalledWith('story_1', {
        openDocumentIds: ['doc_1', 'doc_2'],
        lastDocumentId: 'doc_2',
        previewDocumentId: null,
      })
      expect(api.tabs.value).toEqual({ open: ['doc_1', 'doc_2'], active: 'doc_2', preview: null })
      expect(api.activeDocumentId.value).toBe('doc_2')
    })

    it('brings a document already open forward where it is', () => {
      api.open('doc_1')
      api.open('doc_2')
      api.open('doc_1')

      expect(api.tabs.value).toEqual({ open: ['doc_1', 'doc_2'], active: 'doc_1', preview: null })
    })

    it('gives a story from before tabs one, its last document', () => {
      rememberStory({ lastDocumentId: 'doc_2' })
      expect(api.tabs.value).toEqual({ open: ['doc_2'], active: 'doc_2', preview: null })
    })

    it('leaves out what is not a text document in the tree', () => {
      rememberStory({
        openDocumentIds: ['doc_1', 'manuscript_story_1', 'doc_gone'],
        lastDocumentId: 'doc_gone',
      })
      expect(api.tabs.value).toEqual({ open: ['doc_1'], active: 'doc_1', preview: null })
    })

    it('closes a tab, writing the document out, and brings the neighbour forward', () => {
      api.open('doc_1')
      api.open('doc_2')
      api.open('doc_3')
      api.open('doc_2')

      api.closeTab('doc_2')

      expect(mockEditor.close).toHaveBeenCalledWith('doc_2')
      expect(api.tabs.value).toEqual({ open: ['doc_1', 'doc_3'], active: 'doc_3', preview: null })
    })

    it('opens a preview in the preview tab, letting go of what was there', () => {
      api.open('doc_1')
      api.open('doc_2', { preview: true })
      api.open('doc_3', { preview: true })

      expect(mockEditor.close).toHaveBeenCalledWith('doc_2')
      expect(mockEditor.close).not.toHaveBeenCalledWith('doc_1')
      expect(api.tabs.value).toEqual({
        open: ['doc_1', 'doc_3'],
        active: 'doc_3',
        preview: 'doc_3',
      })
    })

    it('opens the next preview beside a preview that was kept', () => {
      api.open('doc_1', { preview: true })
      api.keep('doc_1')
      api.open('doc_2', { preview: true })

      expect(mockEditor.close).not.toHaveBeenCalled()
      expect(api.tabs.value).toEqual({
        open: ['doc_1', 'doc_2'],
        active: 'doc_2',
        preview: 'doc_2',
      })
    })

    it('writes nothing to keep a tab that is kept already', () => {
      api.open('doc_1')
      mockUpdateStory.mockClear()

      api.keep('doc_1')

      expect(mockUpdateStory).not.toHaveBeenCalled()
    })

    it('remembers a project closed down to nothing', () => {
      api.open('doc_1')
      api.closeTab('doc_1')

      expect(api.tabs.value).toEqual({ open: [], active: null, preview: null })
      expect(mockStory.openDocumentIds).toEqual([])
      expect(mockStory.lastDocumentId).toBeNull()
    })

    it('lets go of every editor state and keeps the tabs when the project is left', () => {
      api.open('doc_1')
      api.open('doc_2')
      mockUpdateStory.mockClear()

      api.releaseTabs()

      expect(mockEditor.close).toHaveBeenCalledWith('doc_1')
      expect(mockEditor.close).toHaveBeenCalledWith('doc_2')
      expect(mockUpdateStory).not.toHaveBeenCalled()
      expect(api.tabs.value).toEqual({ open: ['doc_1', 'doc_2'], active: 'doc_2', preview: null })
    })

    it('drops the tabs of what a deletion takes, and their editor state', () => {
      api.open('doc_1')
      api.open('doc_2')
      api.open('doc_3')
      api.open('doc_2')

      api.remove('doc_2')

      expect(mockEditor.discard).toHaveBeenCalledWith('doc_2')
      expect(api.tabs.value).toEqual({ open: ['doc_1', 'doc_3'], active: 'doc_3', preview: null })
      expect(mockStory.openDocumentIds).toEqual(['doc_1', 'doc_3'])
    })

    it('drops every tab under a deleted folder', () => {
      api.open('doc_1')
      api.open('doc_2')
      mockUpdateStory.mockClear()

      api.remove('manuscript_story_1')

      expect(mockEditor.discard).toHaveBeenCalledWith('doc_1')
      expect(mockEditor.discard).toHaveBeenCalledWith('doc_2')
      expect(api.tabs.value).toEqual({ open: [], active: null, preview: null })
      expect(mockUpdateStory).toHaveBeenCalledTimes(1)
    })

    it('leaves the tabs alone when the deletion took none of them', () => {
      api.open('doc_1')
      mockUpdateStory.mockClear()

      api.remove('doc_3')

      expect(mockUpdateStory).not.toHaveBeenCalled()
      expect(api.tabs.value).toEqual({ open: ['doc_1'], active: 'doc_1', preview: null })
    })
  })

  describe('the project root', () => {
    it('carries the project name', () => {
      expect(api.displayTitle(api.root.value)).toBe('My Novel')
    })

    it('renames the project like any other node', () => {
      api.rename('root_story_1', 'A Better Title')

      // The root node is authoritative, so there is nothing else to keep in step.
      expect(api.displayTitle(api.root.value)).toBe('A Better Title')
      expect(api.editableTitle('root_story_1')).toBe('A Better Title')
    })
  })

  it('returns the same instance per story', () => {
    expect(useDocuments('story_1')).toBe(api)
    expect(useDocuments('story_2')).not.toBe(api)
  })

  it('creates the root on init', () => {
    expect(api.root.value?.id).toBe('root_story_1')
  })

  describe('displayTitle', () => {
    it('shows the stored title, in an ordered folder as anywhere else', () => {
      const manuscript = 'manuscript_story_1'
      const first = api.createFolder(manuscript, 'First Act')
      const second = api.createFolder(manuscript, 'Second Act')

      expect(api.displayTitle(first)).toBe('First Act')
      expect(api.displayTitle(second)).toBe('Second Act')
    })

    it('leaves children of an unordered folder alone', () => {
      const riley = api.createTextDocument('notes_story_1', 'Riley')
      expect(api.displayTitle(riley)).toBe('Riley')
    })

    it('leaves the title alone across a reorder', () => {
      const manuscript = 'manuscript_story_1'
      const first = api.createFolder(manuscript, 'First Act')
      const second = api.createFolder(manuscript, 'Second Act')

      api.reorder(manuscript, [second.id, first.id])

      expect(api.displayTitle(api.get(second.id))).toBe('Second Act')
      expect(api.get(second.id).title).toBe('Second Act')
    })

    it('falls back to Untitled for a nameless document', () => {
      const blank = api.createTextDocument('notes_story_1', '')
      expect(api.displayTitle(blank)).toBe('Untitled')
    })
  })

  describe('ordering', () => {
    it('sorts an unordered folder by title', () => {
      const notes = 'notes_story_1'
      api.createTextDocument(notes, 'Riley')
      api.createTextDocument(notes, 'Anthony')

      expect(api.childrenOf(notes).map(d => d.title)).toEqual(['Anthony', 'Riley'])
    })

    it('sorts an ordered folder by position, newest last', () => {
      const manuscript = 'manuscript_story_1'
      api.createFolder(manuscript, 'Zebra')
      api.createFolder(manuscript, 'Apple')

      expect(api.childrenOf(manuscript).map(d => d.title)).toEqual(['Zebra', 'Apple'])
    })

    it('keeps the order showing when a folder is switched to ordered', () => {
      const notes = 'notes_story_1'
      const riley = api.createTextDocument(notes, 'Riley')
      const anthony = api.createTextDocument(notes, 'Anthony')

      // Alphabetical while off...
      expect(api.childrenOf(notes)[0].title).toBe('Anthony')

      api.setOrdered(notes, true)
      // ...and still alphabetical once on: what the writer saw is what stays.
      expect(api.childrenOf(notes).map(d => d.id)).toEqual([anthony.id, riley.id])
      expect(api.get(anthony.id).order).toBe(0)
      expect(api.get(riley.id).order).toBe(1)
    })

    it('leaves the positions alone when an ordered folder is switched off and on', () => {
      const manuscript = 'manuscript_story_1'
      const zebra = api.createFolder(manuscript, 'Zebra')
      const apple = api.createFolder(manuscript, 'Apple')

      api.setOrdered(manuscript, false)
      expect(api.childrenOf(manuscript)[0].id).toBe(apple.id)

      // Switching back on takes the order showing, which is now by name.
      api.setOrdered(manuscript, true)
      expect(api.childrenOf(manuscript).map(d => d.id)).toEqual([apple.id, zebra.id])
    })

    it('reports whether a folder sequences its children', () => {
      expect(api.isOrdered('manuscript_story_1')).toBe(true)
      expect(api.isOrdered('notes_story_1')).toBe(false)
    })

    it('creates new folders unordered', () => {
      const folder = api.createFolder('root_story_1', 'research')
      expect(api.isOrdered(folder.id)).toBe(false)
    })
  })

  describe('names in a folder', () => {
    const notes = 'notes_story_1'

    it('makes a document under the next free name, whatever its case', () => {
      api.createTextDocument(notes, 'Riley')

      expect(api.createTextDocument(notes, 'riley').title).toBe('riley (2)')
      expect(api.createFolder(notes, 'Riley').title).toBe('Riley (3)')
    })

    it('makes a second unnamed document Untitled (2)', () => {
      expect(api.createTextDocument(notes, '').title).toBe('')
      expect(api.createTextDocument(notes, '').title).toBe('Untitled (2)')
    })

    it('refuses a rename to a name something beside it has', () => {
      api.createTextDocument(notes, 'Riley')
      const anthony = api.createTextDocument(notes, 'Anthony')

      expect(api.rename(anthony.id, 'RILEY')).toBe(false)
      expect(api.get(anthony.id).title).toBe('Anthony')
      expect(api.rename(anthony.id, 'anthony')).toBe(true)
      expect(api.get(anthony.id).title).toBe('anthony')
    })

    it('numbers a document moved in beside one of its name', () => {
      const manuscript = 'manuscript_story_1'
      const here = api.createTextDocument(manuscript, 'Riley')
      const moving = api.createTextDocument(notes, 'Riley')

      api.reorder(manuscript, [moving.id, here.id])

      expect(api.get(moving.id)).toMatchObject({ parentId: manuscript, title: 'Riley (2)' })
      expect(api.get(here.id).title).toBe('Riley')
      expect(api.childrenOf(manuscript).map(d => d.id)).toEqual([moving.id, here.id])
    })

    it('leaves names alone in a reorder within the folder', () => {
      const manuscript = 'manuscript_story_1'
      const first = api.createTextDocument(manuscript, 'One')
      const second = api.createTextDocument(manuscript, 'Two')

      api.reorder(manuscript, [second.id, first.id])

      expect(api.childrenOf(manuscript).map(d => d.title)).toEqual(['Two', 'One'])
    })
  })

  describe('hiding from the model', () => {
    it('is off until the writer turns it on', () => {
      const note = api.createTextDocument('notes_story_1', 'Secret')
      expect(api.isHidden(note.id)).toBe(false)
    })

    it('round-trips through the store', () => {
      const note = api.createTextDocument('notes_story_1', 'Secret')

      api.setHidden(note.id, true)
      expect(api.isHidden(note.id)).toBe(true)
      expect(store.getDocument(note.id).hidden).toBe(true)

      api.setHidden(note.id, false)
      expect(api.isHidden(note.id)).toBe(false)
    })

    it("is the document's own flag, not its folder's", () => {
      // What is under a hidden folder is hidden with it, but the flag stays on
      // the folder: that is where it is switched off again.
      const note = api.createTextDocument('notes_story_1', 'Secret')
      api.setHidden('notes_story_1', true)

      expect(api.isHidden(note.id)).toBe(false)
    })
  })

  describe('pathOf', () => {
    it('spells a document by its titles from the root down, and the root as "/"', () => {
      const act = api.createFolder('manuscript_story_1', 'First Act')
      const opening = api.createTextDocument(act.id, 'Opening')

      expect(api.pathOf('root_story_1')).toBe('/')
      expect(api.pathOf(act.id)).toBe('manuscript/First Act')
      expect(api.pathOf(opening.id)).toBe('manuscript/First Act/Opening')
    })

    it('reads an unnamed document as Untitled, and knows nothing of a stranger', () => {
      const unnamed = api.createTextDocument('notes_story_1', '')
      expect(api.pathOf(unnamed.id)).toBe('notes/Untitled')
      expect(api.pathOf('doc_elsewhere')).toBe('')
    })
  })

  describe('firstTextDocument', () => {
    it('takes the first document in tree order, with no folder singled out', () => {
      // The default structure lands in the manuscript on sort order alone —
      // `manuscript` < `notes` — without this knowing that folder exists.
      const act = api.createFolder('manuscript_story_1', 'Act 1')
      const chapter = api.createTextDocument(act.id, 'Chapter 1')
      api.createTextDocument('notes_story_1', 'Riley')

      expect(api.firstTextDocument().id).toBe(chapter.id)
    })

    it('follows the writer when they restructure the project', () => {
      // A project reorganized into books has no `manuscript`; the fallback has
      // to still find something rather than give up.
      api.remove('manuscript_story_1')
      const book = api.createFolder('root_story_1', 'Book One')
      const chapter = api.createTextDocument(book.id, 'Chapter 1')

      expect(api.firstTextDocument().id).toBe(chapter.id)
    })

    it('descends to find a document nested any number of levels down', () => {
      const act = api.createFolder('manuscript_story_1', 'Act 1')
      const nested = api.createFolder(act.id, 'Fragments')
      const buried = api.createTextDocument(nested.id, 'Opening')

      expect(api.firstTextDocument().id).toBe(buried.id)
    })

    it('looks outside the manuscript when it is empty', () => {
      const note = api.createTextDocument('notes_story_1', 'Riley')
      expect(api.firstTextDocument().id).toBe(note.id)
    })

    it('returns null when the project holds no documents', () => {
      expect(api.firstTextDocument()).toBeNull()
    })
  })

  describe('remove', () => {
    it('deletes a whole subtree', () => {
      const act = api.createFolder('manuscript_story_1', 'Act 1')
      const chapter = api.createTextDocument(act.id, 'Chapter 1')

      expect(api.remove(act.id)).toBe(2)
      expect(api.get(act.id)).toBeNull()
      // A folder deleted without its children would strand them unreachable.
      expect(api.get(chapter.id)).toBeNull()
    })
  })

  describe('canDropInto', () => {
    it('refuses a folder dropped into its own subtree', () => {
      const act = api.createFolder('manuscript_story_1', 'Act 1')
      const nested = api.createFolder(act.id, 'Fragments')

      expect(api.canDropInto(nested.id, act.id)).toBe(false)
      expect(api.canDropInto(act.id, act.id)).toBe(false)
      expect(api.canDropInto('notes_story_1', act.id)).toBe(true)
    })

    it('is enforced by the store, not just the drag handler', () => {
      const act = api.createFolder('manuscript_story_1', 'Act 1')
      const nested = api.createFolder(act.id, 'Fragments')

      expect(() => store.updateDocument(act.id, { parentId: nested.id })).toThrow(
        'into its own subtree'
      )
    })
  })

  describe('pending rename', () => {
    it('hands a freshly created document to exactly one claimant', () => {
      const created = api.createTextDocument('notes_story_1', '')
      api.requestRename(created.id)

      expect(api.claimRename('some_other_id')).toBe(false)
      expect(api.claimRename(created.id)).toBe(true)
      // Only the first claim wins, so a remount doesn't reopen the input.
      expect(api.claimRename(created.id)).toBe(false)
    })
  })
})
