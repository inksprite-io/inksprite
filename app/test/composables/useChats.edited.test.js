import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useChats, clearChatsInstances } from '@/composables/useChats'
import { useDocumentsStore } from '@/stores/documentsStore'

vi.mock('@/stores/db', () => {
  const empty = () => ({
    toArray: vi.fn(async () => []),
    where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
  })
  return { default: { chats: empty(), messages: empty(), stories: empty(), chatProfiles: empty() } }
})

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

describe('useChats and when the project was last edited', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let documents

  beforeEach(() => {
    setActivePinia(createPinia())
    clearChatsInstances()
    documents = useDocumentsStore()
    documents.ensureRoot('story_1', 'Novel')
  })

  /** Take the project's last edit back to the start of time. */
  const forget = () => {
    const root = documents.getRoot('story_1')
    documents.documents.set(root.id, { ...root, edited: 1 })
  }

  it('counts a message added, changed or deleted as work on the project', () => {
    const chats = useChats('story_1')
    const chat = chats.startChat()

    forget()
    const message = chats.addMessage(chat.id, 'user', 'Hello')
    expect(documents.getRoot('story_1').edited).toBeGreaterThan(1)

    forget()
    chats.updateMessage(message.id, { content: 'Hello again' })
    expect(documents.getRoot('story_1').edited).toBeGreaterThan(1)

    forget()
    chats.deleteMessage(message.id)
    expect(documents.getRoot('story_1').edited).toBeGreaterThan(1)
  })

  it('counts a chat forked off as work on the project', () => {
    const chats = useChats('story_1')
    const source = chats.startChat()
    const message = chats.addMessage(source.id, 'user', 'Hello')

    forget()
    chats.forkChat(source.id, message.id)
    expect(documents.getRoot('story_1').edited).toBeGreaterThan(1)
  })
})
