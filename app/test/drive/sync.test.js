/* global Response */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { syncDoc } from '@/drive/sync.js'
import { spliceInside } from '@/drive/suggestions.js'
import { applyBatch, applyRequests } from '@/drive/apply.js'
import { readDoc } from '@/drive/convert.js'
import { writeDoc } from '@/drive/write.js'
import { DriveError, NotGrantedError, StaleRevisionError } from '@/drive/errors.js'
import { parseMarkdown, serializeMarkdown } from '@/editor/markdown.js'
import { pictureHref } from '@/utils/pictures.js'
import { commentRanges, withoutComment } from '@/editor/comments.js'
import {
  acceptSuggestion,
  changeOf,
  newSuggestionId,
  rejectSuggestion,
  seeing,
  suggestChange,
  suggestionsIn,
} from '@/editor/suggestions.js'
import { schema } from '@/editor/schema.js'
import { Transform } from 'prosemirror-transform'
import { docLinks } from '@/drive/links.js'
import { bulleted, docOf, inline, item, para, run, styled } from './docsHelpers.js'
import { anyEdit, busy, edits, objects, plain, random } from './randomEdits.js'

/** Whether the tests run as the desktop app, which fetches a Doc's pictures from their addresses. */
const desktop = vi.hoisted(() => ({ on: true }))
vi.mock('@/platform/fetch.js', () => ({ fetch: (...args) => fetch(...args) }))
vi.mock('@/platform/desktop.js', () => ({ isDesktop: () => desktop.on }))

const DOCUMENTS = 'https://docs.googleapis.com/v1/documents/doc-1'
const ID = 'doc_abc'
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

/**
 * Google, standing in, holding one Doc: a read answers with it as it is, and
 * a write applies its requests to it as Docs would, then whatever a
 * collaborator typed meanwhile, as Google would merge it in.
 *
 * @param {import('@/drive/docsTypes.js').Document} doc
 */
function google(doc) {
  const state = {
    doc,
    revision: 1,
    reads: 0,
    /** @type {any[]} */
    writes: [],
    /** Writes to refuse as too late, before taking one. */
    stale: 0,
    /** @type {((doc: any) => any)|null} What a collaborator does while a write is on its way. */
    meanwhile: null,
    /** @type {Record<string, Uint8Array>} Pictures, by their addresses. */
    pictures: {},
  }
  const fetchMock = vi.fn(async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
    if (url === `${DOCUMENTS}:batchUpdate`) {
      const body = JSON.parse(init.body)
      if (state.stale > 0) {
        state.stale--
        return new Response(
          JSON.stringify({
            error: {
              code: 400,
              message: `Cannot write to revision ${body.writeControl.targetRevisionId}. Please retrieve a newer revision of the document to write against.`,
            },
          }),
          { status: 400 }
        )
      }
      // Replies to comments name no place in the Doc, and no revision.
      if (body.writeControl) expect(body.writeControl.targetRevisionId).toBe(state.doc.revisionId)
      state.writes.push(body)
      // Written in Suggesting mode, as the writer's suggestion.
      const suggest =
        body.writeControl?.writeMode === 'SUGGEST' ? `suggest.w${state.revision}` : undefined
      const batch = applyBatch(state.doc, body.requests, { suggest })
      let after = batch.document
      if (state.meanwhile && body.writeControl) after = state.meanwhile(after)
      state.doc = { ...after, revisionId: `rev-${++state.revision}` }
      return new Response(JSON.stringify({ replies: batch.replies }))
    }
    if (url.startsWith(`${DOCUMENTS}?`)) {
      state.reads++
      return new Response(JSON.stringify(state.doc))
    }
    if (url.startsWith('https://docs.google.com/')) return new Response('{}', { status: 404 })
    const bytes = state.pictures[url]
    if (bytes) return new Response(bytes, { headers: { 'Content-Type': 'image/png' } })
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { state, fetchMock }
}

/** A Doc's text, as the converter reads it. */
const text = doc => readDoc(doc).markdown

/** The same markdown, as the serializer writes it. */
const as = markdown => serializeMarkdown(parseMarkdown(markdown))

/** A Doc of paragraphs. */
const paragraphs = (...lines) => docOf(lines.map(line => para(line)))

/** The base a Doc leaves, read as an import reads it. */
const baseOf = (doc, extra = {}) => ({
  id: ID,
  storyId: 'story_1',
  docId: 'doc-1',
  tabId: 't.0',
  revisionId: doc.revisionId,
  markdown: text(doc),
  at: 0,
  ...extra,
})

/**
 * Sync the document with the Doc standing in.
 *
 * @param {Object} options
 * @param {string|string[]} options.mine - The document; several for one
 *   that changes while the sync runs, the last read at the end
 * @param {any} [options.base]
 * @param {Record<string, any>} [options.pictures]
 * @param {import('@/drive/links.js').DocLinks} [options.links]
 */
async function sync({ mine, base = null, pictures = {}, threads = {}, links }) {
  const versions = [mine].flat()
  let reads = 0
  const current = () => parseMarkdown(versions[Math.min(reads++, versions.length - 1)])
  /** @type {any[]} The pictures the sync had kept, and how often the document had been read by then. */
  const kept = []
  const keep = vi.fn(async given => kept.push(...given.map(picture => ({ ...picture, reads }))))
  const synced = await syncDoc(
    {
      documentId: ID,
      link: { id: 'doc-1' },
      base,
      pictures,
      current,
      keep,
      threads: () => threads,
      ...(links && { links }),
    },
    'tok'
  )
  // Kept before the document's last read, at the end.
  for (const picture of kept) expect(picture.reads).toBe(reads - 1)
  return { ...synced, pictures: kept.map(({ reads: _reads, ...picture }) => picture) }
}

describe('syncDoc', () => {
  beforeEach(() => {
    desktop.on = true
  })
  afterEach(() => vi.unstubAllGlobals())

  it('writes what changed here into the Doc and brings back what changed there', async () => {
    const start = paragraphs('The ferry left at six.', 'It rained.', 'She kept to the rail.')
    const { state } = google(
      paragraphs('The ferry left at six.', 'It rained.', 'She kept to the rail, cold.')
    )
    const synced = await sync({
      base: baseOf(start),
      mine: 'The ferry left at seven.\n\nIt rained.\n\nShe kept to the rail.',
    })

    const both = 'The ferry left at seven.\n\nIt rained.\n\nShe kept to the rail, cold.'
    expect(text(state.doc)).toBe(both)
    expect(serializeMarkdown(synced.doc)).toBe(as(both))
    expect(synced).toMatchObject({ changed: true, sent: expect.any(Number) })
    expect(synced.sent).toBeGreaterThan(0)
    // The new base is the Doc read again after the write.
    expect(state.reads).toBe(2)
    expect(synced.base).toEqual({
      revisionId: 'rev-2',
      tabId: 't.0',
      markdown: as(both),
      pictures: {},
      held: [],
    })
  })

  it('writes nothing and changes nothing when neither side changed', async () => {
    const start = paragraphs('The ferry left at six.', 'It rained.')
    const { state } = google(start)
    const synced = await sync({ base: baseOf(start), mine: text(start) })
    expect(synced).toMatchObject({ sent: 0, changed: false })
    expect(state.writes).toEqual([])
    expect(state.reads).toBe(1)
  })

  it('keeps the document’s words where both changed the same ones, and hands back the Doc’s', async () => {
    const start = paragraphs('The ferry left at six.', 'It rained.')
    const { state } = google(paragraphs('The ferry left at eight.', 'It rained.'))
    const synced = await sync({
      base: baseOf(start),
      mine: 'The ferry left at seven.\n\nIt rained, hard.',
    })

    expect(state.reads).toBe(2)
    const result = 'The ferry left at seven.\n\nIt rained, hard.'
    expect(text(state.doc)).toBe(result)
    expect(serializeMarkdown(synced.doc)).toBe(as(result))
    expect(synced.lost).toBe(as('The ferry left at eight.\n\nIt rained.'))
  })

  it('hands back nothing where no words clashed', async () => {
    const start = paragraphs('The ferry left at six.', 'It rained.')
    google(paragraphs('The ferry left at six.', 'It rained, hard.'))
    const synced = await sync({
      base: baseOf(start),
      mine: 'The ferry left at seven.\n\nIt rained.',
    })
    expect(serializeMarkdown(synced.doc)).toBe(as('The ferry left at seven.\n\nIt rained, hard.'))
    expect(synced.lost).toBeNull()
  })

  describe('with no base', () => {
    it('makes the Doc the document’s, and hands back what the Doc said', async () => {
      const { state } = google(paragraphs('The ferry left at eight.', 'Then the rain.'))
      const synced = await sync({ mine: 'The ferry left at seven.' })
      expect(text(state.doc)).toBe('The ferry left at seven.')
      expect(serializeMarkdown(synced.doc)).toBe(as('The ferry left at seven.'))
      expect(synced.lost).toBe(as('The ferry left at eight.\n\nThen the rain.'))
    })

    it('takes the document into an empty Doc, as a new Doc is', async () => {
      const { state } = google(paragraphs(''))
      const mine =
        '# The crossing\n\nThe ferry left at six.\n\n| Day | Miles |\n| --- | --- |\n| Mon | 12 |'
      const synced = await sync({ mine })
      expect(text(state.doc)).toBe(as(mine))
      expect(synced.base.markdown).toBe(as(mine))
      expect(synced.lost).toBeNull()
    })

    it('takes the Doc into an empty document, and changes nothing where the two agree', async () => {
      google(paragraphs('The ferry left at eight.'))
      const empty = await sync({ mine: '' })
      expect(serializeMarkdown(empty.doc)).toBe(as('The ferry left at eight.'))
      expect(empty.lost).toBeNull()

      const same = await sync({ mine: 'The ferry left at eight.' })
      expect(same).toMatchObject({ sent: 0, changed: false, lost: null })
    })
  })

  it('writes again from a fresh read when the revision is too old, and gives up on the third', async () => {
    const start = paragraphs('The ferry left at six.')
    const { state } = google(start)
    state.stale = 1
    await sync({ base: baseOf(start), mine: 'The ferry left at seven.' })
    expect(text(state.doc)).toBe('The ferry left at seven.')
    expect(state.reads).toBe(3)

    const again = google(paragraphs('The ferry left at six.'))
    again.state.stale = 3
    await expect(
      sync({ base: baseOf(start), mine: 'The ferry left at nine.' })
    ).rejects.toBeInstanceOf(StaleRevisionError)
    expect(again.state.writes).toEqual([])
  })

  it('brings in what a collaborator typed while the write was on its way', async () => {
    const start = paragraphs('The ferry left at six.', 'It rained.')
    const { state } = google(start)
    // Typed at the end of the Doc, after everything the write touches.
    state.meanwhile = doc => {
      const body = doc.tabs[0].documentTab.body.content
      const end = body.at(-1).endIndex - 1
      return applyRequests(doc, [{ insertText: { text: ' Then hail.', location: { index: end } } }])
    }
    const synced = await sync({
      base: baseOf(start),
      // A picture of the document's own goes nowhere: the Doc has no way to take it.
      mine: `The ferry left at seven.\n\n![Pier](.images/${ID}/pier.png)\n\nIt rained.`,
      pictures: { 'pier.png': { mime: 'image/png' } },
    })

    expect(text(state.doc)).toBe('The ferry left at seven.\n\nIt rained. Then hail.')
    expect(serializeMarkdown(synced.doc)).toBe(
      as(`The ferry left at seven.\n\n![Pier](.images/${ID}/pier.png)\n\nIt rained. Then hail.`)
    )
    // The base is the Doc as it now reads.
    expect(synced.base.markdown).toBe(as('The ferry left at seven.\n\nIt rained. Then hail.'))
  })

  it('keeps what was typed here while the sync ran', async () => {
    const start = paragraphs('The ferry left at six.', 'It rained.')
    google(paragraphs('The ferry left at six.', 'It rained all day.'))
    const synced = await sync({
      base: baseOf(start),
      mine: [
        'The ferry left at seven.\n\nIt rained.',
        'The ferry left at seven.\n\nIt rained.\n\nShe waited.',
      ],
    })
    expect(serializeMarkdown(synced.doc)).toBe(
      as('The ferry left at seven.\n\nIt rained all day.\n\nShe waited.')
    )
  })

  it('writes a table put in here, and words changed in its cells there', async () => {
    const start = paragraphs('The ferry left at six.', 'It rained.')
    const { state } = google(start)
    const table = '| Day | Miles |\n| --- | --- |\n| Mon | 12 |'
    const synced = await sync({
      base: baseOf(start),
      mine: `The ferry left at six.\n\n${table}\n\nIt rained.`,
    })
    expect(text(state.doc)).toBe(as(`The ferry left at six.\n\n${table}\n\nIt rained.`))
    expect(synced.base.markdown).toBe(text(state.doc))

    // A collaborator's word in a cell comes back.
    state.doc = applyRequests(
      state.doc,
      writeDoc(state.doc, parseMarkdown(text(state.doc).replace('| 12 |', '| 14 |'))).requests
    )
    const next = await sync({
      base: { ...baseOf(state.doc), ...synced.base, revisionId: 'rev-old' },
      mine: `The ferry left at six.\n\n${table}\n\nIt rained, hard.`,
    })
    expect(serializeMarkdown(next.doc)).toBe(
      as(`The ferry left at six.\n\n${table.replace('12', '14')}\n\nIt rained, hard.`)
    )
    expect(text(state.doc)).toBe(serializeMarkdown(next.doc))
  })

  it('leaves here what the Doc can’t take yet, and sends the rest', async () => {
    const start = paragraphs('The ferry left at six.', 'Gulls came in.', 'It rained.')
    const { state } = google(start)
    // A footnote put in, which the writer can't send yet, and words it can.
    const mine =
      'The ferry left at six.[^1]\n\nGulls came in.\n\nIt rained hard.\n\n[^1]: Or so they said.'
    const first = await sync({ base: baseOf(start), mine })
    expect(first.left).toEqual(['footnote'])
    expect(text(state.doc)).toBe('The ferry left at six.\n\nGulls came in.\n\nIt rained hard.')
    expect(serializeMarkdown(first.doc)).toBe(as(mine))
    // Tried again, and still left: nothing more is written.
    const writes = state.writes.length
    const second = await sync({ base: { ...baseOf(state.doc), ...first.base }, mine })
    expect(second).toMatchObject({ sent: 0, changed: false, left: ['footnote'] })
    expect(state.writes).toHaveLength(writes)
  })

  it('puts a document of lists nested deep into a new Doc whole, and writes it once', async () => {
    const { state } = google(docOf([para('')]))
    const mine =
      '# List Test\n\nHere is a list:\n\n- One\n- Two\n  - Three\n    - Four\n  - Five\n' +
      '- Six\n  - Seven\n    - Eight\n      - Nine\n      - Ten\n- Eleven\n\nThat was the list'
    const first = await sync({ mine })
    expect(first.left).toEqual([])
    expect(text(state.doc)).toBe(as(mine))
    const second = await sync({ base: { ...baseOf(state.doc), ...first.base }, mine })
    expect(second).toMatchObject({ sent: 0, changed: false, left: [] })
  })

  it('leaves a Doc of several tabs alone when the link names none of them', async () => {
    const doc = paragraphs('The ferry left at six.')
    const { state } = google({
      ...doc,
      tabs: [...doc.tabs, { ...doc.tabs[0], tabProperties: { tabId: 't.1', title: 'Tab 2' } }],
    })
    await expect(sync({ mine: 'The ferry left at seven.' })).rejects.toThrow(
      'This Doc has several tabs, and Sync can’t choose between them yet.'
    )
    expect(state.writes).toEqual([])
  })

  it('says when the account has not been given the Doc', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 }))
    )
    await expect(sync({ mine: 'x' })).rejects.toBeInstanceOf(NotGrantedError)
  })

  describe('pictures', () => {
    const pictured = (...extra) =>
      docOf(
        [
          para([
            run('The harbour: '),
            inline('inlineObjectElement', { inlineObjectId: 'kix.pier' }),
          ]),
          para('It rained.'),
          ...extra,
        ],
        { pictures: { 'kix.pier': { uri: 'https://lh3.example/pier', alt: 'Pier' } } }
      )
    const href = name => pictureHref(ID, name)

    it('knows the Doc’s by the names the document has for them, and writes nothing for them', async () => {
      const start = pictured()
      const { state } = google(start)
      const mine = `The harbour: ![Pier](${href('image1.png')})\n\nIt rained, hard.`
      const synced = await sync({
        base: baseOf(start, {
          markdown: as(`The harbour: ![Pier](${href('image1.png')})\n\nIt rained.`),
          pictures: { 'kix.pier': 'image1.png' },
        }),
        mine,
        pictures: { 'image1.png': { mime: 'image/png', docsId: 'kix.pier' } },
      })
      expect(state.writes).toHaveLength(1)
      expect(serializeMarkdown(synced.doc)).toBe(as(mine))
      expect(synced.pictures).toEqual([])
      expect(synced.base.pictures).toEqual({ 'kix.pier': 'image1.png' })
      expect(synced.unsent).toBe(0)
    })

    it('keeps here one added here, and says how many the Doc lacks', async () => {
      const start = paragraphs('The harbour:', 'It rained.')
      const { state } = google(start)
      const mine = `The harbour:\n\n![](${href('pasted.png')})\n\nIt rained, hard.`
      const synced = await sync({
        base: baseOf(start),
        mine,
        pictures: { 'pasted.png': { mime: 'image/png' } },
      })
      expect(text(state.doc)).toBe(as('The harbour:\n\nIt rained, hard.'))
      expect(serializeMarkdown(synced.doc)).toBe(as(mine))
      expect(synced.unsent).toBe(1)
    })

    it('fetches one new in the Doc and names it for the document', async () => {
      const start = paragraphs('The harbour:', 'It rained.')
      const { state } = google(pictured())
      state.pictures['https://lh3.example/pier'] = PNG
      const synced = await sync({
        base: baseOf(start),
        mine: 'The harbour:\n\nIt rained.',
        pictures: { 'image.png': { mime: 'image/png' } },
      })
      expect(synced.pictures).toEqual([
        { name: 'image (2).png', docsId: 'kix.pier', mime: 'image/png', bytes: PNG },
      ])
      expect(serializeMarkdown(synced.doc)).toBe(
        as(`The harbour: ![Pier](${href('image (2).png')})\n\nIt rained.`)
      )
      expect(synced.base.pictures).toEqual({ 'kix.pier': 'image (2).png' })
    })

    it('leaves out one that will not come, as one held', async () => {
      const start = paragraphs('The harbour:', 'It rained.')
      google(pictured())
      const synced = await sync({ base: baseOf(start), mine: 'The harbour:\n\nIt rained, hard.' })
      expect(synced.pictures).toEqual([])
      expect(serializeMarkdown(synced.doc)).toBe(as('The harbour:\n\nIt rained, hard.'))
    })

    it('deletes one in the Doc that was deleted here', async () => {
      const start = pictured()
      const { state } = google(start)
      await sync({
        base: baseOf(start, {
          markdown: as(`The harbour: ![Pier](${href('image1.png')})\n\nIt rained.`),
          pictures: { 'kix.pier': 'image1.png' },
        }),
        // Let go of by the document already: the base still knows it.
        mine: 'The harbour:\n\nIt rained.',
      })
      expect(JSON.stringify(state.doc.tabs[0].documentTab.body)).not.toContain('kix.pier')
    })

    it('holds one the document turned down, in the Doc and out of the document, sync after sync', async () => {
      const { state, fetchMock } = google(pictured())
      state.pictures['https://lh3.example/pier'] = PNG
      /** How often the picture was fetched. */
      const fetched = () =>
        fetchMock.mock.calls.filter(([url]) => url === 'https://lh3.example/pier').length
      const first = await sync({
        mine: 'The harbour:\n\nIt rained, hard.',
      })
      expect(JSON.stringify(state.doc.tabs[0].documentTab.body)).toContain('kix.pier')
      expect(first.pictures).toEqual([])
      expect(first.base).toMatchObject({ pictures: {}, held: ['kix.pier'] })

      const next = await sync({
        base: { ...baseOf(state.doc), ...first.base },
        mine: 'The harbour:\n\nIt rained, hard, all day.',
      })
      expect(JSON.stringify(state.doc.tabs[0].documentTab.body)).toContain('kix.pier')
      expect(serializeMarkdown(next.doc)).toBe(as('The harbour:\n\nIt rained, hard, all day.'))
      expect(next.base.held).toEqual(['kix.pier'])
      // Fetched for the first sync, not again.
      expect(fetched()).toBe(1)
    })
  })
})

