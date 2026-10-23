import { describe, it, expect } from 'vitest'
import { readDoc } from '@/drive/convert.js'
import { withoutIdleStyles, writeDoc } from '@/drive/write.js'
import { parseMarkdown, serializeMarkdown } from '@/editor/markdown.js'
import { applyRequests } from '@/drive/apply.js'
import { bulleted, docOf, inline, item, numbered, para, run, styled, table } from './docsHelpers.js'
import { anyEdit, busy, imported, objects, plain, random } from './randomEdits.js'

const MONO = { weightedFontFamily: { fontFamily: 'Courier New' } }
const QUOTE = {
  indentStart: { magnitude: 30, unit: 'PT' },
  indentFirstLine: { magnitude: 30, unit: 'PT' },
}

/** What a Doc holds that the converter does not show, by kind. */
function heldOf(document) {
  const counts = {}
  const walk = content => {
    for (const element of content ?? []) {
      for (const part of element.paragraph?.elements ?? []) {
        const kind = Object.keys(part).find(key => !key.endsWith('Index'))
        if (kind !== 'textRun') counts[kind] = (counts[kind] ?? 0) + 1
      }
      for (const row of element.table?.tableRows ?? []) {
        for (const cell of row.tableCells) walk(cell.content)
      }
    }
  }
  walk(document.tabs[0].documentTab.body.content)
  return counts
}

/**
 * Edit a Doc's markdown, write the edit, apply it as Docs would, and read
 * the Doc back: it should read as the edit, and hold what it held.
 *
 * @param {object} document
 * @param {(markdown: string) => string} edit
 * @param {{held?: object}} [expected]
 */
function roundTrip(document, edit, { held } = {}) {
  const before = readDoc(document)
  const target = parseMarkdown(edit(before.markdown))
  const written = writeDoc(document, target)
  expect(written.unsent).toEqual([])
  const after = applyRequests(document, written.requests)
  const reread = readDoc(after)
  expect(reread.markdown).toBe(serializeMarkdown(target))
  expect(heldOf(after)).toEqual(held ?? heldOf(document))
  return { written, after, reread }
}

/** What the writer leaves unsent for an edit. */
function unsentFor(document, edit) {
  return writeDoc(document, parseMarkdown(edit(readDoc(document).markdown))).unsent
}

/** A chapter in a Doc, as a writer might keep one. */
const chapter = () =>
  docOf([
    styled('TITLE', 'The Crossing'),
    styled('HEADING_1', 'One'),
    para([run('The ferry left at '), run('six', { bold: true }), run(', late again.')]),
    para('Rain came in from the west.'),
    para(''),
    para('She kept to the rail.'),
    styled('HEADING_2', 'At the dock'),
    para('The rope was wet.'),
  ])

