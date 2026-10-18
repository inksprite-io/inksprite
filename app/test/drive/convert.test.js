import { describe, it, expect } from 'vitest'
import { readDoc, tabsOf } from '@/drive/convert.js'
import { parseMarkdown, serializeMarkdown } from '@/editor/markdown.js'
import {
  bulleted,
  docOf,
  indicesOf,
  inline,
  item,
  numbered,
  para,
  run,
  styled,
  table,
} from './docsHelpers.js'

const MONO = { weightedFontFamily: { fontFamily: 'Courier New', weight: 400 } }
const QUOTE = {
  indentStart: { magnitude: 30, unit: 'PT' },
  indentFirstLine: { magnitude: 30, unit: 'PT' },
}

/**
 * Check a read Doc's spans: every index of the Doc is in one and only one of
 * them, a table's own excepted, and text is the same at both ends of each.
 *
 * @param {import('@/drive/convert.js').ReadDoc} read
 * @param {import('@/drive/docsTypes.js').Document} document
 */
function checkSpans(read, document) {
  const { doc, spans } = read
  expect(spans).not.toBeNull()
  const indices = indicesOf(document)
  /** @type {Map<string, Set<number>>} */
  const seen = new Map()
  let pos = 0
  for (const span of spans ?? []) {
    expect(span.pos).toBeGreaterThanOrEqual(pos)
    pos = span.pos
    const segment = span.segment ?? ''
    const at = /** @type {Map<number, string>} */ (indices.get(segment))
    const covered = seen.get(segment) ?? new Set()
    seen.set(segment, covered)
    for (let i = span.index; i < span.index + span.size; i++) {
      expect(covered.has(i), `index ${i} of ${segment || 'the body'} twice`).toBe(false)
      expect(at.has(i), `index ${i} of ${segment || 'the body'} is in the Doc`).toBe(true)
      covered.add(i)
    }
    if (span.kind === 'text') {
      expect(span.length).toBe(span.size)
      for (let k = 0; k < span.length; k++) {
        const here = doc.textBetween(span.pos + k, span.pos + k + 1, '\n', '\v')
        const there = at.get(span.index + k)
        // A newline or a line break may be a space, a newline in code, or a
        // hard break here; anything else is itself.
        if (there === '\n' || there === '\v') expect(here).toMatch(/^[ \n\v]$/)
        else expect(here).toBe(there)
      }
    }
    if (span.kind === 'end') expect(at.get(span.index)).toBe('\n')
    if (span.kind === 'chip') expect(at.get(span.index)).toBe('inline')
    if (span.kind === 'picture') {
      expect(at.get(span.index)).toBe('inline')
      expect(doc.nodeAt(span.pos)?.type.name).toBe('image')
    }
  }
  for (const [segment, at] of indices) {
    for (const [i, what] of at) {
      if (what === 'structure') continue
      expect(
        seen.get(segment)?.has(i),
        `index ${i} (${JSON.stringify(what)}) of ${segment || 'the body'} is in a span`
      ).toBe(true)
    }
  }
}

/**
 * Read a Doc, checking its spans, and say what the document's markdown is.
 *
 * @param {import('@/drive/docsTypes.js').Document} document
 */
function read(document) {
  const result = readDoc(document)
  checkSpans(result, document)
  // What the import writes is the editor's own form already.
  expect(serializeMarkdown(parseMarkdown(result.markdown))).toBe(result.markdown)
  return result
}

/** The spans held, by what they hold. */
const heldIn = (/** @type {import('@/drive/convert.js').ReadDoc} */ result) =>
  (result.spans ?? []).filter(span => span.kind === 'held').map(span => span.held)

