/* global AbortController, TextEncoder */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/stores/db', () => ({
  default: {
    documents: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
      filter: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
      bulkDelete: vi.fn(),
      bulkGet: vi.fn(async () => []),
      get: vi.fn(async () => undefined),
    },
    stories: { toArray: vi.fn(async () => []) },
  },
}))

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn(), start: () => false }),
}))

/** The native side, which waits for what an app sends: stood in for. */
const native = vi.hoisted(() => ({
  /** @type {Map<string, {connection: string, about: any, bytes: Uint8Array|null}>} */
  waiting: new Map(),
  /** @type {Map<string, object>} */
  kept: new Map(),
}))
vi.mock('@/platform/apps.js', () => ({
  awaitAppImport: vi.fn(async (connection, about) => {
    const id = `id-${native.waiting.size + 1}`
    native.waiting.set(id, { connection, about: JSON.parse(JSON.stringify(about)), bytes: null })
    return { id }
  }),
  takeAppImport: vi.fn(async (connection, id) => {
    const one = native.waiting.get(id)
    if (!one || one.connection !== connection || !one.bytes) return null
    native.waiting.delete(id)
    return { about: one.about, bytes: one.bytes }
  }),
  keptRead: vi.fn(
    async (connection, document) => native.kept.get(`${connection}/${document}`) ?? null
  ),
  keepRead: vi.fn(async (connection, document, record) => {
    native.kept.set(`${connection}/${document}`, JSON.parse(JSON.stringify(record)))
  }),
  forgetReads: vi.fn(async () => {}),
  forgetReadsOf: vi.fn(),
}))

/** The files' bytes, by their documents' ids. */
const files = vi.hoisted(() => ({
  /** @type {Map<string, Blob>} */
  held: new Map(),
}))
vi.mock('@/stores/filesStore', () => ({
  useFilesStore: () => ({
    putFile: async (key, _storyId, blob) => files.held.set(key, blob),
    getFile: async key => files.held.get(key) ?? null,
  }),
}))

/** The window that holds a project, stood in for: this one, unless a test says another. */
const windows = vi.hoisted(() => ({ elsewhere: false }))
vi.mock('@/apps/projects.js', () => ({
  inProject: vi.fn(async (_storyId, work) =>
    windows.elsewhere ? { pass: 'elsewhere' } : { value: await work() }
  ),
}))

import { FILE, IMPORT_NOTE, importFor, receivedFor, titleFor } from '@/apps/imports.js'
import { executeReadDocument, projectOverview } from '@/ai/tools/documents.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances } from '@/composables/useDocuments'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

const STORY = 'story_1'
const APP = {
  id: 'app_1',
  name: 'Claude Code',
  projects: [STORY],
  readOnly: false,
  address: 'http://host.docker.internal:4657',
}
const asking = { storyId: STORY, chatId: 'app:app_1' }
const encoder = new TextEncoder()

/**
 * What the app's shell does with the link: send the file by it, and the door
 * has the page take it (`electron/src/appServer.js`).
 *
 * @param {string} url
 * @param {Uint8Array} bytes
 * @param {typeof APP} [app] - The connection as it is when the file comes
 */
const send = async (url, bytes, app = APP) => {
  const id = url.slice(url.lastIndexOf('/') + 1)
  const one = native.waiting.get(id)
  if (!one) return null
  one.bytes = bytes
  return receivedFor(app, { id, about: one.about }, new AbortController().signal)
}

/** @type {ReturnType<typeof useDocumentsStore>} */
let store

beforeEach(async () => {
  setActivePinia(createPinia())
  clearDocumentInstances()
  native.waiting.clear()
  native.kept.clear()
  files.held.clear()
  windows.elsewhere = false
  vi.spyOn(console, 'error').mockImplementation(() => {})
  store = useDocumentsStore()
  await projectOverview(STORY)
  store.createDocument({
    id: 'folder_research',
    storyId: STORY,
    parentId: rootIdFor(STORY),
    type: 'folder',
    title: 'Research',
  })
  store.createDocument({
    id: 'doc_plan',
    storyId: STORY,
    parentId: 'folder_research',
    type: 'text',
    title: 'Plan',
    content: 'The plan.',
  })
})