describe('writeDoc', () => {
  it('sends nothing for a document the same as its Doc', () => {
    const document = chapter()
    expect(writeDoc(document, readDoc(document).doc)).toEqual({
      requests: [],
      unsent: [],
      revisionId: 'rev-1',
    })
  })

  it('changes words in place, the rest left as it is', () => {
    const { written } = roundTrip(chapter(), md =>
      md.replace('late again', 'on time for once').replace('the west', 'the sea')
    )
    // A word at a time: "late", "again" and "west" out, their words in.
    const inserted = written.requests.flatMap(request =>
      'insertText' in request ? [request.insertText.text] : []
    )
    expect(inserted).toEqual(['sea', 'time for once', 'on'])
    expect(written.requests.filter(request => 'deleteContentRange' in request)).toHaveLength(3)
  })

  it('restyles words: bold, italic, struck, linked and in code, and back', () => {
    roundTrip(chapter(), md =>
      md
        .replace('**six**', 'six')
        .replace('Rain came', '*Rain* came')
        .replace('the west', '~~the west~~')
        .replace('the rail', '[the rail](https://example.com/rail)')
        .replace('rope was', '`rope` was')
    )
  })

  it('puts in paragraphs at the start, the middle and the end', () => {
    roundTrip(
      chapter(),
      md => `A first line.\n\n${md.replace('She kept', 'Gulls overhead.\n\nShe kept')}\n\nThe end.`
    )
  })

  it('takes paragraphs out, the last one too, and the empty one between stays', () => {
    roundTrip(chapter(), md =>
      md.replace('Rain came in from the west.\n\n', '').replace('\n\nThe rope was wet.', '')
    )
  })

  it('takes out every paragraph but one', () => {
    roundTrip(chapter(), () => 'Only this.')
  })

  it('parts a paragraph in two, and joins two into one', () => {
    roundTrip(chapter(), md =>
      md
        .replace('left at **six**, late', 'left at **six**,\n\nlate')
        .replace('west.\n\nShe', 'west. She')
    )
  })

  it('changes a heading’s level, makes one and unmakes one, and leaves a Title as it is', () => {
    const { after } = roundTrip(chapter(), md =>
      md
        .replace('# One', '## One')
        .replace('Rain came in from the west.', '### Rain came in from the west.')
        .replace('## At the dock', 'At the dock')
    )
    const styles = after.tabs[0].documentTab.body.content
      .filter(element => element.paragraph)
      .map(element => element.paragraph.paragraphStyle.namedStyleType)
    expect(styles[0]).toBe('TITLE')
  })

  it('makes a quote, and unmakes one', () => {
    const document = docOf([
      para('Said at the dock:'),
      para('Mind the gap.', { style: QUOTE }),
      para('Then they went.'),
    ])
    roundTrip(document, md =>
      md.replace('> Mind the gap.', 'Mind the gap.').replace('Then they went.', '> Then they went.')
    )
    roundTrip(document, md => md.replace('> Mind the gap.', '> Mind the gap.\n>\n> And the rope.'))
  })

  it('indents a quote either side, as Docs pastes one, and unindents one either side', () => {
    const pasted = { ...QUOTE, indentEnd: { magnitude: 30, unit: 'PT' } }
    const document = docOf([para('Said at the dock:'), para('Mind the gap.', { style: pasted })])
    const { after } = roundTrip(document, md =>
      md.replace('> Mind the gap.', 'Mind the gap.').replace('Said', '> Said')
    )
    const styles = after.tabs[0].documentTab.body.content
      .filter(element => element.paragraph)
      .map(element => element.paragraph.paragraphStyle)
    const indents = style =>
      Object.fromEntries(Object.entries(style).filter(([key]) => key.startsWith('indent')))
    expect(indents(styles[0])).toEqual(pasted)
    expect(indents(styles[1])).toEqual({})
  })

  it('adds a list item, takes one out, and edits one, numbering kept', () => {
    const document = docOf(
      [
        para('Bring:'),
        item('Rope', 'kit'),
        item('Oars', 'kit'),
        para('Then:'),
        item('Cast off', 'steps'),
        item('Row', 'steps'),
      ],
      { lists: { kit: bulleted(), steps: numbered(1) } }
    )
    const { after } = roundTrip(document, md =>
      md
        .replace('- Oars', '- Oars\n- A bailer')
        // As the editor leaves a list whose first item goes: still from 1.
        .replace('1. Cast off\n2. Row', '1. Row hard')
    )
    // The new item is in the list it was added to.
    const bullets = after.tabs[0].documentTab.body.content
      .map(element => element.paragraph?.bullet?.listId)
      .filter(Boolean)
    expect(bullets).toEqual(['kit', 'kit', 'kit', 'steps'])
  })

  it('makes a paragraph a list item and a list item a paragraph', () => {
    const document = docOf([para('Bring:'), item('Rope', 'kit'), para('Oars')], {
      lists: { kit: bulleted() },
    })
    roundTrip(document, md => md.replace('- Rope', 'Rope').replace('\n\nOars', '\n\n1. Oars'))
  })

  it('leaves a list item’s nesting unsent', () => {
    const document = docOf([item('Rope', 'kit'), item('Oars', 'kit')], {
      lists: { kit: bulleted() },
    })
    expect(unsentFor(document, md => md.replace('- Oars', '  - Oars'))).toEqual(['list'])
  })

  it('sends a rule as a paragraph of * * *, and takes one out', () => {
    const document = docOf([para('Before.'), para([inline('horizontalRule')]), para('After.')])
    const { after } = roundTrip(
      document,
      md => md.replace('---', 'Between.').replace('After.', 'After.\n\n---\n\nLast.'),
      {
        held: {},
      }
    )
    expect(JSON.stringify(after)).toContain('* * *')
  })

  it('keeps a chip while its words stay, and replaces it with them when they change', () => {
    const document = docOf([
      para([
        run('Ask '),
        inline('person', { personProperties: { name: 'Ada Byrne', email: 'ada@example.com' } }),
        run(' and '),
        inline('person', { personProperties: { name: 'Tom Hale', email: 'tom@example.com' } }),
        run('.'),
      ]),
    ])
    roundTrip(document, md => md.replace('Ask', 'Ask, today,'))
    const { after } = roundTrip(document, md => md.replace('Tom Hale', 'Tom'), {
      held: { person: 1 },
    })
    expect(heldOf(after)).toEqual({ person: 1 })
  })

  it('replaces a chip with words put against it in its link, and keeps it beside words that are not', () => {
    const document = docOf([
      para([
        run('Ask '),
        inline('person', { personProperties: { name: 'Ada Byrne', email: 'ada@example.com' } }),
        run('.'),
      ]),
    ])
    const ada = '[Ada Byrne](mailto:ada@example.com)'
    roundTrip(document, md => md.replace(ada, `${ada} herself`))
    roundTrip(document, md => md.replace(ada, `the ${ada}`))
    for (const named of ['Ada Byrne Jr', 'Dr Ada Byrne']) {
      roundTrip(document, md => md.replace(ada, `[${named}](mailto:ada@example.com)`), {
        held: {},
      })
    }
  })

  it('never deletes a picture, and a page break only when its two paragraphs are joined', () => {
    const document = docOf([
      para('First.'),
      para([
        run('The harbour: '),
        inline('inlineObjectElement', { inlineObjectId: 'kix.i' }),
        run(' at dawn.'),
      ]),
      para([run('Ended here.'), inline('pageBreak'), run('Began again.')]),
      para('Last.'),
    ])
    roundTrip(document, md =>
      md
        .replace('The harbour: at dawn.\n\n', '')
        .replace('Ended here.', 'Ended.')
        .replace('Began again.', 'Begun.')
    )
    roundTrip(document, md => md.replace('Ended here.\n\nBegan again.', 'One page.'), {
      held: { inlineObjectElement: 1 },
    })
  })

  it('styles a paragraph parted from one a join runs on into, as that join leaves it', () => {
    const document = docOf([
      para([run('Ended here.'), inline('pageBreak'), run('Began again on the far side.')]),
      para('Mind the gap.', { style: QUOTE }),
      para('Then they went.'),
    ])
    // The second half goes and a word comes into the quote: the Doc's
    // newline after the break goes with a join, and one put in after the
    // break parts the first half from the quote again.
    roundTrip(document, md =>
      md.replace('Began again on the far side.\n\n> Mind', '> harbour Mind')
    )
  })

  it('takes a page break with a join, which it would otherwise part again', () => {
    const document = docOf([
      para([run('Here is a page break.'), inline('pageBreak')]),
      para('The next page.'),
      para([inline('pageBreak')]),
      para('And the one after.'),
    ])
    roundTrip(document, md => md.replace('break.\n\nThe next', 'break. The next'), {
      held: { pageBreak: 1 },
    })
    roundTrip(document, md => md.replace('page.\n\nAnd', 'page. And'), {
      held: { pageBreak: 1 },
    })
  })

  it('takes out the whitespace a paragraph held with it, and with a join', () => {
    const document = docOf([para('\tIndented.'), para('Trailing.   '), para('  Leading.')])
    roundTrip(document, md => md.replace('Indented.\n\n', ''))
    roundTrip(document, md => md.replace('Trailing.\n\nLeading.', 'Trailing.Leading.'))
  })

  it('writes code in a monospaced font, a block a paragraph a line', () => {
    // In a Doc mostly of prose, as code in a Doc mostly of code is not read
    // as code at all.
    const document = docOf([
      para('The harbour master kept a notebook of tides, and wrote them out each dawn.'),
      para('Set the tide:'),
      para([run('let tide = 4', MONO)]),
      para('Then wait.'),
    ])
    roundTrip(document, md =>
      md
        .replace('let tide = 4', 'let tide = 5\ntide += 1')
        .replace('Then wait.', 'Then `wait` a while.\n\n```\nsleep(60)\n```')
    )
  })

  it('adds and takes out line breaks', () => {
    const document = docOf([para('One line\vand the next'), para('All one line.')])
    roundTrip(document, md =>
      md.replace('One line\nand', 'One line and').replace('All one', 'All\none')
    )
  })

  it('writes a footnote’s words into the footnote, and leaves its number unsent', () => {
    const document = docOf(
      [
        para([
          run('The ferry'),
          inline('footnoteReference', { footnoteId: 'kix.f', footnoteNumber: '1' }),
          run(' was late.'),
        ]),
      ],
      { footnotes: { 'kix.f': [para(' Twice that week.')] } }
    )
    const { written } = roundTrip(document, md => md.replace('Twice that', 'Three times that'))
    expect(
      written.requests.every(request => JSON.stringify(request).includes('"segmentId":"kix.f"'))
    ).toBe(true)
    expect(unsentFor(document, md => md.replace('\\[^1\\]: Twice', '\\[^2\\]: Twice'))).toEqual([
      'footnote',
    ])
  })

  it('writes around the words a suggestion puts in or takes out, but not a style', () => {
    const document = docOf([
      para([
        run('Kept '),
        run('new ', {}, { suggestedInsertionIds: ['s.1'] }),
        run('old ', {}, { suggestedDeletionIds: ['s.1'] }),
        run('words.'),
      ]),
      para([run('Styled', {}, { suggestedTextStyleChanges: { 's.2': {} } }), run(' here.')]),
      para('Free to change.'),
    ])
    // The words it puts in stay put in, and those it takes out stay to take out.
    const edit = md => md.replace('Kept old words', 'All kept old words, still')
    expect(unsentFor(document, edit)).toEqual([])
    const after = applyRequests(
      document,
      writeDoc(document, parseMarkdown(edit(readDoc(document).markdown))).requests
    )
    expect(readDoc(after).markdown).toMatch(/^All kept old words, still\./)
    expect(readDoc(after, { accepted: new Set(['s.1']) }).markdown).toMatch(
      /^All kept new words, still\./
    )

    expect(unsentFor(document, md => md.replace('Styled here', 'Styled there'))).toEqual([
      'suggestion',
    ])
    expect(unsentFor(document, md => md.replace('Free to', 'Fine to'))).toEqual([])
  })

  it('leaves out the changes of style that change nothing', () => {
    const document = docOf([para([run('A '), run('bold', { bold: true }), run(' word.')])])
    const clear = (/** @type {number} */ startIndex) => ({
      updateTextStyle: {
        range: { startIndex, endIndex: startIndex + 1 },
        textStyle: {},
        fields: 'bold,italic,strikethrough,link',
      },
    })
    // Put in after plain words, it is plain; after bold ones, bold.
    const requests = [
      { insertText: { text: 'x', location: { index: 2 } } },
      clear(2),
      { insertText: { text: 'y', location: { index: 8 } } },
      clear(8),
    ]
    expect(withoutIdleStyles(document, requests, undefined)).toEqual([
      requests[0],
      requests[2],
      requests[3],
    ])
  })

  describe('tables', () => {
    const log = () =>
      docOf([
        para('The log.'),
        table([
          ['Day', 'Miles', 'Wind'],
          ['Mon', '12', 'west'],
          ['Tue', '9', 'north'],
        ]),
        para('After.'),
      ])
    /** A table as markdown, by its rows. */
    const grid = (...rows) =>
      [
        `| ${rows[0].join(' | ')} |`,
        `| ${rows[0].map(() => '---').join(' | ')} |`,
        ...rows.slice(1).map(row => `| ${row.join(' | ')} |`),
      ].join('\n')
    const LOG = grid(['Day', 'Miles', 'Wind'], ['Mon', '12', 'west'], ['Tue', '9', 'north'])
    /** The log's table made another. */
    const relog =
      (...rows) =>
      md =>
        md.replace(LOG, grid(...rows))

    it('changes words in cells in place, the table left as it is', () => {
      const { written } = roundTrip(
        log(),
        relog(['Day', 'Miles', 'Wind'], ['Mon', '14', 'west'], ['Tue', '9', 'a **north** gale'])
      )
      expect(written.requests.some(request => Object.keys(request)[0].includes('Table'))).toBe(
        false
      )
    })

    it('puts rows in and takes them out, where they stand', () => {
      roundTrip(
        log(),
        relog(
          ['Day', 'Miles', 'Wind'],
          ['Sun', '3', 'calm'],
          ['Mon', '12', 'west'],
          ['Tue', '9', 'north'],
          ['Wed', '20', 'east']
        )
      )
      roundTrip(log(), relog(['Day', 'Miles', 'Wind'], ['Tue', '9', 'north']))
      roundTrip(
        log(),
        relog(['Day', 'Miles', 'Wind'], ['Tue', '9', 'north'], ['Thu', '1', 'south'])
      )
    })

    it('puts columns in and takes them out, where they stand', () => {
      roundTrip(
        log(),
        relog(
          ['When', 'Day', 'Miles', 'Rain', 'Wind'],
          ['am', 'Mon', '12', 'yes', 'west'],
          ['pm', 'Tue', '9', 'no', 'north']
        )
      )
      roundTrip(log(), relog(['Day', 'Wind'], ['Mon', 'west'], ['Tue', 'north']))
    })

    it('changes rows, columns and words at once', () => {
      roundTrip(
        log(),
        relog(['Day', 'Wind', 'Rain'], ['Tue', 'north east', 'none'], ['Wed', 'east', 'some'])
      )
    })

    it('reads a cell of several paragraphs as one line, and edits it so', () => {
      const document = docOf([
        para('Before.'),
        table([
          ['Day', 'Note'],
          ['Mon', [para('Rain at dawn.'), para('Calm by noon.')]],
        ]),
        para('After.'),
      ])
      roundTrip(document, md =>
        md.replace('Rain at dawn. Calm by noon.', 'Rain at first light. Calm by noon, then wind.')
      )
      roundTrip(document, md => md.replace('Rain at dawn. Calm', 'Calm'))
    })

    it('puts a table in between paragraphs, at the start and at the end', () => {
      const document = chapter()
      const made = grid(['Day', 'Miles'], ['Mon', '12'])
      roundTrip(document, md => md.replace('Rain came in from the west.', `$&\n\n${made}`))
      roundTrip(document, md => `${made}\n\n${md}`)
      roundTrip(document, md => `${md}\n\n${made}`)
      // After a heading, and two together.
      roundTrip(document, md => md.replace('# One', `$&\n\n${made}\n\n${made}`))
    })

    it('leaves no paragraph of its own after a table put in, where Docs allows', () => {
      const document = docOf([para('Before.'), para('After.')])
      const { after } = roundTrip(document, md =>
        md.replace('Before.', `$&\n\n${grid(['a', 'b'], ['c', 'd'])}`)
      )
      const content = after.tabs[0].documentTab.body.content
      expect(
        content.map(element => Object.keys(element).find(key => !key.endsWith('Index')))
      ).toEqual(['sectionBreak', 'paragraph', 'table', 'paragraph'])
    })

    it('deletes a table whole, and keeps one that holds a picture', () => {
      roundTrip(log(), md => md.replace(`\n\n${LOG}`, ''))
      const pictured = docOf(
        [
          para('Before.'),
          table([
            [
              'Day',
              [para([run('Pier '), inline('inlineObjectElement', { inlineObjectId: 'kix.p' })])],
            ],
          ]),
          para('After.'),
        ],
        { pictures: { 'kix.p': { uri: 'https://pictures.example.com/p' } } }
      )
      expect(unsentFor(pictured, md => md.replace(/\n\n\|[^]*\|/, ''))).toEqual(['held'])
      roundTrip(pictured, md => md.replace('Pier', 'The pier'))
    })

    it('sends what is around a table, and a paragraph put after one at the end', () => {
      // A Doc has a paragraph after a table always.
      const document = docOf([para('Before.'), table([['Day', 'Miles']]), para('')])
      roundTrip(document, md => md.replace('Before.', 'Just before.'))
      roundTrip(document, md => `${md}\n\nAfter it.`)
    })

    it('changes no shape of a table with merged cells', () => {
      const merged = log()
      const cells = merged.tabs[0].documentTab.body.content[2].table.tableRows[0].tableCells
      cells[1].tableCellStyle = { columnSpan: 2 }
      expect(unsentFor(merged, relog(['Day', 'Miles'], ['Mon', '12'], ['Tue', '9']))).toEqual([
        'merged',
      ])
      roundTrip(merged, md => md.replace('| 12 |', '| 14 |'))
    })
  })

  it('takes out the paragraph before a table, and the last one after it, as Docs allows', () => {
    const document = docOf([
      para('First.'),
      para('Just before.'),
      table([['Day', 'Miles']]),
      para('Just after.'),
    ])
    roundTrip(document, md => md.replace('\n\nJust before.', ''))
    roundTrip(document, md => md.replace('\n\nJust after.', ''))
  })

  describe('pictures', () => {
    const pictured = () =>
      docOf(
        [
          para([
            run('The harbour: '),
            inline('inlineObjectElement', { inlineObjectId: 'kix.pier' }),
            run(' at dawn.'),
          ]),
          para('Gulls overhead.'),
          para([inline('inlineObjectElement', { inlineObjectId: 'kix.gull' })]),
          para('The end.'),
        ],
        {
          pictures: {
            'kix.pier': { uri: 'https://pictures.example.com/pier', alt: 'The north pier' },
            'kix.gull': { uri: 'https://pictures.example.com/gull' },
          },
        }
      )

    /**
     * A Doc's markdown as the import leaves it, each picture the document's
     * own under its name, and the row's entries, each with the Doc's id.
     */
    const imported = (read, names) =>
      read.pictures.reduce(
        (markdown, picture) =>
          markdown
            .split(`](${picture.marker})`)
            .join(`](.images/doc_t/${names.get(picture.object)})`),
        read.markdown
      )
    const asImported = document => {
      const read = readDoc(document)
      const names = new Map(
        read.pictures.map((picture, i) => [picture.object, `image${i + 1}.png`])
      )
      const pictures = Object.fromEntries(
        [...names].map(([object, name]) => [name, { mime: 'image/png', docsId: object }])
      )
      return { markdown: imported(read, names), names, pictures }
    }

    /** As `roundTrip`, the document's pictures known by the Doc's ids. */
    const pictureTrip = (document, edit) => {
      const { markdown, names, pictures } = asImported(document)
      const target = parseMarkdown(edit(markdown))
      const written = writeDoc(document, target, { pictures })
      expect(written.unsent).toEqual([])
      const after = applyRequests(document, written.requests)
      expect(imported(readDoc(after), names)).toBe(serializeMarkdown(target))
      return { written, after }
    }

    it('sends nothing for pictures left as they are, and edits around them', () => {
      const document = pictured()
      const { markdown, pictures } = asImported(document)
      expect(writeDoc(document, parseMarkdown(markdown), { pictures }).requests).toEqual([])
      const { after } = pictureTrip(document, md =>
        md.replace('at dawn', 'at first light').replace('Gulls overhead.\n\n', '')
      )
      expect(heldOf(after)).toEqual({ inlineObjectElement: 2 })
    })

    it('deletes in the Doc a picture deleted here, and the paragraph it had to itself', () => {
      const { after } = pictureTrip(pictured(), md =>
        md
          .replace(/\n\n!\[\]\([^)]*image2\.png\)/, '')
          .replace(' ![The north pier](.images/doc_t/image1.png)', '')
      )
      expect(heldOf(after)).toEqual({})
    })

    it('keeps here a picture added here, sending nothing for it, its paragraph neither', () => {
      const document = pictured()
      const { markdown, pictures } = asImported(document)
      const target = parseMarkdown(
        markdown.replace('Gulls overhead.', 'Gulls overhead.\n\n![](.images/doc_t/pasted.png)')
      )
      const written = writeDoc(document, target, {
        pictures: { ...pictures, 'pasted.png': { mime: 'image/png' } },
      })
      expect(written).toMatchObject({ requests: [], unsent: [] })
    })

    it('deletes the paragraph a page break parts off whole, the one before it ending alike', () => {
      // A picture keeps its paragraph in the comparison, which laid from the
      // end once took the first full stop with the break.
      const document = docOf(
        [
          para('Monday'),
          para([
            run('The ferry was late '),
            inline('inlineObjectElement', { inlineObjectId: 'kix.pier' }),
            run(' and nobody minded much.'),
            inline('inlineObjectElement', { inlineObjectId: 'kix.gull' }),
            inline('pageBreak'),
          ]),
          para('Began again on the far side.'),
          para('Mind the gap.', { style: QUOTE }),
        ],
        {
          pictures: {
            'kix.pier': { uri: 'https://pictures.example.com/pier' },
            'kix.gull': {},
          },
        }
      )
      const { written } = pictureTrip(document, md =>
        md.replace('Began again on the far side.\n\n', '')
      )
      expect(written.requests).toHaveLength(1)
    })

    it('deletes none of the Doc’s pictures the document never had', () => {
      // As one imported before pictures came in, or through Google's export,
      // whose pictures have no ids.
      const document = pictured()
      const { markdown } = asImported(document)
      for (const target of [
        markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace('The end.', 'The end, at last.'),
        markdown.replace('The end.', 'The end, at last.'),
      ]) {
        const after = applyRequests(document, writeDoc(document, parseMarkdown(target)).requests)
        expect(heldOf(after)).toEqual({ inlineObjectElement: 2 })
        expect(readDoc(after).markdown).toContain('The end, at last.')
      }
    })
  })

  it('sends nothing for comments, which cross apart, overlapping ones too', () => {
    const document = docOf([para('The ferry left at six, late again.'), para('Rain came in.')])
    const markdown =
      'The ferry {==left at{== six,==}{>>c2bb<<}==}{>>c1aa<<}{== late again.==}{>>c2bb<<}' +
      '\n\nRain {==came in==}{>>c3cc<<}.'
    expect(writeDoc(document, parseMarkdown(markdown)).requests).toEqual([])
  })

  it('makes its requests against the tab read, and says which revision', () => {
    const document = chapter()
    const written = writeDoc(
      document,
      parseMarkdown(readDoc(document).markdown.replace('wet', 'dry'))
    )
    expect(written.revisionId).toBe('rev-1')
    expect(JSON.stringify(written.requests)).toContain('"tabId":"t.0"')
  })
})

