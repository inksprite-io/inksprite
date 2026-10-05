import { describe, it, expect } from 'vitest'
import { pageLines } from '@/files/pdf.js'
import {
  ancestorsOf,
  bodySize,
  givenHeadings,
  linesOfLayout,
  linesOfText,
  parseStructure,
  placeBookmarks,
  planRequests,
  requestLabel,
  requestText,
  runningLines,
  structureMessages,
  structureOfLayout,
  styleHeadings,
  titleMatch,
  unitsOf,
  wordsOfTitle,
} from '@/jobs/sections.js'

/** A line on a page: the body at size 8, a heading larger. */
const line = (text, page, y, size = 8) => ({ text, page, size, y })

/** Two pages of a rulebook: headings set large, a table's worth of words. */
const LINES = [
  line('Chapter 1', 1, 800, 28),
  line('Character Creation', 1, 780, 28),
  line('Everyone makes a character.', 1, 760),
  line('', 1, 750, 0),
  line('Core Lineage: Dwarf', 1, 700, 12),
  line('Dwarves dig.', 1, 690),
  line('Might (MT):', 1, 600, 9),
  line('How strong you are.', 1, 590),
  line('Traits of the Deep', 2, 800, 12),
  line('Folk', 2, 790, 12),
  line('Dwarves see in the dark.', 2, 780),
  line('9', 2, 20),
]

describe('the source as lines', () => {
  it('marks a line set in a bold face throughout', () => {
    const items = [
      {
        str: 'Heading',
        height: 10,
        transform: [10, 0, 0, 10, 0, 700],
        fontName: 'b',
        hasEOL: true,
      },
      { str: 'Lead. ', height: 10, transform: [10, 0, 0, 10, 0, 690], fontName: 'b' },
      {
        str: 'then regular',
        height: 10,
        transform: [10, 0, 0, 10, 30, 690],
        fontName: 'r',
        hasEOL: true,
      },
    ]
    const [heading, mixed] = pageLines(items, new Set(['b']))
    expect(heading.bold).toBe(true)
    expect(mixed).not.toHaveProperty('bold')
  })

  it('reads a page into lines with their size and height, blank lines as breaks', () => {
    const items = [
      { str: 'Big', height: 12, transform: [12, 0, 0, 12, 50, 700], hasEOL: true },
      { str: '', hasEOL: true },
      { str: '', hasEOL: true },
      { str: 'small ', height: 8, transform: [8, 0, 0, 8, 50, 680] },
      { str: 'words here', height: 8, transform: [8, 0, 0, 8, 80, 680], hasEOL: true },
      { str: '', hasEOL: true },
    ]
    expect(pageLines(items)).toEqual([
      { text: 'Big', size: 12, y: 700 },
      { text: '', size: 0, y: 0 },
      { text: 'small words here', size: 8, y: 680 },
    ])
  })

  it('flattens a layout into lines that carry their page', () => {
    const lines = linesOfLayout({
      pages: [
        { number: 1, lines: [{ text: 'A', size: 8, y: 1 }] },
        { number: 2, lines: [{ text: 'B', size: 9, y: 2 }] },
      ],
      outline: [],
    })
    expect(lines).toEqual([
      { text: 'A', page: 1, size: 8, y: 1 },
      { text: 'B', page: 2, size: 9, y: 2 },
    ])
  })

  it('reads a stored text, turning its page markers into pages', () => {
    const lines = linesOfText('[p.1]\nOne\n\n\n  two  \n[p.2]\nThree\n\n')
    expect(lines).toEqual([
      { text: 'One', page: 1, size: 0 },
      { text: '', page: 1, size: 0 },
      { text: 'two', page: 1, size: 0 },
      { text: 'Three', page: 2, size: 0 },
    ])
    expect(linesOfText('Plain\ntext')[0].page).toBeNull()
  })

  it('takes the body size from where most characters are', () => {
    expect(bodySize(LINES)).toBe(8)
    expect(bodySize(linesOfText('no sizes'))).toBe(0)
  })
})

