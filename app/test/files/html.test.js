/* global File */
import { describe, it, expect } from 'vitest'
import { markdownOfHtml, textOfHtml } from '@/files/html.js'
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

describe('markdownOfHtml', () => {
  const SAVED = `<!DOCTYPE html><html><head><title>Harbour notes</title>
<link rel="stylesheet" href="https://example.com/site.css"><script src="https://example.com/a.js"></script></head>
<body><nav><a href="/">Home</a></nav><header>Site name</header>
<main><h1>Harbour notes</h1>
<p>The ferry leaves at <strong>six</strong>, <em>weather allowing</em>.</p>
<p>See <a href="https://example.com/timetable">the timetable</a>, <a href="/fares">the fares</a>
and <a href="#tides">the tides</a>. Write to <a href="mailto:harbour@example.com">the office</a>.</p>
<img src="https://example.com/boat.png" alt="A boat"><video src="clip.mp4">No video here.</video>
<ol><li>Buy a ticket</li><li>Board</li></ol>
<table><tr><th>Day</th><th>Sailings</th></tr><tr><td>Monday</td><td>3</td></tr></table>
<script>track()</script><form><input value="Subscribe"></form></main>
<footer>Small print</footer></body></html>`

  it('keeps the article as markdown and drops the page around it', () => {
    const markdown = markdownOfHtml(SAVED)

    expect(markdown).toBe(
      [
        '# Harbour notes',
        'The ferry leaves at **six**, *weather allowing*.',
        'See [the timetable](https://example.com/timetable), the fares and the tides. Write to [the office](mailto:harbour@example.com).',
        '1. Buy a ticket\n2. Board',
        '| Day | Sailings |\n| --- | --- |\n| Monday | 3 |',
      ].join('\n\n')
    )
  })

  it('leaves nothing that could run or load', () => {
    const markdown = markdownOfHtml(SAVED)

    for (const gone of ['track()', 'a.js', 'site.css', 'boat.png', 'No video', 'Subscribe']) {
      expect(markdown).not.toContain(gone)
    }
    expect(markdown).not.toContain('Home')
    expect(markdown).not.toContain('Small print')
  })

  it('has nothing to say of a page with no words', () => {
    expect(markdownOfHtml('<html><body><img src="a.png"><script>x()</script></body></html>')).toBe(
      ''
    )
  })
})