describe('titleFor', () => {
  it('names a document after its file, without the extension, and a file as it is named', () => {
    expect(titleFor('Notes.md')).toBe('Notes')
    expect(titleFor('Draft.markdown')).toBe('Draft')
    expect(titleFor('Report.docx')).toBe('Report')
    expect(titleFor('paper.pdf')).toBe('paper')
    expect(titleFor('system.txt')).toBe('system.txt')
    expect(titleFor('d20.py')).toBe('d20.py')
    expect(titleFor('LICENSE')).toBe('LICENSE')
  })
})

describe('importFor', () => {
  it('answers with a link and the command that sends the file to it', async () => {
    const answer = await importFor(APP, asking, { path: 'Research/Notes.md' })

    expect(answer).toEqual({
      url: 'http://host.docker.internal:4657/import/id-1',
      command: `curl -sS -T ${FILE} "http://host.docker.internal:4657/import/id-1"`,
      note: IMPORT_NOTE,
    })
    expect(native.waiting.get('id-1')).toMatchObject({
      connection: 'app_1',
      about: { storyId: STORY, parentId: 'folder_research', name: 'Notes.md' },
    })
  })

  it('takes the top of the project for a file with no folder', async () => {
    const { url } = await importFor(APP, asking, { path: 'system.txt' })

    expect(native.waiting.get('id-1').about.parentId).toBe(rootIdFor(STORY))
    const { answer } = await send(url, encoder.encode('Be brief.'))
    expect(answer.document.path).toBe('system.txt')
  })

  it('refuses a folder that isn’t there, a name that is taken, and a path with no name', async () => {
    expect((await importFor(APP, asking, { path: 'Nowhere/Notes.md' })).error).toMatch(
      /No folder at "Nowhere"/
    )
    expect((await importFor(APP, asking, { path: 'Research/Plan.md' })).error).toBe(
      'There is already something at "Research/Plan". Import under another name, or delete it first.'
    )
    expect((await importFor(APP, asking, { path: '' })).error).toMatch(/Give the path/)
    expect((await importFor(APP, asking, { path: 'id:doc_plan' })).error).toMatch(/no id yet/)
    expect(native.waiting.size).toBe(0)
  })
})