describe('writeDoc, edited at random', () => {
  it('reads back as each edit, holding what it held', () => {
    const next = random(11)
    const document = busy()
    const read = readDoc(document)
    const names = new Map(read.pictures.map((picture, i) => [picture.object, `image${i + 1}.png`]))
    const pictures = Object.fromEntries(
      [...names].map(([object, name]) => [name, { mime: 'image/png', docsId: object }])
    )
    const markdown = imported(read, names)
    for (let round = 0; round < 300; round++) {
      const blocks = markdown.split('\n\n')
      const pick = list => {
        const choices = list.map((block, i) => (plain(block) ? i : -1)).filter(i => i >= 0)
        return choices.length ? choices[Math.floor(next() * choices.length)] : -1
      }
      const count = 1 + Math.floor(next() * 4)
      for (let k = 0; k < count; k++) anyEdit(blocks, pick, next)
      const edited = blocks.join('\n\n')
      const target = parseMarkdown(edited)
      const written = writeDoc(document, target, { pictures })
      expect(written.unsent, `round ${round}: ${edited}`).toEqual([])
      let after
      try {
        after = applyRequests(document, written.requests)
      } catch (error) {
        throw new Error(
          `round ${round}: ${error.message}\n${edited}\n${JSON.stringify(written.requests)}`
        )
      }
      // A footnote goes with its number, as Docs deletes one.
      const note = /\n\n\\\[\^1\\\]: [^\n]*$/
      const kept = edited.replace(note, '').includes('\\[^1\\]')
      const expected = serializeMarkdown(kept ? target : parseMarkdown(edited.replace(note, '')))
      expect(imported(readDoc(after), names), `round ${round}`).toBe(expected)
      expect(objects(after, 'kix.pic'), `round ${round}: the drawing`).toBe(1)
      expect(objects(after, 'kix.photo'), `round ${round}: the picture`).toBe(
        edited.includes('image1.png') ? 1 : 0
      )
    }
  })
})

