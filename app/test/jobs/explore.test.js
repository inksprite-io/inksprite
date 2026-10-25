import { describe, it, expect } from 'vitest'
import {
  DEFAULT_BUDGET,
  MOST_BUDGET,
  PACK_MOST,
  SECTIONS_MOST,
  SECTION_WORDS,
  budgetFor,
  digestOf,
  documentBasis,
  longSections,
  sectionsAskedFor,
  exploreMessages,
  folderBasis,
  parseDigests,
  partAnswer,
  partsOf,
  planExplore,
} from '@/jobs/explore.js'

/** @typedef {import('@/jobs/explore.js').ExploreNode} ExploreNode */

/** Made-up prose of about so many words. @param {number} words @param {string} [seed] */
const prose = (words, seed = 'tide') =>
  Array.from({ length: words }, (_, at) => (at % 12 === 11 ? `${seed}.` : seed)).join(' ')

/**
 * @param {string} path
 * @param {string} text
 * @param {Partial<ExploreNode>} [extra]
 * @returns {ExploreNode}
 */
const doc = (path, text, extra = {}) => ({
  id: path,
  path,
  title: path.split('/').pop() || path,
  type: 'text',
  text,
  words: text.split(/\s+/).filter(Boolean).length,
  children: [],
  ...extra,
})

/**
 * @param {string} path
 * @param {ExploreNode[]} children
 * @param {Partial<ExploreNode>} [extra]
 * @returns {ExploreNode}
 */
const folder = (path, children, extra = {}) => ({
  id: path,
  path,
  title: path === '/' ? 'Thief' : path.split('/').pop() || path,
  type: 'folder',
  text: '',
  words: 0,
  children,
  ...extra,
})

/** Give a node the digest it would have once explored, as of now. @param {ExploreNode} node */
const explored = node => {
  node.digest = {
    line: `About ${node.title}.`,
    text: `What ${node.title} holds.`,
    of: node.type === 'folder' ? folderBasis(node) : documentBasis(node),
    made: 1,
  }
  return node
}

/** @param {import('@/jobs/explore.js').PlannedExplore} planned */
const kinds = planned => planned.steps.map(step => planned.plan.work[step.id].kind)

describe('budgetFor', () => {
  it('fits the text to the context, kept short of it, and caps it', () => {
    expect(budgetFor(undefined)).toBe(DEFAULT_BUDGET)
    expect(budgetFor(131072)).toBe((131072 - 8000) * 3)
    expect(budgetFor(2_000_000)).toBe(MOST_BUDGET)
    // A small context gives half of itself to the text.
    expect(budgetFor(4096)).toBe(2048 * 3)
  })
})

