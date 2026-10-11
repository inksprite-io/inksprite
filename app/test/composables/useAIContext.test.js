import { describe, it, expect, beforeEach, vi } from 'vitest'

const { buildContext, chat } = vi.hoisted(() => ({
  buildContext: vi.fn(async () => ({ messages: [] })),
  /** The chat being built for, as the mocked store holds it. */
  chat: { value: /** @type {any} */ (null) },
}))

vi.mock('@/stores/documentsStore.js', () => ({ useDocumentsStore: () => ({}) }))
vi.mock('@/stores/chatsStore.js', () => ({
  useChatsStore: () => ({ getChatById: () => chat.value }),
}))
vi.mock('@/stores/messagesStore.js', () => ({ useMessagesStore: () => ({}) }))
vi.mock('@/ai/context/build.js', () => ({ buildContext }))
vi.mock('@/ai/tools/documents.js', () => ({ projectOverview: vi.fn(async () => null) }))
vi.mock('@/ai/tools/index.js', () => ({
  keptInConversation: name => name === 'read_document',
}))

const { useAIContext } = await import('@/composables/useAIContext')

/**
 * Build one chat context and return the options the builder was handed.
 * @param {Object} [args] - More for the build
 */
async function optionsGiven(args = {}) {
  await useAIContext('story_1').build({
    mode: 'chat',
    systemPrompt: 'Hi',
    chatId: 'chat_1',
    ...args,
  })
  return buildContext.mock.calls.at(-1)[2]
}

describe('useAIContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chat.value = null
  })

  it("hands the builder the author's note it was given", async () => {
    // The caller's, as the profile the chat runs on reads it, rather than the
    // chat's as it was stamped. See `noteOnProfile`.
    chat.value = { id: 'chat_1', rules: 'Never write for the player.' }

    expect((await optionsGiven({ note: 'Write for nobody.' })).note).toBe('Write for nobody.')
  })

  it('hands the builder which calls an older turn keeps: the document tools', async () => {
    const { keeps } = await optionsGiven()

    expect(keeps('read_document')).toBe(true)
    expect(keeps('oracle')).toBe(false)
  })

  it('hands it none when given none', async () => {
    chat.value = { id: 'chat_1', rules: 'Never write for the player.' }

    expect((await optionsGiven()).note).toBeUndefined()
  })
})
