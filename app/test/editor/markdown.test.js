import { describe, it, expect, vi } from 'vitest'
import { MarkdownSerializer, MarkdownSerializerState } from 'prosemirror-markdown'
import { schema, NODE_NAMES, MARK_NAMES } from '../../src/editor/schema.js'
import {
  parseMarkdown,
  serializeMarkdown,
  serializer,
  settleMarkdown,
} from '../../src/editor/markdown.js'

/** Serialize, parse the result, and hand back both. */
const roundTrip = doc => {
  const markdown = serializeMarkdown(doc)
  return { markdown, doc: parseMarkdown(markdown) }
}

/** What a document reads as after one pass through the serializer. */
const settle = markdown => serializeMarkdown(parseMarkdown(markdown))

describe('schema', () => {
  it('holds exactly the nodes and marks that have a markdown form', () => {
    expect(Object.keys(schema.nodes).sort()).toEqual([...NODE_NAMES].sort())
    expect(Object.keys(schema.marks).sort()).toEqual([...MARK_NAMES].sort())
  })
})

describe('parseMarkdown', () => {
  it('reads nothing as an empty document', () => {
    expect(parseMarkdown('').toJSON()).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    })
    expect(parseMarkdown(null).childCount).toBe(1)
    expect(parseMarkdown(undefined).childCount).toBe(1)
  })

  it('reads a lone newline as a hard break and a blank line as a paragraph', () => {
    const doc = parseMarkdown('Once\nupon a time\n\nThere was')
    expect(doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Once' },
            { type: 'hard_break' },
            { type: 'text', text: 'upon a time' },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'There was' }] },
      ],
    })
  })

  it('reads raw HTML as the text it is', () => {
    const doc = parseMarkdown('<b>bold</b> and <script>alert(1)</script>')
    expect(doc.textContent).toBe('<b>bold</b> and <script>alert(1)</script>')
    expect(doc.firstChild.firstChild.marks).toEqual([])
  })

  it('reads a picture as a picture, its path and alt text kept', () => {
    const picture = parseMarkdown('![A map](.images/doc_a1/market%20map.png "The quarter")')
      .firstChild.firstChild
    expect(picture.type.name).toBe('image')
    expect(picture.attrs).toEqual({
      src: '.images/doc_a1/market%20map.png',
      alt: 'A map',
      title: 'The quarter',
    })
  })

  it("reads a picture's alt text as its words alone", () => {
    const picture = parseMarkdown('![a *walled* `city`](x.png)').firstChild.firstChild
    expect(picture.attrs.alt).toBe('a walled city')
  })

  it('reads a path written in <…> with its spaces encoded', () => {
    const picture = parseMarkdown('![](<.images/doc_a1/market map.png>)').firstChild.firstChild
    expect(picture.attrs.src).toBe('.images/doc_a1/market%20map.png')
    expect(picture.attrs.alt).toBe(null)
  })

  it('keeps an escaped ! before a link as words and a link', () => {
    const paragraph = parseMarkdown('\\![not a picture](x.png)').firstChild
    expect(paragraph.firstChild.text).toBe('!')
    expect(paragraph.child(1).marks[0].type.name).toBe('link')
  })

  it('reads every block and mark into its node', () => {
    const doc = parseMarkdown(
      [
        '# Title',
        '',
        '> quoted',
        '',
        '- one',
        '- two',
        '',
        '3. three',
        '4. four',
        '',
        '```js',
        'code()',
        '```',
        '',
        '---',
        '',
        '**bold** *italic* `code` ~~gone~~ [link](https://example.com)',
      ].join('\n')
    )
    const types = doc.content.content.map(node => node.type.name)
    expect(types).toEqual([
      'heading',
      'blockquote',
      'bullet_list',
      'ordered_list',
      'code_block',
      'horizontal_rule',
      'paragraph',
    ])
    expect(doc.child(0).attrs.level).toBe(1)
    expect(doc.child(3).attrs.order).toBe(3)
    expect(doc.child(4).attrs.params).toBe('js')
    const marks = doc.lastChild.content.content.flatMap(n => n.marks.map(m => m.type.name))
    expect(marks).toEqual(['strong', 'em', 'code', 'strikethrough', 'link'])
    expect(doc.lastChild.lastChild.marks[0].attrs.href).toBe('https://example.com')
  })
})