describe('planExplore', () => {
  it('reads a folder that fits whole in one request, describing it last', () => {
    const entries = [
      doc('Lore/Varrow', prose(40)),
      doc('Lore/The Gull', prose(200)),
      doc('Lore/Harbour Guild', prose(30)),
    ]
    const places = folder('Lore/Places', [doc('Lore/Places/Docks', prose(160))])
    const lore = folder('Lore', [...entries, places])

    const planned = planExplore(lore, DEFAULT_BUDGET)

    expect(kinds(planned)).toEqual(['read'])
    const work = planned.plan.work[planned.steps[0].id]
    expect(work.whole).toBe('Lore')
    expect(work.reads).toEqual([
      'Lore/Varrow',
      'Lore/The Gull',
      'Lore/Harbour Guild',
      'Lore/Places/Docks',
    ])
    // The short entries are read and not described on their own.
    expect(Object.keys(work.answers)).toEqual([
      'Lore/The Gull',
      'Lore/Places/Docks',
      'Lore/Places',
      'Lore',
    ])
    expect(planned.documents).toBe(4)
    expect(planned.steps[0].label).toBe('Lore/ · all of it')
  })

  it('reads each document of a folder too big for one request, small ones together, then puts it together', () => {
    const budget = 20000
    const papers = Array.from({ length: PACK_MOST + 2 }, (_, at) =>
      doc(`Research/Paper ${at + 1}`, prose(300, `w${at}`))
    )
    const big = doc('Research/Survey', prose(2500))
    const note = doc('Research/Reading list', prose(60))
    const research = folder('Research', [...papers, big, note])

    const planned = planExplore(research, budget)

    const reads = planned.steps.filter(step => planned.plan.work[step.id].kind === 'read')
    expect(reads.map(step => planned.plan.work[step.id].reads?.length)).toEqual([PACK_MOST, 3])
    expect(reads[0].label).toBe(`Paper 1 +${PACK_MOST - 1}`)
    const last = planned.steps[planned.steps.length - 1]
    const gather = planned.plan.work[last.id]
    expect(gather.kind).toBe('gather')
    expect(Object.keys(gather.answers)).toEqual(['Research'])
    expect(last.after).toEqual(reads.map(step => step.id))
    expect(gather.pieces).toContainEqual({ text: 'Research/Reading list' })
    expect(gather.pieces).toContainEqual({ digest: 'Research/Survey' })
  })

  it('reads a document longer than a request in parts along its headings, then puts it together', () => {
    const text = [
      '[p.1]',
      '# Scoring',
      prose(900, 'score'),
      '[p.2]',
      '# Curves',
      prose(900, 'curve'),
      '[p.3]',
      '# Buckets',
      prose(900, 'bucket'),
    ].join('\n')
    const book = doc('Research/Book', text, { type: 'file' })
    const research = folder('Research', [book, doc('Research/Other', prose(1000))])

    const planned = planExplore(research, 8000)

    const parts = planned.steps.filter(step => planned.plan.work[step.id].kind === 'part')
    expect(parts.map(step => step.label)).toEqual(['Book · p. 1', 'Book · p. 2', 'Book · p. 3'])
    for (const part of parts) expect(part.after).toEqual([])
    const whole = planned.steps.find(
      step =>
        planned.plan.work[step.id].kind === 'gather' && planned.plan.work[step.id].of === book.id
    )
    expect(whole?.label).toBe('Book · put together')
    expect(whole?.after).toEqual(parts.map(step => step.id))
    expect(planned.plan.work[whole?.id || ''].answers).toHaveProperty('Research/Book')
    // The folder waits for the book to be put together.
    const top = planned.steps[planned.steps.length - 1]
    expect(top.after).toContain(whole?.id)
  })

  it('cuts at the headings, so each part starts at one', () => {
    const text = ['# One', prose(500), '# Two', prose(500), '# Three', prose(500)].join('\n')
    const parts = partsOf(text, 3500)
    expect(parts).toHaveLength(3)
    const lines = text.split('\n')
    expect(parts.map(part => lines[part.from])).toEqual(['# One', '# Two', '# Three'])
  })

  it('puts the project together from its top folders, after them', () => {
    const notes = folder('Notes', [doc('Notes/Elara', prose(5000))])
    const lore = folder('Lore', [doc('Lore/Varrow', prose(5000))])
    const root = folder('/', [notes, lore, doc('Outline', prose(50))])

    const planned = planExplore(root, 12000)

    const top = planned.steps[planned.steps.length - 1]
    const work = planned.plan.work[top.id]
    expect(work.of).toBe('/')
    expect(top.label).toBe('Thief · put together')
    expect(work.pieces).toEqual([{ digest: 'Notes' }, { digest: 'Lore' }, { text: 'Outline' }])
    expect(top.after).toHaveLength(2)
  })

  it('names what it cannot read in the folder’s digest, and reads none of it', () => {
    const repo = folder('Code', [doc('Code/main.js', prose(4000))], { leftOut: 'a codebase' })
    const scan = doc('Scan', '', { type: 'file', leftOut: 'a file with no text' })
    const root = folder('/', [repo, scan, doc('Notes', prose(4000)), doc('More', prose(4000))])

    const planned = planExplore(root, 20000)

    const read = Object.values(planned.plan.work).flatMap(work => work.reads || [])
    expect(read).not.toContain('Code/main.js')
    expect(read).not.toContain('Scan')
    const gather = planned.plan.work[planned.steps[planned.steps.length - 1].id]
    expect(gather.pieces).toContainEqual({ left: 'Code' })
    expect(gather.pieces).toContainEqual({ left: 'Scan' })
  })

  it('plans nothing for what is current, and only what moved after an edit', () => {
    const elara = doc('Notes/Elara', prose(3000))
    const bran = doc('Notes/Bran', prose(3000))
    const notes = folder('Notes', [elara, bran])
    const lore = folder('Lore', [doc('Lore/Varrow', prose(3000)), doc('Lore/Docks', prose(3000))])
    const root = folder('/', [notes, lore])
    for (const node of [elara, bran, notes, ...lore.children, lore, root]) explored(node)

    expect(planExplore(root, 20000).steps).toEqual([])

    elara.text = `${elara.text} The end.`
    const again = planExplore(root, 20000)
    expect(
      again.steps.map(step => {
        const work = again.plan.work[step.id]
        return [work.kind, work.reads || work.of]
      })
    ).toEqual([
      ['read', ['Notes/Elara']],
      ['gather', 'Notes'],
      ['gather', '/'],
    ])
    expect(again.documents).toBe(1)
  })

  it('reads a folder again when a document is added to it, hidden in it, or taken out', () => {
    const lore = folder('Lore', [doc('Lore/Varrow', prose(40)), doc('Lore/Docks', prose(40))])
    explored(lore)
    expect(planExplore(lore, DEFAULT_BUDGET).steps).toEqual([])

    lore.children.pop()
    expect(planExplore(lore, DEFAULT_BUDGET).steps).toHaveLength(1)
  })

  it('lets go of the digest of a document that has grown too short for one', () => {
    const short = explored(doc('Lore/Varrow', prose(40)))
    const lore = explored(folder('Lore', [short, doc('Lore/Docks', prose(40))]))

    const planned = planExplore(lore, DEFAULT_BUDGET)

    expect(planned.plan.work[planned.steps[0].id].drop).toEqual(['Lore/Varrow'])
  })

  it('puts a folder with too much in it together in parts, then the parts together', () => {
    const many = Array.from({ length: 30 }, (_, at) =>
      explored(doc(`Big/Doc ${at}`, prose(400, `x${at}`)))
    )
    const big = folder('Big', many)

    const planned = planExplore(big, 2000)

    const gathers = planned.steps.filter(step => planned.plan.work[step.id].kind === 'gather')
    const partial = gathers.filter(step => planned.plan.work[step.id].part)
    expect(partial.length).toBeGreaterThan(1)
    expect(partial[0].label).toBe(`Big/ · put together, part 1 of ${partial.length}`)
    const last = gathers[gathers.length - 1]
    expect(planned.plan.work[last.id].pieces).toEqual(partial.map(step => ({ step: step.id })))
    expect(last.after).toEqual(partial.map(step => step.id))
    expect(planned.plan.work[last.id].answers).toHaveProperty('Big')
  })

  it('says how much it reads', () => {
    const lore = folder('Lore', [doc('Lore/Varrow', prose(400)), doc('Lore/Docks', prose(400))])
    const planned = planExplore(lore, DEFAULT_BUDGET)
    expect(planned.documents).toBe(2)
    expect(planned.chars).toBeGreaterThan(2 * prose(400).length)
  })

  it('plans nothing for a folder with nothing in it to read', () => {
    expect(planExplore(folder('Empty', []), DEFAULT_BUDGET).steps).toEqual([])
  })
})

