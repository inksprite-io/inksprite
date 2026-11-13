import { describe, it, expect } from 'vitest'
import { render, select } from '@/components/common/welcome/markdown.js'

const lines = (/** @type {string[]} */ ...text) => text.join('\n')

describe("the welcome's Markdown", () => {
  describe('parts shown some of the time', () => {
    // As Prettier lays them out: a blank line either side of each comment.
    const source = lines(
      'Always.',
      '',
      '<!-- if one -->',
      '',
      'One.',
      '',
      '<!-- if two -->',
      '',
      'Two.',
      '',
      '<!-- end -->',
      '<!-- end -->',
      '',
      'After.'
    )

    it('keeps a part whose name is true, and leaves out one whose name is false', () => {
      expect(render(source, { when: { one: true, two: false } })).toBe(
        '<p>Always.</p>\n<p>One.</p>\n<p>After.</p>\n'
      )
      expect(render(source, { when: { one: true, two: true } })).toBe(
        '<p>Always.</p>\n<p>One.</p>\n<p>Two.</p>\n<p>After.</p>\n'
      )
    })

    it('leaves out a part inside one left out', () => {
      expect(render(source, { when: { one: false, two: true } })).toBe(
        '<p>Always.</p>\n<p>After.</p>\n'
      )
    })

    it('keeps a paragraph whole around a part inside it', () => {
      const line = '**A warning.** <!-- if more -->And more.<!-- end -->'
      expect(render(line, { when: { more: true } })).toBe(
        '<p><strong>A warning.</strong> And more.</p>\n'
      )
      expect(render(line, { when: { more: false } })).toBe('<p><strong>A warning.</strong></p>\n')
    })

    it('stands between blocks on a line of its own, as a preview shows it', () => {
      expect(
        render(lines('First.', '<!-- if on -->', 'Second.', '<!-- end -->'), { when: { on: true } })
      ).toBe('<p>First.</p>\n<p>Second.</p>\n')
    })

    it('keeps a quote whole around a part on lines of the quote, as Prettier lays it out', () => {
      const quote = lines(
        '> First.',
        '>',
        '> <!-- if more -->',
        '>',
        '> Second.',
        '>',
        '> <!-- end -->'
      )
      /** Each quote's paragraphs. */
      const quotes = (/** @type {boolean} */ more) => {
        const root = document.createElement('div')
        root.innerHTML = render(quote, { when: { more } })
        return [...root.children].map(child =>
          [...child.querySelectorAll('p')].map(p => p.textContent)
        )
      }
      expect(quotes(true)).toEqual([['First.', 'Second.']])
      expect(quotes(false)).toEqual([['First.']])
    })

    it('leaves out the notes to whoever edits the file', () => {
      expect(render(lines('<!--', 'A note, if any.', '-->', '', 'Text.'))).toBe('<p>Text.</p>\n')
      expect(render('Text. <!-- a note -->')).toBe('<p>Text.</p>\n')
    })

    it('throws on a part nobody named, so a slip fails the tests', () => {
      expect(() => select(source, { one: true })).toThrow('No part is called "two".')
    })

    it('throws on an end without an if, and an if without an end', () => {
      expect(() => select('<!-- end -->', {})).toThrow('closes no part')
      expect(() => select('<!-- if one -->', { one: true })).toThrow('never closed')
    })
  })

  it('opens a link in a tab of its own', () => {
    expect(render('[the guide](https://example.com/guide)')).toBe(
      '<p><a href="https://example.com/guide" target="_blank" rel="noopener noreferrer">the guide</a></p>\n'
    )
  })

  describe('alerts', () => {
    /** The rendered Markdown, as elements. */
    const dom = (/** @type {string} */ source) => {
      const root = document.createElement('div')
      root.innerHTML = render(source)
      return root
    }

    /** An alert's title and the text of each paragraph after it. */
    const alert = (/** @type {HTMLElement} */ root) => {
      const [title, ...body] = root.querySelectorAll('[data-alert] > p')
      return { title: title.textContent, body: body.map(p => p.textContent) }
    }

    it("makes a quote that opens with [!NOTE] a note, as GitHub's example has it", () => {
      // GitHub's example ends the word's line in two spaces, a hard break.
      const root = dom('> [!NOTE]  \n> Highlights information to take into account.')
      expect(root.querySelector('[data-alert]').getAttribute('data-alert')).toBe('note')
      expect(alert(root)).toEqual({
        title: 'Note',
        body: ['Highlights information to take into account.'],
      })
      expect(root.querySelector('blockquote, br')).toBeNull()
    })

    it('knows the five, whatever their case', () => {
      const titles = ['NOTE', 'Tip', 'important', 'WARNING', 'caution'].map(
        word => alert(dom(`> [!${word}]\n> Text.`)).title
      )
      expect(titles).toEqual(['Note', 'Tip', 'Important', 'Warning', 'Caution'])
    })

    it('starts at the next paragraph when the word stands alone', () => {
      expect(alert(dom('> [!TIP]\n>\n> First.\n>\n> Second.'))).toEqual({
        title: 'Tip',
        body: ['First.', 'Second.'],
      })
    })

    it('keeps the links and emphasis in its first paragraph', () => {
      const root = dom('> [!CAUTION]\n> Read [the terms](https://example.com/terms) **first**.')
      expect(root.querySelector('[data-alert] a').getAttribute('target')).toBe('_blank')
      expect(root.querySelector('[data-alert] strong').textContent).toBe('first')
    })

    it('leaves a quote a quote when the word shares its line, or is no alert', () => {
      for (const source of [
        '> [!NOTE] Text on the same line.',
        '> [!DANGER]\n> Text.',
        '> Said.',
      ]) {
        const root = dom(source)
        expect(root.querySelector('[data-alert]'), source).toBeNull()
        expect(root.querySelector('blockquote'), source).not.toBeNull()
      }
    })

    it('can be a part shown only some of the time', () => {
      const source = '<!-- if risky -->\n\n> [!WARNING]\n> Careful.\n\n<!-- end -->'
      expect(render(source, { when: { risky: false } })).not.toContain('Careful')
      expect(render(source, { when: { risky: true } })).toContain('data-alert="warning"')
    })
  })

  it('escapes HTML in the text', () => {
    expect(render('<b>bold</b>')).toBe('<p>&lt;b&gt;bold&lt;/b&gt;</p>\n')
  })
})
