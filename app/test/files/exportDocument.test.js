/* global Blob */
import { describe, it, expect } from 'vitest'
import { unzipSync } from 'fflate'
import { exportDocument } from '@/files/exportDocument.js'

const png = (/** @type {string} */ text) => new Blob([text], { type: 'image/png' })

/** The files in an export's zip, the markdown as text and the rest as theirs. */
const unzipped = async (/** @type {Blob} */ blob) => {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  return Object.fromEntries(
    Object.entries(files).map(([path, bytes]) => [path, new TextDecoder().decode(bytes)])
  )
}

describe('exportDocument', () => {
  it('hands out a document with no pictures as its markdown file', async () => {
    const { blob, filename } = await exportDocument(
      { title: 'Prologue' },
      'The gate.',
      async () => null
    )
    expect(filename).toBe('Prologue.md')
    expect(blob.type).toBe('text/markdown')
    expect(await blob.text()).toBe('The gate.')
  })

  it('hands it out as its text stands, its comments kept and its suggestions left out', async () => {
    const markdown =
      'A {--cold--}{>>sabcd1<<}{++warm++}{>>sabcd1<<} {==night==}{>>cabcd1<<}.\n\n{++Gulls.++}{>>sabcd2<<}'
    const { blob } = await exportDocument({ title: 'Prologue' }, markdown, async () => null)
    expect(await blob.text()).toBe('A cold {==night==}{>>cabcd1<<}.')
    // A plain document is handed out as typed.
    const plain = await exportDocument({ title: 'Prompt', plain: true }, markdown, async () => null)
    expect(await plain.blob.text()).toBe(markdown)
  })

  it('hands out one with pictures as a zip, the pictures in images beside it', async () => {
    const text = [
      'The gate ![](.images/doc_a1/gate.png) shut.',
      '![A map](.images/doc_a1/market%20map.png)',
      '![](https://example.com/web.png) and ![](.images/doc_a1/gone.png)',
    ].join('\n\n')
    const kept = { 'doc_a1/gate.png': png('gate'), 'doc_a1/market map.png': png('map') }
    const { blob, filename } = await exportDocument({ title: 'Prologue' }, text, async key =>
      key in kept ? kept[/** @type {keyof typeof kept} */ (key)] : null
    )

    expect(filename).toBe('Prologue.zip')
    expect(blob.type).toBe('application/zip')
    expect(await unzipped(blob)).toEqual({
      'Prologue.md': [
        'The gate ![](images/gate.png) shut.',
        '![A map](images/market%20map.png)',
        // A picture with no bytes, and one on the web, stay as they were.
        '![](https://example.com/web.png) and ![](.images/doc_a1/gone.png)',
      ].join('\n\n'),
      'images/gate.png': 'gate',
      'images/market map.png': 'map',
    })
  })

  it("numbers another document's picture that shares a name with one of its own", async () => {
    const text = '![](.images/doc_a1/gate.png) ![](.images/doc_b2/gate.png)'
    const { blob } = await exportDocument({ title: 'Prologue' }, text, async key => png(key))
    const files = await unzipped(blob)
    expect(files['Prologue.md']).toBe('![](images/gate.png) ![](images/gate%20%282%29.png)')
    expect(Object.keys(files).sort()).toEqual(
      ['Prologue.md', 'images/gate (2).png', 'images/gate.png'].sort()
    )
  })
})