describe('readDoc', () => {
  it('reads a Title, a Subtitle and headings, and words bold, italic, struck, linked and monospaced', () => {
    const result = read(
      docOf([
        styled('TITLE', 'The Crossing'),
        styled('SUBTITLE', 'A story in three tides'),
        styled('HEADING_1', 'One'),
        para([
          run('The ferry left at '),
          run('six', { bold: true }),
          run(', '),
          run('late', { italic: true }),
          run(', '),
          run('again', { strikethrough: true }),
          run(', past '),
          run('the pier', { link: { url: 'https://example.com/pier' }, underline: true }),
          run(' and '),
          run('berth 4', MONO),
          run('.'),
        ]),
        styled('HEADING_3', [run('Two '), run('halves')]),
      ])
    )

    expect(result.markdown).toBe(
      [
        '# The Crossing',
        '## A story in three tides',
        '# One',
        'The ferry left at **six**, *late*, ~~again~~, past [the pier](https://example.com/pier) and `berth 4`.',
        '### Two halves',
      ].join('\n\n')
    )
    expect(result).toMatchObject({ revisionId: 'rev-1', tabId: 't.0', images: 0, suggestions: 0 })
  })

  it('leaves unmarked what a named style makes bold already', () => {
    const result = read(
      docOf(
        [styled('HEADING_1', [run('One', { bold: true })]), para([run('Two', { bold: true })])],
        {
          namedStyles: [
            { namedStyleType: 'NORMAL_TEXT', textStyle: {} },
            { namedStyleType: 'HEADING_1', textStyle: { bold: true } },
          ],
        }
      )
    )
    expect(result.markdown).toBe('# One\n\n**Two**')
  })

  it('parts a paragraph at a page break with words on both sides, holding the break', () => {
    const result = read(
      docOf([
        para([run('The end of one.'), inline('pageBreak'), run('The start of two.')]),
        para([run('A last page.'), inline('pageBreak')]),
        styled('HEADING_1', 'After it'),
      ])
    )

    expect(result.markdown).toBe(
      'The end of one.\n\nThe start of two.\n\nA last page.\n\n# After it'
    )
    expect(heldIn(result).filter(held => held === 'pageBreak')).toHaveLength(2)
  })

  it('reads a line break as a hard break, and as a space in a heading', () => {
    const result = read(
      docOf([styled('HEADING_1', 'Chapter One\vThe Tide'), para('One line\vand the next')])
    )
    expect(result.markdown).toBe('# Chapter One The Tide\n\nOne line\nand the next')
  })

  it('holds empty paragraphs, and the whitespace and breaks markdown would drop', () => {
    const result = read(
      docOf([
        para('\tIndented with a tab.'),
        para(''),
        para('    Four spaces in.'),
        para('   '),
        para('Spaces after.   '),
        para('\vA break first, '),
        para('around \v a break\v'),
      ])
    )

    expect(result.markdown).toBe(
      [
        'Indented with a tab.',
        'Four spaces in.',
        'Spaces after.',
        'A break first,',
        'around\na break',
      ].join('\n\n')
    )
    expect(heldIn(result)).toEqual(
      expect.arrayContaining(['space', 'paragraph', 'break', 'sectionBreak'])
    )
  })

  it('reads a horizontal line, and a paragraph of * * *, as a rule', () => {
    const result = read(
      docOf([para('Before.'), para([inline('horizontalRule')]), para('* * *'), para('After.')])
    )
    expect(result.markdown).toBe('Before.\n\n---\n\n---\n\nAfter.')
    expect(result.spans?.filter(span => span.kind === 'rule')).toHaveLength(2)
  })

  it('reads a paragraph indented at its start and first line alike as a quote', () => {
    const result = read(
      docOf([
        para('Said at the dock:'),
        para('Mind the gap.', { style: QUOTE }),
        para(''),
        para('And the rope.', { style: QUOTE }),
        para('Indented on its first line only.', {
          style: { indentFirstLine: { magnitude: 36, unit: 'PT' } },
        }),
        para('Narrowed at its end only.', { style: { indentEnd: { magnitude: 30, unit: 'PT' } } }),
      ])
    )
    expect(result.markdown).toBe(
      [
        'Said at the dock:',
        '> Mind the gap.\n>\n> And the rope.',
        'Indented on its first line only.',
        'Narrowed at its end only.',
      ].join('\n\n')
    )
  })

  it('reads lists nested, and numbered on from where Docs numbers them', () => {
    const result = read(
      docOf(
        [
          item('Rope', 'kit'),
          item('Knots', 'kit', 1),
          item('Oars', 'kit'),
          para(''),
          item('Bailer', 'kit'),
          para('Then:'),
          item('Cast off', 'steps'),
          item('Row', 'steps'),
          item('Steadily', 'steps', 1),
          para('Later:'),
          item('Land', 'steps'),
        ],
        { lists: { kit: bulleted(), steps: numbered(3) } }
      )
    )

    expect(result.markdown).toBe(
      [
        '- Rope\n  - Knots\n- Oars\n- Bailer',
        'Then:',
        '3. Cast off\n4. Row\n   1. Steadily',
        'Later:',
        '5. Land',
      ].join('\n\n')
    )
  })

  it('reads a table, a cell’s paragraphs one line, its short rows filled out', () => {
    const result = read(
      docOf([
        table([
          ['Day', 'Miles'],
          [[para('Monday'), para(''), para('and Tuesday ')], '12'],
          ['Wednesday'],
        ]),
        table([
          ['', ''],
          ['', ''],
        ]),
      ])
    )
    expect(result.markdown).toBe(
      [
        '| Day | Miles |\n| --- | --- |\n| Monday and Tuesday | 12 |\n| Wednesday |  |',
        '|  |  |\n| --- | --- |\n|  |  |',
      ].join('\n\n')
    )
  })

  it('reads a run of monospaced paragraphs as a code block, blank lines and all', () => {
    const result = read(
      docOf([
        para('Set the tide:'),
        para([run('let tide = 4', MONO)]),
        para([run('', MONO)]),
        para([run('  tide += 1', MONO)]),
        para(''),
        para('Then wait.'),
      ])
    )
    expect(result.markdown).toBe(
      'Set the tide:\n\n```\nlet tide = 4\n\n  tide += 1\n```\n\nThen wait.'
    )
  })

  it('reads nothing as code in a Doc written in a monospaced font throughout', () => {
    const courier = [
      {
        namedStyleType: 'NORMAL_TEXT',
        textStyle: { weightedFontFamily: { fontFamily: 'Courier Prime' } },
      },
    ]
    expect(
      read(docOf([para('FADE IN:'), para('A DOCK. NIGHT.')], { namedStyles: courier })).markdown
    ).toBe('FADE IN:\n\nA DOCK. NIGHT.')
    // Or in Courier set on every word, over a style that is not.
    expect(
      read(docOf([para([run('FADE IN:', MONO)]), para([run('A DOCK. ', MONO), run('NIGHT.')])]))
        .markdown
    ).toBe('FADE IN:\n\nA DOCK. NIGHT.')
  })

  it('keeps the spaces at a monospaced run’s ends out of its code', () => {
    const result = read(docOf([para([run('Type'), run(' tide ', MONO), run('to see it.')])]))
    expect(result.markdown).toBe('Type `tide` to see it.')
  })

  it('reads a smart chip as its words, a person’s and a link’s linked', () => {
    const result = read(
      docOf([
        para([
          run('Ask '),
          inline('person', { personProperties: { name: 'Ada Byrne', email: 'ada@example.com' } }),
          run(' by '),
          inline('dateElement', { dateElementProperties: { displayText: 'Oct 16, 2026' } }),
          run(' or '),
          inline('person', { personProperties: { email: 'tom@example.com' } }),
          run(' about '),
          inline('richLink', {
            richLinkProperties: { title: 'the timetable', uri: 'https://example.com/t' },
          }),
          run('.'),
        ]),
      ])
    )
    expect(result.markdown).toBe(
      'Ask [Ada Byrne](mailto:ada@example.com) by Oct 16, 2026' +
        ' or [tom@example.com](mailto:tom@example.com) about [the timetable](https://example.com/t).'
    )
    expect(result.spans?.filter(span => span.kind === 'chip').map(span => span.size)).toEqual([
      1, 1, 1, 1,
    ])
  })

  it('writes a footnote as markdown does, its note at the end, in the footnote’s own indices', () => {
    const result = read(
      docOf(
        [
          para([
            run('The ferry'),
            inline('footnoteReference', { footnoteId: 'kix.f1', footnoteNumber: '1' }),
            run(' was late.'),
          ]),
          para('It always was.'),
        ],
        { footnotes: { 'kix.f1': [para(' Twice that week.'), para('Once on a Sunday.')] } }
      )
    )

    expect(result.markdown).toBe(
      'The ferry\\[^1\\] was late.\n\nIt always was.\n\n\\[^1\\]: Twice that week. Once on a Sunday.'
    )
    const note = result.spans?.filter(span => span.segment === 'kix.f1') ?? []
    expect(note.find(span => span.kind === 'text')?.index).toBe(1)
  })

  it('comes in as it was before a suggested edit, and counts it', () => {
    const result = read(
      docOf([
        para([
          run('The ferry left at '),
          run('seven', {}, { suggestedInsertionIds: ['suggest.a'] }),
          run('six', {}, { suggestedDeletionIds: ['suggest.a'] }),
          run('.'),
        ]),
        // A newline suggested: the two paragraphs are one until it is taken.
        para([run('One half'), run('', {}, { suggestedInsertionIds: ['suggest.b'] })]),
        para(' and the other.'),
      ])
    )
    expect(result.markdown).toBe('The ferry left at six.\n\nOne half and the other.')
    expect(result.suggestions).toBe(2)
    expect(heldIn(result).filter(held => held === 'suggestion')).toHaveLength(2)
  })

  it('holds pictures and counts them, in the text and beside it', () => {
    const result = read(
      docOf([
        para([run('The harbour: '), inline('inlineObjectElement', { inlineObjectId: 'kix.i1' })]),
        para([inline('inlineObjectElement', { inlineObjectId: 'kix.i2' })]),
        para('Beside a picture.', { positionedObjectIds: ['kix.p1'] }),
      ])
    )
    expect(result.markdown).toBe('The harbour:\n\nBeside a picture.')
    expect(result.images).toBe(3)
  })

  it('keeps bold italic whose space Docs bolded with it', () => {
    // As double-clicking a word and pressing bold leaves it.
    const result = read(
      docOf([
        para([
          run('Then '),
          run('bold italic.', { bold: true, italic: true }),
          run(' ', { bold: true }),
          run('Plain.'),
        ]),
      ])
    )
    expect(result.markdown).toBe('Then ***bold italic.*** Plain.')
  })

  it('brings a picture in as one, a marker for its source, its alt text with it', () => {
    const result = read(
      docOf(
        [
          para([
            run('The harbour: '),
            inline('inlineObjectElement', { inlineObjectId: 'kix.pier' }),
            run(' at dawn.'),
          ]),
          para([inline('inlineObjectElement', { inlineObjectId: 'kix.gull' })]),
        ],
        {
          pictures: {
            'kix.pier': { uri: 'https://pictures.example.com/pier', alt: 'The north pier' },
            'kix.gull': { uri: 'https://pictures.example.com/gull' },
          },
        }
      )
    )

    expect(result.markdown).toBe(
      'The harbour: ![The north pier](inksprite-picture-1) at dawn.\n\n![](inksprite-picture-2)'
    )
    expect(result.pictures).toEqual([
      {
        object: 'kix.pier',
        marker: 'inksprite-picture-1',
        uri: 'https://pictures.example.com/pier',
        alt: 'The north pier',
      },
      {
        object: 'kix.gull',
        marker: 'inksprite-picture-2',
        uri: 'https://pictures.example.com/gull',
        alt: '',
      },
    ])
    expect(result.images).toBe(0)
  })

  it('holds and counts a drawing, a picture in a cell or placed beside a paragraph, and one left out', () => {
    const document = docOf(
      [
        para([run('A sketch: '), inline('inlineObjectElement', { inlineObjectId: 'kix.sketch' })]),
        table([
          [[para([run('Map '), inline('inlineObjectElement', { inlineObjectId: 'kix.map' })])]],
        ]),
        para('Beside a picture.', { positionedObjectIds: ['kix.float'] }),
        para([run('Kept '), inline('inlineObjectElement', { inlineObjectId: 'kix.kept' })]),
        para([run('Lost '), inline('inlineObjectElement', { inlineObjectId: 'kix.lost' })]),
      ],
      {
        pictures: {
          'kix.sketch': {},
          'kix.map': { uri: 'https://pictures.example.com/map' },
          'kix.kept': { uri: 'https://pictures.example.com/kept' },
          'kix.lost': { uri: 'https://pictures.example.com/lost' },
        },
      }
    )

    const all = read(document)
    expect(all.pictures.map(picture => picture.object)).toEqual(['kix.kept', 'kix.lost'])
    expect(all.images).toBe(3)

    const fewer = readDoc(document, { leaveOut: new Set(['kix.kept']) })
    checkSpans(fewer, document)
    expect(fewer.markdown).toContain('Kept\n\nLost ![](inksprite-picture-1)')
    expect(fewer.pictures.map(picture => picture.object)).toEqual(['kix.lost'])
    expect(fewer.images).toBe(4)
  })

  it('gives up marks markdown cannot write, keeping the words', () => {
    const result = read(
      docOf([
        para([
          run('Bold', { bold: true }),
          run('both', { bold: true, italic: true }),
          run('italic', { italic: true }),
          run(' and fine, '),
          run('this', { italic: true }),
          run(' too.'),
        ]),
      ])
    )
    expect(result.doc.textContent).toBe('Boldbothitalic and fine, this too.')
    expect(result.markdown).not.toMatch(/\\\*/)
  })

  it('escapes what would read as markdown, and keeps an emoji’s two indices', () => {
    const result = read(
      docOf([
        para('1) First, the rope.'),
        para('# Not a heading'),
        para('Fish &amp; chips 🐟 here'),
      ])
    )
    expect(result.markdown).toBe(
      '1\\) First, the rope.\n\n\\# Not a heading\n\nFish \\&amp; chips 🐟 here'
    )
  })

  it('reads an empty Doc as an empty document', () => {
    const result = read(docOf([para('')]))
    expect(result.markdown).toBe('')
    expect(result.doc.childCount).toBe(1)
  })

  it('reads the tab asked for, or the first', () => {
    const document = docOf([para('First tab.')])
    const second = docOf([para('Second tab.')]).tabs?.[0]
    document.tabs = [
      { ...document.tabs?.[0], childTabs: [{ ...second, tabProperties: { tabId: 't.1' } }] },
    ]

    expect(tabsOf(document).map(tab => tab.tabProperties?.tabId)).toEqual(['t.0', 't.1'])
    expect(readDoc(document).markdown).toBe('First tab.')
    expect(readDoc(document, { tabId: 't.1' })).toMatchObject({
      markdown: 'Second tab.',
      tabId: 't.1',
    })
    expect(() => readDoc(document, { tabId: 't.9' })).toThrow()
  })

  it('reads a Doc read without its tabs', () => {
    const { tabs, ...rest } = docOf([para('No tabs.')])
    const document = { ...rest, ...tabs?.[0].documentTab }
    expect(tabsOf(document)).toHaveLength(1)
    expect(readDoc(document)).toMatchObject({ markdown: 'No tabs.', tabId: '' })
  })

  it('reads a Doc with everything at once, every index in its place', () => {
    const result = read(
      docOf(
        [
          styled('TITLE', 'Harbour Notes'),
          styled('SUBTITLE', 'Kept on the crossing'),
          styled('HEADING_1', 'Monday'),
          para([
            run('Rain from the west, '),
            run('hard', { bold: true }),
            run(', then '),
            run('dry', { italic: true }),
            run('. Log: '),
            run('wind=4', MONO),
            run('.'),
          ]),
          para(''),
          table([
            ['Port', 'Hours'],
            ['North', '3'],
          ]),
          para(''),
          para([inline('horizontalRule')]),
          para([run('Ended here.'), inline('pageBreak'), run('“Began again,” she wrote.')]),
          para([
            run('A note'),
            inline('footnoteReference', { footnoteId: 'kix.n', footnoteNumber: '1' }),
            run(' and a chip: '),
            inline('person', { personProperties: { name: 'Ada' } }),
            run('.'),
          ]),
          para([inline('inlineObjectElement', { inlineObjectId: 'kix.pic' })]),
          item('Ropes', 'l'),
          item('Spare', 'l', 1),
          para('Then.', { style: QUOTE }),
          para([
            run('Kept '),
            run('new ', {}, { suggestedInsertionIds: ['s.1'] }),
            run('old ', {}, { suggestedDeletionIds: ['s.1'] }),
            run('words.'),
          ]),
          { tableOfContents: {}, size: 3 },
          para('The end.'),
        ],
        { footnotes: { 'kix.n': [para(' A footnote.')] }, lists: { l: bulleted() } }
      )
    )

    expect(result.markdown).toBe(
      [
        '# Harbour Notes',
        '## Kept on the crossing',
        '# Monday',
        'Rain from the west, **hard**, then *dry*. Log: `wind=4`.',
        '| Port | Hours |\n| --- | --- |\n| North | 3 |',
        '---',
        'Ended here.',
        '“Began again,” she wrote.',
        'A note\\[^1\\] and a chip: Ada.',
        '- Ropes\n  - Spare',
        '> Then.',
        'Kept old words.',
        'The end.',
        '\\[^1\\]: A footnote.',
      ].join('\n\n')
    )
    expect(result).toMatchObject({ images: 1, suggestions: 1 })
  })
})
