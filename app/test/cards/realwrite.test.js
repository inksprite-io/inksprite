import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { cardFromPng } from '@/cards/png.js'
import { shapeOf, readCard, readLorebook } from '@/cards/card.js'
import { writeCard, writeLorebook } from '@/cards/write.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances } from '@/composables/useDocuments'

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
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

/**
 * The real files, written all the way into a tree. See `./real.test.js` for
 * why these are not in the repository and why it is worth running over them
 * anyway. The sizes here are the point: a book of a thousand entries is a
 * thousand documents, and nothing about that should be special.
 */
const DIR = 'harness/test-cards'
const files = existsSync(DIR) ? readdirSync(DIR).filter(name => /\.(png|json)$/.test(name)) : []

describe.skipIf(files.length === 0)('writing the cards people actually share', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    clearDocumentInstances()
  })

  it.each(files)('writes %s into a tree', async name => {
    const store = useDocumentsStore()
    const bytes = readFileSync(join(DIR, name))
    const value = name.endsWith('.png') ? cardFromPng(bytes) : JSON.parse(bytes.toString('utf8'))

    const written =
      shapeOf(value) === 'lorebook'
        ? await writeLorebook('s1', readLorebook(value))
        : await writeCard('s1', readCard(value), { userName: 'Riley' })

    // Everything but the project root, which `init` lays down before any of
    // this and which the import did not write.
    const documents = [...store.documents.values()].filter(document => document.id !== 'root_s1')

    expect(written.title.trim()).toBeTruthy()
    expect(documents).toHaveLength(written.documents)
    // Every document is findable and every pin names one of them.
    expect(documents.every(document => document.title.trim())).toBe(true)
    expect(written.pinnedIds.every(id => store.getDocument(id))).toBe(true)
    // Nothing the writer will open is left as a macro for the editor to
    // explain. The sidecar is the exception and the point of it: it is the
    // card as it arrived, macros and all.
    const theirs = documents.filter(document => document.kind !== 'sidecar')
    expect(theirs.some(document => /\{\{\s*(char|user)\s*\}\}/i.test(document.content))).toBe(false)
  })
})