describe('tables', () => {
  /** A table's rows as arrays of their cells' text. */
  const grid = table => {
    const rows = []
    table.forEach(row => {
      const cells = []
      row.forEach(cell => cells.push(cell.textContent))
      rows.push(cells)
    })
    return rows
  }

  it('reads a table into rows of cells, the header first', () => {
    const doc = parseMarkdown('| Name | Age |\n| --- | --- |\n| Ada | 36 |\n| Bo | 7 |')
    expect(doc.childCount).toBe(1)
    expect(doc.firstChild.type.name).toBe('table')
    expect(grid(doc.firstChild)).toEqual([
      ['Name', 'Age'],
      ['Ada', '36'],
      ['Bo', '7'],
    ])
  })

  it("keeps each column's alignment on its cells", () => {
    const doc = parseMarkdown('| a | b | c | d |\n| --- | :-- | :-: | --: |\n| 1 | 2 | 3 | 4 |')
    const aligns = row => row.content.content.map(cell => cell.attrs.align)
    expect(aligns(doc.firstChild.child(0))).toEqual([null, 'left', 'center', 'right'])
    expect(aligns(doc.firstChild.child(1))).toEqual([null, 'left', 'center', 'right'])
  })

  it('reads marks in a cell', () => {
    const doc = parseMarkdown('| **bold** `code` |\n| --- |')
    const cell = doc.firstChild.firstChild.firstChild
    expect(cell.content.content.map(n => n.marks.map(m => m.type.name))).toEqual([
      ['strong'],
      [],
      ['code'],
    ])
  })

  it('reads a table with a row longer than its header as the text it is', () => {
    const markdown = '| a | b |\n| --- | --- |\n| 1 | 2 | 3 |'
    const doc = parseMarkdown(markdown)
    expect(doc.firstChild.type.name).toBe('paragraph')
    expect(settle(markdown)).toBe(markdown)
  })

  it('counts a pipe in code as one, which is why that row is too long', () => {
    const markdown = '| a | b |\n| --- | --- |\n| `x || y` | z |'
    expect(parseMarkdown(markdown).firstChild.type.name).toBe('paragraph')
    expect(settle(markdown)).toBe(markdown)
  })

  it('fills a short row with empty cells', () => {
    expect(settle('| a | b |\n| --- | --- |\n| 1 |')).toBe('| a | b |\n| --- | --- |\n| 1 |  |')
  })

  it('writes a table with a pipe at each end and no padding', () => {
    expect(settle('Name   | Age\n:------|----:\nAda    |  36')).toBe(
      '| Name | Age |\n| :--- | ---: |\n| Ada | 36 |'
    )
  })

  it('escapes a pipe in a cell, in code as well', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'table_row',
              content: [
                { type: 'table_cell', content: [{ type: 'text', text: 'a | b' }] },
                {
                  type: 'table_cell',
                  content: [{ type: 'text', text: 'x || y', marks: [{ type: 'code' }] }],
                },
              ],
            },
          ],
        },
      ],
    })
    const { markdown, doc: back } = roundTrip(doc)
    expect(markdown).toBe('| a \\| b | `x \\|\\| y` |\n| --- | --- |')
    expect(back.eq(doc)).toBe(true)
  })

  it('does not escape what would start a line, since a cell does not', () => {
    expect(settle('| - | # | 1. | > |\n| --- | --- | --- | --- |')).toBe(
      '| - | # | 1. | > |\n| --- | --- | --- | --- |'
    )
  })

  it('reads a table in a quote and in a list, and writes their markers on every row', () => {
    const quoted = '> | a | b |\n> | --- | --- |\n> | 1 | 2 |'
    expect(parseMarkdown(quoted).firstChild.firstChild.type.name).toBe('table')
    expect(settle(quoted)).toBe(quoted)
    const listed = '- item\n\n  | a |\n  | --- |\n  | 1 |'
    expect(parseMarkdown(listed).firstChild.firstChild.lastChild.type.name).toBe('table')
    expect(settle(listed)).toBe(listed)
  })

  it('ends a paragraph the table starts under', () => {
    const doc = parseMarkdown('Before\n| a |\n| --- |\n| 1 |')
    expect(doc.content.content.map(n => n.type.name)).toEqual(['paragraph', 'table'])
  })
})

