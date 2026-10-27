/* global Blob */
import { describe, it, expect } from 'vitest'
import { exportEntries } from '@/files/exportDocument.js'

/** @typedef {import('@/types/models.js').Document} Document */
/** @typedef {import('@/files/exportDocument.js').ExportEntry} ExportEntry */

const ROOT = 'root_story_1'

/**
 * A document of the project, with only what a test says of it.
 *
 * @param {Partial<Document> & {id: string, title: string}} fields
 * @returns {Document}
 */
const row = fields =>
  /** @type {Document} */ ({ type: 'text', parentId: ROOT, content: '', ...fields })

/**
 * An export's source over these documents, the root first among them; each
 * folder's children in the order given.
 *
 * @param {Document[]} documents
 * @param {{bytes?: Record<string, Blob>, located?: Record<string, string>}} [options]
 */
function sourceOf(documents, { bytes = {}, located } = {}) {
  const byId = new Map(documents.map(document => [document.id, document]))
  return {
    tree: {
      get: (/** @type {string} */ id) => byId.get(id) ?? null,
      childrenOf: (/** @type {string} */ id) =>
        documents.filter(document => document.parentId === id && document.id !== ROOT),
      rootId: ROOT,
    },
    content: (/** @type {string} */ id) => byId.get(id)?.content ?? '',
    read: async (/** @type {string} */ key) => bytes[key] ?? null,
    ...(located ? { located: async (/** @type {string} */ id) => located[id] ?? null } : {}),
  }
}

const root = row({ id: ROOT, type: 'folder', title: 'My Project', parentId: 'story_1' })

/** An export's entries by path: a text as its text, a file as what it is. */
const byPath = (/** @type {ExportEntry[]} */ entries) =>
  Object.fromEntries(
    entries.map(entry => [
      entry.path,
      'text' in entry
        ? entry.text
        : 'blob' in entry
          ? entry.blob
          : 'file' in entry
            ? { file: entry.file }
            : 'folder',
    ])
  )

const png = (/** @type {string} */ text) => new Blob([text], { type: 'image/png' })

