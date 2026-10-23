import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { executeDeleteDocument, applyProposal, DELETE_PROPOSED_NOTE } from '@/ai/tools/documents.js'
import { describeEdit } from '@/ai/tools/progress.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances, useDocuments } from '@/composables/useDocuments'

vi.mock('@/stores/db', () => ({
  default: {
    documents: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
      bulkGet: vi.fn(async () => []),
    },
    stories: { toArray: vi.fn(async () => []) },
  },
}))

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const STORY = 'story_1'

describe('delete_document', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store
  /** @type {ReturnType<typeof useDocuments>} */
  let api
  /** @type {any[]} */
  let edits

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    store = useDocumentsStore()
    api = useDocuments(STORY)
    await api.init()
    edits = []
    const notes = api.createFolder('root_story_1', 'Notes')
    api.createTextDocument(notes.id, 'Elara', 'A thief.')
    api.createTextDocument(notes.id, 'Marta', 'A guard.')
    api.createTextDocument('root_story_1', 'Chapter 1', 'Snow fell.')
  })

  const idOf = path => store.trashedOf(STORY).find(doc => doc.title === path)?.id

  it('moves a folder to the trash with what is in it, and records it', async () => {
    const result = await executeDeleteDocument({ path: 'Notes' }, { storyId: STORY, edits })

    expect(result).toMatchObject({
      success: true,
      deleted: { path: 'Notes', type: 'folder', inside: 2 },
    })
    expect(api.childrenOf('root_story_1').map(doc => doc.title)).toEqual(['Chapter 1'])
    expect(store.trashedOf(STORY).map(doc => doc.title)).toEqual(['Notes'])
    expect(edits).toEqual([
      expect.objectContaining({ tool: 'delete_document', path: 'Notes', old: '', new: '' }),
    ])
  })

  it('refuses the project, and what it cannot find', async () => {
    expect(await executeDeleteDocument({ path: '/' }, { storyId: STORY })).toHaveProperty('error')
    expect(await executeDeleteDocument({ path: 'Nowhere' }, { storyId: STORY })).toEqual({
      error: 'No document at "Nowhere". list_documents shows what the project holds.',
    })
  })

  it('says where what goes by the name is, and deletes nothing', async () => {
    const result = await executeDeleteDocument({ path: 'Elara' }, { storyId: STORY, edits })

    expect(result).toEqual({ error: 'No document at "Elara". "Notes/Elara" goes by that name.' })
    expect(store.trashedOf(STORY)).toEqual([])
    expect(edits).toEqual([])
  })

  it('refuses a folder holding a document kept from the model', async () => {
    const notes = api.childrenOf('root_story_1').find(doc => doc.title === 'Notes')
    const marta = api.childrenOf(notes.id).find(doc => doc.title === 'Marta')
    api.setHidden(marta.id, true)

    const result = await executeDeleteDocument({ path: 'Notes' }, { storyId: STORY })

    expect(result.error).toContain('kept from this chat')
    expect(store.trashedOf(STORY)).toEqual([])
  })

  it('asks first when the chat does, and deletes once accepted', async () => {
    const result = await executeDeleteDocument(
      { path: 'Chapter 1' },
      { storyId: STORY, edits, propose: true }
    )

    expect(result).toEqual({
      proposed: true,
      document: { path: 'Chapter 1', type: 'text' },
      note: DELETE_PROPOSED_NOTE,
    })
    expect(api.childrenOf('root_story_1').map(doc => doc.title)).toContain('Chapter 1')
    expect(describeEdit(edits[0])).toEqual({ verb: 'Deleting', path: 'Chapter 1' })

    expect(await applyProposal(STORY, edits[0])).toMatchObject({ path: 'Chapter 1' })
    expect(store.trashedOf(STORY).map(doc => doc.title)).toEqual(['Chapter 1'])
  })

  it('says what a folder it asks to delete holds, since the writer is told', async () => {
    const result = await executeDeleteDocument(
      { path: 'Notes' },
      { storyId: STORY, edits, propose: true }
    )

    expect(result.document).toEqual({ path: 'Notes', type: 'folder', inside: 2 })
    expect(store.trashedOf(STORY)).toEqual([])
  })

  it('comes back from the trash when the turn is rewound, and goes again when it is redone', async () => {
    await executeDeleteDocument({ path: 'Chapter 1' }, { storyId: STORY, edits })
    const id = idOf('Chapter 1')

    expect(api.revertEdit(edits[0])).toBe(true)
    expect(api.get(id)?.title).toBe('Chapter 1')

    expect(await api.reapplyEdit(edits[0])).toBe(true)
    expect(api.get(id)).toBeNull()
    expect(idOf('Chapter 1')).toBe(id)
  })
})
