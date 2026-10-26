import { describe, it, expect } from 'vitest'
import { docLinks, linksHere, linksThere } from '@/drive/links.js'
import { docOf, para, run } from './docsHelpers.js'

const docs = [
  { id: 'root_s', parentId: 's', type: 'folder', title: 'Thief' },
  {
    id: 'plan',
    parentId: 'root_s',
    type: 'text',
    title: 'Plan',
    drive: { id: 'doc-1', tabId: 't.0' },
  },
  { id: 'notes', parentId: 'root_s', type: 'folder', title: 'Notes' },
  {
    id: 'cast',
    parentId: 'notes',
    type: 'text',
    title: 'Cast list',
    drive: { id: 'doc-2', tabId: 't.0' },
  },
  { id: 'map', parentId: 'notes', type: 'text', title: 'Map', drive: { id: 'doc-3' } },
  { id: 'loose', parentId: 'notes', type: 'text', title: 'Loose ends' },
]
const byId = new Map(docs.map(doc => [doc.id, doc]))
const tree = {
  get: id => byId.get(id) ?? null,
  childrenOf: parentId => docs.filter(doc => doc.parentId === parentId),
  rootId: 'root_s',
}
const links = docLinks(tree, 'plan')

describe('docLinks', () => {
  it('reads an address of a linked document’s Doc, however written, as the link to it', () => {
    for (const url of [
      'https://docs.google.com/document/d/doc-2/edit',
      'https://docs.google.com/document/d/doc-2/edit?usp=sharing',
      'https://docs.google.com/document/d/doc-2/edit?tab=t.0',
      'https://docs.google.com/document/u/0/d/doc-2/edit',
      'https://docs.google.com/document/d/doc-2',
    ]) {
      expect(links.here(url), url).toBe('Notes/Cast%20list.md')
    }
    // A document linked with no tab named is the Doc's whichever tab.
    expect(links.here('https://docs.google.com/document/d/doc-3/edit?tab=t.0')).toBe('Notes/Map.md')
  })

  it('leaves an address of a Doc no document is linked to, a place in one, or another tab', () => {
    expect(links.here('https://docs.google.com/document/d/doc-9/edit')).toBeNull()
    expect(links.here('https://docs.google.com/document/d/doc-2/edit#heading=h.abc')).toBeNull()
    expect(links.here('https://docs.google.com/document/d/doc-2/edit?tab=t.7')).toBeNull()
    expect(links.here('https://docs.google.com/spreadsheets/d/doc-2/edit')).toBeNull()
    expect(links.here('https://example.com/')).toBeNull()
  })

  it('writes a link to a document with a Doc as its address, and has none for the rest', () => {
    expect(links.there('Notes/Cast%20list.md')).toBe(
      'https://docs.google.com/document/d/doc-2/edit?tab=t.0'
    )
    expect(links.there('Notes/Map.md')).toBe('https://docs.google.com/document/d/doc-3/edit')
    expect(links.there('Notes/Loose%20ends.md')).toBeNull()
    expect(links.there('Notes/Nowhere.md')).toBeNull()
    expect(links.there('https://example.com/')).toBeNull()
  })

  it('reads a link from where the document synced is', () => {
    expect(docLinks(tree, 'cast').here('https://docs.google.com/document/d/doc-1/edit')).toBe(
      '../Plan.md'
    )
  })
})

describe('linksHere and linksThere', () => {
  it('turn a Doc’s links into links here, and requests’ back into addresses', () => {
    const cast = 'https://docs.google.com/document/d/doc-2/edit?usp=sharing'
    const elsewhere = 'https://example.com/'
    const document = docOf([
      para([
        run('See '),
        run('the cast', { link: { url: cast } }),
        run(' and '),
        run('this', { link: { url: elsewhere } }),
      ]),
    ])
    const here = linksHere(document, links)
    const urls = JSON.stringify(here).match(/"url":"[^"]*"/g)
    expect(urls).toEqual(['"url":"Notes/Cast%20list.md"', `"url":"${elsewhere}"`])
    // The Doc as read is left as it was.
    expect(JSON.stringify(document)).toContain(cast)

    const requests = [
      { updateTextStyle: { textStyle: { link: { url: 'Notes/Cast%20list.md' } }, fields: 'link' } },
      {
        updateTextStyle: {
          textStyle: { link: { url: 'Notes/Loose%20ends.md' }, bold: true },
          fields: 'link,bold',
        },
      },
      { updateTextStyle: { textStyle: { link: { url: elsewhere } }, fields: 'link' } },
    ]
    expect(linksThere(requests, links)).toEqual([
      {
        updateTextStyle: {
          textStyle: { link: { url: 'https://docs.google.com/document/d/doc-2/edit?tab=t.0' } },
          fields: 'link',
        },
      },
      { updateTextStyle: { textStyle: { bold: true }, fields: 'link,bold' } },
      { updateTextStyle: { textStyle: { link: { url: elsewhere } }, fields: 'link' } },
    ])
  })
})
