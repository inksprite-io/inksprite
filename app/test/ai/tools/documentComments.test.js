import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  projectOverview,
  executeListDocuments,
  executeListComments,
  executeAddComment,
  executeReplyComment,
  executeResolveComment,
  executeReadDocument,
  executeEditDocument,
  executeUpdateDocument,
  applyProposal,
  readNotes,
} from '@/ai/tools/documents.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances, useDocuments } from '@/composables/useDocuments'
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
  'We had a {==cold and narrow==}{>>cabcd1<<} attic.\n\n' +
  'She {==walked==}{>>cabcd2<<} to the door.'

/** A post, as of a fixed time. */
const said = (text, author = 'writer') => ({ author, text, created: 1 })

/** An open thread on a passage. */
const open = (quote, ...posts) => ({ status: 'open', quote, posts })

const THREADS = {
  cabcd1: open('cold and narrow', said('reword this')),
  cabcd2: open('walked', said('too slow?')),
}

describe('comments', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store

  const text = (title, content, comments, extra = {}) =>
    store.createDocument({
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'text',
      title,
      content,
      ...(comments ? { comments } : {}),
      ...extra,
    })
  const chapter = () => text('Chapter 1', CHAPTER, JSON.parse(JSON.stringify(THREADS)))
  const content = id => store.getDocument(id).content
  const threads = id => store.getDocument(id).comments

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    store = useDocumentsStore()
    vi.clearAllMocks()
    // Builds the root, which the documents go in.
    await projectOverview(STORY)
  })

  it('are counted in the listing while open, on the documents that have any', async () => {
    chapter()
    text('Notes', 'Nothing flagged here.')
    text('Aside', 'One {==thing==}{>>cabcd3<<}.', {
      cabcd3: open('thing', said('why?')),
      cdone1: { ...open('gone', said('old')), status: 'resolved' },
    })

    const lines = String(await executeListDocuments({}, context)).split('\n')
    expect(lines.find(line => line.startsWith('Chapter 1'))).toMatch(/, 2 comments$/)
    expect(lines.find(line => line.startsWith('Aside'))).toMatch(/, 1 comment$/)
    expect(lines.find(line => line.startsWith('Notes'))).not.toContain('comment')
  })

  describe('read_document', () => {
    it('reads the text without the markup, and the comments after it', async () => {
      chapter()
      const result = await executeReadDocument({ path: 'Chapter 1' }, context)
      expect(result.content).toBe('We had a cold and narrow attic.\n\nShe walked to the door.')
      expect(result.comments).toEqual([
        {
          id: 'cabcd1',
          passage: 'cold and narrow',
          posts: [{ author: 'writer', text: 'reword this' }],
        },
        { id: 'cabcd2', passage: 'walked', posts: [{ author: 'writer', text: 'too slow?' }] },
      ])
    })

    it('tells a passage from its repeats, and leaves out what is resolved or has no thread', async () => {
      text(
        'Chapter 1',
        'She said yes. He {==said==}{>>cabcd1<<} no. {==Gulls==}{>>cnone1<<} cried.',
        {
          cabcd1: open('said', said('who?'), said('Tom.', 'model')),
          cdone1: { ...open('yes', said('old')), status: 'resolved' },
        }
      )
      const result = await executeReadDocument({ path: 'Chapter 1' }, context)
      expect(result.content).toBe('She said yes. He said no. Gulls cried.')
      expect(result.comments).toEqual([
        {
          id: 'cabcd1',
          passage: 'said',
          in: 'She said yes. He said no. Gulls cried.',
          posts: [
            { author: 'writer', text: 'who?' },
            { author: 'model', text: 'Tom.' },
          ],
        },
      ])
    })

    it('lists a comment over the end of a slice with the slice that has its last words', async () => {
      const paragraphs = Array.from(
        { length: 600 },
        (_, i) => `Line ${i} ${'and so on '.repeat(9)}`
      )
      const plain = paragraphs.join('\n\n')
      const document = text('Long', plain)
      const first = await executeReadDocument({ path: 'Long' }, context)
      const cut = first.to

      // The last words before the cut, and the first after it: one comment.
      const end = plain.lastIndexOf(' ', cut - 2)
      const start = plain.indexOf(' ', cut + 2)
      const marked =
        plain.slice(0, end + 1) +
        `{==${plain.slice(end + 1, cut)}==}{>>cabcd1<<}` +
        plain.slice(cut, cut + 2) +
        `{==${plain.slice(cut + 2, start)}==}{>>cabcd1<<}` +
        plain.slice(start)
      store.updateDocument(document.id, {
        comments: { cabcd1: open('x', said('across')) },
        content: marked,
      })

      const again = await executeReadDocument({ path: 'Long' }, context)
      expect(again.to).toBe(cut)
      expect(again.comments).toBeUndefined()
      const next = await executeReadDocument({ path: 'Long', from: again.next }, context)
      expect(next.comments.map(comment => comment.id)).toEqual(['cabcd1'])
    })

    it('counts a reply as a change to what was read', async () => {
      const document = chapter()
      const before = readNotes('read_document', { id: document.id, path: 'Chapter 1' })._hash
      await executeReplyComment({ path: 'Chapter 1', id: 'cabcd1', text: 'Done.' }, context)
      const after = readNotes('read_document', { id: document.id, path: 'Chapter 1' })._hash
      expect(after).not.toBe(before)
    })
  })

  describe('list_comments', () => {
    it('lists the open comments across the project, with their passages and posts', async () => {
      chapter()
      text('Notes', 'Say {==more==}{>>cabcd3<<}.', {
        cabcd3: open('more', said('about what?')),
        cgone1: open('the old lines', said('check'), said('Checked.', 'model')),
        cdone1: { ...open('done', said('old')), status: 'resolved' },
      })

      const { comments } = await executeListComments({}, context)

      expect(comments).toEqual([
        {
          id: 'cabcd1',
          path: 'Chapter 1',
          passage: 'cold and narrow',
          posts: [{ author: 'writer', text: 'reword this' }],
        },
        {
          id: 'cabcd2',
          path: 'Chapter 1',
          passage: 'walked',
          posts: [{ author: 'writer', text: 'too slow?' }],
        },
        {
          id: 'cabcd3',
          path: 'Notes',
          passage: 'more',
          posts: [{ author: 'writer', text: 'about what?' }],
        },
        {
          id: 'cgone1',
          path: 'Notes',
          passage: 'the old lines',
          stale: 'Its passage was deleted. resolve_comment takes it off.',
          posts: [
            { author: 'writer', text: 'check' },
            { author: 'model', text: 'Checked.' },
          ],
        },
      ])
    })

    it("lists one document's when asked for it, and refuses a path that is not there", async () => {
      chapter()
      text('Notes', 'Say {==more==}{>>cabcd3<<}.', { cabcd3: open('more', said('about what?')) })

      const { comments } = await executeListComments({ path: 'Notes' }, context)
      expect(comments.map(c => c.id)).toEqual(['cabcd3'])

      const missing = await executeListComments({ path: 'Nowhere' }, context)
      expect(missing.error).toContain('Nowhere')
    })
  })

  describe('add_comment', () => {
    const add = (passage, said, extra = {}) =>
      executeAddComment({ path: 'Chapter 1', passage, text: said }, { ...context, ...extra })

    it("puts the model's comment on the passage, with a thread of its own", async () => {
      const document = chapter()
      const edits = []

      const result = await add('to the door', 'Which door?', { edits })

      expect(result.success).toBe(true)
      const id = result.comment
      expect(content(document.id)).toContain(
        `She {==walked==}{>>cabcd2<<} {==to the door==}{>>${id}<<}.`
      )
      expect(threads(document.id)[id]).toMatchObject({
        status: 'open',
        quote: 'to the door',
        before: 'She walked ',
        after: '.',
        posts: [{ author: 'model', text: 'Which door?' }],
      })
      // Recorded as an edit with the thread it made, so a rewind takes both back.
      expect(edits).toHaveLength(1)
      expect(edits[0]).toMatchObject({ tool: 'edit_document', comments: [{ id, before: null }] })
      expect(useDocuments(STORY).revertEdit(edits[0])).toBe(true)
      expect(content(document.id)).toBe(CHAPTER)
      expect(threads(document.id)[id]).toBeUndefined()
      expect(await useDocuments(STORY).reapplyEdit(edits[0])).toBe(true)
      expect(threads(document.id)[id].posts[0].text).toBe('Which door?')
    })

    it('refuses words it cannot find once, or over paragraphs', async () => {
      chapter()
      expect((await add('a bus', 'x')).error).toContain('not found')
      expect((await add('a', 'x')).error).toContain('times')
      expect((await add('attic.\n\nShe', 'x')).error).toContain('one paragraph')
    })

    it('puts a comment on words another comment is on', async () => {
      const document = chapter()
      const result = await add('and narrow attic', 'Which attic?')

      expect(result.success).toBe(true)
      expect(content(document.id)).toBe(
        `We had a {==cold {==and narrow==}{>>${result.comment}<<}==}{>>cabcd1<<}` +
          `{== attic==}{>>${result.comment}<<}.\n\n` +
          'She {==walked==}{>>cabcd2<<} to the door.'
      )
      expect(threads(document.id)[result.comment]).toMatchObject({
        quote: 'and narrow attic',
        posts: [{ author: 'model', text: 'Which attic?' }],
      })
      expect(threads(document.id).cabcd1.quote).toBe('cold and narrow')
    })

    it("refuses words that run into a link's address", async () => {
      text('Chapter 1', 'See [the map](https://example.com/map) here.')
      const result = await add('map) here', 'x')
      expect(result.error).toContain('link')
    })

    it('proposes the comment when the chat asks the writer first', async () => {
      const document = chapter()
      const edits = []
      const result = await add('to the door', 'Which door?', { propose: true, edits })

      expect(result.proposed).toBe(true)
      expect(content(document.id)).toBe(CHAPTER)
      expect(Object.keys(threads(document.id))).toEqual(['cabcd1', 'cabcd2'])

      const applied = await applyProposal(STORY, edits[0])
      expect(applied.error).toBeUndefined()
      expect(content(document.id)).toContain(`{==to the door==}{>>${result.comment}<<}`)
      expect(threads(document.id)[result.comment].posts[0].author).toBe('model')
    })
  })

  describe('reply_comment', () => {
    it('adds the reply to the thread, and a rewind takes it back', async () => {
      const document = chapter()
      const edits = []

      const result = await executeReplyComment(
        { path: 'Chapter 1', id: 'cabcd1', text: 'Shortened it.' },
        { ...context, edits }
      )

      expect(result.success).toBe(true)
      expect(threads(document.id).cabcd1.posts).toEqual([
        said('reword this'),
        expect.objectContaining({ author: 'model', text: 'Shortened it.' }),
      ])
      expect(content(document.id)).toBe(CHAPTER)
      expect(edits[0]).toMatchObject({ tool: 'reply_comment', old: '', new: '' })
      expect(useDocuments(STORY).revertEdit(edits[0])).toBe(true)
      expect(threads(document.id).cabcd1.posts).toEqual([said('reword this')])
    })

    it('goes straight in when the chat asks first, being said rather than written', async () => {
      const document = chapter()
      await executeReplyComment(
        { path: 'Chapter 1', id: 'cabcd1', text: 'Why?' },
        { ...context, propose: true, edits: [] }
      )
      expect(threads(document.id).cabcd1.posts).toHaveLength(2)
    })

    it('refuses a comment that is not there', async () => {
      chapter()
      const result = await executeReplyComment(
        { path: 'Chapter 1', id: 'cnope1', text: 'Hi.' },
        context
      )
      expect(result.error).toContain('list_comments')
    })

    it('answers a comment its edit resolved, which stays resolved', async () => {
      const document = chapter()
      await executeEditDocument(
        { path: 'Chapter 1', old: 'cold and narrow', new: 'cramped' },
        context
      )
      expect(threads(document.id).cabcd1.status).toBe('resolved')

      const result = await executeReplyComment(
        { path: 'Chapter 1', id: 'cabcd1', text: 'Made it one word.' },
        context
      )

      expect(result.success).toBe(true)
      expect(result.comment.resolved).toBe(true)
      expect(threads(document.id).cabcd1.status).toBe('resolved')
      expect(threads(document.id).cabcd1.posts.map(post => post.author)).toEqual([
        'writer',
        'model',
      ])
    })
  })

  describe('resolve_comment', () => {
    it('takes the marker off, leaves the passage, and keeps the thread resolved', async () => {
      const document = chapter()
      const edits = []

      const result = await executeResolveComment(
        { path: 'Chapter 1', id: 'cabcd2' },
        { ...context, edits }
      )

      expect(result.success).toBe(true)
      expect(result.resolved).toBe('cabcd2')
      expect(content(document.id)).toContain('She walked to the door.')
      expect(content(document.id)).toContain('{==cold and narrow==}{>>cabcd1<<}')
      expect(threads(document.id).cabcd2.status).toBe('resolved')
      expect(threads(document.id).cabcd2.posts).toEqual([said('too slow?')])

      // Recorded as an ordinary edit, so it can be undone and made again.
      expect(edits).toHaveLength(1)
      expect(edits[0]).toMatchObject({ tool: 'edit_document' })
      expect(useDocuments(STORY).revertEdit(edits[0])).toBe(true)
      expect(content(document.id)).toBe(CHAPTER)
      expect(threads(document.id).cabcd2.status).toBe('open')
    })

    it('resolves a comment whose passage is gone, with no text to change', async () => {
      const document = text('Chapter 1', 'Nothing marked.', { cgone1: open('x', said('check')) })
      const edits = []
      const result = await executeResolveComment(
        { path: 'Chapter 1', id: 'cgone1' },
        { ...context, edits }
      )
      expect(result.success).toBe(true)
      expect(threads(document.id).cgone1.status).toBe('resolved')
      expect(edits[0]).toMatchObject({ tool: 'resolve_comment', old: '', new: '' })
    })

    it('says a comment resolved already is done, and changes nothing', async () => {
      const document = chapter()
      await executeEditDocument({ path: 'Chapter 1', old: 'walked', new: 'ran' }, context)
      const before = content(document.id)
      const edits = []

      const result = await executeResolveComment(
        { path: 'Chapter 1', id: 'cabcd2' },
        { ...context, edits }
      )

      expect(result).toMatchObject({ success: true, resolved: 'cabcd2', already: true })
      expect(content(document.id)).toBe(before)
      expect(edits).toEqual([])
    })

    it('names the ids that exist when the comment is not there', async () => {
      chapter()

      const result = await executeResolveComment({ path: 'Chapter 1', id: 'cnope1' }, context)

      expect(result.error).toContain('cnope1')
      expect(result.error).toContain('list_comments')
    })

    it('proposes the change when the chat asks the writer first', async () => {
      const document = chapter()
      const edits = []

      const result = await executeResolveComment(
        { path: 'Chapter 1', id: 'cabcd1' },
        { ...context, propose: true, edits }
      )

      expect(result.proposed).toBe(true)
      expect(content(document.id)).toBe(CHAPTER)
      expect(edits[0]).toMatchObject({ tool: 'edit_document', status: 'proposed' })

      await applyProposal(STORY, edits[0])
      expect(content(document.id)).toContain('We had a cold and narrow attic.')
      expect(threads(document.id).cabcd1.status).toBe('resolved')
    })
  })

  describe('edit_document over comments', () => {
    const edit = (old, replacement, extra = {}) =>
      executeEditDocument({ path: 'Chapter 1', old, new: replacement }, { ...context, ...extra })

    it('takes a quote without the markup, and keeps a comment whose words it leaves alone', async () => {
      const document = chapter()

      const result = await edit(
        'We had a cold and narrow attic.',
        'We had a cold and narrow cellar.'
      )

      expect(result.success).toBe(true)
      expect(result.resolvedComments).toBeUndefined()
      expect(content(document.id)).toContain('We had a {==cold and narrow==}{>>cabcd1<<} cellar.')
      expect(threads(document.id).cabcd1).toMatchObject({ status: 'open', after: ' cellar.' })
    })

    it('resolves a comment whose words it changes, says what it said, and keeps its thread', async () => {
      const document = chapter()
      const edits = []

      const result = await edit('She walked to the door.', 'She ran.', { edits })

      expect(result.success).toBe(true)
      expect(result.resolvedComments).toEqual([{ id: 'cabcd2', comment: 'too slow?' }])
      expect(content(document.id)).toContain('She ran.')
      expect(content(document.id)).not.toContain('cabcd2')
      expect(threads(document.id).cabcd2.status).toBe('resolved')

      expect(useDocuments(STORY).revertEdit(edits[0])).toBe(true)
      expect(content(document.id)).toBe(CHAPTER)
      expect(threads(document.id).cabcd2.status).toBe('open')
    })

    it('rewrites a sentence a comment ends inside of, and resolves it', async () => {
      const document = text(
        'Chapter 1',
        'Some parts {==are built, some are pla==}{>>cabcd4<<}nned, and some never will be.',
        { cabcd4: open('are built, some are pla', said('Reword this sentence.')) }
      )

      const result = await edit(
        'Some parts are built, some are planned, and some never will be.',
        'Parts are built, parts planned, and parts only hoped for.'
      )

      expect(result.resolvedComments).toEqual([{ id: 'cabcd4', comment: 'Reword this sentence.' }])
      expect(content(document.id)).toBe('Parts are built, parts planned, and parts only hoped for.')
    })

    it('makes no comment of markup the model writes', async () => {
      const document = chapter()

      await edit('to the door', 'to the {==door==}{>>cfake1<<}')

      expect(content(document.id)).not.toContain('cfake1')
      expect(content(document.id)).toContain('to the door.')
    })

    it('proposes the edit with the markup it takes in, and resolves on Accept', async () => {
      const document = chapter()
      const edits = []

      const result = await edit('She walked to the', 'He ran to the', { propose: true, edits })

      expect(result.proposed).toBe(true)
      expect(result.resolvedComments).toEqual([{ id: 'cabcd2', comment: 'too slow?' }])
      expect(content(document.id)).toBe(CHAPTER)
      expect(edits[0]).toMatchObject({
        status: 'proposed',
        old: 'She {==walked==}{>>cabcd2<<} to the',
        new: 'He ran to the',
      })
      expect(threads(document.id).cabcd2.status).toBe('open')

      await applyProposal(STORY, edits[0])
      expect(threads(document.id).cabcd2.status).toBe('resolved')
    })
  })

  it('update_document keeps comments on what the new body still says, and resolves the rest', async () => {
    const document = chapter()
    const result = await executeUpdateDocument(
      { path: 'Chapter 1', content: 'It was cold and narrow up there.' },
      context
    )
    expect(content(document.id)).toBe('It was {==cold and narrow==}{>>cabcd1<<} up there.')
    expect(result.resolvedComments).toEqual([{ id: 'cabcd2', comment: 'too slow?' }])
    expect(threads(document.id).cabcd2.status).toBe('resolved')
  })
})
