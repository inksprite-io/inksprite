// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { libraryStorage } from '@/storage/library.js'
import { dexieStorage } from '@/storage/dexie.js'
import { memoryLibrary } from './memoryLibrary.js'
import { STORY, ROOT, story, sample, doc } from './project.js'

// Two windows of the desktop app over one library: each its own storage, as
// each page has, over the same folder.

/** @typedef {import('@/types/models.js').Change} Change */

/** @param {string} table @param {any} row @returns {Change} */
const put = (table, row) => ({ entityType: table, id: row.id, op: 'put', data: row, timestamp: 0 })

/** A window's storage over the library, and what it has been told was changed elsewhere. */
const windowOn = (/** @type {ReturnType<typeof memoryLibrary>} */ library) => {
  /** @type {string[]} */
  const conflicts = []
  const storage = libraryStorage(library.disk, {
    onConflict: changed => conflicts.push(...changed.map(({ path }) => path)),
  })
  return { storage, conflicts }
}

/** Write the sample project, as a window's stores would. */
async function writeSample(/** @type {any} */ storage) {
  await storage.stories()
  await storage.write('stories', [put('stories', story())])
  await storage.write(
    'documents',
    sample()
      .filter(row => row.type !== 'file')
      .map(row => put('documents', row))
  )
}

const rootTitle = async (/** @type {any} */ storage) =>
  (await storage.roots([STORY])).map(root => root.title)

beforeEach(async () => {
  await dexieStorage.replaceAll({})
})

describe('the list of projects, read again after another window changed it', () => {
  it('has a project another window made', async () => {
    const library = memoryLibrary()
    const a = windowOn(library)
    const b = windowOn(library)
    expect(await b.storage.stories()).toEqual([])

    await writeSample(a.storage)
    expect(await b.storage.stories()).toEqual([])

    await b.storage.refreshProjects([])
    expect((await b.storage.stories()).map(row => row.id)).toEqual([STORY])
    expect(await rootTitle(b.storage)).toEqual(['My Novel'])
  })

  it('has a project another window renamed by its new name, and not one it deleted', async () => {
    const library = memoryLibrary()
    const a = windowOn(library)
    await writeSample(a.storage)
    const b = windowOn(library)
    expect(await rootTitle(b.storage)).toEqual(['My Novel'])

    const [root] = sample()
    await a.storage.write('documents', [put('documents', { ...root, title: 'The Door' })])
    await b.storage.refreshProjects([])
    expect(await rootTitle(b.storage)).toEqual(['The Door'])

    await a.storage.removeProject(STORY)
    await b.storage.refreshProjects([])
    expect(await b.storage.stories()).toEqual([])
  })

  it('leaves a project this window has open as this window has it', async () => {
    const library = memoryLibrary()
    const a = windowOn(library)
    await writeSample(a.storage)
    const b = windowOn(library)
    await b.storage.stories()

    const [root] = sample()
    await a.storage.write('documents', [put('documents', { ...root, title: 'The Door' })])
    await b.storage.refreshProjects([STORY])
    expect(await rootTitle(b.storage)).toEqual(['My Novel'])
  })
})

describe('a project reopened after another window had it', () => {
  /**
   * Window B reads the project whole, then window A adds a chapter and
   * changes another, as it would with the project open there.
   */
  async function changedElsewhere() {
    const library = memoryLibrary()
    const a = windowOn(library)
    await writeSample(a.storage)
    const b = windowOn(library)
    await b.storage.documents(STORY)

    await a.storage.documents(STORY)
    await a.storage.write('documents', [
      put('documents', doc('ch3', 'act1', { title: 'Chapter 3', content: 'Later.', order: 2 })),
      put('documents', doc('ch1', 'act1', { title: 'Chapter 1', content: 'Changed.', order: 0 })),
    ])
    return { a, b }
  }

  /** Window B, back on the project, changes Chapter 1 again. */
  const writeChapterOne = (/** @type {any} */ storage) =>
    storage.write('documents', [
      put('documents', doc('ch1', 'act1', { title: 'Chapter 1', content: 'Mine.', order: 0 })),
    ])

  it('is read as the other window left it, and written over with no file taken for changed', async () => {
    const { b } = await changedElsewhere()

    await b.storage.reopenProject(STORY)
    const documents = await b.storage.documents(STORY)
    expect(documents.find(row => row.id === 'ch3')?.content).toBe('Later.')
    expect(documents.find(row => row.id === 'ch1')?.content).toBe('Changed.')

    await writeChapterOne(b.storage)
    expect(b.conflicts).toEqual([])
  })

  it('without being reopened, has its changed files taken for changed elsewhere', async () => {
    const { b } = await changedElsewhere()
    await b.storage.documents(STORY)
    await writeChapterOne(b.storage)
    expect(b.conflicts).not.toEqual([])
  })

  it('keeps its root and record from the disk', async () => {
    const library = memoryLibrary()
    const a = windowOn(library)
    await writeSample(a.storage)
    const b = windowOn(library)
    await b.storage.stories()

    await a.storage.write('stories', [put('stories', { ...story(), overview: 'Rewritten.' })])
    await b.storage.reopenProject(STORY)
    expect((await b.storage.story(STORY))?.overview).toBe('Rewritten.')
    expect((await b.storage.roots([STORY]))[0].id).toBe(ROOT)
  })
})
