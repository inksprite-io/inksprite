import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PAGE_CLASS, printPage } from '@/files/printPage.js'

/** A picture's address, for one the test has bytes for. */
const shown = async (/** @type {string} */ src) => (src.includes('map') ? 'blob:map' : null)

// jsdom says it supports everything; a browser that can't clone a page's edges is the plain case.
beforeEach(() => {
  vi.stubGlobal('CSS', { supports: () => false })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('printPage', () => {
  it('draws the text as it stands, in the editor’s classes', async () => {
    const page = await printPage(
      'A {--cold--}{>>sabcd1<<}{++warm++}{>>sabcd1<<} {==night==}{>>cabcd1<<}.\n\n# The gate',
      shown
    )
    expect(page.className).toBe(PAGE_CLASS)
    expect(page.ownerDocument).toBe(document)
    expect(page.innerHTML).toBe('<p>A cold night.</p><h1>The gate</h1>')
  })

  it('keeps a link to a site, and a link to a document as its words', async () => {
    const page = await printPage(
      'See [the map](https://example.com/map), [the plan](../Notes/Plan.md) and [above](#the-gate).',
      shown
    )
    expect(page.innerHTML).toBe(
      '<p>See <a href="https://example.com/map">the map</a>, the plan and above.</p>'
    )
  })

  it('shows a picture from the address it is given, and leaves out one with none', async () => {
    const picture = vi.fn(shown)
    const page = await printPage(
      '![The map](.images/doc_1/map.png)\n\nA hill ![](https://example.com/hill.png) behind.',
      picture
    )
    expect(picture.mock.calls).toEqual([
      ['.images/doc_1/map.png'],
      ['https://example.com/hill.png'],
    ])
    expect(page.innerHTML).toBe(
      '<p class="figure"><img src="blob:map" alt="The map"></p><p>A hill  behind.</p>'
    )
  })

  it('makes no figure of a picture that has words beside it', async () => {
    const page = await printPage('The ![map](.images/doc_1/map.png) here.', shown)
    expect(page.querySelector('p')?.classList.contains('figure')).toBe(false)
  })

  it('brings its own room above and below each page where that can be cloned', async () => {
    const supports = vi.fn(() => true)
    vi.stubGlobal('CSS', { supports })
    const page = await printPage('The gate.', shown)
    expect(supports).toHaveBeenCalledWith('box-decoration-break', 'clone')
    expect(page.classList.contains('paged')).toBe(true)
    expect(page.innerHTML).toBe(
      '<p>The gate.</p><style>@page { margin-top: 0; margin-bottom: 0; }</style>'
    )

    vi.stubGlobal('CSS', { supports: () => false })
    const plain = await printPage('The gate.', shown)
    expect(plain.classList.contains('paged')).toBe(false)
    expect(plain.innerHTML).toBe('<p>The gate.</p>')
  })
})
