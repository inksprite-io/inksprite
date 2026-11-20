/* global Blob */
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

/** The native side, which holds what is offered: stood in for. */
const native = vi.hoisted(() => ({
  /** @type {Array<{connection: string, name: string, bytes: Uint8Array}>} */
  offered: [],
}))
vi.mock('@/platform/apps.js', () => ({
  offerAppExport: vi.fn(async (connection, file) => {
    native.offered.push({ connection, ...file })
    return { id: `id-${native.offered.length}` }
  }),
}))

/** The files' bytes, by their documents' ids. */
const bytes = vi.hoisted(() => ({
  /** @type {Map<string, any>} */
  held: new Map(),
}))
vi.mock('@/stores/filesStore', () => ({
  useFilesStore: () => ({ getFile: async key => bytes.held.get(key) ?? null }),
}))

import { EXPORT_MOST, LINK_NOTE, exportFor } from '@/apps/exports.js'
import { projectOverview } from '@/ai/tools/documents.js'
import { STAMP_NOTE } from '@/files/exportStamp.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances } from '@/composables/useDocuments'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

const STORY = 'story_1'
const APP = {
  id: 'app_1',
  name: 'Claude Code',
  projects: [STORY],
  readOnly: true,
  address: 'http://host.docker.internal:4657',
}
const asking = { storyId: STORY, chatId: 'app:app_1' }
const decoder = new TextDecoder()

/** The text of what was last offered. */
const offeredText = () => decoder.decode(native.offered.at(-1).bytes)

/** The names in a tar, and each one's text. */
function untar(tar) {
  /** @type {Record<string, string>} */
  const files = {}
  for (let at = 0; at < tar.length; ) {
    const block = tar.subarray(at, at + 512)
    if (block.every(byte => byte === 0)) break
    const name = decoder.decode(block.subarray(0, 100)).replace(/\0.*$/s, '')
    const size = parseInt(decoder.decode(block.subarray(124, 135)), 8)
    files[name] = decoder.decode(tar.subarray(at + 512, at + 512 + size))
    at += 512 + Math.ceil(size / 512) * 512
  }
  return files
}

/** The stamp a text of the project is exported under. */
const stampOf = (document, id) =>
  [
    '---',
    'inksprite:',
    '  project: Thief',
    `  document: ${document}`,
    `  id: ${id}`,
    `  note: ${STAMP_NOTE}`,
    '---',
    '',
    '',
  ].join('\n')

/** @type {ReturnType<typeof useDocumentsStore>} */
let store

beforeEach(async () => {
  setActivePinia(createPinia())
  clearDocumentInstances()
  vi.clearAllMocks()
  native.offered = []
  bytes.held = new Map()
  store = useDocumentsStore()
  await projectOverview(STORY)
  store.updateDocument(rootIdFor(STORY), { title: 'Thief' })
  const make = row => store.createDocument({ storyId: STORY, type: 'text', ...row })
  make({ id: 'folder_designs', parentId: rootIdFor(STORY), type: 'folder', title: 'designs' })
  make({
    id: 'doc_sync',
    parentId: 'folder_designs',
    title: 'Sync v2',
    content: '# Sync\n\nHow the devices agree.',
    comments: {
      c1: { status: 'open', quote: 'agree', posts: [{ author: 'writer', text: 'How?' }] },
    },
  })
  make({ id: 'doc_keys', parentId: 'folder_designs', title: "Friend's keys", content: 'Keys.\n' })
  make({
    id: 'doc_odds',
    parentId: 'folder_designs',
    title: 'odds.py',
    plain: true,
    content: 'print(1)',
  })
  make({
    id: 'doc_secret',
    parentId: 'folder_designs',
    title: 'Secret',
    content: 'No.',
    hidden: true,
  })
  make({ id: 'folder_empty', parentId: rootIdFor(STORY), type: 'folder', title: 'empty' })
  make({
    id: 'repo',
    parentId: rootIdFor(STORY),
    type: 'folder',
    kind: 'repository',
    title: 'thief-app',
  })
  make({ id: 'repo_readme', parentId: 'repo', type: 'file', title: 'README.md', content: '# App' })
  make({ id: 'doc_top', parentId: rootIdFor(STORY), title: 'Welcome', content: 'Hello.' })
})