describe('exploreMessages', () => {
  /** @param {ExploreNode[]} nodes @param {Record<string, string>} [outputs] */
  const reader = (nodes, outputs = {}) => {
    const all = new Map()
    const index = (/** @type {ExploreNode} */ node) => {
      all.set(node.id, node)
      node.children.forEach(index)
    }
    nodes.forEach(index)
    return { node: id => all.get(id) || null, output: id => outputs[id] || '' }
  }

  it('sends a folder’s documents whole, and asks for each heading in turn', () => {
    const lore = folder('Lore', [
      doc('Lore/Varrow', 'A port town.'),
      doc('Lore/The Gull', prose(200)),
    ])
    const planned = planExplore(lore, DEFAULT_BUDGET)

    const [system, user] =
      exploreMessages(planned.plan.work[planned.steps[0].id], reader([lore])) || []

    expect(system.content).toContain('finding aid')
    expect(user.content).toContain('These are the documents in Lore/, all of them.')
    expect(user.content).toContain(
      '<document path="Lore/Varrow" words="3">\nA port town.\n</document>'
    )
    expect(user.content).toMatch(/## Lore\/The Gull\n## Lore\/$/)
  })

  it('sends a part with its pages, and asks for it under the part’s heading', () => {
    const text = ['[p.4]', '# Curves', prose(900), '[p.5]', '# Buckets', prose(900)].join('\n')
    const book = doc('Book', text, { type: 'file' })
    const planned = planExplore(folder('/', [book, doc('Other', prose(3000))]), 6000)
    const part = planned.steps.find(step => planned.plan.work[step.id].kind === 'part')

    const [, user] = exploreMessages(planned.plan.work[part?.id || ''], reader([book])) || []

    expect(user.content).toContain('This is part 1 of 2 of Book, p. 4')
    expect(user.content).toContain('[p.4]\n# Curves')
    expect(user.content).toMatch(/## Book, part 1 of 2$/)
  })

  it('puts a folder together from its digests, short documents and what it left out', () => {
    const elara = explored(doc('Notes/Elara', prose(400)))
    const list = doc('Notes/List', 'Rope, lamp, chalk.')
    const code = folder('Notes/Code', [], { leftOut: 'a codebase' })
    const notes = folder('Notes', [elara, list, code])
    /** @type {import('@/jobs/explore.js').ExploreWork} */
    const work = {
      kind: 'gather',
      of: 'Notes',
      pieces: [
        { digest: 'Notes/Elara' },
        { text: 'Notes/List' },
        { left: 'Notes/Code' },
        { digest: 'Notes/Gone' },
      ],
      answers: { Notes: 'x' },
    }

    const [, user] = exploreMessages(work, reader([notes])) || []

    expect(user.content).toContain(
      '<description path="Notes/Elara" words="400">\nAbout Elara.\n\nWhat Elara holds.\n</description>'
    )
    expect(user.content).toContain(
      '<document path="Notes/List" words="3">\nRope, lamp, chalk.\n</document>'
    )
    expect(user.content).toContain('Not read: Notes/Code/ (a codebase).')
    expect(user.content).not.toContain('Gone')
    expect(user.content).toMatch(/## Notes\/$/)
  })

  it('names the project as the project, not by its slash', () => {
    const root = folder('/', [explored(doc('Notes', prose(400)))])
    /** @type {import('@/jobs/explore.js').ExploreWork} */
    const work = { kind: 'gather', of: '/', pieces: [{ digest: 'Notes' }], answers: { '/': 'x' } }

    const [, user] = exploreMessages(work, reader([root])) || []

    expect(user.content).toMatch(/^The project holds too much to read at once\./)
    expect(user.content).toContain('Describe the project.')
    expect(user.content).toMatch(/## \/$/)
  })

  it('puts a document together from what its parts answered', () => {
    const book = doc('Book', prose(10))
    /** @type {import('@/jobs/explore.js').ExploreWork} */
    const work = {
      kind: 'gather',
      of: 'Book',
      pieces: [{ step: 'part-1' }, { step: 'part-2' }],
      answers: { Book: 'x' },
    }

    const [, user] =
      exploreMessages(work, reader([book], { 'part-1': 'On scoring.', 'part-2': 'On curves.' })) ||
      []

    expect(user.content).toContain('Book was too long to read at once, and was read in 2 parts.')
    expect(user.content).toContain('<part n="1">\nOn scoring.\n</part>')
  })

  it('has nothing to send once what it was to read has gone', () => {
    /** @type {import('@/jobs/explore.js').ExploreWork} */
    const work = { kind: 'read', reads: ['Gone'], answers: { Gone: 'x' } }
    expect(exploreMessages(work, reader([]))).toBeNull()
  })
})

describe('parseDigests', () => {
  const asked = [
    { id: 'elara', path: 'Notes/Elara' },
    { id: 'bran', path: 'Notes/Bran' },
    { id: 'notes', path: 'Notes/' },
  ]

  it('reads a line and a paragraph under each heading asked for', () => {
    const answer = [
      '## Notes/Elara',
      'An entry on Elara: her ship and her debts.',
      '',
      'Elara took over the Gull. Read it for her motives.',
      '',
      '## Notes/Bran',
      'Bran, the harbourmaster.',
      '',
      'His rounds, and the bribes he takes.',
      '',
      '## Notes/',
      'The characters, an entry each.',
      '',
      'Two entries.',
    ].join('\n')

    const found = parseDigests(answer, asked)

    expect(found.get('elara')).toEqual({
      line: 'An entry on Elara: her ship and her debts.',
      text: 'Elara took over the Gull. Read it for her motives.',
    })
    expect(found.get('notes')?.line).toBe('The characters, an entry each.')
  })

  it('takes a heading written differently, or by the last part of its path', () => {
    const answer = '### **Elara**\nOn Elara.\n\nMore.\n\n## `Notes/Bran/`\nOn Bran.\n\nMore.'
    const found = parseDigests(answer, asked)
    expect(found.get('elara')?.line).toBe('On Elara.')
    expect(found.get('bran')?.line).toBe('On Bran.')
    expect(found.has('notes')).toBe(false)
  })

  it('takes the whole answer for one asked alone, thinking and fences taken out', () => {
    const answer = '<think>Let me see.</think>\n```markdown\nOn Elara.\n\nHer ship.\n```'
    expect(parseDigests(answer, [asked[0]]).get('elara')).toEqual({
      line: 'On Elara.',
      text: 'Her ship.',
    })
  })

  it('answers for the project under its slash', () => {
    const found = parseDigests('## /\nA novel and its notes.\n\nThe chapters.', [
      { id: 'root', path: '/' },
      { id: 'elara', path: 'Notes/Elara' },
    ])
    expect(found.get('root')?.line).toBe('A novel and its notes.')
  })
})

describe('digestOf', () => {
  it('takes labels off, and the first sentence of a lone paragraph for the line', () => {
    expect(digestOf('**Line:** On Elara.\n\n**Paragraph:** Her ship.')).toEqual({
      line: 'On Elara.',
      text: 'Her ship.',
    })
    expect(digestOf('On Elara. Her ship, and her debts.')).toEqual({
      line: 'On Elara.',
      text: 'On Elara. Her ship, and her debts.',
    })
    expect(digestOf('  ')).toBeNull()
  })

  it('cuts a line that runs on, at a word', () => {
    const { line } = digestOf(`${prose(80)}\n\nMore.`) || { line: '' }
    expect(line.length).toBeLessThanOrEqual(301)
    expect(line.endsWith('…')).toBe(true)
  })
})

describe('partAnswer', () => {
  it('keeps what a part said without its heading', () => {
    expect(partAnswer('## Book, part 2 of 3\nOn curves.\n\nMore.', 'Book')).toBe(
      'On curves.\n\nMore.'
    )
  })
})

describe('planExplore over one document', () => {
  it('reads a short one in one request, describing it alone', () => {
    const elara = doc('Notes/Elara', 'A knight of the north.')
    const planned = planExplore(elara, DEFAULT_BUDGET)

    expect(kinds(planned)).toEqual(['read'])
    const [step] = planned.steps
    expect(step.label).toBe('Elara')
    expect(Object.keys(planned.plan.work[step.id].answers)).toEqual(['Notes/Elara'])
    expect(planned.plan.rootId).toBe('Notes/Elara')
    expect(planned.documents).toBe(1)
  })

  it('reads a long one in parts, then puts it together', () => {
    const text = ['# One', prose(3000, 'one'), '# Two', prose(3000, 'two')].join('\n')
    const planned = planExplore(doc('Book', text), 12000)

    expect(kinds(planned).filter(kind => kind === 'part').length).toBeGreaterThan(1)
    expect(kinds(planned).at(-1)).toBe('gather')
  })

  it('plans nothing for one that is current, or has nothing to read', () => {
    expect(planExplore(explored(doc('Notes/Elara', prose(200))), DEFAULT_BUDGET).steps).toEqual([])
    expect(planExplore(doc('Empty', '   '), DEFAULT_BUDGET).steps).toEqual([])
    expect(planExplore(doc('Code', 'x', { leftOut: 'a codebase' }), DEFAULT_BUDGET).steps).toEqual(
      []
    )
  })
})

describe('long sections', () => {
  /** A document of these sections, each `# title` and so many words. @param {Array<[string, number, number?]>} parts */
  const book = (path, parts) =>
    doc(
      path,
      parts
        .map(([title, words, level = 1]) => `${'#'.repeat(level)} ${title}\n\n${prose(words)}`)
        .join('\n\n')
    )

  it('gives a line to each section long enough, however deep, and not to the whole', () => {
    const atlas = book('Atlas', [
      ['Coasts', 10, 1],
      ['Harbours', SECTION_WORDS + 50, 4],
      ['Spells', 60, 1],
      ['Light', 40, 2],
      ['Tides', SECTION_WORDS * 2, 1],
    ])

    expect(longSections(atlas).map(section => section.title)).toEqual([
      'Coasts',
      'Harbours',
      'Tides',
    ])
    // One section that is the whole document is the document's own line.
    expect(longSections(book('One', [['Everything', SECTION_WORDS * 3]]))).toEqual([])
    expect(longSections(doc('Short', prose(SECTION_WORDS - 10)))).toEqual([])
  })

  it('keeps the longest when there are too many, in the order they come', () => {
    const many = book(
      'Almanac',
      Array.from({ length: SECTIONS_MOST + 5 }, (_, at) => [
        `Day ${at + 1}`,
        SECTION_WORDS + (at === 0 ? 0 : 10),
      ])
    )
    const kept = longSections(many)

    expect(kept).toHaveLength(SECTIONS_MOST)
    expect(kept[0].title).toBe('Day 2')
    expect(kept.map(section => section.offset)).toEqual(
      [...kept.map(section => section.offset)].sort((a, b) => a - b)
    )
  })

  it('asks for them in the request that reads the document', () => {
    const atlas = book('Atlas', [
      ['Coasts', SECTION_WORDS],
      ['Tides', SECTION_WORDS],
    ])
    const planned = planExplore(atlas, MOST_BUDGET)
    const work = planned.plan.work[planned.steps[0].id]

    expect(work.sections).toEqual({ Atlas: ['coasts', 'tides'] })
    const read = { node: id => (id === 'Atlas' ? atlas : null), output: () => '' }
    const [, user] = exploreMessages(work, read) || []
    expect(user.content).toContain('## Atlas\n## Atlas § Coasts\n## Atlas § Tides')
    expect(user.content).toContain('Those with § are sections of a document: give each one line')
  })

  it('asks each part of a long document for the sections whose headings it reads', () => {
    const atlas = book('Atlas', [
      ['Coasts', SECTION_WORDS + 200],
      ['Tides', SECTION_WORDS + 200],
      ['Winds', SECTION_WORDS + 200],
    ])
    const planned = planExplore(atlas, 9000)
    const parts = planned.steps.filter(step => planned.plan.work[step.id].kind === 'part')
    const gatherStep = planned.steps.at(-1)

    const asked = parts.flatMap(step => planned.plan.work[step.id].sections?.Atlas || [])
    expect(asked).toEqual(['coasts', 'tides', 'winds'])
    expect(planned.plan.work[gatherStep?.id || ''].sectionsFrom).toEqual(
      parts.filter(step => planned.plan.work[step.id].sections).map(step => step.id)
    )
  })

  it('does not ask a section whose heading has gone since', () => {
    const atlas = book('Atlas', [['Coasts', 20]])
    const read = { node: () => atlas, output: () => '' }

    expect(sectionsAskedFor({ Atlas: ['coasts', 'gone'] }, read)).toEqual([
      { id: 'Atlas#coasts', path: 'Atlas § Coasts', of: 'Atlas', link: 'coasts' },
    ])
  })

  it('reads a section’s line by its heading, or by its title alone', () => {
    const asked = [
      { id: 'atlas', path: 'Books/Atlas' },
      { id: 'atlas#coasts', path: 'Books/Atlas § Coasts' },
      { id: 'atlas#tides', path: 'Books/Atlas § Tides' },
    ]
    const answer = [
      '## Books/Atlas',
      'An atlas of the north coast.',
      '',
      'Its coasts and its tides.',
      '',
      '## Books/Atlas § Coasts',
      'Every harbour from Varrow north.',
      '',
      '## Tides',
      'Tide tables by month.',
    ].join('\n')

    const found = parseDigests(answer, asked)

    expect(found.get('atlas')).toEqual({
      line: 'An atlas of the north coast.',
      text: 'Its coasts and its tides.',
    })
    expect(found.get('atlas#coasts')?.line).toBe('Every harbour from Varrow north.')
    expect(found.get('atlas#tides')?.line).toBe('Tide tables by month.')
  })

  it('takes nothing for a section a part did not head', () => {
    const asked = [{ id: 'atlas#coasts', path: 'Atlas § Coasts' }]
    const part = 'The first part: coasts, harbours and a map.'

    expect(parseDigests(part, asked, { alone: false }).size).toBe(0)
    expect(parseDigests(part, asked).size).toBe(1)
  })
})

describe('planExplore over a document that holds others', () => {
  /** A card's picture, with no text, holding its fields. */
  const portrait = () =>
    doc('Cards/Wren', '', {
      type: 'file',
      children: [
        doc('Cards/Wren/Description', prose(120, 'quiet')),
        doc('Cards/Wren/Scenario', prose(90, 'market')),
      ],
    })

  it('describes one with no text of its own from what it holds, as a folder', () => {
    const wren = portrait()
    const planned = planExplore(folder('Cards', [wren]), DEFAULT_BUDGET)

    expect(kinds(planned)).toEqual(['read'])
    const work = planned.plan.work[planned.steps[0].id]
    expect(work.reads).toEqual(['Cards/Wren/Description', 'Cards/Wren/Scenario'])
    expect(Object.keys(work.answers)).toEqual([
      'Cards/Wren/Description',
      'Cards/Wren/Scenario',
      'Cards/Wren',
      'Cards',
    ])
    // What it is made from changes with what it holds.
    const before = folderBasis(wren)
    wren.children[0].text = prose(130, 'loud')
    expect(folderBasis(wren)).not.toBe(before)
  })

  it('reads one with text of its own as a document, and what it holds beside it', () => {
    const budget = 20000
    const chapter = doc('Book/Chapter 1', prose(1500, 'gate'), {
      children: [
        doc('Book/Chapter 1/Arrival', prose(1500, 'river')),
        doc('Book/Chapter 1/Leaving', prose(1500, 'road')),
      ],
    })
    const planned = planExplore(folder('Book', [chapter]), budget)

    const reads = planned.steps
      .map(step => planned.plan.work[step.id])
      .filter(work => work.kind === 'read')
      .flatMap(work => work.reads)
    expect(reads).toEqual(['Book/Chapter 1', 'Book/Chapter 1/Arrival', 'Book/Chapter 1/Leaving'])
    const gather = planned.plan.work[planned.steps.at(-1).id]
    expect(gather.pieces).toEqual([
      { digest: 'Book/Chapter 1' },
      { digest: 'Book/Chapter 1/Arrival' },
      { digest: 'Book/Chapter 1/Leaving' },
    ])
  })

  it('asked for alone, describes it and each thing it holds', () => {
    const chapter = doc('Chapter 1', prose(200, 'gate'), {
      children: [doc('Chapter 1/Arrival', prose(30, 'river'))],
    })
    const planned = planExplore(chapter, DEFAULT_BUDGET)

    expect(planned.steps.flatMap(step => Object.keys(planned.plan.work[step.id].answers))).toEqual([
      'Chapter 1',
      'Chapter 1/Arrival',
    ])
  })

  it('sends one with no text as what it holds, and asks it last', () => {
    const wren = portrait()
    const nodes = new Map()
    const index = node => {
      nodes.set(node.id, node)
      node.children.forEach(index)
    }
    index(wren)
    const planned = planExplore(wren, DEFAULT_BUDGET)
    const messages = exploreMessages(planned.plan.work[planned.steps[0].id], {
      node: id => nodes.get(id) ?? null,
      output: () => '',
    })

    expect(messages?.[1].content).toContain(
      'These are the documents in Cards/Wren, all of them. Describe the ones listed below, and Cards/Wren as a whole.'
    )
  })
})
