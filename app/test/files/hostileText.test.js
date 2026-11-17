// @vitest-environment node
/* global performance */
import { describe, it, expect } from 'vitest'
import { uncomment } from '@/cards/card.js'
import { withoutHead } from '@/files/html.js'
import { readToc } from '@/files/epub.js'

/** How long a call takes, in ms. */
const timed = run => {
  const started = performance.now()
  run()
  return performance.now() - started
}

/** A megabyte of one piece of text, over and over. */
const repeated = piece => piece.repeat(Math.ceil((1024 * 1024) / piece.length))

/** Far under what going over the text once for each opener takes: minutes. */
const SOON = 2000

describe('uncomment', () => {
  /**
   * The same reading, written as one pattern: a comment runs from `{{//` to
   * the first `}}`, and takes its line with it when it has the line to itself.
   */
  const plainly = value =>
    value.replace(
      /([ \t]*)\{\{\/\/(?:(?!\}\})[\s\S])*\}\}([ \t]*)(\r?\n)?/g,
      (match, before, spaces, newline, offset) => {
        const starts = offset === 0 || value[offset - 1] === '\n'
        const ends = newline !== undefined || offset + match.length === value.length
        return starts && ends ? '' : `${before}${spaces}${newline ?? ''}`
      }
    )

  it('takes out what a plain reading takes out, whatever the text', () => {
    const pieces = ['{{//', '}}', ' ', '\t', '\n', '\r\n', 'a', 'note', '{{user}}', '{', '}', '/']
    // The same every run: a generator seeded by hand.
    let seed = 12345
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648)
    for (let run = 0; run < 3000; run++) {
      let text = ''
      for (let length = next() % 14; length > 0; length--) text += pieces[next() % pieces.length]
      expect(uncomment(text), JSON.stringify(text)).toBe(plainly(text))
    }
  })

  it('leaves what follows a comment on its line, a macro among it', () => {
    // Read as two patterns, the first took the whole line where it ended in `}}`.
    expect(uncomment('{{// note}} Wren greets {{user}}\nNext.')).toBe(
      ' Wren greets {{user}}\nNext.'
    )
  })

  it('takes a comment out of a line, and the line with one that has it to itself', () => {
    expect(uncomment('Wren. {{// tweak this}}A thief.')).toBe('Wren. A thief.')
    expect(uncomment('Wren.\n  {{// tweak\nthis}}  \nA thief.')).toBe('Wren.\nA thief.')
    expect(uncomment('{{// never closed')).toBe('{{// never closed')
    expect(uncomment('')).toBe('')
  })

  it('reads a field of nothing but comments begun and never ended, once', () => {
    const field = repeated('{{// ')
    expect(timed(() => expect(uncomment(field)).toBe(field))).toBeLessThan(SOON)
    const ended = repeated('{{// note }} word ')
    expect(timed(() => uncomment(ended))).toBeLessThan(SOON)
  })
})

describe('withoutHead', () => {
  it('takes the head out, whatever its case, and leaves a page without one as it is', () => {
    expect(
      withoutHead('<html><HEAD lang="en"><link href="x.css"></Head><body>Hi</body></html>')
    ).toBe('<html><body>Hi</body></html>')
    expect(withoutHead('<p>No head here</p>')).toBe('<p>No head here</p>')
    expect(withoutHead('<head><title>Never closed')).toBe('<head><title>Never closed')
    expect(withoutHead('<header>Not a head</header>')).toBe('<header>Not a head</header>')
  })

  it('reads a page of heads begun and never ended, once', () => {
    const page = repeated('<head ')
    expect(timed(() => expect(withoutHead(page)).toBe(page))).toBeLessThan(SOON)
  })
})

describe('readToc', () => {
  it('reads a nav of links begun and never ended, once, and finds nothing in it', () => {
    for (const piece of ['<a href="x">', '<span>', '<li ', '<nav>', '<a ']) {
      const nav = `<nav epub:type="toc"><ol>${repeated(piece)}</ol></nav>`
      expect(
        timed(() => readToc(nav, 'nav.xhtml')),
        piece
      ).toBeLessThan(SOON)
    }
  })

  it('reads an NCX of labels begun and never ended, once', () => {
    const ncx = `<ncx><navMap>${repeated('<navPoint><navLabel><text>')}</navMap></ncx>`
    expect(timed(() => readToc(ncx, 'toc.ncx'))).toBeLessThan(SOON)
  })

  it('still reads a nav and an NCX as written', () => {
    const nav =
      '<nav epub:type="toc"><ol><li><a href="one.xhtml#top">One</a><ol><li><a href="two.xhtml">Two</a></li></ol></li><li><span>Part</span><ol><li><a href="three.xhtml">Three</a></li></ol></li></ol></nav>'
    expect(readToc(nav, 'OEBPS/nav.xhtml')).toEqual([
      {
        title: 'One',
        path: 'OEBPS/one.xhtml',
        fragment: 'top',
        children: [{ title: 'Two', path: 'OEBPS/two.xhtml', fragment: '', children: [] }],
      },
      {
        title: 'Part',
        path: 'OEBPS/three.xhtml',
        fragment: '',
        children: [{ title: 'Three', path: 'OEBPS/three.xhtml', fragment: '', children: [] }],
      },
    ])
    const ncx =
      '<ncx><navMap><navPoint><navLabel><text>One</text></navLabel><content src="one.xhtml"/></navPoint></navMap></ncx>'
    expect(readToc(ncx, 'toc.ncx')).toEqual([
      { title: 'One', path: 'one.xhtml', fragment: '', children: [] },
    ])
  })
})
