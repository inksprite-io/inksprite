// @vitest-environment node
/* global Blob */
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { libraryStorage } from '@/storage/library.js'
import { dexieStorage } from '@/storage/dexie.js'
import { memoryLibrary } from './memoryLibrary.js'
import { STORY, story, sample, doc, folder } from './project.js'

/** @typedef {import('@/types/models.js').Change} Change */

/** @param {string} table @param {any} row @returns {Change} */
const put = (table, row) => ({ entityType: table, id: row.id, op: 'put', data: row, timestamp: 0 })

/** @param {string} table @param {string} id @returns {Change} */
const gone = (table, id) => ({ entityType: table, id, op: 'delete', data: null, timestamp: 0 })

const PNG = { mime: 'image/png', width: 4, height: 3 }

/** Elara, in Notes, with two pictures of her own in her text. */
const elara = (fields = {}) =>
  doc('elara', 'notes', {
    title: 'Elara',
    content: '![](.images/elara/map.png) and ![](.images/elara/gate.png)',
    pictures: { 'map.png': PNG, 'gate.png': PNG },
    ...fields,
  })

const png = (/** @type {string} */ text) => new Blob([text], { type: 'image/png' })

/** The sample project in a library, Elara's pictures in it, as the stores would write it. */
async function withPictures() {
  const library = memoryLibrary()
  const storage = libraryStorage(library.disk)
  await storage.stories()
  await storage.write('stories', [put('stories', story())])
  // Bytes that come before the rows are kept until the document is written.
  await storage.putFileBytes('elara/map.png', STORY, png('map pixels'))
  const rows = sample().map(row => (row.id === 'elara' ? elara() : row))
  await storage.write(
    'documents',
    rows.map(row => put('documents', row))
  )
  await storage.putFileBytes('elara/gate.png', STORY, png('gate pixels'))
  return { ...library, storage }
}

const reopened = (/** @type {ReturnType<typeof memoryLibrary>} */ library) =>
  libraryStorage(library.disk)

beforeEach(async () => {
  await dexieStorage.replaceAll({})
})

describe('pictures in the library', () => {
  it("keeps a document's pictures in the .images beside it, by its id", async () => {
    const library = await withPictures()

    expect(library.outside.read('My Novel/Notes/.images/elara/map.png')).toBe('map pixels')
    expect(library.outside.read('My Novel/Notes/.images/elara/gate.png')).toBe('gate pixels')
    expect(library.outside.read('My Novel/Notes/Elara.md')).toContain('map.png:')
  })

  it('reads them back with their type, and the document with its pictures', async () => {
    const library = await withPictures()
    const again = reopened(library)
    const documents = await again.documents(STORY)

    expect(documents.find(document => document.id === 'elara')?.pictures).toEqual({
      'gate.png': PNG,
      'map.png': PNG,
    })
    // The folder of pictures is no document.
    expect(documents.map(document => document.title)).not.toContain('.images')
    const bytes = await again.fileBytes('elara/map.png')
    expect(bytes?.type).toBe('image/png')
    expect(await bytes?.text()).toBe('map pixels')
  })

  it('carries them in a backup and into another library', async () => {
    const library = await withPictures()

    const tables = await reopened(library).dump()
    expect(tables.files.map(file => file.id).sort()).toEqual(['elara/gate.png', 'elara/map.png'])
    expect((await reopened(library).projectFiles(STORY)).map(file => file.id)).toContain(
      'elara/map.png'
    )

    const other = memoryLibrary()
    await libraryStorage(other.disk).replaceAll(tables)
    expect(other.outside.read('My Novel/Notes/.images/elara/gate.png')).toBe('gate pixels')
  })

  it('moves them with their document to another folder, and not on a rename', async () => {
    const library = await withPictures()
    await library.storage.documents(STORY)

    await library.storage.write('documents', [put('documents', elara({ title: 'Elara Vane' }))])
    expect(library.outside.read('My Novel/Notes/.images/elara/map.png')).toBe('map pixels')

    await library.storage.write('documents', [
      put('documents', elara({ title: 'Elara Vane', parentId: 'act1' })),
    ])
    const files = library.outside.list()
    expect(files.filter(path => path.includes('/.images/elara/'))).toEqual([
      expect.stringMatching(/Act 1\/\.images\/elara\/gate\.png$/),
      expect.stringMatching(/Act 1\/\.images\/elara\/map\.png$/),
    ])
    const again = reopened(library)
    await again.documents(STORY)
    expect(await (await again.fileBytes('elara/gate.png'))?.text()).toBe('gate pixels')
  })

  it('takes them along with a folder renamed or moved above them', async () => {
    const library = await withPictures()
    await library.storage.documents(STORY)

    await library.storage.write('documents', [
      put('documents', folder('notes', 'act1', { title: 'Research', order: 1 })),
    ])

    expect(library.outside.list().filter(path => path.endsWith('/.images/elara/map.png'))).toEqual([
      'My Novel/Manuscript/01 - Act 1/03 - Research/.images/elara/map.png',
    ])
  })

  it("trashes a document's pictures with it, and one its row lets go of", async () => {
    const library = await withPictures()
    await library.storage.documents(STORY)

    const { 'gate.png': _gate, ...left } = elara().pictures || {}
    await library.storage.write('documents', [put('documents', elara({ pictures: left }))])
    expect(library.trashed).toEqual(['My Novel/Notes/.images/elara/gate.png'])

    await library.storage.write('documents', [gone('documents', 'elara')])
    expect(library.trashed).toContain('My Novel/Notes/.images/elara')
    expect(library.outside.list().some(path => path.includes('/.images/elara/'))).toBe(false)
  })

  it('moves a document whose pictures have not come yet', async () => {
    const library = memoryLibrary()
    const storage = libraryStorage(library.disk)
    await storage.stories()
    await storage.write('stories', [put('stories', story())])
    const rows = sample().map(row => (row.id === 'elara' ? elara() : row))
    await storage.write(
      'documents',
      rows.map(row => put('documents', row))
    )

    await storage.write('documents', [put('documents', elara({ parentId: 'act1' }))])
    await storage.putFileBytes('elara/map.png', STORY, png('late pixels'))

    expect(library.outside.list().filter(path => path.includes('/.images/'))).toEqual([
      expect.stringMatching(/Act 1\/\.images\/elara\/map\.png$/),
    ])
  })
})