describe('syncDoc, comments both ways', () => {
  afterEach(() => vi.unstubAllGlobals())

  const ANA = { displayName: 'Ana Marsh', user: 'user-ana' }
  /** A thread of the writer's. */
  const writers = (text, extra = {}) => ({
    status: 'open',
    quote: '',
    posts: [{ author: 'writer', text, created: 1 }],
    ...extra,
  })
  /** The Doc's threads, by what their first post says. */
  const threadsIn = doc =>
    Object.fromEntries(
      (doc.comments ?? []).map(comment => [
        comment.headPost.content,
        {
          status: comment.status,
          on: comment.plainTextQuote,
          posts: [comment.headPost, ...(comment.replies ?? [])]
            .filter(post => post.content)
            .map(post => `${post.author.me ? 'me' : post.author.displayName}: ${post.content}`),
        },
      ])
    )
  /** The Doc's anchored words for a thread, by what its first post says. */
  const anchoredIn = (doc, said) => {
    const comment = doc.comments.find(each => each.headPost.content === said)
    const [range] = doc.tabs[0].documentTab.commentAnchors[comment.anchorId].ranges
    return text(doc).length >= 0 && range
  }
  /** Another's comment made in the Doc on some words of it. */
  const theirComment = (doc, words, said, author = ANA) => {
    const at = text(doc).indexOf(words)
    // The Doc's indices: 1 before the first paragraph's text, as the helpers lay it.
    const read = readDoc(doc)
    const span = read.spans.find(
      each =>
        each.kind === 'text' &&
        read.doc.textBetween(each.pos, each.pos + each.length).includes(words)
    )
    const offset = read.doc.textBetween(span.pos, span.pos + span.length).indexOf(words)
    expect(at).toBeGreaterThanOrEqual(0)
    return applyBatch(
      doc,
      [
        {
          insertComment: {
            range: {
              startIndex: span.index + offset,
              endIndex: span.index + offset + words.length,
            },
            content: said,
          },
        },
      ],
      { author }
    ).document
  }

  it('makes a comment here the Doc’s, on its words, and the next sync sends it no more', async () => {
    const start = paragraphs('The ferry left at six.', 'It rained.')
    const { state } = google(start)
    const threads = { cmta01: writers('Which ferry?') }
    const synced = await sync({
      base: baseOf(start),
      mine: 'The {==ferry==}{>>cmta01<<} left at six.\n\nIt rained.',
      threads,
    })
    expect(threadsIn(state.doc)).toEqual({
      'Which ferry?': { status: 'OPEN', on: 'ferry', posts: ['me: Which ferry?'] },
    })
    expect(synced.threads.cmta01.google).toEqual({ doc: 'doc-1', id: 'comment.1', status: 'open' })
    expect(serializeMarkdown(synced.doc)).toBe(
      as('The {==ferry==}{>>cmta01<<} left at six.\n\nIt rained.')
    )

    const writes = state.writes.length
    await sync({
      base: { ...baseOf(state.doc), ...synced.base },
      mine: 'The {==ferry==}{>>cmta01<<} left at six.\n\nIt rained.',
      threads: synced.threads,
    })
    expect(state.writes).toHaveLength(writes)
  })

  it('brings a collaborator’s comment in on its words, with their name, and replies both ways', async () => {
    const start = paragraphs('The ferry left at six.', 'It rained.')
    const { state } = google(theirComment(start, 'six', 'Or seven?'))
    const first = await sync({ base: baseOf(start), mine: 'The ferry left at six.\n\nIt rained.' })
    const [[id, thread]] = Object.entries(first.threads)
    expect(serializeMarkdown(first.doc)).toBe(
      as(`The ferry left at {==six==}{>>${id}<<}.\n\nIt rained.`)
    )
    expect(thread.posts).toMatchObject([{ author: 'person', name: 'Ana Marsh', text: 'Or seven?' }])
    expect(first.comments.came).toBe(1)

    // A reply here goes up; one there comes down.
    const replied = {
      [id]: {
        ...thread,
        posts: [...thread.posts, { author: 'writer', text: 'Six, by the log.', created: 5 }],
      },
    }
    const second = await sync({
      base: { ...baseOf(state.doc), ...first.base },
      mine: serializeMarkdown(first.doc),
      threads: replied,
    })
    expect(threadsIn(state.doc)['Or seven?'].posts).toEqual([
      'Ana Marsh: Or seven?',
      'me: Six, by the log.',
    ])
    // Comments alone, and said as a sync of them.
    expect(second).toMatchObject({ sent: 0, changed: false, comments: { sent: 1, changed: 0 } })
    state.doc = applyBatch(
      state.doc,
      [{ addCommentReply: { commentId: 'comment.1', post: { content: 'Fair enough.' } } }],
      { author: ANA }
    ).document
    const third = await sync({
      base: { ...baseOf(state.doc), ...second.base },
      mine: serializeMarkdown(second.doc),
      threads: second.threads,
    })
    expect(third.threads[id].posts.map(post => post.text)).toEqual([
      'Or seven?',
      'Six, by the log.',
      'Fair enough.',
    ])
    expect(third.comments).toMatchObject({ came: 1, changed: 1, sent: 0 })
  })

  it('resolves here what was resolved there, and there what was resolved here', async () => {
    const start = paragraphs('The ferry left at six.', 'It rained.')
    const { state } = google(start)
    const mine = 'The {==ferry==}{>>cmta01<<} left at {==six==}{>>cmta02<<}.\n\nIt rained.'
    const made = await sync({
      base: baseOf(start),
      mine,
      threads: { cmta01: writers('Which ferry?'), cmta02: writers('Check the time.') },
    })
    // Resolved in Docs: cmta01. Resolved here: cmta02, its mark taken off.
    state.doc = applyBatch(state.doc, [
      {
        addCommentReply: {
          commentId: made.threads.cmta01.google.id,
          post: { commentAction: 'RESOLVE' },
        },
      },
    ]).document
    const synced = await sync({
      base: { ...baseOf(state.doc), ...made.base },
      mine: 'The {==ferry==}{>>cmta01<<} left at six.\n\nIt rained.',
      threads: { ...made.threads, cmta02: { ...made.threads.cmta02, status: 'resolved' } },
    })
    expect(serializeMarkdown(synced.doc)).toBe(as('The ferry left at six.\n\nIt rained.'))
    expect(synced.threads.cmta01.status).toBe('resolved')
    expect(Object.values(threadsIn(state.doc)).map(each => each.status)).toEqual([
      'RESOLVED',
      'RESOLVED',
    ])
  })

  it('brings in a thread on words not here as stale, and resolves one gone from the Doc', async () => {
    const start = paragraphs('The ferry left at six.', 'It rained.')
    const doc = theirComment(start, 'rained', 'Drizzle, really.')
    const { state } = google(doc)
    // The words it was on, gone here since the base.
    const synced = await sync({ base: baseOf(start), mine: 'The ferry left at six.\n\nIt poured.' })
    const [[id, thread]] = Object.entries(synced.threads)
    expect(serializeMarkdown(synced.doc)).not.toContain(id)
    expect(thread).toMatchObject({ status: 'open', quote: 'rained' })

    state.doc = { ...state.doc, comments: [] }
    const again = await sync({
      base: { ...baseOf(state.doc), ...synced.base },
      mine: serializeMarkdown(synced.doc),
      threads: synced.threads,
    })
    expect(again.threads[id].status).toBe('resolved')
    expect(again.threads[id].google).toBeUndefined()
  })

  it('sends no comment too long for Docs, nor one whose words the Doc has not got', async () => {
    const start = paragraphs('The ferry left at six.')
    const { state } = google(start)
    const synced = await sync({
      base: baseOf(start),
      mine: 'The {==ferry==}{>>cmta01<<} left at six. {==Late==}{>>cmta02<<}',
      threads: { cmta01: writers('x'.repeat(2049)), cmta02: writers('Since when?') },
    })
    // The words of cmta02 went up with the sync, and the comment after them.
    expect(Object.keys(threadsIn(state.doc))).toEqual(['Since when?'])
    expect(synced.comments.tooLong).toBe(1)
    expect(synced.threads.cmta01.google).toBeUndefined()
  })

  it('takes a thread linked to another Doc for one of its own, as a copy’s are', async () => {
    const start = paragraphs('The ferry left at six.')
    const { state } = google(start)
    const synced = await sync({
      base: baseOf(start),
      mine: 'The {==ferry==}{>>cmta01<<} left at six.',
      threads: {
        cmta01: writers('Which ferry?', {
          google: { doc: 'doc-other', id: 'x.9', status: 'open' },
        }),
      },
    })
    expect(Object.keys(threadsIn(state.doc))).toEqual(['Which ferry?'])
    expect(synced.threads.cmta01.google).toMatchObject({ doc: 'doc-1', id: 'comment.1' })
  })

  it('sends the writer’s own words edited here, and takes an edit made there', async () => {
    const start = paragraphs('The ferry left at six.')
    const { state } = google(start)
    const mine = 'The {==ferry==}{>>cmta01<<} left at six.'
    const made = await sync({
      base: baseOf(start),
      mine,
      threads: { cmta01: writers('Which ferry?') },
    })
    const edited = {
      cmta01: {
        ...made.threads.cmta01,
        posts: [{ ...made.threads.cmta01.posts[0], text: 'Which ferry, the early one?' }],
      },
    }
    const second = await sync({
      base: { ...baseOf(state.doc), ...made.base },
      mine,
      threads: edited,
    })
    expect(Object.keys(threadsIn(state.doc))).toEqual(['Which ferry, the early one?'])

    state.doc = applyBatch(state.doc, [
      {
        updateCommentPost: {
          commentId: 'comment.1',
          postId: state.doc.comments[0].headPost.postId,
          content: 'Which ferry was it?',
        },
      },
    ]).document
    const third = await sync({
      base: { ...baseOf(state.doc), ...second.base },
      mine,
      threads: second.threads,
    })
    expect(third.threads.cmta01.posts[0].text).toBe('Which ferry was it?')
  })
})

