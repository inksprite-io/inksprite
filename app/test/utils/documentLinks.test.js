import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '@/editor/markdown.js'
import {
  documentNamed,
  fileNameOf,
  hrefFor,
  projectHref,
  isDocumentHref,
  readableHref,
  resolveLink,
} from '@/utils/documentLinks.js'

const docs = [
  { id: 'root_s', parentId: 's', type: 'folder', title: 'Novel' },
  { id: 'notes', parentId: 'root_s', type: 'folder', title: 'Notes' },
  { id: 'cast', parentId: 'notes', type: 'text', title: 'Cast list' },
  { id: 'qa', parentId: 'notes', type: 'text', title: 'Q&A: the ending' },
  { id: 'paper', parentId: 'notes', type: 'file', title: 'Tide tables', mime: 'application/pdf' },
  { id: 'drafts', parentId: 'root_s', type: 'folder', title: 'Drafts', ordered: true },
  { id: 'one', parentId: 'drafts', type: 'text', title: 'Chapter 1' },
  { id: 'two', parentId: 'drafts', type: 'text', title: 'Chapter 2' },
  { id: 'top', parentId: 'root_s', type: 'text', title: 'Outline' },
  { id: 'deep', parentId: 'notes', type: 'folder', title: 'Places' },
  { id: 'harbour', parentId: 'deep', type: 'text', title: 'The harbour' },
]
const byId = new Map(docs.map(doc => [doc.id, doc]))
const tree = {
  get: id => byId.get(id) ?? null,
  childrenOf: parentId => docs.filter(doc => doc.parentId === parentId),
  rootId: 'root_s',
}
const resolved = (href, fromId) => resolveLink(tree, href, fromId)?.id ?? null

describe('isDocumentHref', () => {
  it('takes a link without a scheme for one to a document', () => {
    expect(isDocumentHref('../Notes/Cast%20list.md')).toBe(true)
    expect(isDocumentHref('Notes/Cast list')).toBe(true)
    expect(isDocumentHref('/Outline')).toBe(true)
    expect(isDocumentHref('<../Notes/Cast list.md>')).toBe(true)
  })

  it('leaves web and mail addresses, and nothing, to the rest of the app', () => {
    expect(isDocumentHref('https://example.com/a b')).toBe(false)
    expect(isDocumentHref('mailto:someone@example.com')).toBe(false)
    expect(isDocumentHref('//example.com/page')).toBe(false)
    expect(isDocumentHref('')).toBe(false)
    expect(isDocumentHref(undefined)).toBe(false)
  })
})

describe('fileNameOf', () => {
  it('names a document as its file is named on disk', () => {
    expect(fileNameOf(byId.get('cast'))).toBe('Cast list.md')
    expect(fileNameOf(byId.get('qa'))).toBe('Q&A- the ending.md')
    expect(fileNameOf(byId.get('paper'))).toBe('Tide tables.pdf')
    expect(fileNameOf(byId.get('notes'))).toBe('Notes')
  })
})