describe('matching a heading to a printed line', () => {
  const words = wordsOfTitle
  it('takes a label before the title, or a page number after it', () => {
    expect(titleMatch(words('Core Lineage: Dwarf'), words('Dwarf'))).toBe('whole')
    expect(titleMatch(words('3.2 A Definition'), words('A Definition'))).toBe('whole')
    expect(titleMatch(words('Introduction 12'), words('Introduction'))).toBe('whole')
    expect(titleMatch(words('Jötunn'), words('JOTUNN'))).toBe('whole')
  })

  it('does not take a longer heading that starts with a short title, or a sentence', () => {
    expect(titleMatch(words('Core Lineage: Dwarf'), words('Core'))).toBeNull()
    expect(titleMatch(words('the dwarf went home to his hall'), words('Dwarf'))).toBeNull()
    expect(titleMatch(words('for himself'), words('elf'))).toBeNull()
  })

  it('takes a short gloss in brackets, and the first line of a heading that wraps', () => {
    const text = 'Might (MT):'
    expect(titleMatch(words(text), words('Might'), text)).toBe('whole')
    expect(titleMatch(words('Traits of the'), words('Traits of the Deep Folk'))).toBe('start')
    expect(titleMatch(words('Traits'), words('Traits of the Deep Folk'))).toBeNull()
  })
})

describe('placing bookmarks', () => {
  const bookmark = (title, level, page, top = null) => ({ title, level, page, top })

  it('finds each printed heading, with the label above and the lines it wraps over', () => {
    const placed = placeBookmarks(LINES, [
      bookmark('Character Creation', 1, 1, 800),
      bookmark('Dwarf', 2, 1, 700),
      bookmark('Might', 3, 1, 600),
      bookmark('Traits of the Deep Folk', 3, 2, 800),
    ])
    expect(placed).toEqual([
      { title: 'Chapter 1: Character Creation', level: 1, line: 0, consumed: 2 },
      { title: 'Dwarf', level: 2, line: 4, consumed: 1 },
      { title: 'Might', level: 3, line: 6, consumed: 1 },
      { title: 'Traits of the Deep Folk', level: 3, line: 8, consumed: 2 },
    ])
  })

  it('puts a bookmark that groups the next before its first child, not where it points', () => {
    const placed = placeBookmarks(LINES, [
      bookmark('Character Creation', 1, 1),
      // Points at the top of page 1, above where the chapter's text starts.
      bookmark('Core', 2, 1, 900),
      bookmark('Dwarf', 3, 1),
    ])
    expect(placed[1]).toEqual({ title: 'Core', level: 2, line: 4, consumed: 0 })
    expect(placed[2].line).toBe(4)
  })

  it('puts an unprinted bookmark at the height it points to, between its neighbours', () => {
    const placed = placeBookmarks(LINES, [
      bookmark('Character Creation', 1, 1),
      bookmark('Strength', 2, 1, 605),
      bookmark('Traits of the Deep Folk', 2, 2),
    ])
    expect(placed[1]).toEqual({ title: 'Strength', level: 2, line: 6, consumed: 0 })
  })

  it('places a bookmark the outline lists late where its page prints it, in text order', () => {
    const placed = placeBookmarks(LINES, [
      bookmark('Dwarf', 2, 1),
      bookmark('Traits of the Deep Folk', 2, 2),
      bookmark('Character Creation', 1, 1),
    ])
    expect(placed.map(heading => [heading.title, heading.line, heading.consumed])).toEqual([
      ['Chapter 1: Character Creation', 0, 2],
      ['Dwarf', 4, 1],
      ['Traits of the Deep Folk', 8, 2],
    ])
  })

  it('takes only the title itself from earlier on the page, not a row that ends with it', () => {
    // The outline lists Character Size after the races, though the page
    // prints it above them; by then the search has passed the table.
    const table = [
      line('Races', 1, 800, 12),
      line('2 Core', 1, 700, 9),
      line('Character Size', 1, 600, 12),
      line('All races are medium.', 1, 590),
      line('Sub-races', 1, 500, 12),
      line('Some differ.', 1, 490),
      line('Core Lineage: Dwarf', 2, 800, 12),
      line('Dwarves dig.', 2, 790),
    ]
    const placed = placeBookmarks(table, [
      bookmark('Races', 1, 1),
      bookmark('Sub-races', 2, 1, 500),
      bookmark('Core', 2, 1, 700),
      bookmark('Dwarf', 3, 2),
      bookmark('Character Size', 2, 1, 600),
    ])
    expect(placed.map(heading => [heading.title, heading.line, heading.consumed])).toEqual([
      ['Races', 0, 1],
      ['Character Size', 2, 1],
      ['Sub-races', 4, 1],
      ['Core', 6, 0],
      ['Dwarf', 6, 1],
    ])
  })
})

