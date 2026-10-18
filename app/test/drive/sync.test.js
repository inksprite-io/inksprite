/* global Response */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { syncDoc } from '@/drive/sync.js'
import { applyRequests } from '@/drive/apply.js'
import { readDoc } from '@/drive/convert.js'
import { writeDoc } from '@/drive/write.js'
import { DriveError, NotGrantedError, StaleRevisionError } from '@/drive/errors.js'
import { parseMarkdown, serializeMarkdown } from '@/editor/markdown.js'
import { pictureHref } from '@/utils/pictures.js'
import { docOf, inline, para, run } from './docsHelpers.js'
import { anyEdit, busy, objects, plain, random } from './randomEdits.js'

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
      expect(body.writeControl.targetRevisionId).toBe(state.doc.revisionId)
      state.writes.push(body)
      let after = applyRequests(state.doc, body.requests)
      if (state.meanwhile) after = state.meanwhile(after)
      state.doc = { ...after, revisionId: `rev-${++state.revision}` }
      return new Response('{}')
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
 * @param {any} [options.ask]
 */
async function sync({ mine, base = null, pictures = {}, ask = {} }) {
  const versions = [mine].flat()
  let reads = 0
  const current = () => parseMarkdown(versions[Math.min(reads++, versions.length - 1)])
  /** @type {any[]} The pictures the sync had kept, and how often the document had been read by then. */
  const kept = []
  const keep = vi.fn(async given => kept.push(...given.map(picture => ({ ...picture, reads }))))
  const synced = await syncDoc(
    { documentId: ID, link: { id: 'doc-1' }, base, pictures, current, keep },
    'tok',
    {
      ask: {
        first: vi.fn(async () => {
          throw new Error('not asked')
        }),
        clashes: vi.fn(async () => {
          throw new Error('not asked')
        }),
        ...ask,
      },
    }
  )
  // Kept before the document's last read, at the end.
  for (const picture of kept) expect(picture.reads).toBe(reads - 1)
  return synced && { ...synced, pictures: kept.map(({ reads: _reads, ...picture }) => picture) }
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

  it('asks where both changed the same words, reads again, and keeps the side chosen', async () => {
    const start = paragraphs('The ferry left at six.', 'It rained.')
    const { state } = google(paragraphs('The ferry left at eight.', 'It rained.'))
    const clashes = vi.fn(async found => {
      expect(found).toHaveLength(1)
      return ['theirs']
    })
    const synced = await sync({
      base: baseOf(start),
      mine: 'The ferry left at seven.\n\nIt rained, hard.',
      ask: { clashes },
    })

    expect(clashes).toHaveBeenCalledTimes(1)
    // Read again once answered, as a revision lasts minutes.
    expect(state.reads).toBe(3)
    const result = 'The ferry left at eight.\n\nIt rained, hard.'
    expect(text(state.doc)).toBe(result)
    expect(serializeMarkdown(synced.doc)).toBe(as(result))
  })

  it('does nothing when the writer cancels a question', async () => {
    const start = paragraphs('The ferry left at six.')
    const { state } = google(paragraphs('The ferry left at eight.'))
    await expect(
      sync({
        base: baseOf(start),
        mine: 'The ferry left at seven.',
        ask: { clashes: async () => null },
      })
    ).resolves.toBeNull()
    expect(state.writes).toEqual([])
  })

  describe('with no base', () => {
    it('makes the Doc the document’s on Keep mine', async () => {
      const { state } = google(paragraphs('The ferry left at eight.', 'Then the rain.'))
      const first = vi.fn(async () => 'mine')
      const synced = await sync({ mine: 'The ferry left at seven.', ask: { first } })
      expect(first).toHaveBeenCalledTimes(1)
      expect(text(state.doc)).toBe('The ferry left at seven.')
      expect(serializeMarkdown(synced.doc)).toBe(as('The ferry left at seven.'))
    })

    it('makes the document the Doc’s on Use the Doc’s, its comments kept on words that stay', async () => {
      const { state } = google(paragraphs('The ferry left at eight.', 'Then the rain.'))
      const synced = await sync({
        mine: 'The {==ferry==}{>>c7k2m1<<} left at seven.',
        ask: { first: async () => 'theirs' },
      })
      expect(state.writes).toEqual([])
      expect(serializeMarkdown(synced.doc)).toBe(
        as('The {==ferry==}{>>c7k2m1<<} left at eight.\n\nThen the rain.')
      )
    })

    it('takes the Doc into an empty document, and asks nothing where the two agree', async () => {
      google(paragraphs('The ferry left at eight.'))
      const empty = await sync({ mine: '' })
      expect(serializeMarkdown(empty.doc)).toBe(as('The ferry left at eight.'))

      const same = await sync({ mine: 'The ferry left at eight.' })
      expect(same).toMatchObject({ sent: 0, changed: false })
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

  it('stops before writing anything the Doc cannot take yet', async () => {
    const start = paragraphs('The ferry left at six.')
    const { state } = google(start)
    await expect(
      sync({
        base: baseOf(start),
        mine: 'The ferry left at six.[^1]\n\n[^1]: Or so they said.',
      })
    ).rejects.toThrow(new DriveError('Sync can’t add or remove footnotes in Google Docs yet.'))
    expect(state.writes).toEqual([])
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
        ask: { first: async () => 'mine' },
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
        result = await sync({
          base,
          mine,
          pictures,
          ask: {
            clashes: async found => {
              clashed++
              return found.map(() => (next() < 0.5 ? 'mine' : 'theirs'))
            },
          },
        })
      } catch (error) {
        if (error instanceof DriveError && !(error instanceof StaleRevisionError)) continue
        throw new Error(`round ${round}: ${error.message}\nmine:\n${mine}\ntheirs:\n${theirs}`)
      }
      synced++
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
    // Most rounds synced, and some clashed, settled either way.
    console.log({ synced, clashed })
    expect(synced).toBeGreaterThan(60)
    expect(clashed).toBeGreaterThan(0)
  })
})
