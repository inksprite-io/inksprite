/* global TextEncoder */
import { describe, it, expect } from 'vitest'
import { extractPdf, imageDecoderAllowed, joinPages, pageMarker, pageText } from '@/files/pdf.js'
import { minimalPdf } from './helpers.js'

describe('pageText', () => {
  it('joins the runs on a line and breaks where the page did', () => {
    const items = [
      { str: 'Hello ', hasEOL: false },
      { str: 'world', hasEOL: true },
      { str: 'Second', hasEOL: false },
      { str: ' line', hasEOL: true },
    ]
    expect(pageText(items)).toBe('Hello world\nSecond line')
  })

  it('squashes the spacing a layout leaves and the blank lines it stacks', () => {
    const items = [
      { str: 'A   word', hasEOL: true },
      { str: '', hasEOL: true },
      { str: '', hasEOL: true },
      { str: '  B', hasEOL: true },
    ]
    expect(pageText(items)).toBe('A word\n\nB')
  })

  it('skips an item with no text in it', () => {
    expect(pageText([{ hasEOL: true }, { str: 'x' }])).toBe('x')
  })
})

describe('joinPages', () => {
  it('puts each page under its marker', () => {
    expect(joinPages(['one', 'two'])).toBe('[p.1]\none\n\n[p.2]\ntwo')
  })

  it('keeps the marker of a page with nothing on it', () => {
    expect(joinPages(['one', '', 'three'])).toBe('[p.1]\none\n\n[p.2]\n\n[p.3]\nthree')
  })

  it('is nothing at all when no page has text — a scan', () => {
    expect(joinPages(['', '  ', ''])).toBe('')
  })

  it('counts pages from one, as a reader does', () => {
    expect(pageMarker(1)).toBe('[p.1]')
  })
})

describe('extractPdf', () => {
  it('reads the text of every page, each under its marker', async () => {
    const { pages, text } = await extractPdf(
      minimalPdf([['Hello world', 'Second line'], ['Page two']])
    )

    expect(pages).toBe(2)
    expect(text).toBe('[p.1]\nHello world\nSecond line\n\n[p.2]\nPage two')
  })

  it('says a PDF with no text has none, and still how many pages', async () => {
    const { pages, text } = await extractPdf(minimalPdf([[], []]))

    expect(pages).toBe(2)
    expect(text).toBe('')
  })

  it('takes an ArrayBuffer as readily as bytes', async () => {
    const bytes = minimalPdf([['Buffered']])
    const { text } = await extractPdf(bytes.buffer)

    expect(text).toContain('Buffered')
  })

  it('refuses what is not a PDF', async () => {
    await expect(extractPdf(new TextEncoder().encode('not a pdf'))).rejects.toThrow()
  })
})

describe('imageDecoderAllowed', () => {
  const agents = {
    chrome:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
    firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
    safari:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    webkitLinux:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    chromeOnIos:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
    edgeOnIos:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/140.0.0.0 Mobile/15E148 Safari/605.1.15',
  }

  it('lets Chromium browsers and Firefox decode with the browser', () => {
    expect(imageDecoderAllowed(agents.chrome)).toBe(true)
    expect(imageDecoderAllowed(agents.edge)).toBe(true)
    expect(imageDecoderAllowed(agents.firefox)).toBe(true)
  })

  it('keeps WebKit to pdf.js, on any platform and under any name', () => {
    expect(imageDecoderAllowed(agents.safari)).toBe(false)
    expect(imageDecoderAllowed(agents.webkitLinux)).toBe(false)
    expect(imageDecoderAllowed(agents.chromeOnIos)).toBe(false)
    expect(imageDecoderAllowed(agents.edgeOnIos)).toBe(false)
  })
})