describe('syncDoc, the Doc’s suggestions', () => {
  afterEach(() => vi.unstubAllGlobals())

  const ANA = { displayName: 'Ana Marsh', user: 'user-ana' }
  /** A Doc with a word's change suggested, by Ana, said why. */
  const suggested = () => ({
    ...docOf([
      para([
        run('The ferry left at '),
        run('seven', {}, { suggestedInsertionIds: ['suggest.a'] }),
        run('six', {}, { suggestedDeletionIds: ['suggest.a'] }),
        run('.'),
      ]),
      para('It rained.'),
    ]),
    suggestions: [
      {
        suggestionId: 'suggest.a',
        status: 'OPEN',
        headPost: { postId: 'post.a.0', author: ANA, createTime: '2026-10-01T00:00:00Z' },
        replies: [
          {
            postId: 'post.a.1',
            author: ANA,
            content: 'Seven, by the timetable.',
            createTime: '2026-10-01T00:01:00Z',
          },
        ],
      },
    ],
  })
  const AS_IT_STANDS = 'The ferry left at six.\n\nIt rained.'

  /** The first sync, which brings the suggestion in; and its id here. */
  async function broughtIn() {
    const doc = suggested()
    const { state } = google(doc)
    const first = await sync({ base: baseOf(doc), mine: AS_IT_STANDS })
    const [[id, thread]] = Object.entries(first.threads)
    return { state, first, id, thread }
  }

  /** The base the first sync left, as the next is handed it. */
  const next = (state, synced) => ({ ...baseOf(state.doc), ...synced.base })

  it('brings it in as a suggestion here, with who made it, and leaves it be after', async () => {
    const { state, first, id, thread } = await broughtIn()
    expect(serializeMarkdown(first.doc)).toBe(
      as(`The ferry left at {--six--}{>>${id}<<}{++seven++}{>>${id}<<}.\n\nIt rained.`)
    )
    expect(thread).toMatchObject({
      status: 'open',
      quote: 'six',
      posts: [{ author: 'person', name: 'Ana Marsh', text: 'Seven, by the timetable.' }],
      suggestion: { text: 'seven', author: 'person', name: 'Ana Marsh', user: 'user-ana' },
      google: { doc: 'doc-1', id: 'suggest.a', status: 'open' },
    })
    expect(thread.suggestion.created).toBe(Date.parse('2026-10-01T00:00:00Z'))
    expect(first).toMatchObject({ sent: 0, changed: true, suggestions: { came: 1, settled: 0 } })
    expect(state.writes).toEqual([])
    // The base keeps it, by the same id.
    expect(first.base.markdown).toBe(serializeMarkdown(first.doc))

    const second = await sync({
      base: next(state, first),
      mine: serializeMarkdown(first.doc),
      threads: first.threads,
    })
    expect(second).toMatchObject({ sent: 0, changed: false, suggestions: { came: 0, changed: 0 } })
    expect(second.threads).toEqual(first.threads)
    expect(state.writes).toEqual([])
  })

  it('accepts it in the Doc when it was accepted here, before the words, edited after', async () => {
    const { state, first, id, thread } = await broughtIn()
    // Accepted here, and the words it put in changed further.
    const mine = serializeMarkdown(acceptSuggestion(first.doc, id)).replace('seven', 'seven sharp')
    const threads = {
      [id]: {
        ...thread,
        status: 'resolved',
        suggestion: { ...thread.suggestion, settled: 'accepted' },
      },
    }
    const second = await sync({ base: next(state, first), mine, threads })
    expect(state.writes[0].requests).toEqual([{ acceptSuggestion: { suggestionId: 'suggest.a' } }])
    expect(text(state.doc)).toBe('The ferry left at seven sharp.\n\nIt rained.')
    expect(serializeMarkdown(second.doc)).toBe(as('The ferry left at seven sharp.\n\nIt rained.'))
    expect(second.threads[id]).toMatchObject({
      status: 'resolved',
      suggestion: { settled: 'accepted' },
      google: { status: 'resolved' },
    })
    expect(second.suggestions).toMatchObject({ settled: 1, came: 0 })

    // Settled, it is sent no more.
    const writes = state.writes.length
    await sync({
      base: next(state, second),
      mine: serializeMarkdown(second.doc),
      threads: second.threads,
    })
    expect(state.writes).toHaveLength(writes)
  })

  it('rejects it in the Doc when it was rejected here', async () => {
    const { state, first, id, thread } = await broughtIn()
    const threads = {
      [id]: {
        ...thread,
        status: 'resolved',
        suggestion: { ...thread.suggestion, settled: 'rejected' },
      },
    }
    const second = await sync({
      base: next(state, first),
      mine: serializeMarkdown(rejectSuggestion(first.doc, id)),
      threads,
    })
    expect(state.writes.map(write => write.requests)).toEqual([
      [{ rejectSuggestion: { suggestionId: 'suggest.a' } }],
    ])
    expect(text(state.doc)).toBe(AS_IT_STANDS)
    // Listed still, as it ended.
    expect(state.doc.suggestions.map(each => each.status)).toEqual(['REJECTED'])
    expect(serializeMarkdown(second.doc)).toBe(as(AS_IT_STANDS))
    expect(second.threads[id]).toMatchObject({ status: 'resolved', google: { status: 'resolved' } })
  })

  it('settles it here when it was settled in the Doc', async () => {
    const { state, first, id } = await broughtIn()
    state.doc = applyBatch(state.doc, [{ acceptSuggestion: { suggestionId: 'suggest.a' } }], {
      author: ANA,
    }).document
    const second = await sync({
      base: next(state, first),
      mine: serializeMarkdown(first.doc),
      threads: first.threads,
    })
    expect(serializeMarkdown(second.doc)).toBe(as('The ferry left at seven.\n\nIt rained.'))
    // As the Doc lists it still.
    expect(second.threads[id]).toMatchObject({
      status: 'resolved',
      suggestion: { settled: 'accepted' },
      google: { status: 'resolved' },
    })
    expect(second).toMatchObject({ sent: 0, changed: true, suggestions: { changed: 1 } })
    expect(state.writes).toEqual([])
  })

  it('sends a reply here to its thread in the Doc, and brings one there in', async () => {
    const { state, first, id, thread } = await broughtIn()
    const replied = {
      [id]: {
        ...thread,
        posts: [...thread.posts, { author: 'writer', text: 'Seven it is.', created: 5 }],
      },
    }
    const second = await sync({
      base: next(state, first),
      mine: serializeMarkdown(first.doc),
      threads: replied,
    })
    // Named as a suggestion's: Docs knows no comment by its id.
    expect(state.writes.map(write => write.requests)).toEqual([
      [{ addCommentReply: { suggestionId: 'suggest.a', post: { content: 'Seven it is.' } } }],
    ])
    expect(state.doc.suggestions[0].replies.map(post => post.content)).toEqual([
      'Seven, by the timetable.',
      'Seven it is.',
    ])
    expect(second.threads[id].posts[1].google?.id).toBeTruthy()
    expect(second).toMatchObject({ sent: 0, changed: false, comments: { sent: 1 } })

    state.doc = applyBatch(
      state.doc,
      [{ addCommentReply: { suggestionId: 'suggest.a', post: { content: 'Thanks.' } } }],
      { author: ANA }
    ).document
    const third = await sync({
      base: next(state, second),
      mine: serializeMarkdown(second.doc),
      threads: second.threads,
    })
    expect(third.threads[id].posts.map(post => post.text)).toEqual([
      'Seven, by the timetable.',
      'Seven it is.',
      'Thanks.',
    ])
    expect(third.comments.came).toBe(1)
  })

  it('writes an edit beside it, and one in its paragraph around it', async () => {
    const { state, first, id } = await broughtIn()
    const marked = serializeMarkdown(first.doc)
    const second = await sync({
      base: next(state, first),
      mine: marked.replace('It rained.', 'It rained hard.'),
      threads: first.threads,
    })
    expect(text(state.doc)).toBe('The ferry left at six.\n\nIt rained hard.')
    expect(serializeMarkdown(second.doc)).toBe(
      as(`The ferry left at {--six--}{>>${id}<<}{++seven++}{>>${id}<<}.\n\nIt rained hard.`)
    )

    const typed = serializeMarkdown(second.doc).replace('The ferry', 'The old ferry')
    const third = await sync({ base: next(state, second), mine: typed, threads: second.threads })
    expect(text(state.doc)).toBe('The old ferry left at six.\n\nIt rained hard.')
    expect(readDoc(state.doc, { accepted: new Set(['suggest.a']) }).markdown).toBe(
      'The old ferry left at seven.\n\nIt rained hard.'
    )
    expect(serializeMarkdown(third.doc)).toBe(as(typed))
  })

  it('lays a paragraph parted in two in, and parts it in the Doc when accepted here', async () => {
    const doc = docOf([
      // Its newline suggested: one paragraph with the next until it is taken.
      para([run('One half.'), run('', {}, { suggestedInsertionIds: ['suggest.b'] })]),
      para('The other half.'),
      para('It rained.'),
    ])
    const { state } = google(doc)
    const first = await sync({
      base: baseOf(doc),
      mine: 'One half.The other half.\n\nIt rained.',
    })
    const [id] = Object.keys(first.threads)
    expect(first.threads[id].suggestion).toMatchObject({ text: 'One half.' })
    expect(serializeMarkdown(rejectSuggestion(first.doc, id))).toBe(
      as('One half.The other half.\n\nIt rained.')
    )
    const parted = serializeMarkdown(acceptSuggestion(first.doc, id))
    expect(parted).toBe(as('One half.\n\nThe other half.\n\nIt rained.'))

    const threads = {
      [id]: {
        ...first.threads[id],
        status: 'resolved',
        suggestion: { ...first.threads[id].suggestion, settled: 'accepted' },
      },
    }
    const second = await sync({ base: next(state, first), mine: parted, threads })
    expect(text(state.doc)).toBe('One half.\n\nThe other half.\n\nIt rained.')
    expect(second).toMatchObject({ sent: 0, changed: false })
  })

  it('lays one in whole where it changes two places, and one that takes a list item out', async () => {
    const doc = docOf(
      [
        para([
          run('The '),
          run('old ', {}, { suggestedDeletionIds: ['suggest.d'] }),
          run('ferry left at six, as the '),
          run('old ', {}, { suggestedDeletionIds: ['suggest.d'] }),
          run('timetable said.'),
        ]),
        item('Ropes', 'l'),
        item([run('Salt', {}, { suggestedDeletionIds: ['suggest.e'] })], 'l'),
        styled('HEADING_2', 'Tuesday'),
        para('It rained.'),
      ],
      { lists: { l: bulleted() } }
    )
    google(doc)
    const first = await sync({ base: baseOf(doc), mine: text(doc) })
    const ids = Object.fromEntries(
      Object.entries(first.threads).map(([id, thread]) => [thread.google.id, id])
    )
    const [d, e] = [ids['suggest.d'], ids['suggest.e']]
    expect(serializeMarkdown(first.doc)).toBe(
      as(
        `The {--old --}{>>${d}<<}ferry left at six, as the {--old --}{>>${d}<<}timetable said.\n\n` +
          `- Ropes\n- {--Salt--}{>>${e}<<}\n\n## Tuesday\n\nIt rained.`
      )
    )
    expect(serializeMarkdown(acceptSuggestion(rejectSuggestion(first.doc, e), d))).toBe(
      as(
        'The ferry left at six, as the timetable said.\n\n- Ropes\n- Salt\n\n## Tuesday\n\nIt rained.'
      )
    )
    // Taken out, the heading after it stays a heading, as in Docs.
    expect(serializeMarkdown(acceptSuggestion(rejectSuggestion(first.doc, d), e))).toBe(
      as(
        'The old ferry left at six, as the old timetable said.\n\n- Ropes\n\n## Tuesday\n\nIt rained.'
      )
    )
  })

  /** The Doc's text with the suggestions named read as made. */
  const made = (doc, ...ids) => readDoc(doc, { accepted: new Set(ids) }).markdown

  /** The first sync's document with words of the suggestion changed, and synced again. */
  async function typedInto(from, to) {
    const { state, first, id } = await broughtIn()
    const typed = serializeMarkdown(first.doc).replace(from(id), to(id))
    const second = await sync({ base: next(state, first), mine: typed, threads: first.threads })
    return { state, first, second, id, typed }
  }

  it('writes words typed into what it puts in into it in the Doc, still its author’s', async () => {
    const { state, second, id, typed } = await typedInto(
      id => `{++seven++}{>>${id}<<}`,
      id => `{++seven sharp++}{>>${id}<<}`
    )
    // Put in after its first letter, so that it is part of it.
    expect(state.writes).toHaveLength(1)
    expect(state.writes[0].writeControl).not.toHaveProperty('writeMode')
    expect(text(state.doc)).toBe('The ferry left at six.\n\nIt rained.')
    expect(made(state.doc, 'suggest.a')).toBe('The ferry left at seven sharp.\n\nIt rained.')
    expect(state.doc.suggestions.map(each => each.headPost.author)).toEqual([ANA])
    // Laid in again as it is here, by the same id.
    expect(serializeMarkdown(second.doc)).toBe(as(typed))
    expect(second.threads[id]).toMatchObject({
      quote: 'six',
      suggestion: { text: 'seven sharp', author: 'person', name: 'Ana Marsh' },
      google: { doc: 'doc-1', id: 'suggest.a', status: 'open' },
    })
    const third = await sync({ base: next(state, second), mine: typed, threads: second.threads })
    expect(third).toMatchObject({ sent: 0, changed: false })
    expect(state.writes).toHaveLength(1)
  })

  it('writes nothing where the Doc already has the words typed here', async () => {
    const { state, first, id } = await broughtIn()
    // A sync that wrote them, and went no further.
    const words = { start: 19, text: 'seven', tabId: 't.0' }
    state.doc = applyBatch(
      state.doc,
      /** @type {object[]} */ (spliceInside(words, 5, 5, ' sharp'))
    ).document
    expect(made(state.doc, 'suggest.a')).toBe('The ferry left at seven sharp.\n\nIt rained.')
    const typed = serializeMarkdown(first.doc).replace(
      `{++seven++}{>>${id}<<}`,
      `{++seven sharp++}{>>${id}<<}`
    )
    const second = await sync({ base: next(state, first), mine: typed, threads: first.threads })
    expect(state.writes).toEqual([])
    expect(serializeMarkdown(second.doc)).toBe(as(typed))
  })

  it('writes words typed into what it takes out, and takes out all it puts in', async () => {
    const old = await typedInto(
      id => `{--six--}{>>${id}<<}`,
      id => `{--sixty--}{>>${id}<<}`
    )
    expect(text(old.state.doc)).toBe('The ferry left at sixty.\n\nIt rained.')
    expect(made(old.state.doc, 'suggest.a')).toBe('The ferry left at seven.\n\nIt rained.')
    expect(serializeMarkdown(old.second.doc)).toBe(as(old.typed))

    const gone = await typedInto(
      id => `{++seven++}{>>${id}<<}`,
      () => ''
    )
    expect(made(gone.state.doc, 'suggest.a')).toBe('The ferry left at .\n\nIt rained.')
    expect(serializeMarkdown(gone.second.doc)).toBe(as(gone.typed))
    expect(gone.second.threads[gone.id]).toMatchObject({ quote: 'six', suggestion: { text: '' } })
  })

  it('puts the words typed into one letter it puts in beside it, as the writer’s own', async () => {
    const doc = {
      ...docOf([
        para([
          run('The ferry left at six'),
          run('!', {}, { suggestedInsertionIds: ['suggest.b'] }),
          run('.', {}, { suggestedDeletionIds: ['suggest.b'] }),
        ]),
      ]),
      suggestions: [
        {
          suggestionId: 'suggest.b',
          status: 'OPEN',
          headPost: { postId: 'post.b.0', author: ANA, createTime: '2026-10-01T00:00:00Z' },
        },
      ],
    }
    const { state } = google(doc)
    const first = await sync({ base: baseOf(doc), mine: 'The ferry left at six.' })
    const [id] = Object.keys(first.threads)
    const typed = serializeMarkdown(first.doc).replace(`{++!++}{>>${id}<<}`, `{++?!++}{>>${id}<<}`)
    const second = await sync({ base: next(state, first), mine: typed, threads: first.threads })

    // Put in as a suggestion first, then the letter taken out.
    expect(state.writes.map(write => write.writeControl.writeMode)).toEqual(['SUGGEST', undefined])
    const ids = state.doc.suggestions.map(each => each.suggestionId)
    expect(text(state.doc)).toBe('The ferry left at six.')
    expect(made(state.doc, ...ids)).toBe('The ferry left at six?!')
    // Hers takes the full stop out, and the writer's puts the words in.
    const threads = Object.values(second.threads)
    expect(threads.map(thread => thread.suggestion)).toEqual([
      expect.objectContaining({ text: '', author: 'person', name: 'Ana Marsh' }),
      expect.objectContaining({ text: '?!', author: 'writer' }),
    ])
    expect(serializeMarkdown(seeing(second.doc, Object.keys(second.threads)).doc)).toBe(
      'The ferry left at six?!'
    )
    const third = await sync({
      base: next(state, second),
      mine: serializeMarkdown(second.doc),
      threads: second.threads,
    })
    expect(third).toMatchObject({ sent: 0, changed: false })
  })

  it('rejects in the Doc one changed here it can’t be given, and sends the words here as the writer’s', async () => {
    const doc = {
      ...docOf([
        para([
          run('The '),
          run('old ', {}, { suggestedDeletionIds: ['suggest.d'] }),
          run('ferry left, as the '),
          run('old ', {}, { suggestedDeletionIds: ['suggest.d'] }),
          run('timetable said.'),
        ]),
      ]),
      suggestions: [
        {
          suggestionId: 'suggest.d',
          status: 'OPEN',
          headPost: { postId: 'post.d.0', author: ANA, createTime: '2026-10-01T00:00:00Z' },
        },
      ],
    }
    const { state } = google(doc)
    const first = await sync({ base: baseOf(doc), mine: text(doc) })
    const [id] = Object.keys(first.threads)
    // In two pieces apart here, one of them changed: no stretch of the Doc's to rewrite.
    const typed = serializeMarkdown(first.doc).replace(
      `{--old --}{>>${id}<<}ferry`,
      `{--olde --}{>>${id}<<}ferry`
    )
    const second = await sync({ base: next(state, first), mine: typed, threads: first.threads })

    // Hers rejected there, and settled so here.
    const listed = Object.fromEntries(
      state.doc.suggestions.map(each => [each.suggestionId, each.status])
    )
    expect(listed['suggest.d']).toBe('REJECTED')
    expect(second.threads[id]).toMatchObject({
      status: 'resolved',
      suggestion: { settled: 'rejected', name: 'Ana Marsh' },
    })
    // The words here are the writer's suggestion there, and here.
    expect(text(state.doc)).toBe('The olde ferry left, as the old timetable said.')
    const open = state.doc.suggestions.filter(each => each.status === 'OPEN')
    expect(open.every(each => each.headPost.author.me)).toBe(true)
    expect(
      readDoc(state.doc, { accepted: new Set(open.map(each => each.suggestionId)) }).markdown
    ).toBe('The ferry left, as the timetable said.')
    const mine = Object.entries(second.threads).filter(
      ([other, thread]) => other !== id && thread.status === 'open'
    )
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every(([, thread]) => thread.suggestion.author === 'writer')).toBe(true)
    expect(
      serializeMarkdown(
        seeing(
          second.doc,
          mine.map(([other]) => other)
        ).doc
      )
    ).toBe('The ferry left, as the timetable said.')
    expect(serializeMarkdown(seeing(second.doc, []).doc)).toBe(
      'The olde ferry left, as the old timetable said.'
    )
  })

  it('keeps an empty list item and an empty heading here, and writes nothing for them', async () => {
    const doc = docOf([item('Ropes', 'l'), item('Oars', 'l'), para('After.')], {
      lists: { l: bulleted() },
    })
    const { state } = google(doc)
    // A Doc reads one back as nothing, which would have it written again
    // at every sync.
    const mine = '- Ropes\n- Oars\n- \n\n## \n\nAfter.'
    const first = await sync({ base: baseOf(doc), mine })
    expect(state.writes).toEqual([])
    expect(serializeMarkdown(first.doc)).toBe(as(mine))
    const second = await sync({ base: { ...baseOf(state.doc), ...first.base }, mine })
    expect(second).toMatchObject({ sent: 0, changed: false })
    expect(state.writes).toEqual([])
  })

  /** A suggestion of the model's, its thread as a chat leaves it. */
  const models = (quote, put, reason) => ({
    status: 'open',
    quote,
    posts: reason ? [{ author: 'model', text: reason, created: 2 }] : [],
    suggestion: { text: put, created: 1, chat: 'chat_1' },
  })

  it('sends the model’s suggestions to the Doc as suggestions, and lays them in again by their ids', async () => {
    const doc = paragraphs('The ferry left at six, and it rained.', 'Gulls came in.')
    const { state } = google(doc)
    const mine =
      'The ferry left at {--six--}{>>sabcd1<<}{++seven++}{>>sabcd1<<}, and it ' +
      '{--rained--}{>>sabcd2<<}{++poured++}{>>sabcd2<<}.\n\nGulls came in.'
    const threads = {
      sabcd1: models('six', 'seven', 'By the timetable.'),
      sabcd2: models('rained', 'poured'),
    }
    const first = await sync({ base: baseOf(doc), mine, threads })

    // Each one of its own, in Suggesting mode, the two in one paragraph.
    const suggested = state.writes.filter(write => write.writeControl?.writeMode === 'SUGGEST')
    expect(suggested).toHaveLength(2)
    expect(text(state.doc)).toBe('The ferry left at six, and it rained.\n\nGulls came in.')
    const ids = state.doc.suggestions.map(each => each.suggestionId)
    expect(ids).toHaveLength(2)
    expect(state.doc.suggestions.every(each => each.headPost.author.me)).toBe(true)
    expect(readDoc(state.doc, { accepted: new Set(ids) }).markdown).toBe(
      'The ferry left at seven, and it poured.\n\nGulls came in.'
    )
    // Its reason goes as a reply on it.
    const replies = state.writes
      .flatMap(write => write.requests)
      .filter(each => each.addCommentReply)
    expect(replies.map(each => each.addCommentReply.post.content)).toEqual(['By the timetable.'])
    expect(replies[0].addCommentReply.suggestionId).toBe(first.threads.sabcd1.google.id)

    // Back as they were, by their ids, still the model's.
    expect(serializeMarkdown(first.doc)).toBe(as(mine))
    expect(first.threads.sabcd1).toMatchObject({
      quote: 'six',
      suggestion: { text: 'seven', chat: 'chat_1' },
      google: { doc: 'doc-1', status: 'open' },
    })
    expect(first.threads.sabcd1.suggestion).not.toHaveProperty('author')
    expect(first.suggestions.sent).toBe(2)
    expect(first.base.markdown).toBe(serializeMarkdown(first.doc))

    const second = await sync({ base: next(state, first), mine, threads: first.threads })
    expect(second).toMatchObject({ sent: 0, changed: false, suggestions: { sent: 0 } })
    expect(state.writes).toHaveLength(3)

    // Accepted here, accepted there.
    const accepted = serializeMarkdown(acceptSuggestion(parseMarkdown(mine), 'sabcd1'))
    const settled = {
      ...second.threads,
      sabcd1: {
        ...second.threads.sabcd1,
        status: 'resolved',
        suggestion: { ...second.threads.sabcd1.suggestion, settled: 'accepted' },
      },
    }
    await sync({ base: next(state, second), mine: accepted, threads: settled })
    expect(text(state.doc)).toBe('The ferry left at seven, and it rained.\n\nGulls came in.')
  })

  it('sends the model’s paragraphs put in and taken out to the Doc as suggestions', async () => {
    for (const [mine, made, accepted] of [
      [
        'The ferry left at six.\n\n{++A gull flew past.++}{>>sabcd9<<}\n\nGulls came in.',
        models('', 'A gull flew past.'),
        'The ferry left at six.\n\nA gull flew past.\n\nGulls came in.',
      ],
      [
        '{--The ferry left at six.--}{>>sabcd9<<}\n\nGulls came in.',
        models('The ferry left at six.', ''),
        'Gulls came in.',
      ],
    ]) {
      const doc = paragraphs('The ferry left at six.', 'Gulls came in.')
      const { state } = google(doc)
      const first = await sync({ base: baseOf(doc), mine, threads: { sabcd9: made } })
      expect(
        state.writes.filter(write => write.writeControl?.writeMode === 'SUGGEST')
      ).toHaveLength(1)
      expect(text(state.doc)).toBe('The ferry left at six.\n\nGulls came in.')
      const ids = state.doc.suggestions.map(each => each.suggestionId)
      expect(readDoc(state.doc, { accepted: new Set(ids) }).markdown).toBe(accepted)
      expect(serializeMarkdown(first.doc)).toBe(as(mine))
      expect(first.threads.sabcd9.google).toMatchObject({ doc: 'doc-1', status: 'open' })
      const second = await sync({ base: next(state, first), mine, threads: first.threads })
      expect(second).toMatchObject({ sent: 0, changed: false, suggestions: { sent: 0 } })
    }
  })

  it('keeps here one of the model’s that parts a paragraph, or joins two', async () => {
    for (const mine of [
      'The ferry left{-- at six--}{>>sabcd9<<}.\n\n{++At six.++}{>>sabcd9<<}\n\nGulls came in.',
      'The ferry left at six.{++ Gulls came in.++}{>>sabcd9<<}\n\n{--Gulls came in.--}{>>sabcd9<<}',
    ]) {
      const doc = paragraphs('The ferry left at six.', 'Gulls came in.')
      const { state } = google(doc)
      const first = await sync({ base: baseOf(doc), mine, threads: { sabcd9: models('', '') } })
      expect(state.writes).toEqual([])
      expect(serializeMarkdown(first.doc)).toBe(as(mine))
      expect(first.threads.sabcd9).not.toHaveProperty('google')
    }
  })

  it('writes an edit beside a paragraph the Doc suggests parting, and keeps the suggestion', async () => {
    const doc = docOf([
      para([run('One half.'), run('', {}, { suggestedInsertionIds: ['suggest.b'] })]),
      para('The other half.'),
      para('It rained.'),
    ])
    const { state } = google(doc)
    const first = await sync({ base: baseOf(doc), mine: text(doc) })
    const edited = serializeMarkdown(first.doc).replace('other half', 'second half')
    const second = await sync({ base: next(state, first), mine: edited, threads: first.threads })
    expect(second.left).toEqual([])
    expect(text(state.doc)).toBe('One half.The second half.\n\nIt rained.')
    expect(readDoc(state.doc, { accepted: new Set(['suggest.b']) }).markdown).toBe(
      'One half.\n\nThe second half.\n\nIt rained.'
    )
    expect(serializeMarkdown(second.doc)).toBe(as(edited))
  })

  it('puts a document with the model’s suggestions into a new Doc, they as suggestions', async () => {
    const mine = 'The ferry left at {--six--}{>>sabcd1<<}{++seven++}{>>sabcd1<<}.\n\nIt rained.'
    const { state } = google(docOf([para('')]))
    const first = await sync({ mine, threads: { sabcd1: models('six', 'seven') } })
    expect(text(state.doc)).toBe('The ferry left at six.\n\nIt rained.')
    const ids = state.doc.suggestions.map(each => each.suggestionId)
    expect(readDoc(state.doc, { accepted: new Set(ids) }).markdown).toBe(
      'The ferry left at seven.\n\nIt rained.'
    )
    expect(serializeMarkdown(first.doc)).toBe(as(mine))
    expect(first.threads.sabcd1.google).toMatchObject({ doc: 'doc-1', status: 'open' })
  })

  it('keeps here a suggestion of the model’s the Doc can’t take, and sends the rest', async () => {
    const doc = docOf([
      para([
        run('Bold', {}, { suggestedTextStyleChanges: { 'suggest.s': {} } }),
        run(' and plain.'),
      ]),
      para('Gulls came in.'),
    ])
    const { state } = google(doc)
    // One in a paragraph with a change of style suggested, which holds it off.
    const mine =
      'Bold and {--plain--}{>>sabcd1<<}{++clear++}{>>sabcd1<<}.\n\n' +
      'Gulls {--came--}{>>sabcd2<<}{++flew++}{>>sabcd2<<} in.'
    const threads = { sabcd1: models('plain', 'clear'), sabcd2: models('came', 'flew') }
    const first = await sync({ base: baseOf(doc), mine, threads })
    expect(state.writes.filter(write => write.writeControl?.writeMode === 'SUGGEST')).toHaveLength(
      1
    )
    expect(serializeMarkdown(first.doc)).toBe(as(mine))
    expect(first.threads.sabcd1).not.toHaveProperty('google')
    expect(first.threads.sabcd2.google).toMatchObject({ doc: 'doc-1', status: 'open' })
  })

  it('leaves one of the model’s the Doc changed the words of meanwhile without a place', async () => {
    const doc = paragraphs('The ferry left at six.', 'Gulls came in.')
    const { state } = google(doc)
    const base = baseOf(doc)
    // Someone made six ten in the Doc since.
    state.doc = applyBatch(
      state.doc,
      [
        { deleteContentRange: { range: { startIndex: 19, endIndex: 22 } } },
        { insertText: { text: 'ten', location: { index: 19 } } },
      ],
      { author: { displayName: 'Ana Marsh' } }
    ).document
    const mine =
      'The ferry left at {--six--}{>>sabcd1<<}{++seven++}{>>sabcd1<<}.\n\n' +
      'Gulls {--came--}{>>sabcd2<<}{++flew++}{>>sabcd2<<} in.'
    const threads = { sabcd1: models('six', 'seven'), sabcd2: models('came', 'flew') }
    const first = await sync({ base, mine, threads })
    expect(state.writes.filter(write => write.writeControl?.writeMode === 'SUGGEST')).toHaveLength(
      1
    )
    expect(serializeMarkdown(first.doc)).toBe(
      as(`The ferry left at ten.\n\nGulls {--came--}{>>sabcd2<<}{++flew++}{>>sabcd2<<} in.`)
    )
    expect(first.threads.sabcd1).toMatchObject({ status: 'open' })
    expect(first.threads.sabcd1).not.toHaveProperty('google')
  })

  /**
   * A Doc suggested in by hand in Docs, in the shape Docs wrote it: a word
   * replaced, a paragraph parted, another word replaced by someone else, a
   * paragraph's words taken out, a word made bold, two list items joined and
   * the second taken out of the list, and a heading suggested with a
   * paragraph after it, its newline the one put in. Two people, the account
   * one of them, and a reply on one.
   */
  function byHand() {
    const ins = (/** @type {string} */ id) => ({ suggestedInsertionIds: [`suggest.${id}`] })
    const del = (/** @type {string} */ id) => ({ suggestedDeletionIds: [`suggest.${id}`] })
    const styling = (/** @type {string} */ id, textStyle = {}) => ({
      suggestedTextStyleChanges: {
        [`suggest.${id}`]: { textStyle, textStyleSuggestionState: { boldSuggested: true } },
      },
    })
    const ME = { displayName: 'Ana Marsh', me: true, user: 'user-ana' }
    const BEN = { displayName: 'Ben Hale', user: 'user-ben' }
    const thread = (id, author, replies = []) => ({
      suggestionId: `suggest.${id}`,
      status: 'OPEN',
      headPost: { postId: `post.${id}`, author, createTime: '2026-10-22T06:40:00Z' },
      replies,
    })
    return {
      ...docOf(
        [
          styled('HEADING_1', 'Ferry log'),
          para([
            run('The crossing took most of the '),
            run('night', {}, ins('night')),
            run('morning', {}, del('night')),
            run('. '),
            run('', {}, ins('part')),
          ]),
          para([
            run('The wind '),
            run('went', {}, ins('went')),
            run('came', {}, del('went')),
            run(' round to the west by noon.'),
          ]),
          para([run('Gulls followed the wake the whole way.', {}, del('gulls')), run('')]),
          styled('HEADING_2', 'Tides'),
          para([
            run('We waited by the '),
            run('harbour', {}, styling('bold', { bold: true })),
            run(' wall until the tide turned.'),
          ]),
          item([run('Rope and fenders'), run('', {}, del('join'))], 'list.1'),
          para('A flask of tea', {
            bullet: { listId: 'list.1' },
            suggestedParagraphStyleChanges: {
              'suggest.unlist': {
                paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
                paragraphStyleSuggestionState: { indentStartSuggested: true },
              },
            },
            suggestedBulletChanges: {
              'suggest.unlist': { bulletSuggestionState: { listIdSuggested: true } },
            },
          }),
          styled('HEADING_2', [
            run('The last line.', {}, styling('style')),
            run('', {}, { ...ins('added'), ...styling('style') }),
          ]),
          para([run('The new last line.', {}, ins('added')), run('')]),
        ],
        { lists: { 'list.1': bulleted() } }
      ),
      suggestions: [
        thread('join', ME),
        thread('night', ME),
        thread('unlist', ME),
        thread('style', ME),
        thread('added', ME),
        thread('part', ME),
        thread('gulls', ME),
        thread('went', BEN),
        thread('bold', ME, [
          {
            postId: 'post.bold.1',
            author: ME,
            content: 'Bold?',
            createTime: '2026-10-22T06:41:00Z',
          },
        ]),
      ],
    }
  }

  it('brings in a Doc suggested in by hand, each change of words as it is there', async () => {
    const doc = byHand()
    const { state } = google(doc)
    const first = await sync({ base: baseOf(doc), mine: text(doc) })
    const byDocs = Object.fromEntries(
      Object.entries(first.threads).map(([id, thread]) => [thread.google.id.slice(8), id])
    )
    // Not the bold, the heading's style or the item out of the list, which
    // change no words; nor the paragraph parted, whose words the two either
    // side of it change.
    expect(Object.keys(byDocs).sort()).toEqual(['added', 'gulls', 'join', 'night', 'went'])
    expect(first).toMatchObject({ sent: 0, suggestions: { came: 5 } })
    expect(state.writes).toEqual([])
    expect(serializeMarkdown(seeing(first.doc, []).doc)).toBe(text(doc))
    // Each, accepted alone, as Docs makes it.
    for (const [docsId, id] of Object.entries(byDocs)) {
      expect(serializeMarkdown(seeing(first.doc, [id]).doc), docsId).toBe(
        as(readDoc(doc, { accepted: new Set([`suggest.${docsId}`]) }).markdown)
      )
    }
    expect(first.threads[byDocs.night]).toMatchObject({
      quote: 'morning',
      suggestion: { text: 'night', author: 'writer' },
    })
    expect(first.threads[byDocs.went].suggestion).toMatchObject({
      text: 'went',
      author: 'person',
      name: 'Ben Hale',
    })

    // All accepted here: accepted there, and the paragraph parted comes in.
    const ids = Object.values(byDocs)
    const threads = Object.fromEntries(
      Object.entries(first.threads).map(([id, thread]) => [
        id,
        {
          ...thread,
          status: 'resolved',
          suggestion: { ...thread.suggestion, settled: 'accepted' },
        },
      ])
    )
    const second = await sync({
      base: next(state, first),
      mine: serializeMarkdown(seeing(first.doc, ids).doc),
      threads,
    })
    expect(state.writes[0].requests).toHaveLength(5)
    expect(text(state.doc)).toBe(
      as(
        readDoc(doc, { accepted: new Set(Object.keys(byDocs).map(id => `suggest.${id}`)) }).markdown
      )
    )
    const [parted] = Object.entries(second.threads).filter(([id]) => !threads[id])
    expect(parted[1].google.id).toBe('suggest.part')
    expect(serializeMarkdown(seeing(second.doc, [parted[0]]).doc)).toBe(
      as(readDoc(state.doc, { accepted: new Set(['suggest.part']) }).markdown)
    )
  })
})