describe('serializeMarkdown', () => {
  it('writes an empty document as nothing', () => {
    expect(serializeMarkdown(parseMarkdown(''))).toBe('')
  })

  it('writes a hard break as a bare newline', () => {
    expect(serializeMarkdown(parseMarkdown('Once\nupon a time'))).toBe('Once\nupon a time')
  })

  it('escapes what would start a block after a break', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Once' },
            { type: 'hard_break' },
            { type: 'text', text: '# not a heading' },
            { type: 'hard_break' },
            { type: 'text', text: '- not a list' },
            { type: 'hard_break' },
            { type: 'text', text: '1. not a list either' },
          ],
        },
      ],
    })
    const { markdown, doc: back } = roundTrip(doc)
    expect(markdown).toBe('Once\n\\# not a heading\n\\- not a list\n1\\. not a list either')
    expect(back.eq(doc)).toBe(true)
  })

  it('escapes what the reference leaves to come back as something else', () => {
    const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] })
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [
        paragraph('1) not a list'),
        paragraph('2.'),
        paragraph('+'),
        paragraph('Fish &amp; chips, &#42; and &#x2A;, but & alone'),
        paragraph('Write to <ada@example.com> or <https://example.com>, not <b>'),
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Not a heading' },
            { type: 'hard_break' },
            { type: 'text', text: '===' },
            { type: 'hard_break' },
            { type: 'text', text: '3) nor a list' },
          ],
        },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Take #' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Part ##' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'C# and #1' }] },
      ],
    })
    const { markdown, doc: back } = roundTrip(doc)
    expect(markdown).toBe(
      [
        '1\\) not a list',
        '2\\.',
        '\\+',
        'Fish \\&amp; chips, \\&#42; and \\&#x2A;, but & alone',
        'Write to \\<ada@example.com> or \\<https://example.com>, not <b>',
        'Not a heading\n\\===\n3\\) nor a list',
        '## Take \\#',
        '### Part \\##',
        '## C# and #1',
      ].join('\n\n')
    )
    expect(back.eq(doc)).toBe(true)

    // A break after it is dropped, so the `#` still ends the line.
    const broken = schema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Take #' }, { type: 'hard_break' }],
        },
      ],
    })
    expect(serializeMarkdown(broken)).toBe('## Take \\#')
  })

  it('writes a space without the bold or italic the text after it lacks', () => {
    const strong = schema.marks.strong.create()
    const em = schema.marks.em.create()
    const link = schema.marks.link.create({ href: 'https://example.com' })
    const paragraph = (/** @type {import('prosemirror-model').Node[]} */ ...content) =>
      schema.node('paragraph', null, content)
    const doc = schema.node('doc', null, [
      // As Docs bolds a double-clicked word's space with it.
      paragraph(
        schema.text('Kept '),
        schema.text('bold italic.', [strong, em]),
        schema.text(' ', [strong]),
        schema.text('Plain.')
      ),
      // Between two bold words, a bold space stays bold, and a link keeps its own.
      paragraph(
        schema.text('one', [strong]),
        schema.text(' ', [strong]),
        schema.text('two', [strong, em]),
        schema.text(' and '),
        schema.text('a', [link]),
        schema.text(' ', [link, em]),
        schema.text('link', [link])
      ),
      schema.node('table', null, [
        schema.node('table_row', null, [
          schema.node('table_cell', null, [
            schema.text('cell', [strong, em]),
            schema.text(' ', [strong]),
            schema.text('text'),
          ]),
        ]),
      ]),
    ])

    const { markdown, doc: back } = roundTrip(doc)

    expect(markdown).toBe(
      [
        'Kept ***bold italic.*** Plain.',
        '**one *two*** and [a link](https://example.com)',
        '| ***cell*** text |\n| --- |',
      ].join('\n\n')
    )
    expect(back.textBetween(0, back.content.size, '|')).toBe(
      'Kept bold italic. Plain.|one two and a link|cell text'
    )
  })

  it('keeps a run of breaks a run rather than a paragraph break', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a' },
            { type: 'hard_break' },
            { type: 'hard_break' },
            { type: 'hard_break' },
            { type: 'text', text: 'b' },
          ],
        },
      ],
    })
    const { markdown, doc: back } = roundTrip(doc)
    expect(markdown).toBe('a\n\\\n\\\nb')
    expect(back.eq(doc)).toBe(true)
  })

  it('drops a trailing break, which has no form', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hard_break' }] },
      ],
    })
    expect(serializeMarkdown(doc)).toBe('a')
  })

  it('writes lists tight with dashes and numbers from their start', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'bullet_list',
          content: [
            {
              type: 'list_item',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
            {
              type: 'list_item',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
                {
                  type: 'bullet_list',
                  content: [
                    {
                      type: 'list_item',
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inner' }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'between' }] },
        {
          type: 'ordered_list',
          attrs: { order: 9 },
          content: [
            {
              type: 'list_item',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'nine' }] }],
            },
            {
              type: 'list_item',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ten' }] }],
            },
          ],
        },
      ],
    })
    const { markdown, doc: back } = roundTrip(doc)
    expect(markdown).toBe('- one\n- two\n  - inner\n\nbetween\n\n 9. nine\n10. ten')
    expect(back.eq(doc)).toBe(true)
  })

  it('writes a code block with its language and a fence longer than any inside', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'code_block',
          attrs: { params: 'md' },
          content: [{ type: 'text', text: 'a ``` b' }],
        },
      ],
    })
    const { markdown, doc: back } = roundTrip(doc)
    expect(markdown).toBe('````md\na ``` b\n````')
    expect(back.eq(doc)).toBe(true)
  })
})

