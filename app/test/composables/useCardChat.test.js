import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCardChat } from '@/composables/useCardChat'
import { shelfFor, writeCard } from '@/cards/write.js'
import { readCard } from '@/cards/card.js'
import { clearDocumentInstances } from '@/composables/useDocuments'
import { clearChatsInstances } from '@/composables/useChats'
import { ROLEPLAY_PROFILE_ID, ROLEPLAY_NSFW_PROFILE_ID } from '@/ai/profiles/index.js'
import {
  DEFAULT_ROLEPLAY_NOTE,
  DEFAULT_ROLEPLAY_PROMPT,
  DEFAULT_ROLEPLAY_NSFW_NOTE,
  DEFAULT_ROLEPLAY_NSFW_PROMPT,
} from '@/ai/prompts/index.js'
import { useProfiles } from '@/composables/useProfiles'
import { useApplicationState } from '@/composables/useApplicationState'

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
    chatProfiles: { toArray: vi.fn(async () => []), filter: vi.fn(), bulkDelete: vi.fn() },
  },
}))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const { chats, messages, mockCreateChat, mockUpdateChat, mockAddMessage } = vi.hoisted(() => {
  const chats = new Map()
  const messages = []
  return {
    chats,
    messages,
    mockCreateChat: vi.fn((storyId, title, _id, initial) => {
      const chat = { id: `chat_${chats.size + 1}`, storyId, title, ...initial }
      chats.set(chat.id, chat)
      return chat
    }),
    mockUpdateChat: vi.fn((id, updates) => Object.assign(chats.get(id), updates)),
    mockAddMessage: vi.fn((chatId, role, content) => {
      messages.push({ chatId, role, content })
      return messages.at(-1)
    }),
  }
})

vi.mock('@/stores/chatsStore', () => ({
  generateChatId: () => 'chat_unstarted',
  useChatsStore: () => ({
    chats,
    loadChatsForStory: vi.fn(async () => {}),
    getChatsForStory: () => [...chats.values()],
    createChat: mockCreateChat,
    updateChat: mockUpdateChat,
  }),
}))
vi.mock('@/stores/messagesStore', () => ({
  useMessagesStore: () => ({
    messages: new Map(),
    loadMessagesForChat: vi.fn(async () => {}),
    getMessagesForChat: () => [],
    createMessage: mockAddMessage,
  }),
}))
vi.mock('@/stores/storiesStore', () => ({ useStoriesStore: () => ({ getStory: () => null }) }))

const STORY = 'story_1'

