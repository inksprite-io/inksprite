import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  projectOverview,
  executeReadDocument,
  executeDescribeDocument,
  executeSearchDocuments,
} from '@/ai/tools/documents.js'
import { READ_BUDGET } from '@/ai/tools/slices.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useChatsStore } from '@/stores/chatsStore'
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

/** A chapter's worth of paragraphs, each opening with its number. */
const paragraphs = (count, size = 600) =>
  Array.from(
    { length: count },
    (_, at) => `Paragraph ${at + 1}. ` + 'lorem '.repeat(size / 6)
  ).join('\n\n')

/** A long Markdown document: headings over enough prose to need three reads. */
const LONG = [
  '# Part One',
  paragraphs(40),
  '## Method',
  paragraphs(40),
  '# Part Two',
  paragraphs(50),
]
  .join('\n\n')
  .concat('\n\nThe reranker gains six points here at the very end.')

/** A long PDF's text as the importer writes it: pages under markers. */
const PAGED = Array.from(
  { length: 12 },
  (_, at) => `[p.${at + 1}]\nPage ${at + 1} opens. ` + 'ipsum '.repeat(1200)
).join('\n\n')

describe('reading a long document', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store
  const context = { storyId: STORY }

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
    await projectOverview(STORY)
    expect(LONG.length).toBeGreaterThan(READ_BUDGET * 2)
  })

  it('reads a short document whole, as before', async () => {
    text('Note', 'Short and sweet.')

    const result = await executeReadDocument({ path: 'Note' }, context)

    expect(result.content).toBe('Short and sweet.')
    expect(result).not.toHaveProperty('next')
    expect(result).not.toHaveProperty('from')
  })

  it('reads a long document one slice at a time, with the map on the first', async () => {
    text('Thesis', LONG)

    const first = await executeReadDocument({ path: 'Thesis' }, context)

    expect(first.from).toBe(0)
    expect(first.to).toBeLessThanOrEqual(READ_BUDGET)
    expect(first.length).toBe(LONG.length)
    expect(first.next).toBe(first.to)
    expect(first.content).toBe(LONG.slice(0, first.to))
    expect(first.sections.map(section => section.title)).toEqual(['Part One', 'Part Two'])
    expect(first.sections[0].sections).toEqual([
      expect.objectContaining({ link: 'method', title: 'Method' }),
    ])
    expect(first.map).toMatch(/describe_document/)
    expect(first.note).toBeUndefined()

    const second = await executeReadDocument({ path: 'Thesis', from: first.next }, context)
    expect(second.from).toBe(first.next)
    expect(second.content).toBe(LONG.slice(second.from, second.to))
    expect(second).not.toHaveProperty('sections')

    const last = await executeReadDocument({ path: 'Thesis', from: second.next }, context)
    expect(last.next).toBeNull()
    expect(last.to).toBe(LONG.length)
    expect(last.note).toMatch(/end of the document/)
  })

  it('starts at a heading when given its offset', async () => {
    text('Thesis', LONG)
    const at = LONG.indexOf('# Part Two')

    const result = await executeReadDocument({ path: 'Thesis', from: at }, context)

    expect(result.content.startsWith('# Part Two')).toBe(true)
    expect(result.from).toBe(at)
  })

  it('reads a section by its link or its title, whole when it fits', async () => {
    text('Thesis', LONG)

    const byLink = await executeReadDocument({ path: 'Thesis', section: 'method' }, context)
    expect(byLink.error).toBeUndefined()
    expect(byLink.section).toMatchObject({ link: 'method', title: 'Method' })
    expect(byLink.content).toBe(LONG.slice(LONG.indexOf('## Method'), LONG.indexOf('# Part Two')))
    expect(byLink).not.toHaveProperty('next')

    const byTitle = await executeReadDocument({ path: 'Thesis', section: 'part two' }, context)
    expect(byTitle.section.link).toBe('part-two')
    expect(byTitle.content.startsWith('# Part Two')).toBe(true)
    expect(byTitle.content.endsWith('at the very end.')).toBe(true)
  })

  it('reads a section longer than a read a slice at a time, and stops where it ends', async () => {
    text('Thesis', LONG)

    // A part holds its sections, so Part One runs to Part Two: longer than
    // one read. Its first slice lists its subsections; it goes on with from
    // and the same section, and the last slice is cut at the section's end.
    const first = await executeReadDocument({ path: 'Thesis', section: 'part-one' }, context)
    expect(first.section).toMatchObject({ from: 0, until: LONG.indexOf('# Part Two') })
    expect(first.sections.map(section => section.link)).toEqual(['method'])
    expect(first.next).not.toBeNull()
    expect(first.note).toMatch(/goes on/)
    let slice = first
    while (slice.next !== null) {
      slice = await executeReadDocument(
        { path: 'Thesis', section: 'part-one', from: slice.next },
        context
      )
      expect(slice).not.toHaveProperty('sections')
    }
    expect(slice.to).toBe(LONG.indexOf('# Part Two'))
    expect(slice.note).toMatch(/end of the section/)
  })

  it('says which sections there are when the one asked for is not', async () => {
    text('Thesis', LONG)

    const result = await executeReadDocument({ path: 'Thesis', section: 'appendix' }, context)

    expect(result.error).toMatch(/no section "appendix"/)
    expect(result.sections.map(section => section.title)).toEqual(['Part One', 'Part Two'])
  })

  it("describes a document's sections as a tree of links with their lengths", async () => {
    text('Thesis', LONG)

    const result = await executeDescribeDocument({ path: 'Thesis' }, context)

    expect(result).not.toHaveProperty('content')
    expect(result.path).toBe('Thesis')
    expect(result.sections).toEqual([
      {
        link: 'part-one',
        title: 'Part One',
        words: expect.any(Number),
        sections: [{ link: 'method', title: 'Method', words: expect.any(Number) }],
      },
      { link: 'part-two', title: 'Part Two', words: expect.any(Number) },
    ])
    const [one, two] = result.sections
    expect(one.words).toBeGreaterThan(one.sections[0].words)
    expect(two.words).toBeGreaterThan(0)
  })

  it('says a document without headings has none, and reads a PDF by its numbered ones', async () => {
    text('Plain', paragraphs(3))
    const plain = await executeDescribeDocument({ path: 'Plain' }, context)
    expect(plain).not.toHaveProperty('sections')
    expect(plain.note).toMatch(/no headings/)

    store.createDocument({
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'file',
      title: 'Dissertation',
      mime: 'application/pdf',
      content: [
        '[p.1]\nChapter 1\nBeginnings',
        paragraphs(2),
        '[p.2]\n1.1 First Steps',
        paragraphs(2),
        '[p.3]\nChapter 2\nEndings',
        paragraphs(2),
      ].join('\n\n'),
    })
    const paper = await executeDescribeDocument({ path: 'Dissertation' }, context)
    expect(paper.sections.map(section => section.link)).toEqual(['1-beginnings', '2-endings'])
    expect(paper.sections[0].sections[0].link).toBe('11-first-steps')

    const read = await executeReadDocument(
      { path: 'Dissertation', section: '11-first-steps' },
      context
    )
    expect(read.content.startsWith('1.1 First Steps')).toBe(true)
    expect(read.content).not.toContain('Endings')
  })

  it('reads a file by page, and says which page a slice is on', async () => {
    store.createDocument({
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'file',
      title: 'Paper',
      mime: 'application/pdf',
      pages: 12,
      content: PAGED,
    })

    const result = await executeReadDocument({ path: 'Paper', page: 7 }, context)

    expect(result.type).toBe('file')
    expect(result.page).toBe(7)
    expect(result.content.startsWith('[p.7]')).toBe(true)
    expect(result.pages).toBe(12)

    const missing = await executeReadDocument({ path: 'Paper', page: 40 }, context)
    expect(missing.error).toContain('no page 40')
  })

  it('does not nag about re-reading a long document, which has to be read each turn', async () => {
    text('Thesis', LONG)
    const chat = useChatsStore().createChat(STORY)
    const ctx = { storyId: STORY, chatId: chat.id }

    const result = await executeReadDocument({ path: 'Thesis' }, ctx)

    expect(result.note).toBeUndefined()
  })

  describe('search', () => {
    it('says where a hit is in a long document, and nothing for a short one', async () => {
      text('Thesis', LONG)
      text('Note', 'The reranker is mentioned here.')

      const { results } = await executeSearchDocuments({ query: 'reranker' }, context)

      const thesis = results.find(hit => hit.path === 'Thesis')
      const note = results.find(hit => hit.path === 'Note')
      expect(thesis.passages[0].at).toBe(LONG.toLowerCase().indexOf('reranker'))
      expect(thesis.passages[0]).not.toHaveProperty('page')
      expect(note.passages[0]).not.toHaveProperty('at')
      expect(note.passages[0].text).toContain('reranker')
    })

    it('says the page of a hit in a file with pages', async () => {
      store.createDocument({
        storyId: STORY,
        parentId: rootIdFor(STORY),
        type: 'file',
        title: 'Paper',
        mime: 'application/pdf',
        pages: 12,
        content: PAGED,
      })

      const { results } = await executeSearchDocuments({ query: 'Page 9 opens' }, context)

      const [passage] = results[0].passages
      expect(passage.page).toBe(9)
      expect(PAGED.slice(passage.at, passage.at + 12)).toBe('Page 9 opens')
    })
  })

  /** A rulebook as a conversion writes it: an index on top, a chapter with a long run of spells. */
  const RULEBOOK = [
    '- [Spells](#spells)',
    '  - [Spell Descriptions](#spell-descriptions) (40 entries)',
    '',
    '---',
    '',
    '# Spells',
    'Casting rules. For example, a wizard casting Fire Burst rolls its damage a single time.',
    '## Spell Descriptions',
    ...Array.from({ length: 40 }, (_, at) =>
      at === 11
        ? '### Fire Burst\nA spark swells into a burst of flame: 8d6 Fire damage.'
        : at === 12
          ? '### Slow Fire Burst\nA glowing bead, and a Fire Burst later.'
          : `### Spell ${at + 1}\n${paragraphs(4)}`
    ),
  ].join('\n\n')

  it('lists the subsections of one section when asked for it', async () => {
    text('Rules', RULEBOOK)
    expect(RULEBOOK.length).toBeGreaterThan(READ_BUDGET)

    const whole = await executeDescribeDocument({ path: 'Rules' }, context)
    expect(whole.sections[0].sections[0]).toMatchObject({ link: 'spell-descriptions', entries: 40 })

    const spells = await executeDescribeDocument(
      { path: 'Rules', section: 'spell-descriptions' },
      context
    )
    expect(spells.section).toMatchObject({
      link: 'spell-descriptions',
      in: 'Spells / Spell Descriptions',
    })
    expect(spells.sections).toHaveLength(40)
    expect(spells.sections[11]).toEqual({
      link: 'fire-burst',
      title: 'Fire Burst',
      words: expect.any(Number),
    })

    const missing = await executeDescribeDocument({ path: 'Rules', section: 'nope' }, context)
    expect(missing.error).toMatch(/no section "nope"/)
  })

  it('leads a search with the section named exactly that, and says the section of each passage', async () => {
    text('Rules', RULEBOOK)

    const { results } = await executeSearchDocuments({ query: 'Fire Burst' }, context)
    const [hit] = results
    expect(hit.titled).toEqual([
      {
        section: 'fire-burst',
        in: 'Spells / Spell Descriptions / Fire Burst',
        words: expect.any(Number),
      },
      {
        section: 'slow-fire-burst',
        in: 'Spells / Spell Descriptions / Slow Fire Burst',
        words: expect.any(Number),
      },
    ])
    // Not the index on top; one passage per section, each with where it is.
    expect(hit.passages.map(passage => passage.section)).toEqual([
      'spells',
      'fire-burst',
      'slow-fire-burst',
    ])
    expect(hit.passages[1]).toMatchObject({ in: 'Spells / Spell Descriptions / Fire Burst' })
    expect(hit).not.toHaveProperty('exact')

    const read = await executeReadDocument({ path: 'Rules', section: 'fire-burst' }, context)
    expect(read.content).toBe(
      '### Fire Burst\nA spark swells into a burst of flame: 8d6 Fire damage.\n\n'
    )
  })
})
