/* global File */
import { describe, it, expect } from 'vitest'
import { textOfHtml } from '@/files/html.js'
import { inspectFile } from '@/files/inspect.js'

const PAGE = `<!DOCTYPE html><html><head><title>Cycles and Journeys</title>
<style>body { color: red }</style><script>track()</script></head>
<body><nav><a href="/">Home</a> · <a href="/posts">Posts</a></nav>
<header><h1>Lost Garden</h1></header>
<article><h2>Cycles and Journeys</h2>
<p>A <em>loop</em> is a repeated&nbsp;cycle.   An arc is <b>not</b>.</p>
<ul><li>One</li><li>Two</li></ul>
<pre>  indented
code</pre></article>
<footer>© 2012</footer></body></html>`

describe('textOfHtml', () => {
  it('keeps the words and the breaks between blocks, and drops the page around them', () => {
    const text = textOfHtml(PAGE)

    // The title is the heading already, so it is not said twice.
    expect(text).toBe(
      'Cycles and Journeys\n\nA loop is a repeated cycle. An arc is not.\n\nOne\n\nTwo\n\nindented\ncode'
    )
    expect(text).not.toContain('color: red')
    expect(text).not.toContain('track()')
    expect(text).not.toContain('Home')
    expect(text).not.toContain('Lost Garden')
    expect(text).not.toContain('2012')
  })

  it('puts the title first only when the body does not start with it', () => {
    expect(textOfHtml('<title>Same</title><p>Same words</p>')).toBe('Same words')
    expect(textOfHtml('<title>Title</title><p>Words</p>')).toBe('Title\n\nWords')
    expect(textOfHtml('<p>No title</p>')).toBe('No title')
  })
})

describe('inspectFile on a web page', () => {
  it('reads the words out of a saved page rather than its source', async () => {
    const found = await inspectFile(new File([PAGE], 'loops.html', { type: 'text/html' }))

    expect(found.mime).toBe('text/html')
    expect(found.text).toContain('An arc is not.')
    expect(found.text).not.toContain('<p>')
  })
})
