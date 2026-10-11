import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  projectOverview,
  pinnedDocuments,
  documentLocator,
  executeAppendDocument,
  executeEditDocument,
  executeListComments,
  executeListDocuments,
  executeReadDocument,
  executeSearchDocuments,
} from '@/ai/tools/documents.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useChatsStore } from '@/stores/chatsStore'
import { clearDocumentInstances } from '@/composables/useDocuments'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

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

const STORY = 'story_1'

describe('a chat that plays a card', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store
  /** @type {any} */
  let description
  /** @type {any} */
  let oath
  /** A chat on the card, with names. */
  let playing = ''
  /** A chat working on the card, with none. */
  let working = ''

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    store = useDocumentsStore()
    vi.clearAllMocks()
    await projectOverview(STORY)

    const folder = store.createDocument({
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'folder',
      title: 'Elara',
      kind: 'card',
    })
    const document = (title, content) =>
      store.createDocument({
        storyId: STORY,
        parentId: folder.id,
        type: 'text',
        title,
        content,
        plain: true,
      })
    description = document('Description', '{{char}} is a knight. {{user}} met her on the road.')
    oath = document("{{char}}'s Oath", 'Sworn to guard {{user}} until the river freezes.')

    const chats = useChatsStore()
    playing = chats.createChat(STORY).id
    chats.updateChat(playing, { userName: 'Riley', characterName: 'Elara' })
    working = chats.createChat(STORY).id
  })

  const as = chatId => ({ storyId: STORY, chatId })

  it('reads the card with the names in', async () => {
    const read = await executeReadDocument({ path: 'Elara/Description' }, as(playing))

    expect(read.content).toBe('Elara is a knight. Riley met her on the road.')
  })

  it('reads the macros as written in a chat with no names', async () => {
    const read = await executeReadDocument({ path: 'Elara/Description' }, as(working))

    expect(read.content).toBe('{{char}} is a knight. {{user}} met her on the road.')
  })

  it('lists a title with a macro in it by the name, and reads it there', async () => {
    const listing = await executeListDocuments({}, as(playing))
    expect(listing).toContain("Elara/Elara's Oath")
    expect(listing).not.toContain('{{char}}')

    const read = await executeReadDocument({ path: "Elara/Elara's Oath" }, as(playing))
    expect(read.content).toBe('Sworn to guard Riley until the river freezes.')
  })

  it('finds what it searches for by the names', async () => {
    const { results } = await executeSearchDocuments({ query: 'Riley met her' }, as(playing))

    expect(results.map(hit => hit.path)).toEqual(['Elara/Description'])
    expect(results[0].passages[0].text).toContain('Riley met her')
  })

  it('pins with the names in the path', async () => {
    useChatsStore().updateChat(playing, { pinnedIds: [oath.id] })

    const pinned = await pinnedDocuments(STORY, useChatsStore().getChatById(playing))

    expect(pinned.map(entry => entry.path)).toEqual(["Elara/Elara's Oath"])
  })

  it('edits the passage it quoted, and leaves the macros it did not touch', async () => {
    const result = await executeEditDocument(
      { path: 'Elara/Description', old: 'Riley met her on the road', new: 'Riley found her' },
      as(playing)
    )

    expect(result.success).toBe(true)
    expect(store.getDocument(description.id).content).toBe('{{char}} is a knight. Riley found her.')
  })

  it('refuses a quote that is there twice as it reads, however the document spells it', async () => {
    store.updateDocument(description.id, { content: 'Elara waits. {{char}} waits.' })

    const result = await executeEditDocument(
      { path: 'Elara/Description', old: 'Elara waits.', new: 'Elara leaves.' },
      as(playing)
    )

    expect(result.error).toMatch(/appears 2 times/)
    expect(store.getDocument(description.id).content).toBe('Elara waits. {{char}} waits.')
  })

  it('shows the nearest lines with the names in when a quote is not there', async () => {
    const result = await executeEditDocument(
      { path: 'Elara/Description', old: 'Elara is a squire.', new: 'x' },
      as(playing)
    )

    expect(result.nearest).toContain('Elara is a knight.')
  })

  it("lists the writer's comments with the names in", async () => {
    store.updateDocument(description.id, {
      content: '{=={{char}} is a knight.==}{>>cabcd3: Does {{user}} know?<<}',
    })

    const { comments } = await executeListComments({ path: 'Elara/Description' }, as(playing))

    expect(comments).toEqual([
      {
        id: 'cabcd3',
        path: 'Elara/Description',
        text: 'Elara is a knight.',
        comment: 'Does Riley know?',
      },
    ])
  })

  it('writes what it appends as written', async () => {
    await executeAppendDocument({ path: 'Elara/Description', text: 'Elara nods.' }, as(playing))

    expect(store.getDocument(description.id).content).toMatch(
      /\{\{user\}\} met her.*Elara nods\.$/s
    )
  })

  it('does not take the names for a change to the document', async () => {
    const locate = await documentLocator(STORY, useChatsStore().getChatById(playing))

    // A read's note hashes the text as stored; the names are not an edit.
    expect(locate(description.id)).toEqual({
      path: 'Elara/Description',
      text: '{{char}} is a knight. {{user}} met her on the road.',
    })
  })
})
