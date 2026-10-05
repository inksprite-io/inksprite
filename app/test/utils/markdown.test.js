import { describe, it, expect } from 'vitest'
import { renderMarkdown, stripMarkdown } from '../../src/utils/markdown'

describe('renderMarkdown', () => {
  describe('markdown', () => {
    it('renders the things a story is written with', () => {
      expect(renderMarkdown('# Chapter')).toContain('<h1>Chapter</h1>')
      expect(renderMarkdown('**bold** and *italic*')).toBe(
        '<p><strong>bold</strong> and <em>italic</em></p>\n'
      )
      expect(renderMarkdown('- one\n- two')).toContain('<li>one</li>')
      expect(renderMarkdown('1. one\n2. two')).toContain('<ol>')
      expect(renderMarkdown('> quoted')).toContain('<blockquote>')
      expect(renderMarkdown('`code`')).toContain('<code>code</code>')
    })

    it('renders GitHub flavoured tables and strikethrough', () => {
      expect(renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |')).toContain('<table>')
      expect(renderMarkdown('~~gone~~')).toContain('<del>gone</del>')
    })

    it('leaves a fenced block as the text it is', () => {
      // Already escaped by marked, and the one place raw-looking text is meant
      // to survive intact.
      expect(renderMarkdown('```\n<oracle>x</oracle>\n```')).toBe(
        '<pre><code>&lt;oracle&gt;x&lt;/oracle&gt;\n</code></pre>\n'
      )
    })

    it('has nothing to say about nothing', () => {
      expect(renderMarkdown('')).toBe('')
      expect(renderMarkdown(null)).toBe('')
      expect(renderMarkdown(undefined)).toBe('')
    })
  })

  describe('line breaks', () => {
    it('ends a line where the writer ended it', () => {
      // Shift+Enter in the chat input, or a model writing verse. Neither
      // meant the lines to run together, whatever CommonMark says.
      expect(renderMarkdown('Once\nupon a time')).toBe('<p>Once<br>upon a time</p>\n')
    })

    it('still starts a paragraph at a blank line', () => {
      expect(renderMarkdown('Once\n\nupon a time')).toBe('<p>Once</p>\n<p>upon a time</p>\n')
    })
  })

  describe('html', () => {
    it('shows a tag as the text it was typed as', () => {
      // The writer pasting a wire block sees the block, rather than watching
      // their tags disappear into an element the browser does not know.
      expect(renderMarkdown('<oracle>\nIs there anything tasty?\nyes\n</oracle>')).toBe(
        '&lt;oracle&gt;\nIs there anything tasty?\nyes\n&lt;/oracle&gt;'
      )
    })

    it('lets no markup through, whatever it is', () => {
      // This is a model's output as often as it is the writer's, and a model
      // repeats what it was shown.
      const rendered = renderMarkdown('hi <img src=x onerror="boom()"> there')

      expect(rendered).not.toContain('<img')
      expect(rendered).toContain('&lt;img')

      expect(renderMarkdown('<script>boom()</script>')).not.toContain('<script')
    })

    it('escapes markup on the way out of a failure too', () => {
      // The fallback lands in the same v-html the parsed output does. There is
      // no path that reaches it with raw text.
      expect(stripMarkdown('<img src=x onerror="boom()">')).toContain('<img')
      expect(renderMarkdown('<img src=x onerror="boom()">')).not.toContain('<img ')
    })
  })

  describe('links', () => {
    it('links to the places a story links to', () => {
      expect(renderMarkdown('[docs](https://example.com)')).toContain(
        '<a href="https://example.com">docs</a>'
      )
      expect(renderMarkdown('[note](/notes/elara)')).toContain('href="/notes/elara"')
      expect(renderMarkdown('[top](#top)')).toContain('href="#top"')
      expect(renderMarkdown('[write](mailto:a@b.com)')).toContain('href="mailto:a@b.com"')
      expect(renderMarkdown('![art](https://example.com/a.png)')).toContain(
        '<img src="https://example.com/a.png"'
      )
    })

    it('keeps the words and drops a destination that is not one', () => {
      for (const href of [
        'javascript:boom()',
        'JAVASCRIPT:boom()',
        'vbscript:boom()',
        'data:text/html;base64,PHN2Zz4=',
      ]) {
        const rendered = renderMarkdown(`[click me](${href})`)
        expect(rendered).toBe('<p>click me</p>\n')
      }
    })

    it('reads a URL the way the browser will read it', () => {
      // Entities are decoded and control characters dropped before the scheme
      // is read, because they are ignored in a scheme and are only ever there
      // to hide one.
      expect(renderMarkdown('[click](java&#09;script:boom())')).toBe('<p>click</p>\n')
      expect(renderMarkdown('[click](&#106;avascript:boom())')).toBe('<p>click</p>\n')
    })

    it('keeps the formatting inside a refused link', () => {
      expect(renderMarkdown('[**shout** now](javascript:boom())')).toBe(
        '<p><strong>shout</strong> now</p>\n'
      )
    })

    it('leaves an image with nowhere to point as its own caption', () => {
      expect(renderMarkdown('![a knight](javascript:boom())')).toBe('<p>a knight</p>\n')
    })
  })
})
