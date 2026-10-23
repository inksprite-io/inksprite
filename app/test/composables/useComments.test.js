import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { closeHistory, undo } from 'prosemirror-history'
import {
  useComments,
  forgetDone,
  commentDraft,
  currentComment,
  goToComment,
  leaveComment,
  startDraft,
  takeUpComment,
} from '@/composables/useComments'
import { draftRange, withDraft } from '@/editor/commentDraft.js'
import { useDocuments, clearDocumentInstances } from '@/composables/useDocuments'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useEditor, clearEditor } from '@/composables/useEditor.js'
import { commentRanges } from '@/editor/comments.js'
import { parseMarkdown, serializeMarkdown } from '@/editor/markdown.js'
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

const CHAPTER = 'We had a {==cold and narrow==}{>>cabcd1<<} attic.'

/** A post, as of a fixed time. */
const said = (text, author = 'writer') => ({ author, text, created: 1 })
const open = (quote, ...posts) => ({ status: 'open', quote, posts })
const resolved = (quote, ...posts) => ({ ...open(quote, ...posts), status: 'resolved' })

describe('useComments', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store

  const text = (title, content, comments, parentId = ROOT) =>
    store.createDocument({ storyId: STORY, parentId, type: 'text', title, content, comments })
  const chapter = () =>
    text('Chapter', CHAPTER, { cabcd1: open('cold and narrow', said('reword this')) })
  const thread = (documentId, id) => store.getDocument(documentId).comments?.[id]

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    clearEditor()
    store = useDocumentsStore()
    vi.clearAllMocks()
    await useDocuments(STORY).init()
    leaveComment(currentComment.value?.documentId ?? '')
    forgetDone()
  })

  it("lists each document's comments in the outline's order, and only those with any", () => {
    const notes = store.createDocument({
      storyId: STORY,
      parentId: ROOT,
      type: 'folder',
      title: 'Notes',
    })
    text('B chapter', 'And {==walked==}{>>cabcd2<<} on.', {
      cabcd2: open('walked', said('too slow?')),
    })
    chapter()
    text('C clean', 'Nothing flagged.')
    text(
      'Idea',
      'One {==thought==}{>>cabcd3<<}.',
      { cabcd3: open('thought', said('more')) },
      notes.id
    )

    const { groups } = useComments(STORY)

    expect(groups.value.map(group => [group.path, group.comments.map(c => c.id)])).toEqual([
      ['Notes/Idea', ['cabcd3']],
      ['B chapter', ['cabcd2']],
      ['Chapter', ['cabcd1']],
    ])
    expect(groups.value[2].comments[0]).toMatchObject({
      id: 'cabcd1',
      passage: 'cold and narrow',
      state: 'open',
      thread: { posts: [said('reword this')] },
    })
  })

  it('lists the stale and the resolved apart, and leaves out a marker with no thread', () => {
    text('Chapter', 'A {==b==}{>>cabcd1<<} and {==c==}{>>cnone1<<}.', {
      cabcd1: open('b', said('one')),
      cgone1: open('*old* words', said('two')),
      cdone1: resolved('done', said('three')),
    })
    const [group] = useComments(STORY).groups.value
    expect(group.comments.map(c => c.id)).toEqual(['cabcd1'])
    expect(group.stale).toMatchObject([{ id: 'cgone1', passage: 'old words', state: 'stale' }])
    expect(group.resolved).toMatchObject([{ id: 'cdone1', passage: 'done', state: 'resolved' }])
  })

  it('follows a document open in the editor as it changes', () => {
    const document = text('Chapter', 'Nothing yet.', { cabcd9: open('Nothing', said('hm')) })
    const editor = useEditor()
    const state = editor.open(document.id, document.content)
    const { groups } = useComments(STORY)
    expect(groups.value[0].comments).toEqual([])
    expect(groups.value[0].stale.map(c => c.id)).toEqual(['cabcd9'])

    const type = state.schema.marks.comment
    editor.dispatch(document.id, state.tr.addMark(1, 8, type.create({ id: 'cabcd9' })))

    expect(groups.value[0].comments).toMatchObject([{ id: 'cabcd9', passage: 'Nothing' }])
  })

  it('resolves a comment in a closed document, keeps its thread, and lets it go', () => {
    const document = chapter()
    const { groups, resolve } = useComments(STORY)
    goToComment(document.id, 'cabcd1')

    resolve(document.id, 'cabcd1')

    expect(store.getDocument(document.id).content).toBe('We had a cold and narrow attic.')
    expect(thread(document.id, 'cabcd1')).toMatchObject({ status: 'resolved', after: ' attic.' })
    expect(groups.value[0].comments).toEqual([])
    expect(groups.value[0].resolved.map(c => c.id)).toEqual(['cabcd1'])
    expect(currentComment.value).toBeNull()
  })

  it('resolves a comment in an open document as a change to it, which undoing opens again', () => {
    const document = chapter()
    const editor = useEditor()
    editor.open(document.id, document.content)
    const { groups, resolve } = useComments(STORY)
    const caret = editor.stateOf(document.id).selection.head

    resolve(document.id, 'cabcd1')

    const after = editor.stateOf(document.id)
    expect(commentRanges(after.doc)).toEqual([])
    expect(after.doc.textContent).toBe('We had a cold and narrow attic.')
    expect(after.selection.head).toBe(caret)
    expect(groups.value[0].resolved.map(c => c.id)).toEqual(['cabcd1'])

    undo(after, tr => editor.dispatch(document.id, tr))
    expect(groups.value[0].comments.map(c => c.id)).toEqual(['cabcd1'])
    editor.flush(document.id)
    expect(thread(document.id, 'cabcd1').status).toBe('open')
  })

  it('resolves one of two overlapping comments in an open document, the other kept', () => {
    const content =
      'We had a {==cold {==and narrow==}{>>cabcd2<<}==}{>>cabcd1<<}{== attic==}{>>cabcd2<<}.'
    const document = text('Chapter', content, {
      cabcd1: open('cold and narrow', said('reword this')),
      cabcd2: open('and narrow attic', said('which attic?')),
    })
    const editor = useEditor()
    editor.open(document.id, document.content)
    const { resolve } = useComments(STORY)

    resolve(document.id, 'cabcd1')

    const { doc } = editor.stateOf(document.id)
    expect(
      commentRanges(doc).map(range => [range.id, doc.textBetween(range.from, range.to)])
    ).toEqual([['cabcd2', 'and narrow attic']])
    editor.flush(document.id)
    expect(store.getDocument(document.id).content).toBe(
      'We had a cold {==and narrow attic==}{>>cabcd2<<}.'
    )
  })

  describe('suggestions', () => {
    const SUGGESTED =
      'We had a {==cold and narrow==}{>>cabcd1<<} attic, {--damp--}{>>sabcd1<<}{++dry++}{>>sabcd1<<} and dark.'
    const pending = (quote, text, posts = []) => ({
      status: 'open',
      quote,
      posts,
      suggestion: { text, created: 1, chat: 'chat_1' },
    })
    const suggested = () =>
      text('Chapter', SUGGESTED, {
        cabcd1: open('cold and narrow', said('reword this')),
        sabcd1: pending('damp', 'dry'),
      })

    it('lists one among the comments in the order of the text, with its change', () => {
      suggested()
      const [group] = useComments(STORY).groups.value
      expect(group.comments.map(c => [c.id, c.change ?? null])).toEqual([
        ['cabcd1', null],
        ['sabcd1', { out: 'damp', in: 'dry' }],
      ])
      expect(group.stale).toEqual([])
    })

    it('accepts one in a closed document, keeping its thread settled, and says when', () => {
      const document = suggested()
      const { groups, accept } = useComments(STORY)

      accept(document.id, 'sabcd1')

      expect(store.getDocument(document.id).content).toBe(
        'We had a {==cold and narrow==}{>>cabcd1<<} attic, dry and dark.'
      )
      expect(thread(document.id, 'sabcd1')).toMatchObject({
        status: 'resolved',
        suggestion: { settled: 'accepted', settledAt: expect.any(Number) },
      })
      expect(groups.value[0].resolved).toMatchObject([
        { id: 'sabcd1', state: 'resolved', change: { out: 'damp', in: 'dry' } },
      ])
    })

    it('resolves a comment whose passage accepting takes out, and rejecting none', () => {
      const document = text('Chapter', 'A {--{==cold==}{>>cabcd1<<} --}{>>sabcd1<<}night.', {
        cabcd1: open('cold', said('why cold?')),
        sabcd1: pending('cold ', ''),
      })
      useComments(STORY).accept(document.id, 'sabcd1')
      expect(store.getDocument(document.id).content).toBe('A night.')
      expect(thread(document.id, 'cabcd1').status).toBe('resolved')
    })

    it('rejects one in an open document as a change to it, which undoing opens again', () => {
      const document = suggested()
      const editor = useEditor()
      editor.open(document.id, document.content)
      const { groups, reject } = useComments(STORY)

      reject(document.id, 'sabcd1')

      const after = editor.stateOf(document.id)
      expect(after.doc.textContent).toBe('We had a cold and narrow attic, damp and dark.')
      expect(groups.value[0].comments.map(c => c.id)).toEqual(['cabcd1'])
      editor.flush(document.id)
      expect(thread(document.id, 'sabcd1').suggestion.settled).toBe('rejected')

      undo(after, tr => editor.dispatch(document.id, tr))
      expect(groups.value[0].comments.map(c => c.id)).toEqual(['cabcd1', 'sabcd1'])
      editor.flush(document.id)
      expect(thread(document.id, 'sabcd1')).toEqual(pending('damp', 'dry'))
    })

    it('takes one accepted in an open document back as undoing there would, and does it again', () => {
      const document = suggested()
      const editor = useEditor()
      editor.open(document.id, document.content)
      const comments = useComments(STORY)
      const ACCEPTED = 'We had a {==cold and narrow==}{>>cabcd1<<} attic, dry and dark.'

      comments.accept(document.id, 'sabcd1')
      expect(editor.markdown(document.id)).toBe(ACCEPTED)

      expect(comments.undo()).toBe(true)
      expect(editor.markdown(document.id)).toBe(SUGGESTED)
      expect(thread(document.id, 'sabcd1')).toEqual(pending('damp', 'dry'))
      expect(comments.groups.value[0].comments.map(c => c.id)).toEqual(['cabcd1', 'sabcd1'])
      // The step the editor's own undo would have taken: there is none before it.
      expect(undo(editor.stateOf(document.id))).toBe(false)

      expect(comments.redo()).toBe(true)
      expect(editor.markdown(document.id)).toBe(ACCEPTED)
      expect(thread(document.id, 'sabcd1').suggestion.settled).toBe('accepted')
      expect(comments.redo()).toBe(false)

      expect(comments.undo()).toBe(true)
      editor.flush(document.id)
      expect(store.getDocument(document.id).content).toBe(SUGGESTED)
      expect(thread(document.id, 'sabcd1')).toEqual(pending('damp', 'dry'))
      expect(comments.undo()).toBe(false)
    })

    it('takes back two accepted in turn, and none once a change lies between', () => {
      const TWO =
        'A {--cold--}{>>sabcd1<<}{++warm++}{>>sabcd1<<} night, {++very ++}{>>sabcd2<<}dark.'
      const document = text('Chapter', TWO, {
        sabcd1: pending('cold', 'warm'),
        sabcd2: pending('', 'very '),
      })
      const editor = useEditor()
      editor.open(document.id, document.content)
      const comments = useComments(STORY)

      comments.accept(document.id, 'sabcd1')
      comments.accept(document.id, 'sabcd2')
      expect(comments.undo()).toBe(true)
      expect(comments.undo()).toBe(true)
      expect(editor.markdown(document.id)).toBe(TWO)

      comments.accept(document.id, 'sabcd1')
      // Typed and deleted again: the text reads as the accept left it, and
      // the step undoing would take is the deleting.
      const end = () => editor.stateOf(document.id).doc.content.size - 1
      editor.dispatch(document.id, editor.stateOf(document.id).tr.insertText('!', end()))
      editor.dispatch(
        document.id,
        closeHistory(editor.stateOf(document.id).tr.delete(end() - 1, end()))
      )
      expect(comments.undo()).toBe(false)
      expect(editor.markdown(document.id)).toBe('A warm night, {++very ++}{>>sabcd2<<}dark.')
    })

    it('takes one accepted in a closed document back by putting back what it said', () => {
      const CUT = 'A {--{==cold==}{>>cabcd1<<} --}{>>sabcd1<<}night.'
      const document = text('Chapter', CUT, {
        cabcd1: open('cold', said('why cold?')),
        sabcd1: pending('cold ', ''),
      })
      const comments = useComments(STORY)

      comments.accept(document.id, 'sabcd1')
      expect(thread(document.id, 'cabcd1').status).toBe('resolved')

      expect(comments.undo()).toBe(true)
      // As the store keeps any text, in the editor's markup.
      expect(store.getDocument(document.id).content).toBe(serializeMarkdown(parseMarkdown(CUT)))
      expect(thread(document.id, 'sabcd1')).toEqual(pending('cold ', ''))
      expect(thread(document.id, 'cabcd1').status).toBe('open')
    })

    it('leaves one the text has changed around since, and takes back what came before', () => {
      const first = suggested()
      const second = text('Two', 'A {++cold ++}{>>sabcd2<<}night.', {
        sabcd2: pending('', 'cold '),
      })
      const editor = useEditor()
      editor.open(second.id, second.content)
      const comments = useComments(STORY)
      comments.accept(first.id, 'sabcd1')
      comments.accept(second.id, 'sabcd2')
      const typed = editor.stateOf(second.id)
      editor.dispatch(second.id, typed.tr.insertText('!', typed.doc.content.size - 1))

      expect(comments.undo()).toBe(true)
      expect(editor.markdown(second.id)).toBe('A cold night.!')
      expect(store.getDocument(first.id).content).toBe(SUGGESTED)
      expect(comments.undo()).toBe(false)
    })

    it('deletes any post of one alone, the first too, and leaves the suggestion', () => {
      const document = text('Chapter', SUGGESTED, {
        cabcd1: open('cold and narrow', said('reword this')),
        sabcd1: pending('damp', 'dry', [said('Drier.', 'model')]),
      })
      useComments(STORY).deletePost(document.id, 'sabcd1', 0)
      expect(thread(document.id, 'sabcd1').posts).toEqual([])
      expect(store.getDocument(document.id).content).toBe(SUGGESTED)
    })
  })

  it("answers a comment, and changes any of the writer's posts, never the model's", () => {
    const document = chapter()
    const { reply, editPost } = useComments(STORY)

    reply(document.id, 'cabcd1', '  and the  tense ')
    expect(thread(document.id, 'cabcd1').posts.map(p => [p.author, p.text])).toEqual([
      ['writer', 'reword this'],
      ['writer', 'and the tense'],
    ])

    const posts = thread(document.id, 'cabcd1').posts
    store.updateDocument(document.id, {
      comments: {
        cabcd1: { ...thread(document.id, 'cabcd1'), posts: [...posts, said('Done.', 'model')] },
      },
    })

    editPost(document.id, 'cabcd1', 0, 'reword this, please')
    const after = thread(document.id, 'cabcd1').posts
    expect(after[0]).toMatchObject({
      author: 'writer',
      text: 'reword this, please',
      created: 1,
      edited: expect.any(Number),
    })
    expect(after.map(post => post.text)).toEqual(['reword this, please', 'and the tense', 'Done.'])

    editPost(document.id, 'cabcd1', 2, 'not mine to change')
    expect(thread(document.id, 'cabcd1').posts[2].text).toBe('Done.')
  })

  it('deletes a reply alone, and the comment whole by its first post', () => {
    const document = text('Chapter', CHAPTER, {
      cabcd1: open('cold and narrow', said('reword this'), said('Done.', 'model'), said('Thanks.')),
    })
    const { deletePost } = useComments(STORY)

    deletePost(document.id, 'cabcd1', 1)
    expect(thread(document.id, 'cabcd1').posts.map(post => post.text)).toEqual([
      'reword this',
      'Thanks.',
    ])

    deletePost(document.id, 'cabcd1', 0)
    expect(store.getDocument(document.id).comments).toBeUndefined()
    expect(store.getDocument(document.id).content).toBe('We had a cold and narrow attic.')
  })

  it('deletes a comment in an open document outside the undo history', () => {
    const document = chapter()
    const editor = useEditor()
    editor.open(document.id, document.content)
    const { remove } = useComments(STORY)

    remove(document.id, 'cabcd1')

    const after = editor.stateOf(document.id)
    expect(commentRanges(after.doc)).toEqual([])
    expect(store.getDocument(document.id).comments).toBeUndefined()
    // Nothing for undo to bring back: its thread is gone.
    expect(undo(after)).toBe(false)
  })

  it('takes back a comment resolved or deleted, on its passage with its thread', () => {
    const document = chapter()
    const editor = useEditor()
    editor.open(document.id, document.content)
    const comments = useComments(STORY)
    const placed = () => commentRanges(editor.stateOf(document.id).doc).map(range => range.id)

    comments.resolve(document.id, 'cabcd1')
    expect(comments.undo()).toBe(true)
    expect(placed()).toEqual(['cabcd1'])
    expect(thread(document.id, 'cabcd1')).toMatchObject(
      open('cold and narrow', said('reword this'))
    )

    comments.remove(document.id, 'cabcd1')
    expect(comments.undo()).toBe(true)
    expect(placed()).toEqual(['cabcd1'])
    expect(thread(document.id, 'cabcd1')).toMatchObject(
      open('cold and narrow', said('reword this'))
    )
    // Neither is in the editor's own history now: it was taken back there, or never in it.
    expect(undo(editor.stateOf(document.id))).toBe(false)

    expect(comments.redo()).toBe(true)
    expect(placed()).toEqual([])
    expect(store.getDocument(document.id).comments).toBeUndefined()

    const closed = text('Two', 'She {==ran==}{>>cabcd2<<}.', { cabcd2: open('ran', said('x')) })
    comments.deletePost(closed.id, 'cabcd2', 0)
    expect(comments.undo()).toBe(true)
    expect(store.getDocument(closed.id).content).toBe('She {==ran==}{>>cabcd2<<}.')
    expect(thread(closed.id, 'cabcd2')).toMatchObject(open('ran', said('x')))
  })

  it('takes back a reply while the thread says what it left it saying, in its project only', () => {
    const document = chapter()
    const comments = useComments(STORY)
    const texts = () => thread(document.id, 'cabcd1').posts.map(post => post.text)

    comments.reply(document.id, 'cabcd1', 'and the tense')
    expect(useComments('story_2').undo()).toBe(false)
    expect(comments.undo()).toBe(true)
    expect(texts()).toEqual(['reword this'])
    expect(comments.redo()).toBe(true)
    expect(texts()).toEqual(['reword this', 'and the tense'])

    store.updateDocument(document.id, {
      comments: {
        cabcd1: {
          ...thread(document.id, 'cabcd1'),
          posts: [...thread(document.id, 'cabcd1').posts, said('Done.', 'model')],
        },
      },
    })
    expect(comments.undo()).toBe(false)
    expect(texts()).toEqual(['reword this', 'and the tense', 'Done.'])
  })

  it('reopens a resolved comment on its passage, in a closed or an open document', () => {
    const document = text('Chapter', 'We had a cold and narrow attic.', {
      cabcd1: { ...resolved('cold and narrow', said('reword this')), before: 'We had a ' },
    })
    const { reopen } = useComments(STORY)
    expect(reopen(document.id, 'cabcd1')).toBe(true)
    expect(store.getDocument(document.id).content).toBe(CHAPTER)
    expect(thread(document.id, 'cabcd1').status).toBe('open')

    const second = text('Two', 'She ran.', { cabcd2: resolved('ran', said('x')) })
    const editor = useEditor()
    editor.open(second.id, second.content)
    expect(reopen(second.id, 'cabcd2')).toBe(true)
    expect(commentRanges(editor.stateOf(second.id).doc).map(range => range.id)).toEqual(['cabcd2'])
  })

  it('leaves a comment resolved whose words are gone, and deletes one for good', () => {
    const document = text('Chapter', 'Nothing like it.', { cabcd1: resolved('cold', said('x')) })
    const { reopen, remove } = useComments(STORY)
    expect(reopen(document.id, 'cabcd1')).toBe(false)
    expect(thread(document.id, 'cabcd1').status).toBe('resolved')
    remove(document.id, 'cabcd1')
    expect(store.getDocument(document.id).comments).toBeUndefined()
    expect(store.getDocument(document.id).content).toBe('Nothing like it.')
  })

  it('makes a new comment begun in the editor on the passage it holds, and makes it current', () => {
    const document = text('Chapter', 'We had a cold and narrow attic.')
    const editor = useEditor()
    const state = editor.open(document.id, document.content)
    // "cold", which the editor keeps while the comment is written.
    editor.dispatch(document.id, withDraft(state.tr, { from: 10, to: 14 }))
    startDraft(document.id, 'cold')
    const { groups, addDraft } = useComments(STORY)
    // A document with no comments yet is listed while one is being written.
    expect(groups.value.map(group => group.documentId)).toEqual([document.id])

    // Typing before it moves it.
    editor.dispatch(document.id, editor.stateOf(document.id).tr.insertText('So ', 1))
    const id = addDraft('Too cold?')

    expect(commentDraft.value).toBe(null)
    const after = editor.stateOf(document.id)
    expect(draftRange(after)).toBe(null)
    const [range] = commentRanges(after.doc)
    expect(range.id).toBe(id)
    expect(after.doc.textBetween(range.from, range.to)).toBe('cold')
    expect(thread(document.id, id).posts).toMatchObject([{ author: 'writer', text: 'Too cold?' }])
    expect(currentComment.value).toMatchObject({ documentId: document.id, id })
    // Undo takes back the typing, and leaves the comment.
    let undone = after
    undo(after, tr => {
      undone = after.apply(tr)
    })
    expect(undone.doc.textContent).toBe('We had a cold and narrow attic.')
    expect(commentRanges(undone.doc).map(each => each.id)).toEqual([id])
  })

  it('keeps a preview tab its document was commented in, as writing in it does', () => {
    const document = text('Chapter', 'We had a cold and narrow attic.')
    const api = useDocuments(STORY)
    api.open(document.id, { preview: true })
    expect(api.tabs.value.preview).toBe(document.id)
    const editor = useEditor()
    const state = editor.open(document.id, document.content)
    editor.dispatch(document.id, withDraft(state.tr, { from: 10, to: 14 }))
    startDraft(document.id, 'cold')

    useComments(STORY).addDraft('Too cold?')

    expect(api.tabs.value.preview).toBe(null)
    expect(api.tabs.value.open).toContain(document.id)
  })

  it('places a new comment among the open ones by where its passage is', () => {
    const document = text('Chapter', 'A {==b==}{>>cabcd1<<} c d {==e==}{>>cabcd2<<} f.', {
      cabcd1: open('b', said('one')),
      cabcd2: open('e', said('two')),
    })
    const editor = useEditor()
    const state = editor.open(document.id, document.content)
    const { groups } = useComments(STORY)
    expect(groups.value[0].draftAt).toBe(null)

    // "d", between the two.
    const at = state.doc.textContent.indexOf('d') + 1
    editor.dispatch(document.id, withDraft(state.tr, { from: at, to: at + 1 }))
    startDraft(document.id, 'd')
    expect(groups.value[0].draftAt).toBe(1)

    // "A", before both.
    const now = editor.stateOf(document.id)
    editor.dispatch(document.id, withDraft(now.tr, { from: 1, to: 2 }))
    startDraft(document.id, 'A')
    expect(groups.value[0].draftAt).toBe(0)
  })

  it('drops a new comment, its passage let go in the editor', () => {
    const document = text('Chapter', 'We had a cold and narrow attic.')
    const editor = useEditor()
    const state = editor.open(document.id, document.content)
    editor.dispatch(document.id, withDraft(state.tr, { from: 10, to: 14 }))
    startDraft(document.id, 'cold')

    useComments(STORY).cancelDraft()

    expect(commentDraft.value).toBe(null)
    expect(draftRange(editor.stateOf(document.id))).toBe(null)
  })

  it('does nothing for a comment that is not there', () => {
    const document = chapter()
    goToComment(document.id, 'cabcd1')
    useComments(STORY).resolve(document.id, 'cnope1')
    expect(store.getDocument(document.id).content).toBe(CHAPTER)
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
