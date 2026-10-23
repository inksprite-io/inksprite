/* global Response */
import { describe, it, expect, vi } from 'vitest'
import { barePng, minimalPdf } from '../files/helpers.js'

const fetch = vi.hoisted(() => vi.fn())
vi.mock('@/platform/fetch.js', () => ({ fetch }))

const { FILE_BYTES, fetchDirect, fileNameOf, pageOfHtml, readDirect } = await import(
  '@/web/direct.js'
)

/** A made-up page, with the parts that are never the article. */
const html = `<!doctype html><html><head><title>Harbour notes</title><style>p{}</style></head>
<body>
  <header><nav><a href="/">Home</a></nav></header>
  <article>
    <h1>The old mole</h1>
    <p>The mole was built of granite in three seasons, and its <a href="/history">history</a> is long.</p>
    <ul><li>First season: the footing.</li><li>Second season: the wall.</li></ul>
    <p>${'More about the stones. '.repeat(30)}</p>
    <img src="mole.jpg" alt="The mole">
  </article>
  <footer>Copyright nobody</footer>
  <script>track()</script>
</body></html>`

describe('pageOfHtml', () => {
  it('makes the article markdown, its links whole, the rest of the page left out', () => {
    const page = pageOfHtml(html, 'https://example.org/notes/mole')

    expect(page.title).toBe('Harbour notes')
    expect(page.text).toContain('# The old mole')
    expect(page.text).toContain('[history](https://example.org/history)')
    expect(page.text).toMatch(/^[-*] First season: the footing\.$/m)
    for (const left of ['Home', 'Copyright', 'track()', 'p{}', 'mole.jpg']) {
      expect(page.text).not.toContain(left)
    }
  })

  it('reads the whole page when its article is only a teaser', () => {
    const page = pageOfHtml(
      '<html><body><article><p>Short.</p></article><p>The rest of the page.</p></body></html>',
      'https://example.org'
    )

    expect(page.text).toContain('The rest of the page.')
  })
})

// Each test sets the answer it needs. A hook that clears the mock would make
// a failure thrown from it count against the test even once it is caught.
describe('readDirect', () => {
  it('reads a page from its site as markdown', async () => {
    fetch.mockResolvedValue(
      new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    )

    const page = await readDirect('https://example.org/notes/mole', {})

    expect(page.title).toBe('Harbour notes')
    expect(page.text).toContain('granite')
  })

  it('takes plain text as it is', async () => {
    fetch.mockResolvedValue(
      new Response('Just words.', { status: 200, headers: { 'content-type': 'text/plain' } })
    )

    const page = await readDirect('https://example.org/a.txt', {})

    expect(page.text).toBe('Just words.')
    expect(page.file?.name).toBe('a.txt')
  })

  it('reads a PDF as its text, and keeps the file', async () => {
    fetch.mockResolvedValue(
      new Response(minimalPdf([['Fractions on a number line'], ['Grade four standards']]), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      })
    )

    const page = await readDirect('https://example.org/files/maths-standards.pdf', {})

    expect(page.title).toBe('maths-standards')
    expect(page.text).toContain('[p.1]')
    expect(page.text).toContain('Fractions on a number line')
    expect(page.text).toContain('Grade four standards')
    expect(page.file?.name).toBe('maths-standards.pdf')
    expect(page.file?.type).toBe('application/pdf')
  })

  it('says a page is not there, or would not be read', async () => {
    fetch.mockResolvedValueOnce(new Response('', { status: 404 }))
    await expect(readDirect('https://example.org/gone', {})).rejects.toThrow(
      'There is no page at https://example.org/gone (404).'
    )

    fetch.mockResolvedValueOnce(new Response('', { status: 403 }))
    await expect(readDirect('https://example.org/shut', {})).rejects.toThrow(
      'https://example.org/shut would not be read (403).'
    )
  })

  it('says a file has no text to read, and that it can still be kept', async () => {
    fetch.mockResolvedValue(
      new Response(barePng(), { status: 200, headers: { 'content-type': 'image/png' } })
    )

    await expect(readDirect('https://example.org/map.png', {})).rejects.toThrow(
      'https://example.org/map.png is a PNG file with no text to read. save_web_page can still keep the file.'
    )
  })

  it('says a file that will not open', async () => {
    fetch.mockResolvedValue(
      new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } })
    )

    await expect(readDirect('https://example.org/a.pdf', {})).rejects.toThrow(
      'https://example.org/a.pdf is a file that couldn’t be opened.'
    )
  })

  it('says a site that could not be reached', async () => {
    fetch.mockImplementation(async () => {
      throw new TypeError('Failed to fetch')
    })

    const failure = await readDirect('https://example.org', {}).catch(error => error)

    expect(failure.message).toBe('https://example.org couldn’t be reached.')
  })
})

describe('fetchDirect', () => {
  it('fetches a page as markdown and anything else as the file it is', async () => {
    fetch.mockResolvedValueOnce(
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
    )
    const page = await fetchDirect('https://example.org/notes/mole', {})
    expect('page' in page && page.page.title).toBe('Harbour notes')

    fetch.mockResolvedValueOnce(
      new Response(minimalPdf([['A page']]), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      })
    )
    const file = await fetchDirect('https://example.org/a.pdf', {})
    expect('file' in file && file.file.name).toBe('a.pdf')
  })

  it('takes an untyped answer for a page when it reads like one, and for a file otherwise', async () => {
    fetch.mockResolvedValueOnce(
      new Response(html, { status: 200, headers: { 'content-type': '' } })
    )
    expect('page' in (await fetchDirect('https://example.org/notes/mole', {}))).toBe(true)

    fetch.mockResolvedValueOnce(
      new Response(minimalPdf([['A page']]), { status: 200, headers: { 'content-type': '' } })
    )
    const file = await fetchDirect('https://example.org/papers/survey.pdf', {})
    expect('file' in file && file.file.type).toBe('application/pdf')
  })

  it('refuses a file too big to fetch', async () => {
    fetch.mockResolvedValue(
      new Response('', {
        status: 200,
        headers: { 'content-type': 'application/pdf', 'content-length': String(FILE_BYTES + 1) },
      })
    )

    await expect(fetchDirect('https://example.org/huge.pdf', {})).rejects.toThrow(
      'https://example.org/huge.pdf is too big to fetch here.'
    )
  })
})

describe('fileNameOf', () => {
  it('takes the name the site gives', () => {
    expect(
      fileNameOf('https://example.org/get?id=4', 'attachment; filename="Unit 3.pdf"', '')
    ).toBe('Unit 3.pdf')
    expect(
      fileNameOf('https://example.org/get', "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf", '')
    ).toBe('résumé.pdf')
  })

  it('takes the end of the address, with the extension its type has', () => {
    expect(
      fileNameOf('https://example.org/files/standards%20maths.pdf', null, 'application/pdf')
    ).toBe('standards maths.pdf')
    expect(fileNameOf('https://example.org/download/42', null, 'application/pdf')).toBe('42.pdf')
    expect(fileNameOf('https://example.org/', null, '')).toBe('example.org')
  })
})
