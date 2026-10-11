import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  projectOverview,
  executeListDocuments,
  executeListComments,
  executeResolveComment,
  executeReadDocument,
  executeEditDocument,
} from '@/ai/tools/documents.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances } from '@/composables/useDocuments'
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
const context = { storyId: STORY }

const CHAPTER =
  'We had a {==cold and narrow==}{>>cabcd1: reword this<<} attic.\n\n' +
  'She {==walked==}{>>cabcd2: too slow?<<} to the door.'

describe("the writer's comments", () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store

  const text = (title, content, extra = {}) =>
    store.createDocument({
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'text',
      title,
      content,
      ...extra,
    })

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    store = useDocumentsStore()
    vi.clearAllMocks()
    // Builds the root, which the documents go in.
    await projectOverview(STORY)
  })

  it('are counted in the listing, on the documents that have any', async () => {
    text('Chapter 1', CHAPTER)
    text('Notes', 'Nothing flagged here.')
    text('Aside', 'One {==thing==}{>>cabcd3: why?<<}.')

    const lines = String(await executeListDocuments({}, context)).split('\n')
    expect(lines.find(line => line.startsWith('Chapter 1'))).toMatch(/, 2 comments$/)
    expect(lines.find(line => line.startsWith('Aside'))).toMatch(/, 1 comment$/)
    expect(lines.find(line => line.startsWith('Notes'))).not.toContain('comment')
  })

  it('are read as part of the text, where they sit', async () => {
    text('Chapter 1', CHAPTER)
    const result = await executeReadDocument({ path: 'Chapter 1' }, context)
    expect(result.content).toContain('{==cold and narrow==}{>>cabcd1: reword this<<}')
    expect(result.comments).toBe(2)
  })

  describe('list_comments', () => {
    it('lists every comment across the project, with its passage and document', async () => {
      text('Chapter 1', CHAPTER)
      text('Notes', 'Say {==more==}{>>cabcd3: about what?<<}.')

      const { comments } = await executeListComments({}, context)

      expect(comments).toEqual([
        { id: 'cabcd1', path: 'Chapter 1', text: 'cold and narrow', comment: 'reword this' },
        { id: 'cabcd2', path: 'Chapter 1', text: 'walked', comment: 'too slow?' },
        { id: 'cabcd3', path: 'Notes', text: 'more', comment: 'about what?' },
      ])
    })

    it("lists one document's when asked for it, and refuses a path that is not there", async () => {
      text('Chapter 1', CHAPTER)
      text('Notes', 'Say {==more==}{>>cabcd3: about what?<<}.')

      const { comments } = await executeListComments({ path: 'Notes' }, context)
      expect(comments.map(c => c.id)).toEqual(['cabcd3'])

      const missing = await executeListComments({ path: 'Nowhere' }, context)
      expect(missing.error).toContain('Nowhere')
    })
  })

  describe('resolve_comment', () => {
    it('takes the comment off and leaves its passage', async () => {
      const chapter = text('Chapter 1', CHAPTER)
      const edits = []

      const result = await executeResolveComment(
        { path: 'Chapter 1', id: 'cabcd2' },
        { ...context, edits }
      )

      expect(result.success).toBe(true)
      expect(result.resolved).toBe('cabcd2')
      const content = store.getDocument(chapter.id).content
      expect(content).toContain('She walked to the door.')
      expect(content).toContain('{==cold and narrow==}{>>cabcd1: reword this<<}')
      // Recorded as an ordinary edit, so it can be undone and made again.
      expect(edits).toHaveLength(1)
      expect(edits[0]).toMatchObject({
        tool: 'edit_document',
        old: '{==walked==}{>>cabcd2: too slow?<<}',
        new: 'walked',
      })
    })

    it('changes no text, whatever else it is given', async () => {
      const chapter = text('Chapter 1', CHAPTER)
      await executeResolveComment({ path: 'Chapter 1', id: 'cabcd1', new: 'moonless' }, context)
      expect(store.getDocument(chapter.id).content).toContain('We had a cold and narrow attic.')
    })

    it('names the ids that exist when the comment is not there', async () => {
      text('Chapter 1', CHAPTER)

      const result = await executeResolveComment({ path: 'Chapter 1', id: 'cnope1' }, context)

      expect(result.error).toContain('cnope1')
      expect(result.error).toContain('list_comments')
    })

    it('proposes the change when the chat asks the writer first', async () => {
      const chapter = text('Chapter 1', CHAPTER)
      const edits = []

      const result = await executeResolveComment(
        { path: 'Chapter 1', id: 'cabcd1' },
        { ...context, propose: true, edits }
      )

      expect(result.proposed).toBe(true)
      expect(store.getDocument(chapter.id).content).toBe(CHAPTER)
      expect(edits[0]).toMatchObject({
        tool: 'edit_document',
        status: 'proposed',
        old: '{==cold and narrow==}{>>cabcd1: reword this<<}',
        new: 'cold and narrow',
      })
    })
  })

  describe('edit_document over comments', () => {
    const edit = (old, replacement, extra = {}) =>
      executeEditDocument({ path: 'Chapter 1', old, new: replacement }, { ...context, ...extra })
    const content = id => store.getDocument(id).content

    it('takes a quote without the markup, and keeps a comment whose words it leaves alone', async () => {
      const chapter = text('Chapter 1', CHAPTER)

      const result = await edit(
        'We had a cold and narrow attic.',
        'We had a cold and narrow cellar.'
      )

      expect(result.success).toBe(true)
      expect(result.resolvedComments).toBeUndefined()
      expect(content(chapter.id)).toContain(
        'We had a {==cold and narrow==}{>>cabcd1: reword this<<} cellar.'
      )
    })

    it('takes a quote with the markup, as read_document gave it', async () => {
      const chapter = text('Chapter 1', CHAPTER)

      const result = await edit('She {==walked==}{>>cabcd2: too slow?<<} to the door.', 'She ran.')

      expect(result.success).toBe(true)
      expect(result.resolvedComments).toEqual([{ id: 'cabcd2', comment: 'too slow?' }])
      expect(content(chapter.id)).toContain('She ran.')
      expect(content(chapter.id)).not.toContain('cabcd2')
    })

    it('resolves a comment the edit reaches only half of, and says what it said', async () => {
      const chapter = text(
        'Chapter 1',
        'One more {==letter from the keeper covers the tides.==}{>>cabcd3: Check the year.<<}'
      )

      const result = await edit('One more letter', 'Two more letters')

      expect(result.resolvedComments).toEqual([{ id: 'cabcd3', comment: 'Check the year.' }])
      expect(content(chapter.id)).toBe('Two more letters from the keeper covers the tides.')
    })

    it('rewrites a sentence a comment ends inside of, and resolves it', async () => {
      const chapter = text(
        'Chapter 1',
        'Some parts {==are built, some are pla==}{>>cabcd4: Reword this sentence.<<}nned, and some never will be.'
      )

      const result = await edit(
        'Some parts are built, some are planned, and some never will be.',
        'Parts are built, parts planned, and parts only hoped for.'
      )

      expect(result.resolvedComments).toEqual([{ id: 'cabcd4', comment: 'Reword this sentence.' }])
      expect(content(chapter.id)).toBe('Parts are built, parts planned, and parts only hoped for.')
    })

    it('keeps what the writer said when the model copies the markup and changes it', async () => {
      const chapter = text('Chapter 1', CHAPTER)

      await edit(
        'We had a {==cold and narrow==}{>>cabcd1: reword this<<} attic.',
        'At last, we had a {==cold and narrow==}{>>cabcd1: done<<} attic.'
      )

      expect(content(chapter.id)).toContain(
        'At last, we had a {==cold and narrow==}{>>cabcd1: reword this<<} attic.'
      )
    })

    it('makes no comment of markup the model writes', async () => {
      const chapter = text('Chapter 1', CHAPTER)

      await edit('to the door', 'to the {==door==}{>>cfake1: mine<<}')

      expect(content(chapter.id)).not.toContain('cfake1')
      expect(content(chapter.id)).toContain('to the door.')
    })

    it('proposes the edit with the markup it takes in, and names what it would resolve', async () => {
      const chapter = text('Chapter 1', CHAPTER)
      const edits = []

      const result = await edit('She walked', 'He walked slowly', { propose: true, edits })

      expect(result.proposed).toBe(true)
      expect(result.resolvedComments).toBeUndefined()
      expect(content(chapter.id)).toBe(CHAPTER)
      expect(edits[0]).toMatchObject({
        status: 'proposed',
        old: 'She {==walked==}{>>cabcd2: too slow?<<}',
        new: 'He {==walked==}{>>cabcd2: too slow?<<} slowly',
      })
    })
  })
})