describe('serializeMarkdown on a long document', () => {
  const block = [
    '## A heading',
    'A paragraph with **bold** in it.',
    '- one\n- two',
    '| a | b |\n| --- | --- |\n| 1 | 2 |',
    '> said once',
  ].join('\n\n')
  const long = Array.from({ length: 200 }, () => block).join('\n\n')
  const list = Array.from({ length: 1000 }, () => '- An item with **bold** in it').join('\n')
  const quote = Array.from({ length: 1000 }, () => '> A line said once').join('\n>\n')

  it('writes it as it was, in blocks or as one list or quote', () => {
    expect(settle(long)).toBe(long)
    expect(settle(list)).toBe(list)
    expect(settle(quote)).toBe(quote)
  })

  // The state reads its output to see whether a line has ended. Were the
  // whole document there, every block would cost the whole document, and in
  // one long list every item would cost the list.
  it('keeps no more than a few lines of output in the state, at any depth', () => {
    const atBlank = MarkdownSerializerState.prototype.atBlank
    let longest = 0
    const spy = vi
      .spyOn(MarkdownSerializerState.prototype, 'atBlank')
      .mockImplementation(function () {
        longest = Math.max(longest, this.out.length)
        return atBlank.call(this)
      })
    try {
      for (const markdown of [long, list, quote]) settle(markdown)
    } finally {
      spy.mockRestore()
    }
    expect(longest).toBeGreaterThan(0)
    expect(longest).toBeLessThan(500)
  })

  // The state is left only the end of its output, which is all the reference
  // reads back today. Were a later version to read further, or to do more in
  // its own serialize, the two would part here. The scene is moved along a
  // character at a time, so that the state is cut at every point in it.
  it("writes what the reference's own serialize writes", () => {
    const scene = [
      '# A heading',
      'Text with **bold**, *italic*, `code`, ~~gone~~ and a [link](https://example.com).',
      'A bang before a link: wow\\![link](https://example.com)',
      'And after a backslash: wow\\\\![link](https://example.com)',
      'Once\nupon a time\\\n\\\nand after',
      '> quoted\n>\n> - a list in a quote',
      '- one\n  - nested\n- two\n\n1. first\n2. second',
      '```js\nraw *text*\n```',
      '---',
      '| a | b |\n| :--- | ---: |\n| **1** | `2 \\| 3` |',
    ].join('\n\n')
    for (let shift = 0; shift < 300; shift++) {
      const doc = parseMarkdown(`${'x'.repeat(shift)}\n\n${scene}`)
      const reference = MarkdownSerializer.prototype.serialize.call(serializer, doc, {
        tightLists: true,
      })
      expect(serializeMarkdown(doc)).toBe(reference)
    }
  })
})

