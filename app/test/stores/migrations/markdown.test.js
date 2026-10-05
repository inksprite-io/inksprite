import { describe, it, expect } from 'vitest'
import { documentsToMarkdown, htmlToMarkdown } from '../../../src/stores/migrations/markdown.js'
import { plainTextToHtml } from '../../../src/stores/migrations/lore.js'

const text = (id, content, extra = {}) => ({
  id,
  storyId: 'story_1',
  parentId: 'story_1',
  order: 0,
  type: 'text',
  title: id,
  content,
  summary: '',
  wordCount: 0,
  version: 1,
  deleted: false,
  deletedAt: null,
  created: 1,
  updated: 1,
  ...extra,
})

describe('htmlToMarkdown', () => {
  it('reads every node and mark the editor wrote', () => {
    const html = [
      '<h2>Chapter Two</h2>',
      '<p>Deep <strong>below</strong>, <em>something</em> <s>slept</s> <code>stirred</code>.</p>',
      '<p>Once<br>upon a time</p>',
      '<blockquote><p>quoted</p></blockquote>',
      '<ul><li><p>one</p></li><li><p>two</p></li></ul>',
      '<ol start="3"><li><p>three</p></li></ol>',
      '<pre><code class="language-js">code()</code></pre>',
      '<hr>',
      '<p><a href="https://example.com">a link</a></p>',
    ].join('')

    expect(htmlToMarkdown(html)).toBe(
      [
        '## Chapter Two',
        '',
        'Deep **below**, *something* ~~slept~~ `stirred`.',
        '',
        'Once\nupon a time',
        '',
        '> quoted',
        '',
        '- one',
        '- two',
        '',
        '3. three',
        '',
        '```js',
        'code()',
        '```',
        '',
        '---',
        '',
        '[a link](https://example.com)',
      ].join('\n')
    )
  })

  it('keeps the words of what the schema never held', () => {
    expect(htmlToMarkdown('<p><u>under</u> <span style="color:red">red</span></p>')).toBe(
      'under red'
    )
  })

  it('escapes what would otherwise read as syntax', () => {
    expect(htmlToMarkdown('<p>1 * 2 [sic] and #tag</p>')).toBe('1 \\* 2 \\[sic\\] and #tag')
    expect(htmlToMarkdown('<p># not a heading</p>')).toBe('\\# not a heading')
  })

  it('reads what the lore migration built', () => {
    // v5 turned plain text into paragraphs of escaped text with line breaks.
    // That HTML now becomes the text it was, breaks and all.
    const html = plainTextToHtml('First line\nsecond line\n\nA & B <tag>')
    expect(htmlToMarkdown(html)).toBe('First line\nsecond line\n\nA & B <tag>')
  })

  it('reads an empty editor as nothing', () => {
    expect(htmlToMarkdown('<p></p>')).toBe('')
  })
})

describe('documentsToMarkdown', () => {
  it('converts each text document with content and returns only those', () => {
    const { documents, converted } = documentsToMarkdown([
      text('a', '<p><strong>Bold</strong> start.</p>'),
      text('folder', '', { type: 'folder' }),
      text('empty', ''),
      text('b', '<h1>Title</h1>'),
    ])

    expect(converted).toBe(2)
    expect(documents.map(d => [d.id, d.content])).toEqual([
      ['a', '**Bold** start.'],
      ['b', '# Title'],
    ])
  })

  it('changes content and nothing else', () => {
    const before = text('a', '<p>x</p>', { summary: 'kept', wordCount: 7, version: 3 })
    const [after] = documentsToMarkdown([before]).documents
    expect(after).toEqual({ ...before, content: 'x' })
    // The row handed in is left alone.
    expect(before.content).toBe('<p>x</p>')
  })

  it('counts an emptied paragraph as converted, since its content changed', () => {
    const { documents, converted } = documentsToMarkdown([text('a', '<p></p>')])
    expect(converted).toBe(1)
    expect(documents[0].content).toBe('')
  })

  it('is not idempotent by content, which is why the version gate runs it once', () => {
    const first = documentsToMarkdown([text('a', '<h1>Title</h1>')])
    const second = documentsToMarkdown(first.documents)
    expect(second.converted).toBe(1)
    expect(second.documents[0].content).toBe('\\# Title')
  })

  it('tolerates empty and missing input', () => {
    expect(documentsToMarkdown([])).toEqual({ documents: [], converted: 0 })
    expect(documentsToMarkdown(null)).toEqual({ documents: [], converted: 0 })
  })
})