describe('receivedFor', () => {
  it('brings Markdown in as a document, its text laid out as an import lays it out', async () => {
    const { url } = await importFor(APP, asking, { path: 'Research/Notes.md' })

    const { answer } = await send(url, encoder.encode('# Notes\n\n* one\n* two\n'))

    expect(answer).toMatchObject({
      success: true,
      document: { path: 'Research/Notes', type: 'text' },
      revision: expect.any(String),
    })
    const read = await executeReadDocument({ path: 'Research/Notes' }, asking)
    expect(read.content).toBe('# Notes\n\n- one\n- two')
  })

  it('keeps plain text as the file it is, byte for byte, and its text readable', async () => {
    const text = '# Not a heading\n* not a list\n\n\n\nkept as it is\n'
    const { url } = await importFor(APP, asking, { path: 'Research/system.txt' })

    const { answer } = await send(url, encoder.encode(text))

    expect(answer).toMatchObject({
      success: true,
      document: { path: 'Research/system.txt', type: 'file', mime: 'text/plain' },
    })
    const document = store.getChildren('folder_research').find(one => one.title === 'system.txt')
    expect(document.type).toBe('file')
    expect(await files.held.get(document.id).text()).toBe(text)
    expect((await executeReadDocument({ path: 'Research/system.txt' }, asking)).content).toBe(text)
  })

  it('keeps a picture as it came, with no word of text it was never going to have', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const { url } = await importFor(APP, asking, { path: 'Research/map.png' })

    const { answer } = await send(url, png)

    expect(answer).toMatchObject({
      success: true,
      document: { path: 'Research/map', type: 'file', mime: 'image/png' },
    })
    expect(answer.document).not.toHaveProperty('note')
    const document = store.getChildren('folder_research').find(one => one.title === 'map')
    expect([...new Uint8Array(await files.held.get(document.id).arrayBuffer())]).toEqual([...png])
  })

  it('never reads a card out of what an app sends', async () => {
    const card = JSON.stringify({
      spec: 'chara_card_v2',
      data: { name: 'Mara', description: 'A thief.' },
    })
    const { url } = await importFor(APP, asking, { path: 'Research/mara.json' })

    const { answer } = await send(url, encoder.encode(card))

    expect(answer.document).toMatchObject({ path: 'Research/mara.json', type: 'file' })
  })

  it('refuses a name taken since the link was made, and brings nothing in', async () => {
    const { url } = await importFor(APP, asking, { path: 'Research/Notes.md' })
    store.createDocument({
      storyId: STORY,
      parentId: 'folder_research',
      type: 'text',
      title: 'Notes',
      content: 'Written meanwhile.',
    })

    const { answer } = await send(url, encoder.encode('# Notes'))

    expect(answer.error).toMatch(/already something at "Research\/Notes"/)
    expect(store.getChildren('folder_research').filter(one => one.title === 'Notes')).toHaveLength(
      1
    )
  })

  it('refuses a folder gone since the link was made', async () => {
    const { url } = await importFor(APP, asking, { path: 'Research/Notes.md' })
    store.deleteDocument('doc_plan')
    store.deleteDocument('folder_research')

    const { answer } = await send(url, encoder.encode('# Notes'))

    expect(answer.error).toMatch(/folder the file was to go in is gone/)
  })

  it('brings nothing in for a connection that has since been made to read only, or lost the project', async () => {
    const first = await importFor(APP, asking, { path: 'Research/Notes.md' })
    const reader = await send(first.url, encoder.encode('# Notes'), { ...APP, readOnly: true })
    expect(reader.answer.error).toMatch(/only reads/)

    const second = await importFor(APP, asking, { path: 'Research/Notes.md' })
    const unticked = await send(second.url, encoder.encode('# Notes'), { ...APP, projects: [] })
    expect(unticked.answer.error).toMatch(/no longer open to this connection/)

    expect(store.getChildren('folder_research').some(one => one.title === 'Notes')).toBe(false)
  })

  it('has nothing to take for another connection, or twice', async () => {
    const { url } = await importFor(APP, asking, { path: 'Research/Notes.md' })
    const id = url.slice(url.lastIndexOf('/') + 1)
    native.waiting.get(id).bytes = encoder.encode('# Notes')
    const about = native.waiting.get(id).about

    const other = await receivedFor(
      { ...APP, id: 'app_2' },
      { id, about },
      new AbortController().signal
    )
    expect(other.answer.error).toMatch(/Nothing is waiting/)

    expect(
      (await receivedFor(APP, { id, about }, new AbortController().signal)).answer.success
    ).toBe(true)
    expect(
      (await receivedFor(APP, { id, about }, new AbortController().signal)).answer.error
    ).toMatch(/Nothing is waiting/)
  })

  it('passes to another window when the project is there, leaving the file to be taken', async () => {
    const { url } = await importFor(APP, asking, { path: 'Research/Notes.md' })
    windows.elsewhere = true

    expect(await send(url, encoder.encode('# Notes'))).toEqual({ pass: 'elsewhere' })
    expect([...native.waiting.values()][0].bytes).not.toBeNull()
  })

  it('refuses what it was given that says nothing of where the file goes', async () => {
    for (const params of [{}, { id: 'id-1' }, { id: 'id-1', about: { storyId: STORY } }]) {
      const { answer } = await receivedFor(APP, params, new AbortController().signal)
      expect(answer.error, JSON.stringify(params)).toMatch(/Nothing is waiting/)
    }
  })
})
