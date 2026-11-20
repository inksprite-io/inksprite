import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  projectOverview,
  executeAppendDocument,
  executeEditDocument,
  executeListComments,
  executeListDocuments,
  executeReadDocument,
  executeReplyComment,
  executeResolveComment,
  executeUpdateDocument,
  settledSuggestions,
  SUGGESTED_NOTE,
} from '@/ai/tools/documents.js'
import { SUGGESTIONS_MOST, suggestionsAsRead } from '@/ai/tools/commentReads.js'
import { useComments } from '@/composables/useComments'
import { useChatsStore } from '@/stores/chatsStore'
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances, useDocuments } from '@/composables/useDocuments'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { parseMarkdown, serializeMarkdown } from '@/editor/markdown.js'
import { withoutComments } from '@/editor/comments.js'
import { anyEdit, plain, random, WORDS } from '../../drive/randomEdits.js'

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
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn(), start: () => false }),
}))

const STORY = 'story_1'
const CHAT = 'chat_1'
const OTHER = 'chat_2'

/** A document with a little of everything a suggestion meets. */
const SAMPLE = [
  '# Harbour notes',
  'Rain from the west, **hard**, then *dry*. Ask [Ada](https://example.com) about it.',
  'The ferry was late again and {==nobody minded==}{>>c7k2m1<<} much.',
  '- Ropes\n- Oars',
  '> Mind the gap.',
  '| Day | Miles |\n| --- | --- |\n| Mon | 12 |',
  '```\ncode stays\n```',
  '---',
  'Last words of the day.',
].join('\n\n')

/** The text as the model sees it, with one to three edits made to it at random. */
const edited = (text, next) => {
  const blocks = text.split('\n\n')
  const pick = list => {
    const choices = list.map((block, i) => (plain(block) ? i : -1)).filter(i => i >= 0)
    return choices.length ? choices[Math.floor(next() * choices.length)] : -1
  }
  const count = 1 + Math.floor(next() * 3)
  for (let k = 0; k < count; k++) {
    if (next() < 0.15) blocks.splice(Math.floor(next() * (blocks.length + 1)), 0, '---')
    else anyEdit(blocks, pick, next)
  }
  return blocks.join('\n\n')
}

/** A word of the text there once, as `old`, and another in its place. */
const oneWord = (text, next) => {
  const once = [...new Set(text.match(/\b[a-z]{4,}\b/g))].filter(
    word => text.split(word).length === 2
  )
  if (once.length === 0) return null
  return {
    old: once[Math.floor(next() * once.length)],
    new: WORDS[Math.floor(next() * WORDS.length)],
  }
}

/** The ids in a text's suggestion markup, in order, each once. */
const idsIn = content => [
  ...new Set([...content.matchAll(/[-+]\}\{>>([a-z0-9]+)<<\}/g)].map(m => m[1])),
]