describe('settleMarkdown', () => {
  it('writes text from outside the way the editor would', () => {
    expect(settleMarkdown('* star bullet\n\nDone.\n')).toBe('- star bullet\n\nDone.')
    expect(settleMarkdown('')).toBe('')
    expect(settleMarkdown(null)).toBe('')
  })

  it("leaves the editor's own form alone", () => {
    const own = '# One\n\nOnce *upon* a time\nlong ago\n\n- a\n- b'
    expect(settleMarkdown(own)).toBe(own)
  })
})

describe('round trip', () => {
  const cases = {
    heading: '## Chapter Two',
    paragraphs: 'One.\n\nTwo.',
    'hard breaks': 'Once\nupon a time',
    blockquote: '> quoted\n> and broken',
    'bullet list': '- one\n- two',
    'ordered list': '1. one\n2. two',
    'code block': '```\nraw *text*\n```',
    'horizontal rule': '---',
    bold: '**bold**',
    italic: '*italic*',
    code: '`code`',
    strike: '~~gone~~',
    link: '[link](https://example.com)',
    'picture alone': '![A map of the quarter](.images/doc_a1/market%20map.png)',
    'picture in a sentence': 'The gate ![](Maps/gate.png) stood open.',
    'picture with a title': '![Gate](gate.png "The north gate")',
    'picture with spaces in its path': '![](.images/doc_a1/a%20b%20c.png)',
    'picture from the web': '![](https://example.com/gate.png)',
    'linked picture': '[![Gate](gate.png)](https://example.com)',
    'picture in a comment': '{==the gate ![](gate.png) stood==}{>>c_a1<<}',
    table: '| Name | Age |\n| --- | --- |\n| Ada | 36 |',
    'aligned table': '| a | b | c | d |\n| --- | :--- | :---: | ---: |\n| 1 | 2 | 3 | 4 |',
    'table with marks and an empty cell':
      '| **bold** | `a \\| b` |\n| --- | --- |\n| [link](https://example.com) |  |',
    'header-only table': '| a | b |\n| --- | --- |',
    'marks nested': '***both*** and [**bold link**](https://example.com)',
    'escaped syntax': 'not \\*emphasis\\* and a literal \\[bracket\\]',
    'a whole scene':
      '# The Crystal Caves\n\nDeep below, *something* stirred.\nIt had waited **years**.\n\n> "Who goes there?"\n\n- a torch\n- a rope\n\n---\n\nThe end.',
  }

  for (const [name, markdown] of Object.entries(cases)) {
    it(`is a fixed point for ${name}`, () => {
      expect(settle(markdown)).toBe(markdown)
      const doc = parseMarkdown(markdown)
      expect(parseMarkdown(serializeMarkdown(doc)).eq(doc)).toBe(true)
    })
  }

  it('settles what was written another way after one pass', () => {
    const messy = [
      'Title',
      '=====',
      '',
      '* star bullet',
      '',
      '* loose list',
      '',
      '1) paren number',
      '',
      'prose',
      '',
      '    indented code',
      '',
      '__bold__ and _italic_',
      '',
      'trailing two spaces  ',
      'next line',
    ].join('\n')
    const once = settle(messy)
    expect(once).toBe(
      '# Title\n\n- star bullet\n- loose list\n\n1. paren number\n\nprose\n\n```\nindented code\n```\n\n**bold** and *italic*\n\ntrailing two spaces\nnext line'
    )
    expect(settle(once)).toBe(once)
  })

  it('keeps a mark on code', () => {
    expect(settle('**`code in bold`**')).toBe('**`code in bold`**')
  })
})
