/* global Response */
import { describe, it, expect, vi } from 'vitest'

const fetch = vi.hoisted(() => vi.fn())
vi.mock('@/platform/fetch.js', () => ({ fetch }))

const { pageOfHtml, readDirect } = await import('@/web/direct.js')

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

    expect(await readDirect('https://example.org/a.txt', {})).toEqual({ text: 'Just words.' })
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

  it('says what it cannot read', async () => {
    fetch.mockResolvedValue(
      new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } })
    )

    await expect(readDirect('https://example.org/a.pdf', {})).rejects.toThrow(
      'is not a page that can be read here (application/pdf)'
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