describe('suggestions from the edit tools', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store
  /** @type {import('@/types/models.js').DocumentEdit[]} */
  let edits

  /** A chat that asks first, keeping a record of its turn. */
  const asking = (chatId = CHAT) => ({ storyId: STORY, chatId, propose: true, edits })
  /** A chat whose edits go straight in. */
  const applying = (chatId = CHAT) => ({ storyId: STORY, chatId, edits })

  const text = (title, content, extra = {}) =>
    store.createDocument({
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'text',
      title,
      content,
      ...extra,
    })
  const content = id => store.getDocument(id).content
  const threads = id => store.getDocument(id).comments || {}

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    store = useDocumentsStore()
    vi.clearAllMocks()
    edits = []
    await projectOverview(STORY)
  })

  it('writes a change into the text, with a thread for it, in a chat that asks first', async () => {
    const doc = text('Chapter 1', 'A cold night.\n\nThe tide came in.')

    const result = await executeEditDocument(
      { path: 'Chapter 1', old: 'A cold night.', new: 'A warm night.' },
      asking()
    )

    const [id] = idsIn(content(doc.id))
    expect(content(doc.id)).toBe(
      `A {--cold--}{>>${id}<<}{++warm++}{>>${id}<<} night.\n\nThe tide came in.`
    )
    expect(result).toEqual({
      suggested: true,
      document: { path: 'Chapter 1' },
      suggestion: id,
      note: SUGGESTED_NOTE,
    })
    expect(threads(doc.id)[id]).toEqual({
      status: 'open',
      quote: 'cold',
      posts: [],
      suggestion: { text: 'warm', created: expect.any(Number), chat: CHAT },
    })
    expect(edits).toHaveLength(1)
    expect(edits[0]).toMatchObject({ tool: 'edit_document', suggested: true })
    expect(edits[0].comments).toEqual([{ id, before: null, after: threads(doc.id)[id] }])
  })

  it('reads its own suggestion made, and another chat reads the text as it stands', async () => {
    text('Chapter 1', 'A cold night.')
    await executeEditDocument({ path: 'Chapter 1', old: 'cold', new: 'warm' }, asking())

    const own = await executeReadDocument({ path: 'Chapter 1' }, { storyId: STORY, chatId: CHAT })
    const other = await executeReadDocument(
      { path: 'Chapter 1' },
      { storyId: STORY, chatId: OTHER }
    )
    expect(own.content).toBe('A warm night.')
    expect(other.content).toBe('A cold night.')
  })

  it('folds a change into its own suggestion where it touches it', async () => {
    const doc = text('Chapter 1', 'A cold night.\n\nThe tide came in.')
    await executeEditDocument({ path: 'Chapter 1', old: 'cold', new: 'warm' }, asking())
    const [first] = idsIn(content(doc.id))

    const again = await executeEditDocument(
      { path: 'Chapter 1', old: 'A warm night.', new: 'A chilly night.' },
      asking()
    )

    expect(again.suggestion).toBe(first)
    expect(content(doc.id)).toBe(
      `A {--cold--}{>>${first}<<}{++chilly++}{>>${first}<<} night.\n\nThe tide came in.`
    )
    expect(threads(doc.id)[first]).toMatchObject({ quote: 'cold', suggestion: { text: 'chilly' } })
    expect(Object.keys(threads(doc.id))).toEqual([first])
  })

  it('makes a change apart its own suggestion', async () => {
    const doc = text('Chapter 1', 'A cold night.\n\nThe tide came in.')
    await executeEditDocument({ path: 'Chapter 1', old: 'cold', new: 'warm' }, asking())
    const [first] = idsIn(content(doc.id))

    const apart = await executeEditDocument(
      { path: 'Chapter 1', old: 'came in', new: 'went out' },
      asking()
    )

    expect(apart.suggestion).not.toBe(first)
    expect(idsIn(content(doc.id))).toEqual([first, apart.suggestion])
    expect(threads(doc.id)[apart.suggestion].quote).toBe('came in')
  })

  it('makes each change of a rewrite a suggestion of its own, with its thread', async () => {
    const before = 'The thief slipped quietly in. She listened intently.\n\nThe tide came in.'
    const doc = text('Chapter 1', before)

    const result = await executeUpdateDocument(
      { path: 'Chapter 1', content: 'The thief slipped in. She listened.\n\nThe tide went out.' },
      asking()
    )

    const ids = idsIn(content(doc.id))
    expect(ids).toHaveLength(3)
    expect(result).toMatchObject({ suggested: true, suggestions: ids, note: SUGGESTED_NOTE })
    expect(ids.map(id => [threads(doc.id)[id].quote, threads(doc.id)[id].suggestion.text])).toEqual(
      [
        ['quietly ', ''],
        [' intently', ''],
        ['came in', 'went out'],
      ]
    )
    expect(edits).toHaveLength(1)
    expect(edits[0].comments.map(change => change.id)).toEqual(ids)

    expect(useDocuments(STORY).revertEdit(edits[0])).toBe(true)
    expect(content(doc.id)).toBe(before)
    expect(threads(doc.id)).toEqual({})
  })

  it('takes back its own suggestion when the change puts the words back', async () => {
    const doc = text('Chapter 1', 'A cold night.')
    await executeEditDocument({ path: 'Chapter 1', old: 'cold', new: 'warm' }, asking())
    const [first] = idsIn(content(doc.id))

    const back = await executeEditDocument(
      { path: 'Chapter 1', old: 'warm', new: 'cold' },
      asking()
    )

    expect(content(doc.id)).toBe('A cold night.')
    expect(back).toMatchObject({ suggested: true, withdrawn: [first] })
    expect(back.note).toMatch(/suggestion is gone/)
    expect(threads(doc.id)[first]).toMatchObject({
      status: 'resolved',
      suggestion: { settled: 'withdrawn' },
    })
  })

  it('joins two of its own a change bridges, under the older, the posts of both kept', async () => {
    const doc = text('Chapter 1', 'A cold night.\n\nThe tide came in.')
    await executeEditDocument({ path: 'Chapter 1', old: 'cold', new: 'warm' }, asking())
    await executeEditDocument({ path: 'Chapter 1', old: 'came in', new: 'went out' }, asking())
    const [older, later] = idsIn(content(doc.id))
    await executeReplyComment({ path: 'Chapter 1', id: older, text: 'Warmer.' }, asking())
    await executeReplyComment({ path: 'Chapter 1', id: later, text: 'Ebbing.' }, asking())

    const joined = await executeEditDocument(
      { path: 'Chapter 1', old: 'night.\n\nThe tide', new: 'night, and the tide' },
      asking()
    )

    expect(joined).toMatchObject({ suggestion: older, joined: [{ id: later, into: older }] })
    expect(idsIn(content(doc.id))).toEqual([older])
    expect(threads(doc.id)[later]).toBeUndefined()
    expect(threads(doc.id)[older].posts.map(post => post.text)).toEqual(['Warmer.', 'Ebbing.'])
  })

  it('leaves another chat’s suggestion its own, and its chat sees it so', async () => {
    const doc = text('Chapter 1', 'A cold night.\n\nThe tide came in.')
    await executeEditDocument({ path: 'Chapter 1', old: 'cold', new: 'warm' }, asking(OTHER))
    const [theirs] = idsIn(content(doc.id))

    const read = await executeReadDocument({ path: 'Chapter 1' }, { storyId: STORY, chatId: CHAT })
    expect(read.content).toBe('A cold night.\n\nThe tide came in.')
    const mine = await executeEditDocument(
      { path: 'Chapter 1', old: 'came in', new: 'went out' },
      asking()
    )

    expect(idsIn(content(doc.id))).toEqual([theirs, mine.suggestion])
    const seen = await executeReadDocument({ path: 'Chapter 1' }, { storyId: STORY, chatId: OTHER })
    expect(seen.content).toBe('A warm night.\n\nThe tide came in.')
  })

  it('puts a whole block in, appended or rewritten', async () => {
    const doc = text('Notes', 'First.')
    const appended = await executeAppendDocument({ path: 'Notes', text: 'Second.' }, asking())
    const id = appended.suggestion
    expect(content(doc.id)).toBe(`First.\n\n{++Second.++}{>>${id}<<}`)
    expect(edits[0]).toMatchObject({ tool: 'append_document', suggested: true })

    const rewritten = await executeUpdateDocument(
      { path: 'Notes', content: 'First.\n\nSecond.\n\n---' },
      asking()
    )
    expect(rewritten.suggestion).toBe(id)
    expect(content(doc.id)).toBe(`First.\n\n{++Second.++}{>>${id}<<}\n\n{++\n---\n++}{>>${id}<<}`)
  })

  it('keeps a comment on words a suggestion would change', async () => {
    const doc = text('Chapter 1', 'A {==cold==}{>>cabcd1<<} night.', {
      comments: { cabcd1: { status: 'open', quote: 'cold', posts: [] } },
    })

    const result = await executeEditDocument(
      { path: 'Chapter 1', old: 'cold', new: 'warm' },
      asking()
    )

    expect(result.resolvedComments).toBeUndefined()
    expect(content(doc.id)).toContain('{==')
    expect(threads(doc.id).cabcd1.status).toBe('open')
  })

  it('says when the text already reads so', async () => {
    const doc = text('Chapter 1', 'A cold night.')

    const result = await executeEditDocument(
      { path: 'Chapter 1', old: 'cold', new: 'cold' },
      asking()
    )

    expect(result.unchanged).toMatch(/nothing was suggested/)
    expect(content(doc.id)).toBe('A cold night.')
    expect(edits).toEqual([])
  })

  it('reads suggestion markup in what the model writes as the change it marks', async () => {
    const doc = text('Chapter 1', 'A cold night.')

    await executeEditDocument(
      {
        path: 'Chapter 1',
        old: 'A cold night.',
        new: 'A {--cold--}{>>sxxxxx<<}{++warm++}{>>sxxxxx<<} night.',
      },
      asking()
    )

    const [id] = idsIn(content(doc.id))
    expect(id).not.toBe('sxxxxx')
    expect(content(doc.id)).toBe(`A {--cold--}{>>${id}<<}{++warm++}{>>${id}<<} night.`)
  })

  it('finds a quote in the text as the chat sees it, and says where it missed', async () => {
    text('Chapter 1', 'A cold night.')
    await executeEditDocument({ path: 'Chapter 1', old: 'cold', new: 'warm' }, asking())

    const missed = await executeEditDocument(
      { path: 'Chapter 1', old: 'A cold night', new: 'A dark night' },
      asking()
    )

    expect(missed.error).toMatch(/not found/)
    expect(missed.nearest).toBe('A warm night.')
  })

  it('is taken back by rewinding, and the one it went into is put back as it was', async () => {
    const doc = text('Chapter 1', 'A cold night.')
    await executeEditDocument({ path: 'Chapter 1', old: 'cold', new: 'warm' }, asking())
    const first = content(doc.id)
    const thread = threads(doc.id)
    await executeEditDocument({ path: 'Chapter 1', old: 'warm', new: 'chilly' }, asking())
    const api = useDocuments(STORY)

    expect(api.revertEdit(edits[1])).toBe(true)
    expect(content(doc.id)).toBe(first)
    expect(threads(doc.id)).toEqual(thread)

    expect(api.revertEdit(edits[0])).toBe(true)
    expect(content(doc.id)).toBe('A cold night.')
    expect(threads(doc.id)).toEqual({})

    expect(await api.reapplyEdit(edits[0])).toBe(true)
    expect(content(doc.id)).toBe(first)
  })

  it('takes an appended suggestion back wherever it went', async () => {
    const doc = text('Notes', 'First.')
    await executeAppendDocument({ path: 'Notes', text: 'Second.' }, asking())
    await executeAppendDocument({ path: 'Notes', text: 'Third.' }, asking())
    const api = useDocuments(STORY)
    api.setContent(doc.id, `${content(doc.id)}\n\nThe writer's own.`)

    expect(api.revertEdit(edits[1])).toBe(true)
    expect(api.revertEdit(edits[0])).toBe(true)
    expect(content(doc.id)).toBe("First.\n\nThe writer's own.")
  })

  it('proposes in the chat for a plain document', async () => {
    text('Prompt', 'Be brief.', { plain: true })

    expect(
      await executeEditDocument({ path: 'Prompt', old: 'brief', new: 'kind' }, asking())
    ).toMatchObject({ proposed: true })
  })

  it('makes an edit at once over another’s suggestion, which stays', async () => {
    const doc = text('Chapter 1', 'A cold night.\n\nThe tide came in.')
    await executeEditDocument({ path: 'Chapter 1', old: 'cold', new: 'warm' }, asking(OTHER))
    const [theirs] = idsIn(content(doc.id))

    const made = await executeEditDocument(
      { path: 'Chapter 1', old: 'A cold night.\n\nThe tide', new: 'A cold night.\n\nThe sea' },
      applying()
    )

    expect(made).toMatchObject({ success: true })
    expect(content(doc.id)).toBe(
      `A {--cold--}{>>${theirs}<<}{++warm++}{>>${theirs}<<} night.\n\nThe sea came in.`
    )
    expect(edits.at(-1)).not.toHaveProperty('suggested')
  })

  it('keeps its view, its threads and rewinding true over changes made at random', async () => {
    const next = random(73)
    const api = useDocuments(STORY)
    const comment = { status: 'open', quote: 'nobody minded', posts: [] }
    const mine = { storyId: STORY, chatId: CHAT }
    const theirs = { storyId: STORY, chatId: OTHER }
    let rounds = 0
    let withdrawn = 0
    for (let round = 0; round < 60; round++) {
      edits = []
      const path = `Round ${round}`
      const doc = text(path, SAMPLE, { comments: { c7k2m1: comment } })
      const start = content(doc.id)
      const held = threads(doc.id)
      const first = (await executeReadDocument({ path }, mine)).content
      for (let k = 1 + Math.floor(next() * 4); k > 0; k--) {
        const seen = (await executeReadDocument({ path }, mine)).content
        const word = next() < 0.3 ? oneWord(seen, next) : null
        const back = !word && next() < 0.1
        const wanted = word ? seen.replace(word.old, word.new) : back ? first : edited(seen, next)
        const result = word
          ? await executeEditDocument({ path, ...word }, asking())
          : await executeUpdateDocument({ path, content: wanted }, asking())
        expect(result.error).toBeUndefined()
        rounds++
        if (result.withdrawn) withdrawn += result.withdrawn.length

        // It reads back what it meant, and every other chat the text as it stands.
        const now = (await executeReadDocument({ path }, mine)).content
        expect(now).toBe(withoutComments(serializeMarkdown(parseMarkdown(wanted))))
        expect((await executeReadDocument({ path }, theirs)).content).toBe(first)
        if (back) expect(content(doc.id)).toBe(start)

        // A thread open for each suggestion in the text, and only for those.
        const placed = idsIn(content(doc.id))
        const open = Object.entries(threads(doc.id))
          .filter(([, thread]) => thread.suggestion && thread.status === 'open')
          .map(([id]) => id)
        expect(open.sort()).toEqual([...placed].sort())
        for (const id of placed) expect(threads(doc.id)[id].suggestion.chat).toBe(CHAT)

        // Each is told of once, to its own chat and to another, as words that
        // are where it says in the text that chat reads: what it put there
        // for its own, and what it would change for the other.
        for (const [reader, read] of [
          [CHAT, now],
          [OTHER, first],
        ]) {
          const told = suggestionsAsRead(store.getDocument(doc.id), null, reader).placed
          expect(told.map(each => each.id).sort()).toEqual([...placed].sort())
          for (const each of told) {
            expect(each.own).toBe(reader === CHAT)
            expect(read.slice(each.start, each.end)).toBe(each.own ? each.to : each.from)
            expect(each.from).not.toBe(each.to)
          }
        }
      }
      for (const edit of [...edits].reverse()) expect(api.revertEdit(edit)).toBe(true)
      expect(content(doc.id)).toBe(start)
      expect(threads(doc.id)).toEqual(held)
    }
    expect(rounds).toBeGreaterThan(100)
    expect(withdrawn).toBeGreaterThan(0)
  })

  it('names the chat its suggestions the writer settled, and when, for its next turn', async () => {
    const doc = text('Chapter 1', 'A cold night.\n\nThe tide came in.')
    const { suggestion: warm } = await executeEditDocument(
      { path: 'Chapter 1', old: 'cold', new: 'warm' },
      asking()
    )
    const { suggestion: out } = await executeEditDocument(
      { path: 'Chapter 1', old: 'came in', new: 'went out' },
      asking()
    )
    await executeEditDocument({ path: 'Chapter 1', old: 'A cold', new: 'One cold' }, asking(OTHER))
    const comments = useComments(STORY)
    comments.accept(doc.id, warm)
    comments.reject(doc.id, out)
    comments.accept(doc.id, idsIn(content(doc.id))[0])

    const settled = await settledSuggestions(STORY, { id: CHAT })
    expect(settled).toEqual([
      { suggestion: warm, path: 'Chapter 1', accepted: true, at: expect.any(Number) },
      { suggestion: out, path: 'Chapter 1', accepted: false, at: expect.any(Number) },
    ])
    expect(content(doc.id)).toBe('One warm night.\n\nThe tide came in.')
    // Its view is the text as it stands now: nothing of its own waits.
    const read = await executeReadDocument({ path: 'Chapter 1' }, { storyId: STORY, chatId: CHAT })
    expect(read.content).toBe('One warm night.\n\nThe tide came in.')
  })

  it('is not a comment: resolve turns it down, list and counts leave it out', async () => {
    text('Chapter 1', 'A cold night.')
    const { suggestion } = await executeEditDocument(
      { path: 'Chapter 1', old: 'cold', new: 'warm' },
      asking()
    )

    const resolved = await executeResolveComment({ path: 'Chapter 1', id: suggestion }, asking())
    expect(resolved.error).toMatch(/suggested change/)
    expect((await executeListComments({}, asking())).comments).toEqual([])
    const lines = String(await executeListDocuments({}, asking())).split('\n')
    expect(lines.find(line => line.startsWith('Chapter 1'))).not.toContain('comment')
  })

  describe('told of where a chat reads', () => {
    const reading = (chatId = CHAT) => ({ storyId: STORY, chatId })

    it('lists its own after the text, as the change it made to what it reads', async () => {
      text('Chapter 1', 'A cold night.\n\nThe tide came in.')
      const { suggestion } = await executeEditDocument(
        { path: 'Chapter 1', old: 'cold', new: 'warm' },
        asking()
      )

      const read = await executeReadDocument({ path: 'Chapter 1' }, reading())

      expect(read.content).toBe('A warm night.\n\nThe tide came in.')
      expect(read.suggestions).toEqual([{ id: suggestion, by: 'you', from: 'cold', to: 'warm' }])
      expect(read.comments).toBeUndefined()
    })

    it('lists another chat’s, by its chat, in the text as it stands', async () => {
      text('Chapter 1', 'A cold night.')
      useChatsStore().chats.set(OTHER, { id: OTHER, storyId: STORY, title: 'A second look' })
      const { suggestion } = await executeEditDocument(
        { path: 'Chapter 1', old: 'cold', new: 'warm' },
        asking(OTHER)
      )

      const read = await executeReadDocument({ path: 'Chapter 1' }, reading())

      expect(read.content).toBe('A cold night.')
      expect(read.suggestions).toEqual([
        { id: suggestion, by: 'model', chat: 'A second look', from: 'cold', to: 'warm' },
      ])
      // The writer reads with no chat, and is told of it the same.
      const plainly = await executeReadDocument({ path: 'Chapter 1' }, { storyId: STORY })
      expect(plainly.suggestions).toEqual(read.suggestions)
    })

    it('names a connected app by its connection, and someone in a linked Doc by name', async () => {
      const doc = text('Chapter 1', 'A cold night.\n\nThe tide came in.')
      const { suggestion } = await executeEditDocument(
        { path: 'Chapter 1', old: 'cold', new: 'warm' },
        { storyId: STORY, chatId: 'app:app_1', postsAs: 'Claude Code', propose: true, edits }
      )
      // One that came in from a Doc: a person's, by the name Google shows.
      store.updateDocument(doc.id, {
        content: content(doc.id).replace('tide', '{--tide--}{>>sdoc01<<}{++sea++}{>>sdoc01<<}'),
        comments: {
          ...threads(doc.id),
          sdoc01: {
            status: 'open',
            quote: 'tide',
            posts: [],
            suggestion: { text: 'sea', created: 2, author: 'person', name: 'Ada Marsh' },
          },
        },
      })

      const read = await executeReadDocument({ path: 'Chapter 1' }, reading())

      expect(read.content).toBe('A cold night.\n\nThe tide came in.')
      expect(read.suggestions).toEqual([
        { id: suggestion, by: 'Claude Code', from: 'cold', to: 'warm' },
        { id: 'sdoc01', by: 'Ada Marsh', from: 'tide', to: 'sea' },
      ])
    })

    it('lists what has been said on one: why, and the writer’s answer', async () => {
      const doc = text('Chapter 1', 'A cold night.')
      const { suggestion } = await executeEditDocument(
        { path: 'Chapter 1', old: 'cold', new: 'warm' },
        asking()
      )
      await executeReplyComment(
        { path: 'Chapter 1', id: suggestion, text: 'It is August.' },
        reading()
      )
      useComments(STORY).reply(doc.id, suggestion, 'August nights are cold here.')
      const said = [
        { author: 'model', text: 'It is August.' },
        { author: 'writer', text: 'August nights are cold here.' },
      ]

      // To the chat that made it, and to one asked about it.
      const own = await executeReadDocument({ path: 'Chapter 1' }, reading())
      const other = await executeReadDocument({ path: 'Chapter 1' }, reading(OTHER))
      expect(own.suggestions).toEqual([
        { id: suggestion, by: 'you', from: 'cold', to: 'warm', posts: said },
      ])
      expect(other.suggestions).toEqual([
        { id: suggestion, by: 'model', from: 'cold', to: 'warm', posts: said },
      ])

      // Which that one can answer in turn.
      const answered = await executeReplyComment(
        { path: 'Chapter 1', id: suggestion, text: 'Warm for the coast, then.' },
        reading(OTHER)
      )
      expect(answered.error).toBeUndefined()
      expect(threads(doc.id)[suggestion].posts).toHaveLength(3)
    })

    it('gives words put in or taken out with enough around them to be found', async () => {
      text('Chapter 1', 'A cold night.\n\nThe tide came in.')
      await executeEditDocument({ path: 'Chapter 1', old: ' cold', new: '' }, asking())
      await executeAppendDocument({ path: 'Chapter 1', text: 'Nobody slept.' }, asking())

      const own = await executeReadDocument({ path: 'Chapter 1' }, reading())
      const other = await executeReadDocument({ path: 'Chapter 1' }, reading(OTHER))

      expect(own.suggestions).toHaveLength(2)
      for (const [mine, theirs] of own.suggestions.map((each, at) => [
        each,
        other.suggestions[at],
      ])) {
        // The same change either way, in whichever text has it.
        expect(theirs).toMatchObject({ id: mine.id, from: mine.from, to: mine.to })
        expect(mine.from).not.toBe('')
        expect(mine.to).not.toBe('')
        expect(own.content.split(mine.to)).toHaveLength(2)
        expect(other.content.split(theirs.from)).toHaveLength(2)
      }
      expect(own.content).toBe('A night.\n\nThe tide came in.\n\nNobody slept.')
    })

    it('lists with a section the ones in it, in the text’s order, beside its comments', async () => {
      text(
        'Chapter 1',
        [
          '# Dusk',
          'A cold night, and {==quiet==}{>>c7k2m1<<}.',
          '# Dawn',
          'The tide came in. The gulls came after.',
        ].join('\n\n'),
        { comments: { c7k2m1: { status: 'open', quote: 'quiet', posts: [] } } }
      )
      const gulls = await executeEditDocument(
        { path: 'Chapter 1', old: 'gulls', new: 'terns' },
        asking()
      )
      const tide = await executeEditDocument(
        { path: 'Chapter 1', old: 'tide', new: 'fog' },
        asking(OTHER)
      )
      const cold = await executeEditDocument(
        { path: 'Chapter 1', old: 'cold', new: 'warm' },
        asking()
      )

      const whole = await executeReadDocument({ path: 'Chapter 1' }, reading())
      expect(whole.suggestions.map(each => each.id)).toEqual([
        cold.suggestion,
        tide.suggestion,
        gulls.suggestion,
      ])
      expect(whole.comments).toHaveLength(1)

      const dusk = await executeReadDocument({ path: 'Chapter 1', section: 'dusk' }, reading())
      expect(dusk.suggestions.map(each => each.id)).toEqual([cold.suggestion])
      expect(dusk.comments).toHaveLength(1)
      const dawn = await executeReadDocument({ path: 'Chapter 1', section: 'dawn' }, reading())
      expect(dawn.suggestions.map(each => each.id)).toEqual([tide.suggestion, gulls.suggestion])
      expect(dawn.comments).toBeUndefined()
    })

    it('lists them by document in a list of comments, and none where none wait', async () => {
      text('Chapter 1', 'A cold night.')
      text('Chapter 2', 'The tide came in.')
      expect(await executeListComments({}, reading())).toEqual({ comments: [] })

      const cold = await executeEditDocument(
        { path: 'Chapter 1', old: 'cold', new: 'warm' },
        asking()
      )
      const tide = await executeEditDocument(
        { path: 'Chapter 2', old: 'tide', new: 'fog' },
        asking(OTHER)
      )

      expect(await executeListComments({}, reading())).toEqual({
        comments: [],
        suggestions: [
          { id: cold.suggestion, path: 'Chapter 1', by: 'you', from: 'cold', to: 'warm' },
          { id: tide.suggestion, path: 'Chapter 2', by: 'model', from: 'tide', to: 'fog' },
        ],
      })
      expect((await executeListComments({ path: 'Chapter 2' }, reading())).suggestions).toEqual([
        { id: tide.suggestion, path: 'Chapter 2', by: 'model', from: 'tide', to: 'fog' },
      ])
    })

    it('tells of one no more once the writer settles it', async () => {
      const doc = text('Chapter 1', 'A cold night.\n\nThe tide came in.')
      const cold = await executeEditDocument(
        { path: 'Chapter 1', old: 'cold', new: 'warm' },
        asking()
      )
      const tide = await executeEditDocument(
        { path: 'Chapter 1', old: 'tide', new: 'fog' },
        asking()
      )
      const comments = useComments(STORY)
      expect(comments.accept(doc.id, cold.suggestion)).toBe(true)
      expect(comments.reject(doc.id, tide.suggestion)).toBe(true)

      const read = await executeReadDocument({ path: 'Chapter 1' }, reading())
      expect(read.content).toBe('A warm night.\n\nThe tide came in.')
      expect(read.suggestions).toBeUndefined()
      expect(await executeListComments({}, reading())).toEqual({ comments: [] })
    })

    it('cuts a long change short, and tells of only so many', async () => {
      const long = `${'A sentence of the old kind. '.repeat(20)}`.trim()
      text('Chapter 1', long)
      await executeUpdateDocument(
        { path: 'Chapter 1', content: `${'Something new entirely here. '.repeat(20)}`.trim() },
        asking()
      )
      const [whole] = (await executeReadDocument({ path: 'Chapter 1' }, reading())).suggestions
      expect(whole.from.length).toBeLessThan(320)
      expect(whole.from).toContain(' … ')

      // More than a read tells of: the first of them, and how many more.
      const many = Array.from({ length: SUGGESTIONS_MOST + 2 }, (_, n) => ({
        id: `s${String(n).padStart(5, '0')}`,
        word: `word${n}`,
      }))
      const stored = {
        id: 'doc_many',
        type: 'text',
        content: many
          .map(
            ({ id, word }) =>
              `Line with {--${word}--}{>>${id}<<}{++other${word}++}{>>${id}<<} in it.`
          )
          .join('\n\n'),
        comments: Object.fromEntries(
          many.map(({ id, word }, n) => [
            id,
            {
              status: 'open',
              quote: word,
              posts: [],
              suggestion: { text: `other${word}`, created: n, chat: OTHER },
            },
          ])
        ),
      }
      const told = suggestionsAsRead(stored, null, CHAT)
      expect(told.placed).toHaveLength(SUGGESTIONS_MOST)
      expect(told.more).toBe(2)
      // In the text's order, each with the words around it that find it.
      expect(told.placed[0]).toMatchObject({ id: 's00000', own: false, start: 0 })
      expect(told.placed[0].from).toContain('word0')
      expect(told.placed[0].to).toContain('otherword0')
      expect(told.placed.at(-1).id).toBe(`s${String(SUGGESTIONS_MOST - 1).padStart(5, '0')}`)
    })
  })
})
