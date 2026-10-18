/* global TextEncoder */
import { describe, it, expect } from 'vitest'
import { docxToMarkdown, isDocx, DOCX_MIME } from '@/files/docx.js'
import { barePng, minimalDocx } from './helpers.js'

/** A run of text. */
const run = text => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`
/** A run of text with properties: `<w:b/>`, `<w:i/>`. */
const styled = (text, props) => `<w:r><w:rPr>${props}</w:rPr><w:t>${text}</w:t></w:r>`
/** A paragraph, with properties if given. */
const paragraph = (inner, props = '') =>
  `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${inner}</w:p>`
/** An item of the bulleted list (1) or the numbered one (2). */
const item = (text, list) =>
  paragraph(run(text), `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${list}"/></w:numPr>`)
/** A table of paragraphs, a row to an array. */
const table = rows =>
  `<w:tbl>${rows
    .map(
      cells => `<w:tr>${cells.map(cell => `<w:tc>${paragraph(run(cell))}</w:tc>`).join('')}</w:tr>`
    )
    .join('')}</w:tbl>`
/** A picture, in a paragraph of its own. */
const picture = (id, alt) =>
  paragraph(
    `<w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture" descr="${alt}"/><a:graphic>` +
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
      `<pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>` +
      '</wp:inline></w:drawing></w:r>'
  )

/** @param {Uint8Array} bytes */
const bufferOf = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

describe('docxToMarkdown', () => {
  it('reads headings, emphasis, links, lists and tables as markdown', async () => {
    const docx = minimalDocx(
      paragraph(run('The Keeper’s Log'), '<w:pStyle w:val="Heading1"/>') +
        paragraph(
          run('The lamp was ') +
            styled('lit', '<w:b/>') +
            run(' at ') +
            styled('dusk', '<w:i/>') +
            run('.')
        ) +
        paragraph(
          run('See the ') +
            '<w:hyperlink r:id="rTides"><w:r><w:t>tide tables</w:t></w:r></w:hyperlink>' +
            run(' and ') +
            '<w:hyperlink w:anchor="stores"><w:r><w:t>the stores</w:t></w:r></w:hyperlink>' +
            run('.')
        ) +
        item('Oil', 1) +
        item('Wicks', 1) +
        item('Climb', 2) +
        item('Light', 2) +
        table([
          ['Night', 'Hours'],
          ['Monday', '9'],
        ]),
      { links: { rTides: 'https://example.com/tides' } }
    )

    const { markdown, pictures } = await docxToMarkdown(bufferOf(docx))

    expect(markdown).toBe(
      [
        '# The Keeper’s Log',
        'The lamp was **lit** at *dusk*.',
        // A link into the file itself has nowhere to go in a document.
        'See the [tide tables](https://example.com/tides) and the stores.',
        '- Oil\n- Wicks',
        '1. Climb\n2. Light',
        '| Night | Hours |\n| --- | --- |\n| Monday | 9 |',
      ].join('\n\n')
    )
    expect(pictures).toEqual([])
  })

  it('takes each picture out, its bytes kept and a marker left where it was', async () => {
    const docx = minimalDocx(
      paragraph(run('Before.')) +
        picture('rGull', 'A gull') +
        picture('rBoat', 'A boat') +
        paragraph(run('After.')),
      { images: { rGull: barePng(), rBoat: barePng() } }
    )

    const { markdown, pictures } = await docxToMarkdown(bufferOf(docx))

    expect(markdown).toBe(
      'Before.\n\n![A gull](inksprite-picture-1)\n\n![A boat](inksprite-picture-2)\n\nAfter.'
    )
    expect(pictures.map(({ marker, mime }) => ({ marker, mime }))).toEqual([
      { marker: 'inksprite-picture-1', mime: 'image/png' },
      { marker: 'inksprite-picture-2', mime: 'image/png' },
    ])
    expect(Array.from(pictures[0].bytes)).toEqual(Array.from(barePng()))
  })

  it('keeps footnotes at the end, without the links back up', async () => {
    const docx = minimalDocx(
      paragraph(run('Whale oil') + '<w:r><w:footnoteReference w:id="1"/></w:r>' + run(' burned.')),
      { footnotes: { 1: 'Later paraffin.' } }
    )

    const { markdown } = await docxToMarkdown(bufferOf(docx))

    expect(markdown).toContain('Later paraffin.')
    expect(markdown).not.toContain('↑')
  })

  it('says plainly when a file is not one it can read', async () => {
    await expect(docxToMarkdown(new TextEncoder().encode('not a zip').buffer)).rejects.toThrow(
      'Couldn’t read the Word file'
    )
  })
})

describe('isDocx', () => {
  it('knows a Word file by its type or its name', () => {
    expect(isDocx({ name: 'Notes', type: DOCX_MIME })).toBe(true)
    expect(isDocx({ name: 'Notes.DOCX', type: '' })).toBe(true)
    expect(isDocx({ name: 'Notes.doc', type: 'application/msword' })).toBe(false)
  })
})