describe('writeDoc, into an empty Doc', () => {
  it('writes any document whole into one, as a new Doc is', () => {
    const next = random(23)
    // The busy Doc's words, its pictures and footnote aside: a new Doc has
    // neither, and nothing yet makes them.
    const markdown = readDoc(busy())
      .markdown.replace(/ ?!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\\\[\^1\\\]/g, '')
      .replace(/\n\n\\\[\^1\\\]: [^\n]*$/, '')
    let written = 0
    for (let round = 0; round < 200; round++) {
      const blocks = markdown.split('\n\n')
      const pick = list => {
        const choices = list.map((block, i) => (plain(block) ? i : -1)).filter(i => i >= 0)
        return choices.length ? choices[Math.floor(next() * choices.length)] : -1
      }
      const count = Math.floor(next() * 5)
      for (let k = 0; k < count; k++) anyEdit(blocks, pick, next)
      // Some documents start with a table, or are one.
      if (next() < 0.1) blocks.splice(0, 0, '| a | b |\n| --- | --- |\n| c | d |')
      if (next() < 0.05) blocks.splice(1)
      const edited = blocks.join('\n\n')
      const target = parseMarkdown(edited)
      const empty = docOf([para('')])
      const result = writeDoc(empty, target)
      expect(result.unsent, `round ${round}: ${edited}`).toEqual([])
      let after
      try {
        after = applyRequests(empty, result.requests)
      } catch (error) {
        throw new Error(
          `round ${round}: ${error.message}\n${edited}\n${JSON.stringify(result.requests)}`
        )
      }
      expect(readDoc(after).markdown, `round ${round}`).toBe(serializeMarkdown(target))
      written++
    }
    expect(written).toBe(200)
  })
})