describe('exportFor', () => {
  it('makes one document ready as its file, stamped, and answers with the link that fetches it', async () => {
    const answer = await exportFor(APP, asking, { path: 'designs/Sync v2' })

    expect(answer).toEqual({
      file: 'Sync v2.md',
      url: 'http://host.docker.internal:4657/export/id-1',
      command: "curl -fsS 'http://host.docker.internal:4657/export/id-1' -o 'Sync v2.md'",
      note: expect.stringContaining(LINK_NOTE),
    })
    expect(native.offered).toHaveLength(1)
    expect(native.offered[0]).toMatchObject({ connection: 'app_1', name: 'Sync v2.md' })
    // As it stands, without its comment's markup, and ending as a file does.
    expect(offeredText()).toBe(
      `${stampOf('designs/Sync v2', 'doc_sync')}# Sync\n\nHow the devices agree.\n`
    )
  })

  it('quotes a name a shell would read as more than one word', async () => {
    const answer = await exportFor(APP, asking, { path: "designs/Friend's keys" })

    expect(answer.file).toBe("Friend's keys.md")
    expect(answer.command).toBe(
      "curl -fsS 'http://host.docker.internal:4657/export/id-1' -o 'Friend'\\''s keys.md'"
    )
  })

  it('makes a folder ready as a tar of its files, a directory of its name, without what is hidden', async () => {
    const answer = await exportFor(APP, asking, { path: 'designs' })

    expect(answer).toEqual({
      files: ["designs/Friend's keys.md", 'designs/odds.py', 'designs/Sync v2.md'],
      url: 'http://host.docker.internal:4657/export/id-1',
      command: "curl -fsS 'http://host.docker.internal:4657/export/id-1' | tar -x",
      note: expect.stringContaining('tar archive'),
    })
    expect(native.offered[0].name).toBe('designs.tar')
    const files = untar(native.offered[0].bytes)
    expect(Object.keys(files).sort()).toEqual([
      'designs/',
      "designs/Friend's keys.md",
      'designs/Sync v2.md',
      'designs/odds.py',
    ])
    expect(files['designs/Sync v2.md']).toContain('id: doc_sync')
    // A plain document is as typed: no stamp, no newline put on it.
    expect(files['designs/odds.py']).toBe('print(1)')
  })

  it('makes the whole project ready, by its name, and leaves an imported repository out', async () => {
    for (const path of ['/', undefined, '  ']) {
      native.offered = []
      const answer = await exportFor(APP, asking, { path })

      expect(answer.files).toEqual([
        "Thief/designs/Friend's keys.md",
        'Thief/designs/odds.py',
        'Thief/designs/Sync v2.md',
        'Thief/Welcome.md',
      ])
      expect(native.offered[0].name).toBe('Thief.tar')
      const names = Object.keys(untar(native.offered[0].bytes))
      expect(names).toContain('Thief/empty/')
      expect(names.join('\n')).not.toMatch(/thief-app|README|Secret/)
    }
  })

  it('refuses a repository, and what is in one', async () => {
    for (const path of ['thief-app', 'thief-app/README.md']) {
      const answer = await exportFor(APP, asking, { path })
      expect(answer.error, path).toContain('is in a repository imported into the project')
    }
    expect(native.offered).toEqual([])
  })

  it('says so when nothing is there, or nothing to export is', async () => {
    expect((await exportFor(APP, asking, { path: 'designs/Nothing' })).error).toContain(
      'Nothing at "designs/Nothing"'
    )
    // Hidden from models is not there.
    expect((await exportFor(APP, asking, { path: 'designs/Secret' })).error).toContain('Nothing at')
    expect((await exportFor(APP, asking, { path: 'empty' })).error).toBe(
      '"empty" holds nothing to export.'
    )
    expect(native.offered).toEqual([])
  })

  it('hands an imported file over as it came in, and says which it had to leave out', async () => {
    const make = row => store.createDocument({ storyId: STORY, parentId: 'folder_empty', ...row })
    make({ id: 'file_rules', type: 'file', title: 'Rules', mime: 'application/pdf' })
    make({ id: 'file_map', type: 'file', title: 'Map', mime: 'image/png' })
    bytes.held.set('file_rules', new Blob(['%PDF-1.7'], { type: 'application/pdf' }))

    const alone = await exportFor(APP, asking, { path: 'empty/Rules' })
    expect(alone.file).toBe('Rules.pdf')
    expect(offeredText()).toBe('%PDF-1.7')

    const folder = await exportFor(APP, asking, { path: 'empty' })
    expect(folder.files).toEqual(['empty/Rules.pdf'])
    expect(folder.missing).toBe(1)
    expect(folder.missingNote).toContain('sync server')

    const gone = await exportFor(APP, asking, { path: 'empty/Map' })
    expect(gone.error).toContain('still on the sync server')
  })

  it('refuses more than can be handed over at once', async () => {
    store.createDocument({
      id: 'file_big',
      storyId: STORY,
      parentId: 'folder_empty',
      type: 'file',
      title: 'Scans',
      mime: 'application/pdf',
    })
    // A file that says it is too large, without the memory of one that is.
    bytes.held.set('file_big', { size: EXPORT_MOST + 1 })

    const answer = await exportFor(APP, asking, { path: 'empty/Scans' })

    expect(answer.error).toContain('more than can be handed over at once (256 MB)')
    expect(native.offered).toEqual([])
  })
})