describe('headings from a model', () => {
  it('asks with every line numbered, and the large ones sized', () => {
    const [system, user] = structureMessages({ title: 'Rules', lines: LINES })
    expect(system.content).toMatch(/<line number> <level> <title>/)
    expect(user.content).toContain('The body is set at size 8')
    expect(user.content).toContain('0 [28] Chapter 1')
    expect(user.content).toContain('2 Everyone makes a character.')
    expect(user.content).not.toContain('\n3 ')
  })

  it('reads the headings named, on real lines, in order, with the lines they wrap over', () => {
    const answer = [
      'Here you go:',
      '1 1 Character Creation',
      '4 2 Dwarf',
      '4 2 Dwarf again',
      '99 2 Past the end',
      '8 2 Traits of the Deep Folk',
    ].join('\n')
    expect(parseStructure(answer, LINES)).toEqual([
      { title: 'Character Creation', level: 1, line: 1, consumed: 1 },
      { title: 'Dwarf', level: 2, line: 4, consumed: 1 },
      { title: 'Traits of the Deep Folk', level: 2, line: 8, consumed: 2 },
    ])
    expect(() => parseStructure('nothing useful', LINES)).toThrow(/no headings/)
  })
})

describe('cutting the source into requests', () => {
  const headings = [
    { title: 'Character Creation', level: 1, line: 0, consumed: 2 },
    { title: 'Dwarf', level: 2, line: 4, consumed: 1 },
    { title: 'Might', level: 3, line: 6, consumed: 1 },
    { title: 'Traits of the Deep Folk', level: 2, line: 8, consumed: 2 },
  ]

  it('makes a unit of each heading, and of what comes before the first', () => {
    const units = unitsOf(LINES, headings.slice(1))
    expect(units[0]).toEqual({ heading: null, from: 0, to: 4, part: 0 })
    expect(units[1]).toEqual({ heading: 0, from: 5, to: 6, part: 0 })
    expect(unitsOf(LINES, headings)[0]).toEqual({ heading: 0, from: 2, to: 4, part: 0 })
  })

  it('groups units up to the budget, and splits one too long at a paragraph', () => {
    const units = unitsOf(LINES, headings)
    const one = planRequests(LINES, units, 10000)
    expect(one).toHaveLength(1)
    expect(one[0].units).toHaveLength(4)

    const each = planRequests(LINES, units, 120)
    expect(each.length).toBeGreaterThan(1)
    expect(each.flatMap(request => request.units).map(unit => unit.heading)).toEqual([0, 1, 2, 3])

    // A long section alone, cut into parts at its paragraph break.
    const long = [
      ...Array.from({ length: 30 }, (_, at) => line(`Sentence number ${at} of the first.`, 1, 700)),
      line('', 1, 0, 0),
      ...Array.from({ length: 30 }, (_, at) =>
        line(`Sentence number ${at} of the second.`, 2, 700)
      ),
    ]
    const parts = planRequests(long, [{ heading: 0, from: 0, to: long.length, part: 0 }], 1200)
    expect(parts.map(request => request.units[0].part)).toEqual([0, 1])
    expect(parts[1].units[0].from).toBe(31)
  })

  it('writes the headings in as Markdown and the body as it is, no page markers', () => {
    const [request] = planRequests(LINES, unitsOf(LINES, headings), 10000)
    const text = requestText(LINES, request, headings)
    expect(text.startsWith('# Character Creation\n\nEveryone makes a character.')).toBe(true)
    expect(text).toContain('## Dwarf\n\nDwarves dig.')
    expect(text).toContain('### Might\n\nHow strong you are.')
    expect(text).toContain('## Traits of the Deep Folk\n\nDwarves see in the dark.\n9')
    expect(text).not.toContain('Chapter 1')
    expect(givenHeadings(request, headings).map(heading => heading.title)).toEqual([
      'Character Creation',
      'Dwarf',
      'Might',
      'Traits of the Deep Folk',
    ])
  })

  it('says where a request sits, and labels it with its first heading and pages', () => {
    const units = unitsOf(LINES, headings)
    const might = { id: 'r', units: [units[2]] }
    expect(ancestorsOf(might, headings).map(heading => heading.title)).toEqual([
      'Character Creation',
      'Dwarf',
    ])
    const continued = { id: 'r', units: [{ ...units[1], part: 1 }] }
    expect(ancestorsOf(continued, headings).map(heading => heading.title)).toEqual([
      'Character Creation',
      'Dwarf',
    ])
    expect(requestLabel(LINES, { id: 'r', units: units.slice(1) }, headings)).toBe(
      'Dwarf +2 · pp. 1–2'
    )
    expect(requestLabel(LINES, continued, headings)).toBe('Dwarf (continued) · p. 1')
    expect(
      requestLabel(
        linesOfText('Front'),
        { id: 'r', units: [{ heading: null, from: 0, to: 1, part: 0 }] },
        []
      )
    ).toBe('Front matter')
  })
})