describe('hrefFor', () => {
  it('writes a link from the linking document, with the extension and spaces encoded', () => {
    expect(hrefFor(tree, 'one', 'cast')).toBe('../Notes/Cast%20list.md')
    expect(hrefFor(tree, 'one', 'two')).toBe('Chapter%202.md')
    expect(hrefFor(tree, 'top', 'harbour')).toBe('Notes/Places/The%20harbour.md')
    expect(hrefFor(tree, 'harbour', 'top')).toBe('../../Outline.md')
    expect(hrefFor(tree, 'harbour', 'cast')).toBe('../Cast%20list.md')
    expect(hrefFor(tree, 'one', 'paper')).toBe('../Notes/Tide%20tables.pdf')
  })

  it('writes the name a title takes on disk', () => {
    expect(hrefFor(tree, 'cast', 'qa')).toBe('Q&A-%20the%20ending.md')
  })

  it('encodes what a Markdown reader would take for something else', () => {
    const odd = { id: 'odd', parentId: 'notes', type: 'text', title: '50% (draft) #2' }
    const withOdd = { ...tree, get: id => (id === 'odd' ? odd : tree.get(id)) }
    expect(hrefFor(withOdd, 'cast', 'odd')).toBe('50%25%20%28draft%29%20%232.md')
  })

  it('writes a link the editor reads back as it was written', () => {
    for (const title of ['Café [old]', '50% (draft) #2', 'R&D: costs', 'Notes {v2} ✓']) {
      const odd = { id: 'odd', parentId: 'notes', type: 'text', title }
      const withOdd = {
        ...tree,
        get: id => (id === 'odd' ? odd : tree.get(id)),
        childrenOf: parentId => [
          ...tree.childrenOf(parentId),
          ...(parentId === 'notes' ? [odd] : []),
        ],
      }
      const href = hrefFor(withOdd, 'one', 'odd')
      let read = null
      parseMarkdown(`See [it](${href}).`).descendants(node => {
        for (const mark of node.marks) if (mark.type.name === 'link') read = mark.attrs.href
      })
      expect(read).toBe(href)
      expect(resolveLink(withOdd, href, 'one')?.id).toBe('odd')
    }
  })
})

describe('resolveLink', () => {
  it('follows a link from the linking document', () => {
    expect(resolved('../Notes/Cast%20list.md', 'one')).toBe('cast')
    expect(resolved('Chapter%202.md', 'one')).toBe('two')
    expect(resolved('../../Outline.md', 'harbour')).toBe('top')
    expect(resolved('./Places/The%20harbour.md', 'cast')).toBe('harbour')
  })

  it('reads every link hrefFor writes back to its document', () => {
    for (const from of ['one', 'top', 'harbour', 'cast']) {
      for (const to of ['cast', 'qa', 'paper', 'two', 'top', 'harbour']) {
        expect(resolved(hrefFor(tree, from, to), from)).toBe(to)
      }
    }
  })

  it('takes a destination in <…>, a title, and no extension', () => {
    expect(resolved('<../Notes/Cast list.md>', 'one')).toBe('cast')
    expect(resolved('../Notes/Q&A: the ending', 'one')).toBe('qa')
    expect(resolved('../Notes/Tide tables', 'one')).toBe('paper')
    expect(resolved('../notes/cast list', 'one')).toBe('cast')
  })

  it('takes a file in an ordered folder by its name on disk, place and all', () => {
    expect(resolved('Drafts/02%20-%20Chapter%202.md', 'top')).toBe('two')
  })

  it('takes a project path, from the top, with or without a slash', () => {
    expect(resolved('/Notes/Cast list', 'one')).toBe('cast')
    expect(resolved('Notes/Cast list', 'one')).toBe('cast')
    expect(resolved('Notes/Places/The harbour.md')).toBe('harbour')
  })

  it('stays in the project when a link climbs out of it', () => {
    expect(resolved('../../../Outline.md', 'one')).toBe('top')
  })

  it('reads a link that is only a heading as the document it is in', () => {
    expect(resolved('#the-end', 'one')).toBe('one')
    expect(resolved('../Notes/Cast%20list.md#who', 'one')).toBe('cast')
  })

  it('finds nothing where there is nothing, and nothing past a document', () => {
    expect(resolved('../Notes/Nobody.md', 'one')).toBeNull()
    expect(resolved('Outline.md/Cast list.md')).toBeNull()
    expect(resolved('https://example.com', 'one')).toBeNull()
  })

  it('leaves a stray % as it is', () => {
    expect(resolved('../Notes/100%.md', 'one')).toBeNull()
  })
})

