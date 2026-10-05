import { describe, it, expect } from 'vitest'
import { schema, NODE_NAMES, MARK_NAMES } from '../../src/editor/schema.js'
import { parseMarkdown, serializeMarkdown, settleMarkdown } from '../../src/editor/markdown.js'

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

  it('reads a table and an image as text rather than throwing', () => {
    expect(parseMarkdown('| a | b |\n| - | - |\n| 1 | 2 |').textContent).toContain('| a | b |')
    const image = parseMarkdown('![alt](http://x/y.png)')
    expect(image.textContent).toContain('alt')
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