describe('running headers and footers', () => {
  /** Twenty pages, each with a running title, a footer over a page number, and some stat lines. */
  const pages = Array.from({ length: 20 }, (_, at) => at + 1)
  const heights = new Map(pages.map(page => [page, 800]))
  const book = pages.flatMap(page => [
    line('Chapter One', page, 790, 12),
    // A stat block at the top of a column on some pages: the running title above it.
    ...(page % 3 === 0 ? [line('Str 18 +4 +7 Dex 15 +2 +5', page, 770)] : []),
    line(`Body text on page ${page} goes here.`, page, 400),
    // Low on the page, at a height that moves.
    ...(page % 3 === 0 ? [line('Str 18 +4 +7 Dex 15 +2 +5', page, 40 + page)] : []),
    line('Field Guide to the Marsh 2.1', page, 30, 11),
    line(String(page), page, 20),
  ])

  it('takes the same text at the same height at the page edge, on a fifth of the pages', () => {
    const running = runningLines(book, heights)
    const texts = [...running].map(at => book[at].text)
    expect(texts.filter(text => text.startsWith('Field Guide'))).toHaveLength(20)
    expect(texts.filter(text => /^\d+$/.test(text))).toHaveLength(20)
  })

  it('takes a running title, and leaves text below it or moving up and down the page', () => {
    const running = runningLines(book, heights)
    expect([...running].filter(at => book[at].text === 'Chapter One')).toHaveLength(20)
    expect([...running].some(at => book[at].text.startsWith('Str'))).toBe(false)
  })

  it('matches a footer whatever its spacing', () => {
    const spaced = [1, 2, 3, 4, 5].flatMap(page => [
      line('Body.', page, 400),
      line(page % 2 ? 'Field Guide to the Marsh' : 'Field G uide to the M arsh', page, 20),
    ])
    const running = runningLines(spaced, new Map([1, 2, 3, 4, 5].map(page => [page, 800])))
    expect(running.size).toBe(5)
  })

  it('takes a numbered title on three pages running, and not an unnumbered one', () => {
    const short = [4, 5, 6].flatMap(page => [
      line(`${page} Scenes`, page, 790),
      line('Body.', page, 400),
      line('MOD SAVE MOD SAVE', page, 10),
    ])
    const running = runningLines(
      short,
      new Map(Array.from({ length: 30 }, (_, at) => [at + 1, 800]))
    )
    expect([...running].map(at => short[at].text)).toEqual(['4 Scenes', '5 Scenes', '6 Scenes'])
  })
})