describe('documentNamed', () => {
  it('finds the one document by a name, wherever it is', () => {
    expect(documentNamed(tree, 'the harbour')?.id).toBe('harbour')
    expect(documentNamed(tree, 'Tide tables.pdf')?.id).toBe('paper')
  })

  it('finds nothing for a folder, a name nobody has, or one that two have', () => {
    expect(documentNamed(tree, 'Places')).toBeNull()
    expect(documentNamed(tree, 'Nobody')).toBeNull()
    const twice = [...docs, { id: 'dup', parentId: 'drafts', type: 'text', title: 'Outline' }]
    const both = { ...tree, childrenOf: parentId => twice.filter(doc => doc.parentId === parentId) }
    expect(documentNamed(both, 'Outline')).toBeNull()
  })
})

describe('readableHref', () => {
  it('decodes a link for the writer to read', () => {
    expect(readableHref('../Notes/Cast%20list.md')).toBe('../Notes/Cast list.md')
    expect(readableHref('<a b.md>')).toBe('a b.md')
    expect(readableHref('100%.md')).toBe('100%.md')
  })
})

describe('projectHref', () => {
  it('writes a link from the top of the project, which reads back to the same document', () => {
    expect(projectHref(tree, 'cast')).toBe('/Notes/Cast%20list.md')
    expect(projectHref(tree, 'harbour')).toBe('/Notes/Places/The%20harbour.md')
    expect(projectHref(tree, 'paper')).toBe('/Notes/Tide%20tables.pdf')
    for (const id of ['cast', 'harbour', 'paper', 'top']) {
      expect(resolveLink(tree, projectHref(tree, id), 'harbour')?.id).toBe(id)
    }
  })
})

describe('links through a document that holds others', () => {
  const held = [
    ...docs,
    { id: 'arrival', parentId: 'one', type: 'text', title: 'Arrival' },
    { id: 'leaving', parentId: 'one', type: 'text', title: 'Leaving' },
    { id: 'copy', parentId: 'paper', type: 'text', title: 'Tide tables (Markdown)' },
  ]
  const heldById = new Map(held.map(doc => [doc.id, doc]))
  const holding = {
    get: id => heldById.get(id) ?? null,
    childrenOf: parentId => held.filter(doc => doc.parentId === parentId),
    rootId: 'root_s',
  }
  const resolvedIn = (href, fromId) => resolveLink(holding, href, fromId)?.id ?? null

  it('names it on the way by its name, as the outline does', () => {
    expect(hrefFor(holding, 'top', 'arrival')).toBe('Drafts/Chapter%201/Arrival.md')
    expect(hrefFor(holding, 'cast', 'copy')).toBe('Tide%20tables/Tide%20tables%20%28Markdown%29.md')
    expect(hrefFor(holding, 'arrival', 'leaving')).toBe('Leaving.md')
    expect(hrefFor(holding, 'one', 'arrival')).toBe('Chapter%201/Arrival.md')
    expect(projectHref(holding, 'arrival')).toBe('/Drafts/Chapter%201/Arrival.md')
  })

  it('links what it holds to it, not to itself', () => {
    expect(hrefFor(holding, 'arrival', 'one')).toBe('../Chapter%201.md')
    expect(resolvedIn('../Chapter%201.md', 'arrival')).toBe('one')
  })

  it('reads every link written back to its document', () => {
    const ids = ['one', 'arrival', 'leaving', 'paper', 'copy', 'cast', 'top']
    for (const from of ids.filter(id => heldById.get(id).type === 'text')) {
      for (const to of ids) expect(resolvedIn(hrefFor(holding, from, to), from)).toBe(to)
    }
  })

  it('takes it by its file’s name on the way too, and finds what it holds by name', () => {
    expect(resolvedIn('Drafts/Chapter%201.md/Arrival.md', 'top')).toBe('arrival')
    expect(resolvedIn('Notes/Tide tables.pdf/Tide tables (Markdown)')).toBe('copy')
    expect(documentNamed(holding, 'Leaving')?.id).toBe('leaving')
  })
})
