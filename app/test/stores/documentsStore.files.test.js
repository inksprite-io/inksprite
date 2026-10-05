import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDocumentsStore } from '@/stores/documentsStore'

vi.mock('@/stores/db', () => ({
  default: {
    documents: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
      bulkGet: vi.fn(async () => []),
    },
  },
}))

const trackChange = vi.fn()
const trackDelete = vi.fn()
vi.mock('@/stores/syncStore', () => ({ useSyncStore: () => ({ trackChange, trackDelete }) }))

describe('documentsStore, with files', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    store = useDocumentsStore()
  })

  const file = (extra = {}) =>
    store.createDocument({
      storyId: 'story_1',
      parentId: 'story_1',
      type: 'file',
      title: 'paper',
      content: '[p.1]\nHello world',
      mime: 'application/pdf',
      size: 100,
      pages: 1,
      ...extra,
    })

  it('creates a file with its text, its type, and its size', () => {
    const made = file()

    expect(made).toMatchObject({
      type: 'file',
      content: '[p.1]\nHello world',
      mime: 'application/pdf',
      size: 100,
      pages: 1,
      plain: true,
      ordered: false,
    })
    expect(made.wordCount).toBe(3)
  })

  it('leaves off what a file was not given', () => {
    const made = file({ mime: undefined, size: undefined, pages: undefined })

    expect('mime' in made).toBe(false)
    expect('size' in made).toBe(false)
    expect('pages' in made).toBe(false)
  })

  it('does not put file fields on a text document or a folder', () => {
    const text = store.createDocument({
      storyId: 'story_1',
      parentId: 'story_1',
      type: 'text',
      title: 't',
      mime: 'application/pdf',
      size: 5,
    })
    const folder = store.createDocument({
      storyId: 'story_1',
      parentId: 'story_1',
      type: 'folder',
      title: 'f',
      content: 'ignored',
      pages: 5,
    })

    expect('mime' in text).toBe(false)
    expect('plain' in text).toBe(false)
    expect(folder.content).toBe('')
    expect(folder.wordCount).toBe(0)
    expect('pages' in folder).toBe(false)
  })

  it('recounts the words when a file’s text is corrected', () => {
    const made = file()
    const next = store.updateDocument(made.id, { content: 'one two three four' })

    expect(next.wordCount).toBe(4)
  })

  it('deletes a file’s bytes with its row', () => {
    const made = file()

    store.deleteDocument(made.id)

    expect(store.getDocument(made.id)).toBeNull()
    expect(trackDelete).toHaveBeenCalledWith('documents', made.id)
    expect(trackDelete).toHaveBeenCalledWith('files', made.id)
  })

  it('touches the files table only for a file', () => {
    const text = store.createDocument({
      storyId: 'story_1',
      parentId: 'story_1',
      type: 'text',
      title: 't',
    })

    store.deleteDocument(text.id)

    expect(trackDelete).toHaveBeenCalledWith('documents', text.id)
    expect(trackDelete).not.toHaveBeenCalledWith('files', expect.anything())
  })
})
