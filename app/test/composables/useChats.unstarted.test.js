import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useChats, clearChatsInstances } from '@/composables/useChats'
import { useChatsStore } from '@/stores/chatsStore'
import { ADVENTURE_PROFILE_ID, CHAT_PROFILE_ID, getBuiltInProfile } from '@/ai/profiles/index.js'

vi.mock('@/stores/db', () => {
  const empty = () => ({
    toArray: vi.fn(async () => []),
    where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
  })
  return { default: { chats: empty(), messages: empty(), stories: empty(), chatProfiles: empty() } }
})

const trackChange = vi.fn()
vi.mock('@/stores/syncStore', () => ({ useSyncStore: () => ({ trackChange }) }))

describe('useChats unstarted chat', () => {
  /** @type {ReturnType<typeof useChats>} */
  let chats
  /** @type {ReturnType<typeof useChatsStore>} */
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    clearChatsInstances()
    vi.clearAllMocks()
    store = useChatsStore()
    chats = useChats('story_1')
  })

  it('has an id and the project profile’s settings, and no row', () => {
    const { id, profileId } = chats.unstartedChat.value
    expect(chats.isUnstarted(id)).toBe(true)
    expect(profileId).toBe(CHAT_PROFILE_ID)
    expect(chats.getChatById(id)).toBeNull()
    expect(chats.chats.value).toHaveLength(0)
  })

  it('keeps changes to its settings without saving anything', () => {
    chats.updateUnstartedChat({ rules: 'Keep it short.' })
    expect(chats.unstartedChat.value.rules).toBe('Keep it short.')
    expect(trackChange).not.toHaveBeenCalled()
    expect(chats.chats.value).toHaveLength(0)
  })

  it('becomes a chat under its own id, with its settings, when started', () => {
    const adventure = getBuiltInProfile(ADVENTURE_PROFILE_ID)
    const { id } = chats.unstartedChat.value
    chats.updateUnstartedChat({ profileId: adventure.id, rules: 'No dragons.' })

    const chat = chats.startChat()

    expect(chat.id).toBe(id)
    expect(chat).toMatchObject({
      storyId: 'story_1',
      profileId: adventure.id,
      rules: 'No dragons.',
    })
    expect(store.chats.get(id)).toEqual(chat)
    expect(trackChange).toHaveBeenCalledWith('chats', id, chat)
  })

  it('has a fresh one ready behind it once started', () => {
    chats.updateUnstartedChat({ rules: 'No dragons.' })
    const started = chats.startChat()

    const next = chats.unstartedChat.value
    expect(next.id).not.toBe(started.id)
    expect(next.rules).toBeUndefined()
    expect(chats.isUnstarted(started.id)).toBe(false)
  })

  it('is no id at all to a null one', () => {
    expect(chats.isUnstarted(null)).toBe(false)
    expect(chats.isUnstarted(undefined)).toBe(false)
  })
})
