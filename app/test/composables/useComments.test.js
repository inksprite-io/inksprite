import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  useComments,
  currentComment,
  goToComment,
  leaveComment,
  takeUpComment,
} from '@/composables/useComments'
import { useDocuments, clearDocumentInstances } from '@/composables/useDocuments'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useEditor, clearEditor } from '@/composables/useEditor.js'
import { commentRanges } from '@/editor/comments.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

vi.mock('@/stores/db', () => ({
  default: {
    documents: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
      filter: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
      bulkDelete: vi.fn(),
      bulkGet: vi.fn(async () => []),
      get: vi.fn(async () => undefined),
    },
    stories: { toArray: vi.fn(async () => []) },
  },
}))

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const STORY = 'story_1'
const ROOT = rootIdFor(STORY)

const CHAPTER = 'We had a {==cold and narrow==}{>>cabcd1: reword this<<} attic.'

describe('useComments', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store

  const text = (title, content, parentId = ROOT) =>
    store.createDocument({ storyId: STORY, parentId, type: 'text', title, content })

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    clearEditor()
    store = useDocumentsStore()
    vi.clearAllMocks()
    await useDocuments(STORY).init()
    leaveComment(currentComment.value?.documentId ?? '')
  })

  it("lists each document's comments in the outline's order, and only those with any", () => {
    const notes = store.createDocument({
      storyId: STORY,
      parentId: ROOT,
      type: 'folder',
      title: 'Notes',
    })
    text('B chapter', 'And {==walked==}{>>cabcd2: too slow?<<} on.')
    text('A chapter', CHAPTER)
    text('C clean', 'Nothing flagged.')
    text('Idea', 'One {==thought==}{>>cabcd3: more<<}.', notes.id)

    const { groups } = useComments(STORY)

    expect(groups.value.map(group => [group.path, group.comments.map(c => c.id)])).toEqual([
      ['Notes/Idea', ['cabcd3']],
      ['A chapter', ['cabcd1']],
      ['B chapter', ['cabcd2']],
    ])
    expect(groups.value[1].comments[0]).toEqual({
      id: 'cabcd1',
      passage: 'cold and narrow',
      comment: 'reword this',
    })
  })

  it('follows a document open in the editor as it changes', () => {
    const chapter = text('Chapter', 'Nothing yet.')
    const editor = useEditor()
    const state = editor.open(chapter.id, chapter.content)
    const { groups } = useComments(STORY)
    expect(groups.value).toEqual([])

    const type = state.schema.marks.comment
    editor.dispatch(chapter.id, state.tr.addMark(1, 8, type.create({ id: 'cabcd9', text: 'hm' })))

    expect(groups.value[0].comments).toEqual([{ id: 'cabcd9', passage: 'Nothing', comment: 'hm' }])
  })

  it('resolves a comment in a closed document, and lets it go', () => {
    const chapter = text('Chapter', CHAPTER)
    const { groups, resolve } = useComments(STORY)
    goToComment(chapter.id, 'cabcd1')

    resolve(chapter.id, 'cabcd1')

    expect(store.getDocument(chapter.id).content).toBe('We had a cold and narrow attic.')
    expect(groups.value).toEqual([])
    expect(currentComment.value).toBeNull()
  })

  it('resolves a comment in an open document as a change to it, caret left alone', () => {
    const chapter = text('Chapter', CHAPTER)
    const editor = useEditor()
    editor.open(chapter.id, chapter.content)
    const { resolve } = useComments(STORY)
    const caret = editor.stateOf(chapter.id).selection.head

    resolve(chapter.id, 'cabcd1')

    const after = editor.stateOf(chapter.id)
    expect(commentRanges(after.doc)).toEqual([])
    expect(after.doc.textContent).toBe('We had a cold and narrow attic.')
    expect(after.selection.head).toBe(caret)
  })

  it('does nothing for a comment that is not there', () => {
    const chapter = text('Chapter', CHAPTER)
    goToComment(chapter.id, 'cabcd1')
    useComments(STORY).resolve(chapter.id, 'cnope1')
    expect(store.getDocument(chapter.id).content).toBe(CHAPTER)
    expect(currentComment.value).toMatchObject({ id: 'cabcd1' })
  })

  it('keeps one current comment, asked again each time it is gone to', () => {
    goToComment('doc_1', 'cabcd1')
    const first = currentComment.value
    goToComment('doc_1', 'cabcd1')

    expect(currentComment.value).toMatchObject({ documentId: 'doc_1', id: 'cabcd1' })
    expect(currentComment.value.seq).toBeGreaterThan(first.seq)

    leaveComment('doc_2')
    expect(currentComment.value).not.toBeNull()
    leaveComment('doc_1')
    expect(currentComment.value).toBeNull()
  })

  it('has a going taken up once, by a view on its document', () => {
    goToComment('doc_1', 'cabcd1')

    expect(takeUpComment('doc_2')).toBeNull()
    expect(takeUpComment('doc_1')).toMatchObject({ id: 'cabcd1' })
    // A view opening on the tab again later is left where the writer was.
    expect(takeUpComment('doc_1')).toBeNull()

    goToComment('doc_1', 'cabcd1')
    expect(takeUpComment('doc_1')).toMatchObject({ id: 'cabcd1' })
  })
})