describe('useCardChat', () => {
  /** @type {ReturnType<typeof useCardChat>} */
  let cardChats

  beforeEach(() => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    clearChatsInstances()
    chats.clear()
    messages.length = 0
    vi.clearAllMocks()
    useApplicationState().resetState()
    cardChats = useCardChat(STORY)
  })

  const imported = (data = {}, options = {}) =>
    writeCard(
      STORY,
      readCard({
        spec: 'chara_card_v2',
        data: { name: 'Elara', description: 'A knight.', first_mes: 'Well?', ...data },
      }),
      options
    )

  /** Start a chat on a card the way the dialog does: with a name. */
  const begin = async (folderId, options = {}) =>
    cardChats.start(await cardChats.read(folderId), { userName: 'Riley', ...options })

  it('starts the chat on the Roleplay profile, named for the card', async () => {
    const written = await imported()

    const chat = await begin(written.folderId)

    // Not a feature of cards: a profile being applied.
    expect(mockCreateChat).toHaveBeenCalledWith(STORY, 'Elara', null, expect.any(Object))
    expect(chat.profileId).toBe(ROLEPLAY_PROFILE_ID)
    expect(chat.disabledToolGroups).toEqual(['documents', 'rpg', 'skills'])
  })

  it('starts it on Roleplay (NSFW) with NSFW profiles switched on', async () => {
    useApplicationState().setNsfwProfiles(true)
    const written = await imported()

    const chat = await begin(written.folderId)

    expect(chat.profileId).toBe(ROLEPLAY_NSFW_PROFILE_ID)
    expect(chat.rules).toBe(DEFAULT_ROLEPLAY_NSFW_NOTE)
  })

  it("starts a card's own prompt from Roleplay (NSFW)'s with them switched on", async () => {
    useApplicationState().setNsfwProfiles(true)
    const written = await imported(
      { system_prompt: '{{original}}\n\nElara never lies.' },
      { useSystemPrompt: true }
    )

    const chat = await begin(written.folderId)

    const prompt = useProfiles().getProfile(chat.profileId).settings.prompt
    expect(prompt.startsWith(DEFAULT_ROLEPLAY_NSFW_PROMPT.trim())).toBe(true)
    expect(prompt.endsWith('Elara never lies.')).toBe(true)
  })

  it('pins the card so it is in context before anything is said', async () => {
    const written = await imported()

    const chat = await begin(written.folderId)

    expect(chat.pinnedIds).toEqual(written.pinnedIds)
  })

  it('hides the other characters on its shelf, and shows its own', async () => {
    const shelf = await shelfFor(STORY, 'characters')
    const written = await imported({}, { parentId: shelf })

    const chat = await begin(written.folderId)

    // The shelf rather than each card on it, so one imported next week is
    // hidden too.
    expect(chat.hiddenIds).toEqual([shelf])
    expect(chat.shownIds).toEqual([written.folderId])
  })

  it('hides nothing for a card that is not on the shelf', async () => {
    const written = await imported()

    const chat = await begin(written.folderId)

    expect(chat.hiddenIds).toBeUndefined()
    expect(chat.shownIds).toBeUndefined()
  })

  it('opens with the greeting, as an ordinary message', async () => {
    const written = await imported()

    await begin(written.folderId)

    // The opening turn sets voice and length by example before anything has
    // been asked, and it is a message so the writer can retry or delete it.
    expect(messages).toEqual([expect.objectContaining({ role: 'assistant', content: 'Well?' })])
  })

  it('puts the names its macros become on the chat', async () => {
    const written = await imported({ nickname: 'The Knight' })

    const chat = await begin(written.folderId, { userName: ' Sam ' })

    // The character's name, not the card's: on a scenario card the two have
    // nothing to do with each other.
    expect(chat).toMatchObject({ userName: 'Sam', characterName: 'Elara' })
  })

  it('opens with the names in the greeting, and leaves the card as it was', async () => {
    const written = await imported({ first_mes: '{{char}} looks up. "Well, {{user}}?"' })

    await begin(written.folderId)

    expect(messages.at(-1).content).toBe('Elara looks up. "Well, Riley?"')
    expect((await cardChats.read(written.folderId)).greetings[0].content).toBe(
      '{{char}} looks up. "Well, {{user}}?"'
    )
  })

  it('starts from the name given last', async () => {
    const written = await imported()

    await begin(written.folderId, { userName: 'Sam' })

    expect(cardChats.lastUserName()).toBe('Sam')
  })

  it('opens with the greeting that was chosen', async () => {
    const written = await imported({ alternate_greetings: ['Second.', 'Third.'] })

    await begin(written.folderId, { greeting: 2 })

    expect(messages.at(-1).content).toBe('Third.')
  })

  it('falls back to the first greeting when the choice is gone', async () => {
    const written = await imported()

    await begin(written.folderId, { greeting: 9 })

    expect(messages.at(-1).content).toBe('Well?')
  })

  it("takes the card's rules over the profile's", async () => {
    const written = await imported({ post_history_instructions: 'Never write for them.' })

    const chat = await begin(written.folderId)

    // Both say how a turn is written, and two sets three tokens from
    // generation is an argument the model settles instead of writing.
    expect(chat.rules).toBe('Never write for them.')
  })

  it("puts the profile's note where the card says {{original}}", async () => {
    const written = await imported({
      post_history_instructions: '{{original}}\nThoughts in italics.',
    })

    const chat = await begin(written.folderId)

    // ST's rule: the card adds to the standing instructions instead of
    // replacing them, and says where.
    expect(chat.rules).toBe(`${DEFAULT_ROLEPLAY_NOTE}\nThoughts in italics.`)
  })

  it('keeps {{original}} in the card’s own document', async () => {
    const written = await imported({ post_history_instructions: '{{original}}\nItalics.' })

    // Resolved into the chat, not into the card: a chat started under another
    // profile later puts that profile's note there.
    expect((await cardChats.read(written.folderId)).rules).toBe('{{original}}\nItalics.')
  })

  it("puts the Roleplay prompt where a card's own prompt says {{original}}", async () => {
    const written = await imported(
      { system_prompt: '{{original}}\n\nElara never lies.' },
      { useSystemPrompt: true }
    )

    const chat = await begin(written.folderId)

    const prompt = useProfiles().getProfile(chat.profileId).settings.prompt
    expect(prompt.startsWith(DEFAULT_ROLEPLAY_PROMPT.trim())).toBe(true)
    expect(prompt.endsWith('Elara never lies.')).toBe(true)
  })

  it("keeps the profile's rules when the card brought none", async () => {
    const written = await imported()

    const chat = await begin(written.folderId)

    expect(chat.rules).toBe(DEFAULT_ROLEPLAY_NOTE)
  })

  it("saves a card's system prompt as a profile and points the chat at it", async () => {
    const written = await imported({ system_prompt: 'You are Elara.' }, { useSystemPrompt: true })

    const chat = await begin(written.folderId)

    // A prompt that exists only on one chat is a prompt nobody can find or
    // edit. As a profile it is in the library beside every other.
    expect(chat.profileId).not.toBe(ROLEPLAY_PROFILE_ID)
    expect(chat.profileId).toMatch(/^chatprofile_/)
  })

  it("keeps the Roleplay profile's settings under a card's own prompt", async () => {
    const written = await imported({ system_prompt: 'You are Elara.' }, { useSystemPrompt: true })

    const chat = await begin(written.folderId)

    // The prompt assumes no tools; a profile made from it has to assume the
    // same or the card is played with the tools it was written without.
    expect(chat.disabledToolGroups).toEqual(['documents', 'rpg', 'skills'])
  })

  it('says nothing about a folder that did not come from a card', async () => {
    expect(await cardChats.read('nothing_here')).toBeNull()
  })

  it('starts a chat with no opening when the card had no greeting', async () => {
    const written = await imported({ first_mes: '' })

    await begin(written.folderId)

    expect(messages).toEqual([])
  })

  describe('attach', () => {
    /** A chat as an import leaves it: on the Roleplay profile, with nobody in it. */
    const arrived = (settings = {}) =>
      mockCreateChat(STORY, 'Elara - Branch #4', null, {
        profileId: ROLEPLAY_PROFILE_ID,
        rules: 'Write one turn.',
        ...settings,
      })

    it('pins the card for the character the chat was with', async () => {
      const written = await imported()
      const chat = arrived()

      const card = await cardChats.attach(chat.id, 'Elara')

      expect(card.title).toBe('Elara')
      expect(chat.pinnedIds).toEqual(written.pinnedIds)
    })

    it('says nothing twice: the chat has its opening already', async () => {
      await imported()

      await cardChats.attach(arrived().id, 'Elara')

      expect(messages).toEqual([])
    })

    it("puts the card's rules in place of the profile's", async () => {
      await imported({ post_history_instructions: 'Stay in it.' })
      const chat = arrived()

      await cardChats.attach(chat.id, 'Elara')

      expect(chat.rules).toBe('Stay in it.')
    })

    it("keeps the chat's own note after the card's rules", async () => {
      await imported({ post_history_instructions: 'Stay in it.' })
      const chat = arrived({ rules: 'Write one turn.\n\n[Slow burn.]' })

      await cardChats.attach(chat.id, 'Elara', { note: '[Slow burn.]' })

      expect(chat.rules).toBe('Stay in it.\n\n[Slow burn.]')
    })

    it('puts the profile’s note where the card says {{original}}, and the chat’s after', async () => {
      await imported({ post_history_instructions: '{{original}}\nItalics.' })
      const chat = arrived({ rules: `${DEFAULT_ROLEPLAY_NOTE}\n\n[Slow burn.]` })

      await cardChats.attach(chat.id, 'Elara', { note: '[Slow burn.]' })

      expect(chat.rules).toBe(`${DEFAULT_ROLEPLAY_NOTE}\nItalics.\n\n[Slow burn.]`)
    })

    it('leaves the rules alone when the card has none', async () => {
      await imported()
      const chat = arrived({ rules: 'Write one turn.\n\n[Slow burn.]' })

      await cardChats.attach(chat.id, 'Elara', { note: '[Slow burn.]' })

      expect(chat.rules).toBe('Write one turn.\n\n[Slow burn.]')
    })

    it('does nothing when the character has no card here', async () => {
      await imported()
      const chat = arrived()

      expect(await cardChats.attach(chat.id, 'Seraphina')).toBeNull()
      expect(chat).not.toHaveProperty('pinnedIds')
      expect(mockUpdateChat).not.toHaveBeenCalled()
    })

    it('does not guess between two cards for one character', async () => {
      await imported()
      await imported({ description: 'A knight, revised.' })
      const chat = arrived()

      expect(await cardChats.attach(chat.id, 'Elara')).toBeNull()
      expect(chat).not.toHaveProperty('pinnedIds')
    })
  })
})