describe('headings from how the page sets them', () => {
  /** A chapter of spells under a bookmark, with a stat block set large in the middle. */
  const spells = [
    line('Spell Descriptions', 1, 800, 18),
    line('Spells are listed alphabetically.', 1, 790, 10),
    line('Arc Bolt', 1, 780, 12),
    line('Level 2 Evocation (Wizard)', 1, 770, 10),
    line('A crackling bolt leaps to a target.', 1, 760, 10),
    line('Stir Objects', 1, 750, 12),
    line('Level 5 Transmutation (Wizard)', 1, 740, 10),
    line('Nearby objects stir and obey.', 1, 730, 10),
    line('Stirred Object', 1, 720, 15),
    line('Medium or Small Construct, Unaligned', 1, 710, 10),
    line('Traits', 1, 700, 12),
    line('It does things in stat block type.', 1, 690, 9.5),
    line('Lure/Repel', 2, 800, 12),
    line('Level 8 Enchantment (Bard, Druid)', 2, 790, 10),
    line('Creatures are drawn in or driven off.', 2, 780, 10),
    line('Table 3', 2, 770, 12),
    line('Cost Weight Price', 2, 760, 12),
    line('Item Name Value', 2, 750, 12),
    line('10 lb. 5 gp', 2, 740, 10),
    line('Two-Line Spell', 2, 730, 12),
    line('Name Goes Here', 2, 720, 12),
    line('Level 1 Illusion (Wizard)', 2, 710, 10),
  ]
  const bookmark = { title: 'Spell Descriptions', level: 3, line: 0, consumed: 1 }

  it('finds entries below a bookmark and gives every one of a kind the same level', () => {
    const headings = styleHeadings(spells, [bookmark])
    const byTitle = Object.fromEntries(headings.map(heading => [heading.title, heading.level]))
    expect(byTitle).toEqual({
      'Spell Descriptions': 3,
      'Arc Bolt': 4,
      'Stir Objects': 4,
      'Stirred Object': 4,
      Traits: 5,
      'Lure/Repel': 4,
      'Two-Line Spell Name Goes Here': 4,
    })
    const twoLines = headings.find(heading => heading.title.startsWith('Two-Line'))
    expect(twoLines.consumed).toBe(2)
  })

  it('takes a bold line at the body size over regular text, and not a line of a bold paragraph', () => {
    const bold = (text, y) => ({ ...line(text, 1, y, 10), bold: true })
    const lines = [
      line('Chapter', 1, 800, 18),
      line('Opening words.', 1, 790, 10),
      bold('Action Selection', 780),
      line('Characters pick what to do.', 1, 770, 10),
      bold('A whole paragraph set in bold', 760),
      bold('goes on over two lines', 750),
      line('Then regular text.', 1, 740, 10),
      bold('Causal Bookkeeping', 730),
      line('Each action records its causes.', 1, 720, 10),
    ]
    const headings = styleHeadings(lines, [{ title: 'Chapter', level: 1, line: 0, consumed: 1 }])
    expect(headings.map(heading => [heading.title, heading.level])).toEqual([
      ['Chapter', 1],
      ['Action Selection', 2],
      ['Causal Bookkeeping', 2],
    ])
  })

  it('leaves the title page before the first bookmark, and keeps entries inside its section', () => {
    const lines = [
      line('THE BIG BOOK', 1, 800, 30),
      line('by an author', 1, 780, 10),
      line('Index', 2, 800, 9),
      line('A', 2, 790, 14),
      line('Apples, 12', 2, 780, 9),
    ]
    const headings = styleHeadings(lines, [{ title: 'Index', level: 1, line: 2, consumed: 1 }])
    expect(headings.map(heading => [heading.title, heading.level])).toEqual([
      ['Index', 1],
      ['A', 2],
    ])
  })

  it('reads a layout whole: footers out, bookmarks placed, entries found; no bookmarks, no tree', () => {
    const layout = {
      pages: [1, 2, 3, 4, 5].map(number => ({
        number,
        height: 800,
        lines: [
          {
            text: number === 1 ? 'Spells' : `Spell ${number}`,
            size: number === 1 ? 18 : 12,
            y: 700,
          },
          { text: 'Some body text for the spell.', size: 10, y: 690 },
          { text: 'Footer of the book', size: 8, y: 20 },
        ],
      })),
      outline: [{ title: 'Spells', level: 1, page: 1, top: 700 }],
    }
    const { lines, headings, removed } = structureOfLayout(layout)
    expect(removed).toBe(5)
    expect(lines.some(one => one.text === 'Footer of the book')).toBe(false)
    expect(headings.map(heading => [heading.title, heading.level])).toEqual([
      ['Spells', 1],
      ['Spell 2', 2],
      ['Spell 3', 2],
      ['Spell 4', 2],
      ['Spell 5', 2],
    ])
    expect(structureOfLayout({ ...layout, outline: [] }).headings).toBeNull()
  })
})
