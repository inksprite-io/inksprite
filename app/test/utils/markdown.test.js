import { describe, it, expect, beforeAll } from 'vitest'
import { renderMarkdown, stripMarkdown } from '../../src/utils/markdown'
import { loadMath } from '../../src/utils/math'

/**
 * The formulas typeset in some HTML, as the TeX each came from, with `$$` round
 * one set on its own.
 *
 * @param {string} html
 */
const formulas = html => {
  const template = document.createElement('template')
  template.innerHTML = html
  return [...template.content.querySelectorAll('.katex')].map(formula => {
    const tex = formula.querySelector('annotation')?.textContent?.trim()
    return formula.closest('.katex-display') ? `$$${tex}$$` : `$${tex}$`
  })
}

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

  describe('images', () => {
    // An image is fetched as soon as it is shown, so an address a model was
    // talked into writing would carry the writer's words off unasked.
    it('links to an image rather than showing it', () => {
      expect(renderMarkdown('![a *map*](https://example.com/map.png)')).toBe(
        '<p><a href="https://example.com/map.png">a <em>map</em></a></p>\n'
      )
      expect(renderMarkdown('![](https://example.com/x.png?d=the%20secret)')).toBe(
        '<p><a href="https://example.com/x.png?d=the%20secret">https://example.com/x.png?d=the%20secret</a></p>\n'
      )
    })

    it('links to an image with no scheme, which may still be somewhere else', () => {
      const rendered = renderMarkdown('![](//example.com/x.png) ![](/a.png)')

      expect(rendered).not.toContain('<img')
      expect(rendered).toContain('<a href="//example.com/x.png">')
      expect(rendered).toContain('<a href="/a.png">')
    })

    it('keeps an image’s title on its link', () => {
      expect(renderMarkdown('![map](https://example.com/m.png "The coast")')).toContain(
        'title="The coast"'
      )
    })
  })

  describe('math', () => {
    beforeAll(loadMath)

    it('typesets a formula set on its own, in either delimiter', () => {
      const dollars = renderMarkdown(
        'The answer:\n\n$$E \\approx \\Gamma(1+\\tfrac{1}{k})$$\n\nThat is all.'
      )
      expect(formulas(dollars)).toEqual(['$$E \\approx \\Gamma(1+\\tfrac{1}{k})$$'])
      expect(dollars).toContain('<p>That is all.</p>')

      expect(formulas(renderMarkdown('\\[\nx^2 + y^2 = r^2\n\\]'))).toEqual(['$$x^2 + y^2 = r^2$$'])
    })

    it('ends a paragraph where a formula on its own lines starts', () => {
      // Models put a display formula straight under the line that leads into
      // it, with no blank line between.
      const rendered = renderMarkdown('So:\n$$\nE = mc^2\n$$\nAnd on.')

      expect(rendered).toMatch(/^<p>So:<\/p>\n<span class="katex-display">/)
      expect(formulas(rendered)).toEqual(['$$E = mc^2$$'])
      expect(rendered).toContain('<p>And on.</p>')
    })

    it('typesets a formula in a sentence', () => {
      expect(formulas(renderMarkdown('Both $x^2$ and \\(a_1 + b_2\\) here.'))).toEqual([
        '$x^2$',
        '$a_1 + b_2$',
      ])
      expect(formulas(renderMarkdown('- one $n$\n- two'))).toEqual(['$n$'])
      expect(formulas(renderMarkdown('| a |\n| - |\n| $k$ |'))).toEqual(['$k$'])
    })

    it('leaves money as money', () => {
      // A dollar opens a formula only with something other than a space after
      // it, and closes one only with no space before it and no digit after.
      for (const prose of [
        'It cost $5 and $10 to get in.',
        'From $5-$10 a night.',
        'Somewhere between $ and $$.',
      ]) {
        expect(renderMarkdown(prose)).toBe(`<p>${prose}</p>\n`)
      }
      expect(renderMarkdown('Only \\$5, or $x = \\$5$.')).toMatch(
        /^<p>Only \$5, or <span class="katex">/
      )
    })

    it('leaves code as code', () => {
      expect(renderMarkdown('Type `$x$` here.')).toBe('<p>Type <code>$x$</code> here.</p>\n')
      expect(renderMarkdown('```\n$$x$$\n```')).toBe('<pre><code>$$x$$\n</code></pre>\n')
    })

    it('shows TeX it cannot read as it was written', () => {
      expect(renderMarkdown('See $\\nosuchcommand{x}$.')).toBe('<p>See $\\nosuchcommand{x}$.</p>\n')
      expect(renderMarkdown('$$\n\\frac{1}{\n$$')).toBe('<p>$$\n\\frac{1}{\n$$</p>\n')
    })

    it('does not run past a blank line looking for the end of a formula', () => {
      expect(renderMarkdown('$$ one\n\ntwo $$')).toBe('<p>$$ one</p>\n<p>two $$</p>\n')
    })

    it('makes no links or pictures out of TeX', () => {
      // A model repeats what it was shown, and KaTeX would link and load if it
      // were trusted.
      const rendered = renderMarkdown(
        '$\\href{javascript:boom()}{x}$ $\\url{https://example.com}$ $\\includegraphics{https://example.com/x.png}$ $\\htmlId{boom}{x}$'
      )

      expect(rendered).not.toMatch(/<a |<img |href=|id="boom"/)
    })
  })
})