describe('syncDoc, the Doc’s suggestions at random, sync after sync', () => {
  /** Whether an edit here left every suggestion's change as it was. */
  const untouched = (changed, was) => {
    const [after, before] = [parseMarkdown(changed), parseMarkdown(was)]
    const ids = suggestionsIn(before)
    return (
      suggestionsIn(after).join() === ids.join() &&
      ids.every(id => JSON.stringify(changeOf(after, id)) === JSON.stringify(changeOf(before, id)))
    )
  }

  /**
   * Letters typed into the words one of the suggestions puts in or takes
   * out, or one taken out of them, or the words rewritten or taken out:
   * null when none has words of one line to type into.
   *
   * @param {string} markdown
   * @param {() => number} next
   * @returns {string|null}
   */
  const typedInto = (markdown, next) => {
    const found = [...markdown.matchAll(/\{(\+\+|--)([^{}\n*_`[\]\\]+?)(\+\+|--)\}\{>>(\w+)<<\}/g)]
    if (found.length === 0) return null
    const one = found[Math.floor(next() * found.length)]
    const [whole, open, words, close, id] = one
    const at = Math.floor(next() * (words.length + 1))
    const roll = next()
    const changed =
      roll < 0.4
        ? words.slice(0, at) + (next() < 0.5 ? 'x' : 'yz') + words.slice(at)
        : roll < 0.7
          ? words.slice(0, at) + words.slice(at + 1)
          : roll < 0.9
            ? 'calm'
            : ''
    // Not a line's words all taken out: an empty list item or heading stays
    // here only, as a Doc reads one as the spacing it holds.
    const lineStart = markdown.lastIndexOf('\n', one.index) + 1
    const lineEnd = markdown.indexOf('\n', one.index + whole.length)
    const line = markdown.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
    const alone = /^\s*([-*+>]|\d+\.|#{1,6})?\s*$/.test(line.replace(whole, ''))
    const now = changed === words || (alone && !changed) ? `${words}x` : changed
    const put = now ? `{${open}${now}${close}}{>>${id}<<}` : ''
    const typed = markdown.slice(0, one.index) + put + markdown.slice(one.index + whole.length)
    // Only that one changed, as it was typed.
    const [after, before] = [parseMarkdown(typed), parseMarkdown(markdown)]
    const others = suggestionsIn(before).filter(each => each !== id)
    const kept = others.every(
      each => JSON.stringify(changeOf(after, each)) === JSON.stringify(changeOf(before, each))
    )
    return kept && serializeMarkdown(after) !== serializeMarkdown(before) ? typed : null
  }

  /**
   * Whether one of a Doc's suggestions shares its paragraph, or one beside
   * it, with another: a word here is in one suggestion, so the second of two
   * that share words, or a paragraph parted around another's, stays in the
   * Doc until the first is settled.
   *
   * @param {any} doc
   * @param {string} one
   */
  const crowded = (doc, one) => {
    const paragraphs = doc.tabs[0].documentTab.body.content.filter(element => element.paragraph)
    /** @param {any} element */
    const ids = element =>
      (element?.paragraph?.elements ?? []).flatMap(part => [
        ...(part.textRun?.suggestedInsertionIds ?? []),
        ...(part.textRun?.suggestedDeletionIds ?? []),
      ])
    return paragraphs.some(
      (element, i) =>
        ids(element).includes(one) &&
        [...ids(element), ...ids(paragraphs[i - 1]), ...ids(paragraphs[i + 1])].some(
          id => id !== one
        )
    )
  }

  /**
   * An edit the model suggests here, as a chat that asks first makes it
   * (`changeSeen`): written to the text as the model sees it, its own still
   * waiting here made and every other rejected, and laid out against the
   * document. Its new suggestions get threads, and those it went into their
   * change. Null when there was nothing to suggest.
   *
   * @param {string} markdown
   * @param {Record<string, any>} threads
   * @param {() => number} next
   * @param {number} round
   */
  const modelSuggests = (markdown, threads, next, round) => {
    const before = parseMarkdown(markdown)
    // Its own as a chat has them, sent to the Doc or not.
    const own = suggestionsIn(before).filter(id => threads[id]?.suggestion?.chat)
    const seen = serializeMarkdown(seeing(before, own).doc)
    const changed = edited(seen, next)
    if (changed === seen) return null
    const result = suggestChange(before, parseMarkdown(changed), newSuggestionId(), own)
    if (!result) return null
    const made = { ...threads }
    for (const id of suggestionsIn(result.doc)) {
      if (made[id] && !own.includes(id)) continue
      const { out, in: put } = changeOf(result.doc, id)
      made[id] = {
        ...(made[id] ?? { status: 'open', posts: [] }),
        quote: out,
        suggestion: { ...(made[id]?.suggestion ?? { created: round, chat: 'chat_r' }), text: put },
      }
    }
    return { mine: serializeMarkdown(result.doc), threads: made }
  }

  afterEach(() => vi.unstubAllGlobals())

  const ANA = { displayName: 'Ana Marsh', user: 'user-ana' }
  const start = () =>
    docOf(
      [
        styled('HEADING_1', 'Harbour notes'),
        para('The ferry was late again and nobody minded much.'),
        para('Rain from the west, then dry by the evening.'),
        item('Ropes and oars', 'l'),
        item('A flask of tea', 'l'),
        styled('HEADING_2', 'Tuesday'),
        para('The tide turned at noon and the gulls came in.'),
        para('Last words of the day.'),
      ],
      { lists: { l: bulleted() } }
    )

  /**
   * One edit, of the kinds the writer's tests make, to the blocks no
   * suggestion is in.
   *
   * @param {string} markdown
   * @param {() => number} next
   */
  const edited = (markdown, next) => {
    const blocks = markdown.split('\n\n')
    const pick = list => {
      const choices = list
        .map((block, i) => (plain(block) && !/\{[+-]{2}/.test(block) ? i : -1))
        .filter(i => i >= 0)
      return choices.length ? choices[Math.floor(next() * choices.length)] : -1
    }
    edits[Math.floor(next() * edits.length)](blocks, pick, next)
    return blocks.join('\n\n')
  }

  it('keeps each of the Doc’s laid in here, settled either side, and the two the same as they stand', async () => {
    const next = random(29)
    const first = start()
    const { state } = google(first)
    let mine = text(first)
    /** @type {Record<string, any>} */
    let threads = {}
    let base = baseOf(first)
    const counts = {
      suggested: 0,
      synced: 0,
      stopped: 0,
      settledThere: 0,
      settledHere: 0,
      typed: 0,
      modelled: 0,
      left: 0,
    }

    for (let round = 0; round < 60; round++) {
      // Ana suggests an edit in the Doc.
      if (next() < 0.7) {
        const theirs = edited(text(state.doc), next)
        const written = writeDoc(state.doc, parseMarkdown(theirs))
        if (written.unsent.length === 0 && written.requests.length > 0) {
          try {
            state.doc = applyBatch(state.doc, written.requests, {
              author: ANA,
              suggest: `suggest.r${round}`,
            }).document
            counts.suggested++
          } catch {
            // A change of style the stand-in does not suggest.
          }
        }
      }
      const open = readDoc(state.doc).suggested
      // Ana settles one of them there, or says something on one.
      if (open.length > 0 && next() < 0.25) {
        const one = open[Math.floor(next() * open.length)]
        const kind = next() < 0.5 ? 'acceptSuggestion' : 'rejectSuggestion'
        state.doc = applyBatch(state.doc, [{ [kind]: { suggestionId: one } }], {
          author: ANA,
        }).document
        counts.settledThere++
      } else if (open.length > 0 && next() < 0.2) {
        const one = open[Math.floor(next() * open.length)]
        state.doc = applyBatch(
          state.doc,
          [{ addCommentReply: { suggestionId: one, post: { content: `On ${one}.` } } }],
          { author: ANA }
        ).document
      }
      // The writer settles one here, and edits.
      let doc = parseMarkdown(mine)
      const here = Object.entries(threads).filter(
        ([id, thread]) => thread.suggestion && thread.status === 'open' && mine.includes(id)
      )
      if (here.length > 0 && next() < 0.3) {
        const [id, thread] = here[Math.floor(next() * here.length)]
        const accepted = next() < 0.5
        doc = accepted ? acceptSuggestion(doc, id) : rejectSuggestion(doc, id)
        threads = {
          ...threads,
          [id]: {
            ...thread,
            status: 'resolved',
            suggestion: { ...thread.suggestion, settled: accepted ? 'accepted' : 'rejected' },
          },
        }
        counts.settledHere++
      }
      mine = serializeMarkdown(doc)
      if (next() < 0.5) {
        const changed = edited(mine, next)
        if (untouched(changed, mine)) mine = changed
      }
      // And types into one of the Doc's suggestions.
      const typed = next() < 0.6 ? typedInto(mine, next) : null
      if (typed) {
        mine = typed
        counts.typed++
      }
      // The model suggests an edit here.
      if (next() < 0.3) {
        const made = modelSuggests(mine, threads, next, round)
        if (made) {
          ;({ mine, threads } = made)
          counts.modelled++
        }
      }

      const said = `round ${round}\nmine:\n${mine}\nthe Doc:\n${text(state.doc)}`
      let result
      try {
        result = await sync({
          base,
          mine,
          threads,
        })
      } catch (error) {
        if (
          !(error instanceof DriveError) ||
          error instanceof StaleRevisionError ||
          /was changed here/.test(error.message)
        ) {
          throw new Error(`${said}\n${error.stack}`)
        }
        counts.stopped++
        continue
      }
      counts.synced++
      threads = result.threads
      base = { ...baseOf(state.doc), ...result.base }
      // What the Doc can't take yet stays here; the writer gives it up.
      if (result.left.length > 0) {
        counts.left++
        mine = result.base.markdown
        continue
      }
      mine = serializeMarkdown(result.doc)

      // The two say the same as they stand.
      expect(as(text(state.doc)), `${said}\nas it stands`).toBe(
        as(serializeMarkdown(seeing(result.doc, []).doc))
      )
      // The model's the Doc didn't take stay here, and only here.
      let shared = result.doc
      for (const id of suggestionsIn(result.doc)) {
        if (!threads[id]?.google) shared = rejectSuggestion(shared, id)
      }
      expect(result.base.markdown, `${said}\nthe base`).toBe(as(serializeMarkdown(shared)))
      // Each of the Doc's is here, and accepted alone here as it is there.
      const ids = new Map(
        Object.entries(threads).flatMap(([id, thread]) =>
          thread.google ? [[thread.google.id, id]] : []
        )
      )
      const stands = readDoc(state.doc).markdown
      for (const one of readDoc(state.doc).suggested) {
        const made = readDoc(state.doc, { accepted: new Set([one]) }).markdown
        if (made === stands) continue
        const id = ids.get(one)
        const placed = !!id && suggestionsIn(result.doc).includes(id)
        if (!placed && crowded(state.doc, one)) continue
        expect(id, `${said}\n${one} is here`).toBeTruthy()
        expect(threads[id].status, `${said}\n${one} is open`).toBe('open')
        const others = [...ids.values()].filter(each => each !== id)
        let alone = shared
        for (const other of others) alone = rejectSuggestion(alone, other)
        expect(as(serializeMarkdown(acceptSuggestion(alone, id))), `${said}\n${one} accepted`).toBe(
          as(made)
        )
      }
      // And none is open here that the Doc has not got.
      for (const [one, id] of ids) {
        if (threads[id].status !== 'open') continue
        expect(readDoc(state.doc).suggested, `${said}\n${one} is there`).toContain(one)
      }
    }
    console.log(counts)
    expect(counts.synced).toBeGreaterThan(30)
    expect(counts.suggested).toBeGreaterThan(10)
    expect(counts.typed).toBeGreaterThan(3)
  })

  it('does the same in a Doc of pictures, a chip, a page break, a quote, a table and a footnote', async () => {
    const next = random(7)
    const first = busy()
    const read = readDoc(first)
    const names = new Map(read.pictures.map((picture, i) => [picture.object, `image${i + 1}.png`]))
    const pictures = Object.fromEntries(
      [...names].map(([object, name]) => [name, { mime: 'image/png', docsId: object }])
    )
    /** A Doc read in the document's form, as it stands or with suggestions made. */
    const inForm = (doc, accepted) => {
      const read = readDoc(doc, { accepted })
      return as(
        read.pictures.reduce(
          (text, picture) =>
            text
              .split(`](${picture.marker})`)
              .join(`](${pictureHref(ID, /** @type {string} */ (names.get(picture.object)))})`),
          read.markdown
        )
      )
    }
    /** An edit that keeps the footnote, which the writer cannot add or take out. */
    const NOTE = /\n\n\\\[\^1\\\]: [^\n]*$/
    const noted = (changed, was) =>
      NOTE.test(changed) === NOTE.test(was) && /\\\[\^1\\\]/.test(changed.replace(NOTE, ''))
    /** The words, its pictures aside: one added here stays here. */
    const words = text => text.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    const { state } = google(first)
    let mine = inForm(first)
    /** @type {Record<string, any>} */
    let threads = {}
    let base = baseOf(first, { markdown: mine, pictures: Object.fromEntries(names) })
    let synced = 0

    for (let round = 0; round < 40; round++) {
      if (next() < 0.7) {
        const now = inForm(state.doc)
        const theirs = edited(now, next)
        const written = writeDoc(state.doc, parseMarkdown(theirs), { pictures })
        if (noted(theirs, now) && written.unsent.length === 0 && written.requests.length > 0) {
          try {
            state.doc = applyBatch(state.doc, written.requests, {
              author: ANA,
              suggest: `suggest.r${round}`,
            }).document
          } catch {
            // A change of style the stand-in does not suggest.
          }
        }
      }
      const open = readDoc(state.doc).suggested
      if (open.length > 0 && next() < 0.25) {
        const one = open[Math.floor(next() * open.length)]
        const kind = next() < 0.5 ? 'acceptSuggestion' : 'rejectSuggestion'
        state.doc = applyBatch(state.doc, [{ [kind]: { suggestionId: one } }], {
          author: ANA,
        }).document
      }
      let doc = parseMarkdown(mine)
      const here = Object.entries(threads).filter(
        ([id, thread]) => thread.suggestion && thread.status === 'open' && mine.includes(id)
      )
      if (here.length > 0 && next() < 0.3) {
        const [id, thread] = here[Math.floor(next() * here.length)]
        const accepted = next() < 0.5
        doc = accepted ? acceptSuggestion(doc, id) : rejectSuggestion(doc, id)
        threads = {
          ...threads,
          [id]: {
            ...thread,
            status: 'resolved',
            suggestion: { ...thread.suggestion, settled: accepted ? 'accepted' : 'rejected' },
          },
        }
      }
      mine = serializeMarkdown(doc)
      if (next() < 0.5) {
        const changed = edited(mine, next)
        if (noted(changed, mine) && untouched(changed, mine)) mine = changed
      }
      const typed = next() < 0.6 ? typedInto(mine, next) : null
      if (typed && noted(typed, mine)) mine = typed
      if (next() < 0.3) {
        const made = modelSuggests(mine, threads, next, round)
        // Accepted, it keeps the footnote too.
        const accepted =
          made &&
          serializeMarkdown(
            seeing(parseMarkdown(made.mine), suggestionsIn(parseMarkdown(made.mine))).doc
          )
        if (made && noted(made.mine, mine) && noted(/** @type {string} */ (accepted), mine)) {
          ;({ mine, threads } = made)
        }
      }

      const said = `round ${round}\nmine:\n${mine}\nthe Doc:\n${inForm(state.doc)}`
      let result
      try {
        result = await sync({
          base,
          mine,
          threads,
          pictures,
        })
      } catch (error) {
        if (
          !(error instanceof DriveError) ||
          error instanceof StaleRevisionError ||
          /was changed here/.test(error.message)
        ) {
          throw new Error(`${said}\n${error.stack}`)
        }
        continue
      }
      synced++
      threads = result.threads
      base = { ...baseOf(state.doc), ...result.base }
      if (result.left.length > 0) {
        mine = result.base.markdown
        continue
      }
      mine = serializeMarkdown(result.doc)

      expect(words(inForm(state.doc)), `${said}\nas it stands`).toBe(
        words(as(serializeMarkdown(seeing(result.doc, []).doc)))
      )
      const ids = new Map(
        Object.entries(threads).flatMap(([id, thread]) =>
          thread.google ? [[thread.google.id, id]] : []
        )
      )
      const stands = inForm(state.doc)
      for (const one of readDoc(state.doc).suggested) {
        const made = inForm(state.doc, new Set([one]))
        const id = ids.get(one)
        if (made === stands || !id || !suggestionsIn(result.doc).includes(id)) continue
        // The model's the Doc didn't take aside, which stay here only.
        let alone = result.doc
        for (const other of suggestionsIn(result.doc)) {
          if (other !== id) alone = rejectSuggestion(alone, other)
        }
        expect(
          words(as(serializeMarkdown(acceptSuggestion(alone, id)))),
          `${said}\n${one} accepted`
        ).toBe(words(made))
      }
      for (const [one, id] of ids) {
        if (threads[id].status !== 'open') continue
        expect(readDoc(state.doc).suggested, `${said}\n${one} is there`).toContain(one)
      }
    }
    expect(synced).toBeGreaterThan(20)
  })
})

describe('syncDoc, edited at random on both sides', () => {
  /**
   * The edits of one side, made to the base's blocks.
   *
   * @param {string} markdown
   * @param {() => number} next
   */
  const edited = (markdown, next) => {
    const blocks = markdown.split('\n\n')
    const pick = list => {
      const choices = list.map((block, i) => (plain(block) ? i : -1)).filter(i => i >= 0)
      return choices.length ? choices[Math.floor(next() * choices.length)] : -1
    }
    const count = 1 + Math.floor(next() * 3)
    for (let k = 0; k < count; k++) anyEdit(blocks, pick, next)
    return blocks.join('\n\n')
  }

  /** A footnote's note, at the end of a document. */
  const NOTE = /\n\n\\\[\^1\\\]: [^\n]*$/

  it('leaves the Doc and the document saying the same, and the base the Doc', async () => {
    const next = random(17)
    const start = busy()
    const read = readDoc(start)
    const names = new Map(read.pictures.map((picture, i) => [picture.object, `image${i + 1}.png`]))
    const pictures = Object.fromEntries(
      [...names].map(([object, name]) => [name, { mime: 'image/png', docsId: object }])
    )
    /** A Doc read in the document's form, its pictures by the names it has. */
    const inForm = doc =>
      readDoc(doc).pictures.reduce(
        (text, picture) =>
          text
            .split(`](${picture.marker})`)
            .join(`](${pictureHref(ID, /** @type {string} */ (names.get(picture.object)))})`),
        readDoc(doc).markdown
      )
    const markdown = inForm(start)
    const base = baseOf(start, {
      markdown: as(markdown),
      pictures: Object.fromEntries(names),
    })
    let clashed = 0
    let synced = 0
    for (let round = 0; round < 100; round++) {
      // A collaborator's edits, made in the Doc as Docs would make them.
      const theirs = edited(markdown, next)
      const written = writeDoc(start, parseMarkdown(theirs), { pictures })
      if (written.unsent.length > 0 || NOTE.test(theirs) !== NOTE.test(markdown)) continue
      const { state } = google(applyRequests(start, written.requests))
      const photo = objects(state.doc, 'kix.photo')
      const mine = edited(markdown, next)
      if (NOTE.test(mine) !== NOTE.test(markdown)) continue
      if (
        !/\\\[\^1\\\]/.test(mine.replace(NOTE, '')) ||
        !/\\\[\^1\\\]/.test(theirs.replace(NOTE, ''))
      )
        continue

      let result
      try {
        result = await sync({ base, mine, pictures })
      } catch (error) {
        if (error instanceof DriveError && !(error instanceof StaleRevisionError)) continue
        throw new Error(`round ${round}: ${error.message}\nmine:\n${mine}\ntheirs:\n${theirs}`)
      }
      // What the Doc can't take yet stays here, and the two differ by it.
      if (result.left.length > 0) continue
      synced++
      if (result.lost) clashed++
      const doc = serializeMarkdown(result.doc)
      // A picture the Doc has not got stays the document's alone.
      const words = text => text.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      const said = `round ${round}\nmine:\n${mine}\ntheirs:\n${theirs}`
      expect(words(as(inForm(state.doc))), `${said}\nthe Doc`).toBe(words(doc))
      expect(words(result.base.markdown), `${said}\nthe base`).toBe(words(doc))
      expect(objects(state.doc, 'kix.pic'), `${said}\nthe drawing`).toBe(1)
      expect(objects(state.doc, 'kix.photo'), `${said}\nthe picture`).toBe(
        photo && doc.includes('image1.png') ? 1 : 0
      )
    }
    // Most rounds synced, and some clashed, settled for the document.
    console.log({ synced, clashed })
    expect(synced).toBeGreaterThan(60)
    expect(clashed).toBeGreaterThan(0)
  })
})

describe('syncDoc, comments at random on both sides, sync after sync', () => {
  const ANA = { displayName: 'Ana Marsh', user: 'user-ana' }
  const WORDS = ['tide', 'rope', 'gull', 'late', 'grey', 'salt']

  /**
   * One run of syncs between a document and its Doc, each round both sides
   * editing words and commenting, replying, resolving and reopening.
   *
   * @param {number} seed
   * @param {number} rounds
   */
  async function run(seed, rounds) {
    const next = random(seed)
    const pick = list => list[Math.floor(next() * list.length)]
    const start = busy()
    const read = readDoc(start)
    const names = new Map(read.pictures.map((picture, i) => [picture.object, `image${i + 1}.png`]))
    const pictures = Object.fromEntries(
      [...names].map(([object, name]) => [name, { mime: 'image/png', docsId: object }])
    )
    const inForm = doc =>
      readDoc(doc).pictures.reduce(
        (markdown, picture) =>
          markdown
            .split(`](${picture.marker})`)
            .join(`](${pictureHref(ID, /** @type {string} */ (names.get(picture.object)))})`),
        readDoc(doc).markdown
      )
    const { state } = google(start)
    let mine = as(inForm(start))
    let base = baseOf(start, { markdown: mine, pictures: Object.fromEntries(names) })
    /** @type {Record<string, any>} */
    let threads = {}
    let made = 0
    let synced = 0

    for (let round = 0; round < rounds; round++) {
      // The collaborator: words, then comments, in the Doc.
      if (next() < 0.5) {
        const blocks = inForm(state.doc).split('\n\n')
        const choose = list => {
          // The footnote's number and note left alone: deleting the number
          // takes the note in Docs, which the writer cannot send back.
          const choices = list
            .map((block, i) => (plain(block) && !block.includes('\\[^') ? i : -1))
            .filter(i => i >= 0)
          return choices.length ? choices[Math.floor(next() * choices.length)] : -1
        }
        anyEdit(blocks, choose, next)
        const written = writeDoc(state.doc, parseMarkdown(blocks.join('\n\n')), { pictures })
        if (written.unsent.length === 0) state.doc = applyRequests(state.doc, written.requests)
      }
      const comments = state.doc.comments ?? []
      const roll = next()
      if (roll < 0.35) {
        const spans = readDoc(state.doc).spans.filter(
          span => span.kind === 'text' && !span.segment && span.size > 3
        )
        if (spans.length) {
          const span = pick(spans)
          const from = span.index + Math.floor(next() * (span.size - 3))
          const length = 1 + Math.floor(next() * Math.min(12, span.index + span.size - from - 1))
          state.doc = applyBatch(
            state.doc,
            [
              {
                insertComment: {
                  range: { startIndex: from, endIndex: from + length },
                  content: `Ana says ${pick(WORDS)}`,
                },
              },
            ],
            { author: ANA }
          ).document
        }
      } else if (roll < 0.5 && comments.length) {
        const comment = pick(comments)
        state.doc = applyBatch(
          state.doc,
          [
            {
              addCommentReply: {
                commentId: comment.commentId,
                post: { content: `Ana adds ${pick(WORDS)}` },
              },
            },
          ],
          { author: ANA }
        ).document
      } else if (roll < 0.6 && comments.length) {
        const comment = pick(comments)
        const action = comment.status === 'RESOLVED' ? 'REOPEN' : 'RESOLVE'
        state.doc = applyBatch(
          state.doc,
          [{ addCommentReply: { commentId: comment.commentId, post: { commentAction: action } } }],
          { author: ANA }
        ).document
      }

      // The writer: words where no comment is, then comments.
      const blocks = mine.split('\n\n')
      if (next() < 0.5) {
        const free = list => {
          const choices = list
            .map((block, i) =>
              plain(block) && !block.includes('{==') && !block.includes('\\[^') ? i : -1
            )
            .filter(i => i >= 0)
          return choices.length ? choices[Math.floor(next() * choices.length)] : -1
        }
        anyEdit(blocks, free, next)
      }
      mine = blocks.join('\n\n')
      const ids = Object.keys(threads)
      const act = next()
      if (act < 0.35) {
        // A comment on a plain word of a block with none.
        const choices = blocks
          .map((block, i) => (plain(block) && !block.includes('{==') ? i : -1))
          .filter(i => i >= 0)
        if (choices.length) {
          const i = pick(choices)
          const words = blocks[i].split(' ')
          const at = words.findIndex((word, k) => k > 0 && /^[a-z]{3,}$/.test(word))
          if (at > 0) {
            const id = `cmtr${String(++made).padStart(3, '0')}`
            words[at] = `{==${words[at]}==}{>>${id}<<}`
            blocks[i] = words.join(' ')
            mine = blocks.join('\n\n')
            threads = {
              ...threads,
              [id]: {
                status: 'open',
                quote: '',
                posts: [{ author: 'writer', text: `Me on ${pick(WORDS)} ${made}`, created: made }],
              },
            }
          }
        }
      } else if (act < 0.5 && ids.length) {
        const id = pick(ids)
        const thread = threads[id]
        threads = {
          ...threads,
          [id]: {
            ...thread,
            posts: [
              ...thread.posts,
              { author: 'writer', text: `Me again ${pick(WORDS)} ${round}`, created: 1000 + round },
            ],
          },
        }
      } else if (act < 0.6 && ids.length) {
        const id = pick(ids)
        if (mine.includes(`{>>${id}<<}`)) {
          mine = withoutComment(mine, id)
          threads = { ...threads, [id]: { ...threads[id], status: 'resolved' } }
        }
      }

      let result
      try {
        result = await sync({
          base,
          mine,
          pictures,
          threads,
        })
      } catch (error) {
        if (error instanceof DriveError && !(error instanceof StaleRevisionError)) continue
        throw new Error(`seed ${seed} round ${round}: ${error.stack}`)
      }
      if (result.left.length > 0) continue
      synced++
      const said = `seed ${seed} round ${round}`
      const doc = serializeMarkdown(result.doc)
      const words = text => text.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      const uncommented = serializeMarkdown(
        new Transform(result.doc).removeMark(0, result.doc.content.size, schema.marks.comment).doc
      )
      expect(words(uncommented), `${said}: the words`).toBe(words(as(inForm(state.doc))))

      // Every open thread either side is open on the other, saying the same.
      const local = result.threads
      const byGoogle = new Map(
        Object.entries(local)
          .filter(([, t]) => t.google)
          .map(([id, t]) => [t.google.id, [id, t]])
      )
      const placed = new Set(commentRanges(result.doc).map(range => range.id))
      for (const comment of state.doc.comments ?? []) {
        const posts = [comment.headPost, ...(comment.replies ?? [])]
          .filter(post => post.content)
          .map(post => post.content)
        const [id, thread] = byGoogle.get(comment.commentId) ?? []
        if (comment.status === 'OPEN') {
          expect(thread, `${said}: ${comment.commentId} here`).toBeDefined()
          expect(thread.status, `${said}: ${id} open`).toBe('open')
        } else if (thread) {
          expect(thread.status, `${said}: ${id} resolved`).toBe('resolved')
          expect(placed.has(id), `${said}: ${id} off its words`).toBe(false)
        }
        if (thread)
          expect(
            thread.posts.map(post => post.text),
            `${said}: ${id} posts`
          ).toEqual(posts)
      }
      for (const [id, thread] of Object.entries(local)) {
        if (thread.status !== 'open' || !placed.has(id)) continue
        expect(thread.google, `${said}: ${id} in the Doc`).toBeDefined()
      }

      base = { ...baseOf(state.doc), ...result.base }
      threads = result.threads
      mine = doc
    }
    return synced
  }

  afterEach(() => vi.unstubAllGlobals())

  it('keeps the threads either side the same, open, resolved and replied to', async () => {
    let synced = 0
    for (const seed of [31, 37]) synced += await run(seed, 40)
    expect(synced).toBeGreaterThan(60)
  })
})

describe('syncDoc, links between linked documents', () => {
  afterEach(() => vi.unstubAllGlobals())

  const rows = [
    { id: 'root_s', parentId: 's', type: 'folder', title: 'Thief' },
    { id: ID, parentId: 'root_s', type: 'text', title: 'Plan', drive: { id: 'doc-1' } },
    {
      id: 'doc_cast',
      parentId: 'root_s',
      type: 'text',
      title: 'Cast list',
      drive: { id: 'doc-2', tabId: 't.0' },
    },
    { id: 'doc_loose', parentId: 'root_s', type: 'text', title: 'Loose ends' },
  ]
  const tree = {
    get: id => rows.find(row => row.id === id) ?? null,
    childrenOf: parentId => rows.filter(row => row.parentId === parentId),
    rootId: 'root_s',
  }
  const links = docLinks(tree, ID)
  const CAST = 'https://docs.google.com/document/d/doc-2/edit?tab=t.0'
  /** The addresses of a Doc's links. */
  const urls = doc =>
    (JSON.stringify(doc).match(/"url":"[^"]*"/g) ?? []).map(each => each.slice(7, -1))

  /** Sync once, then again from where that left the two: the second sends nothing. */
  const twice = async (start, mine) => {
    const { state } = google(start)
    const first = await sync({ base: baseOf(start), mine, links })
    const writes = state.writes.length
    const second = await sync({
      base: { ...baseOf(state.doc), markdown: first.base.markdown },
      mine: serializeMarkdown(first.doc),
      links,
    })
    expect(state.writes.length, 'the second sync').toBe(writes)
    expect(second.changed).toBe(false)
    return { state, first }
  }

  it('writes a link to a document with a Doc as that Doc’s address', async () => {
    const mine = 'See [the cast](Cast%20list.md) first.'
    const { state, first } = await twice(paragraphs('See the cast first.'), mine)
    expect(urls(state.doc)).toEqual([CAST])
    expect(text(state.doc)).toBe(`See [the cast](${CAST}) first.`)
    expect(serializeMarkdown(first.doc)).toBe(as(mine))
  })

  it('reads a link to a linked document’s Doc as the link to it, the Doc’s address left be', async () => {
    const shared = 'https://docs.google.com/document/d/doc-2/edit?usp=sharing'
    const start = docOf([
      para([run('See '), run('the cast', { link: { url: shared } }), run(' first.')]),
    ])
    const { state, first } = await twice(start, text(start))
    expect(serializeMarkdown(first.doc)).toBe(as('See [the cast](Cast%20list.md) first.'))
    expect(state.writes).toEqual([])
    expect(urls(state.doc)).toEqual([shared])
  })

  it('sends a link to a document with no Doc as its words, and keeps it here', async () => {
    const mine = 'See [the loose ends](Loose%20ends.md) first.'
    const { state, first } = await twice(paragraphs('See the loose ends first.'), mine)
    expect(urls(state.doc)).toEqual([])
    expect(serializeMarkdown(first.doc)).toBe(as(mine))
  })

  it('leaves a link to a Doc no document here is linked to as it is', async () => {
    const other = 'https://docs.google.com/document/d/doc-9/edit'
    const start = docOf([
      para([run('See '), run('the old plan', { link: { url: other } }), run('.')]),
    ])
    const mine = `See [the old plan](${other}), then the cast.`
    const { state, first } = await twice(start, mine)
    expect(urls(state.doc)).toEqual([other])
    expect(serializeMarkdown(first.doc)).toBe(as(mine))
  })

  it('takes out a link to a document that went up as a relative path before', async () => {
    const start = docOf([
      para([run('See '), run('the loose ends', { link: { url: 'Loose%20ends.md' } }), run('.')]),
    ])
    const { state, first } = await twice(start, text(start))
    expect(urls(state.doc)).toEqual([])
    expect(serializeMarkdown(first.doc)).toBe(as('See [the loose ends](Loose%20ends.md).'))
  })
})