describe('exportEntries', () => {
  it('lays a project out by the outline’s paths', async () => {
    const source = sourceOf([
      root,
      row({ id: 'f1', type: 'folder', title: 'Folder 1' }),
      row({ id: 'd1', title: 'Doc 1', parentId: 'f1', content: 'One.' }),
      row({ id: 'd2', title: 'Doc 2', parentId: 'f1', content: 'Two.' }),
      row({ id: 'f2', type: 'folder', title: 'Folder 2' }),
      row({ id: 'f3', type: 'folder', title: 'Folder 3', parentId: 'f2' }),
      row({ id: 'd3', title: 'Doc 3', parentId: 'f3', content: 'Three.' }),
      row({ id: 'f4', type: 'folder', title: 'Empty' }),
    ])
    const { name, entries, missing } = await exportEntries(source, ROOT)
    expect(name).toBe('My Project')
    expect(missing).toBe(0)
    expect(byPath(entries)).toEqual({
      'My Project': 'folder',
      'My Project/Folder 1': 'folder',
      'My Project/Folder 1/Doc 1.md': 'One.',
      'My Project/Folder 1/Doc 2.md': 'Two.',
      'My Project/Folder 2': 'folder',
      'My Project/Folder 2/Folder 3': 'folder',
      'My Project/Folder 2/Folder 3/Doc 3.md': 'Three.',
      'My Project/Empty': 'folder',
    })
  })

  it('exports a folder as its directory, and a document as its file', async () => {
    const source = sourceOf([
      root,
      row({ id: 'f1', type: 'folder', title: 'Guide' }),
      row({ id: 'd1', title: 'Getting started', parentId: 'f1', content: 'Hello.' }),
    ])
    const folder = await exportEntries(source, 'f1')
    expect(folder.name).toBe('Guide')
    expect(byPath(folder.entries)).toEqual({
      Guide: 'folder',
      'Guide/Getting started.md': 'Hello.',
    })
    const document = await exportEntries(source, 'd1')
    expect(document.name).toBe('Getting started.md')
    expect(byPath(document.entries)).toEqual({ 'Getting started.md': 'Hello.' })
  })

  it('names what titles make alike apart, the first keeping the name, and puts no place in front', async () => {
    const source = sourceOf([
      { ...root, ordered: true },
      row({ id: 'a', title: 'Act 1/2', content: 'A.' }),
      row({ id: 'b', title: 'Act 1-2', content: 'B.' }),
      row({ id: 'c', type: 'folder', title: 'Scenes' }),
      row({ id: 'd', type: 'folder', title: 'scenes:' }),
    ])
    const { entries } = await exportEntries(source, ROOT)
    expect(entries.map(entry => entry.path)).toEqual([
      'My Project',
      'My Project/Act 1-2.md',
      'My Project/Act 1-2 (2).md',
      'My Project/Scenes',
      'My Project/scenes-',
    ])
  })

  it('exports each text as it stands, without comments or suggestions', async () => {
    const markdown =
      'A {--cold--}{>>sabcd1<<}{++warm++}{>>sabcd1<<} {==night==}{>>cabcd1<<}.\n\n{++Gulls.++}{>>sabcd2<<}'
    const source = sourceOf([
      root,
      row({ id: 'd1', title: 'Prologue', content: markdown }),
      row({ id: 'p1', title: 'Prompt', plain: true, content: markdown }),
      row({ id: 'p2', title: 'analysis.py', plain: true, content: 'print(1)\n' }),
    ])
    const { entries } = await exportEntries(source, ROOT)
    expect(byPath(entries)).toEqual({
      'My Project': 'folder',
      'My Project/Prologue.md': 'A cold night.',
      // A plain document is as typed, and named by a title with an extension.
      'My Project/Prompt.md': markdown,
      'My Project/analysis.py': 'print(1)\n',
    })
  })

  it('exports an imported file as it came in, and a repository’s as its text', async () => {
    const pdf = new Blob(['%PDF'], { type: 'application/pdf' })
    const source = sourceOf(
      [
        root,
        row({
          id: 'f1',
          type: 'file',
          title: 'Tide tables',
          mime: 'application/pdf',
          content: '[p.1] Tides',
        }),
        row({ id: 'r1', type: 'folder', title: 'tool', kind: 'repository' }),
        row({
          id: 'r2',
          type: 'file',
          title: 'main.js',
          mime: 'text/javascript',
          parentId: 'r1',
          content: 'run()\n',
        }),
        row({ id: 'f2', type: 'file', title: 'Scan', mime: 'image/png' }),
      ],
      { bytes: { f1: pdf } }
    )
    const { entries, missing } = await exportEntries(source, ROOT)
    expect(byPath(entries)).toEqual({
      'My Project': 'folder',
      // The file alone, not the text read out of it.
      'My Project/Tide tables.pdf': pdf,
      'My Project/tool': 'folder',
      'My Project/tool/main.js': 'run()\n',
    })
    // A file whose bytes couldn't be had is left out, and counted.
    expect(missing).toBe(1)
  })

  it('copies a file from where it is in the library when it is there', async () => {
    const source = sourceOf(
      [root, row({ id: 'f1', type: 'file', title: 'Tide tables', mime: 'application/pdf' })],
      { located: { f1: 'My Project/Tide tables.pdf' } }
    )
    const { entries } = await exportEntries(source, ROOT)
    expect(byPath(entries)['My Project/Tide tables.pdf']).toEqual({
      file: 'My Project/Tide tables.pdf',
    })
  })

  it('puts what a document holds in a directory of its name beside it', async () => {
    const pdf = new Blob(['%PDF'], { type: 'application/pdf' })
    const source = sourceOf(
      [
        root,
        row({ id: 'f1', type: 'folder', title: 'Rules' }),
        row({ id: 'b1', type: 'file', title: 'Rulebook', mime: 'application/pdf', parentId: 'f1' }),
        row({
          id: 'b2',
          title: 'Rulebook',
          parentId: 'b1',
          convertedFrom: 'b1',
          content: '# Rules',
        }),
      ],
      { bytes: { b1: pdf } }
    )
    const { entries } = await exportEntries(source, ROOT)
    expect(byPath(entries)).toEqual({
      'My Project': 'folder',
      'My Project/Rules': 'folder',
      'My Project/Rules/Rulebook.pdf': pdf,
      'My Project/Rules/Rulebook': 'folder',
      'My Project/Rules/Rulebook/Rulebook.md': '# Rules',
    })
  })

  describe('pictures', () => {
    it('go in images beside the text, which points there', async () => {
      const text = [
        'The gate ![](.images/d1/gate.png) shut.',
        '![A map](.images/d1/market%20map.png)',
        '![](https://example.com/web.png) and ![](.images/d1/gone.png)',
      ].join('\n\n')
      const gate = png('gate')
      const map = png('map')
      const source = sourceOf([root, row({ id: 'd1', title: 'Prologue', content: text })], {
        bytes: { 'd1/gate.png': gate, 'd1/market map.png': map },
      })
      const { entries } = await exportEntries(source, 'd1')
      expect(byPath(entries)).toEqual({
        'images/gate.png': gate,
        'images/market map.png': map,
        'Prologue.md': [
          'The gate ![](images/gate.png) shut.',
          '![A map](images/market%20map.png)',
          // A picture with no bytes, and one on the web, stay as they were.
          '![](https://example.com/web.png) and ![](.images/d1/gone.png)',
        ].join('\n\n'),
      })
    })

    it('are shared by a directory, numbered where two documents’ have one name', async () => {
      const source = sourceOf(
        [
          root,
          row({ id: 'a', title: 'A', content: '![](.images/a/gate.png) ![](.images/a/gate.png)' }),
          row({ id: 'b', title: 'B', content: '![](.images/b/gate.png)' }),
          row({ id: 'i', type: 'folder', title: 'Images' }),
        ],
        { bytes: { 'a/gate.png': png('a'), 'b/gate.png': png('b') } }
      )
      const files = byPath((await exportEntries(source, ROOT)).entries)
      // The folder called Images keeps its name, and the pictures take the next.
      expect(files['My Project/A.md']).toBe(
        '![](images%20%282%29/gate.png) ![](images%20%282%29/gate.png)'
      )
      expect(files['My Project/B.md']).toBe('![](images%20%282%29/gate%20%282%29.png)')
      expect(Object.keys(files).filter(path => path.includes('/images ('))).toEqual([
        'My Project/images (2)/gate.png',
        'My Project/images (2)/gate (2).png',
      ])
      expect(files['My Project/Images']).toBe('folder')
    })

    it('of what a document holds go in its directory', async () => {
      const source = sourceOf(
        [
          root,
          row({ id: 'c1', title: 'Chapter 1', content: 'Text.' }),
          row({ id: 'n1', title: 'Notes', parentId: 'c1', content: '![](.images/n1/map.png)' }),
        ],
        { bytes: { 'n1/map.png': png('map') } }
      )
      const files = byPath((await exportEntries(source, ROOT)).entries)
      expect(files['My Project/Chapter 1/Notes.md']).toBe('![](images/map.png)')
      expect(Object.keys(files)).toContain('My Project/Chapter 1/images/map.png')
    })
  })

  describe('links', () => {
    const documents = () => [
      root,
      row({ id: 'n', type: 'folder', title: 'Notes' }),
      row({ id: 'cast', title: 'Cast list', parentId: 'n', content: 'Names.' }),
      row({ id: 'g', type: 'folder', title: 'Guide' }),
      row({
        id: 'tides',
        type: 'file',
        title: 'Tide tables',
        mime: 'application/pdf',
        parentId: 'g',
      }),
      row({ id: 'two', title: 'A/B', parentId: 'g' }),
      row({ id: 'one', title: 'A-B', parentId: 'g' }),
    ]

    it('leaves a text whose links are written as the export has them as it was', async () => {
      const text = 'See [the cast](../Notes/Cast%20list.md#leads) and [tides](<Tide tables.pdf>).'
      const source = sourceOf(
        [...documents(), row({ id: 'intro', title: 'Intro', parentId: 'g', content: text })],
        { bytes: { tides: new Blob(['%PDF']) } }
      )
      const files = byPath((await exportEntries(source, ROOT)).entries)
      expect(files['My Project/Guide/Intro.md']).toBe(text)
    })

    it('writes out again a link in a form only inksprite reads', async () => {
      const text = [
        '[by title](<Q&A: the ending>)',
        '[from the top](/Notes/Cast%20list.md)',
        '[no extension](../Notes/Cast%20list)',
        '[into a document](<Chapter 1/Notes>)',
        '![a picture that is a file](<Map>)',
      ].join('\n\n')
      const source = sourceOf(
        [
          ...documents(),
          row({ id: 'map', type: 'file', title: 'Map', mime: 'image/png', parentId: 'g' }),
          row({ id: 'qa', title: 'Q&A: the ending', parentId: 'g' }),
          row({ id: 'c1', title: 'Chapter 1', parentId: 'g' }),
          row({ id: 'c2', title: 'Notes', parentId: 'c1' }),
          row({ id: 'intro', title: 'Intro', parentId: 'g', content: text }),
        ],
        { bytes: { tides: new Blob(['%PDF']), map: png('map') } }
      )
      const files = byPath((await exportEntries(source, ROOT)).entries)
      expect(files['My Project/Guide/Intro.md']).toBe(
        [
          '[by title](Q&A-%20the%20ending.md)',
          '[from the top](../Notes/Cast%20list.md)',
          '[no extension](../Notes/Cast%20list.md)',
          '[into a document](Chapter%201/Notes.md)',
          '![a picture that is a file](Map.png)',
        ].join('\n\n')
      )
    })

    it('leaves one to outside the export, to the web, or to its own text, as it was', async () => {
      const text =
        '[cast](../Notes/Cast%20list.md), [site](https://example.com/a.md), [here](#top), [gone](Lost.md)'
      const source = sourceOf([
        ...documents(),
        row({ id: 'intro', title: 'Intro', parentId: 'g', content: text }),
      ])
      const files = byPath((await exportEntries(source, 'g')).entries)
      expect(files['Guide/Intro.md']).toBe(text)
    })
  })
})
