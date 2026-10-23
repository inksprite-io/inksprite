import { describe, it, expect, beforeEach, vi } from 'vitest'

const {
  buildContext,
  chat,
  projectOverview,
  pinnedDocuments,
  documentLocator,
  settledSuggestions,
} = vi.hoisted(() => ({
  buildContext: vi.fn(async () => ({ messages: [] })),
  /** The chat being built for, as the mocked store holds it. */
  chat: { value: /** @type {any} */ (null) },
  projectOverview: vi.fn(async (_storyId, _chat, { size = true } = {}) => ({
    project: 'Harbour',
    ...(size ? { size: { documents: 3, folders: 1 } } : {}),
  })),
  /** What the chat pins, as the documents its `pinnedIds` name. */
  pinnedDocuments: vi.fn(async (_storyId, chat) =>
    (chat?.pinnedIds || []).map(id => ({ id, path: `/${id}`, type: 'text' }))
  ),
  documentLocator: vi.fn(async () => () => null),
  settledSuggestions: vi.fn(async () => []),
}))

vi.mock('@/stores/documentsStore.js', () => ({ useDocumentsStore: () => ({}) }))
vi.mock('@/stores/chatsStore.js', () => ({
  useChatsStore: () => ({ getChatById: () => chat.value }),
}))
vi.mock('@/stores/messagesStore.js', () => ({ useMessagesStore: () => ({}) }))
vi.mock('@/ai/context/build.js', () => ({ buildContext }))
vi.mock('@/ai/tools/documents.js', () => ({
  projectOverview,
  pinnedDocuments,
  documentLocator,
  settledSuggestions,
}))
vi.mock('@/ai/tools/index.js', () => ({
  keptInConversation: name => name === 'read_document',
  // The group's switch stands for the document tools; tools/groups.test.js
  // has the rest of what turns them off.
  offersDocuments: selection => !(selection?.disabledGroups || []).includes('documents'),
  offersComments: selection => !(selection?.disabledGroups || []).includes('documents'),
}))

const { useAIContext } = await import('@/composables/useAIContext')

/**
 * Build one chat context and return the options the builder was handed.
 * @param {Object} [args] - More for the build
 */
async function optionsGiven(args = {}) {
  await useAIContext('story_1').build({
    systemPrompt: 'Hi',
    chatId: 'chat_1',
    ...args,
  })
  return buildContext.mock.calls.at(-1)[1]
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

  describe('the project block', () => {
    it('goes with a chat offered the document tools, with its size and its stale reads', async () => {
      chat.value = { id: 'chat_1' }

      const { project, pinned, locate } = await optionsGiven()

      expect(project).toEqual({ project: 'Harbour', size: { documents: 3, folders: 1 } })
      expect(pinned).toEqual([])
      expect(locate).toBeTypeOf('function')
    })

    it('stays out of a chat with the document tools off and nothing pinned', async () => {
      chat.value = { id: 'chat_1', disabledToolGroups: ['documents'] }

      const { project, locate } = await optionsGiven()

      expect(project).toBeNull()
      expect(locate).toBeUndefined()
      expect(projectOverview).not.toHaveBeenCalled()
    })

    it('goes with what a chat with no document tools pinned, and nothing it cannot reach', async () => {
      chat.value = { id: 'chat_1', disabledToolGroups: ['documents'], pinnedIds: ['doc_1'] }

      const { project, pinned, locate } = await optionsGiven()

      expect(project).toEqual({ project: 'Harbour' })
      expect(pinned.map(document => document.id)).toEqual(['doc_1'])
      expect(locate).toBeUndefined()
    })

    it('stays out when the model may call no tools, whatever the chat offers', async () => {
      chat.value = { id: 'chat_1' }

      expect((await optionsGiven({ toolsAllowed: false })).project).toBeNull()
    })

    it('goes with a pin when the model may call no tools', async () => {
      chat.value = { id: 'chat_1', pinnedIds: ['doc_1'] }

      const { project, pinned } = await optionsGiven({ toolsAllowed: false })

      expect(project).toEqual({ project: 'Harbour' })
      expect(pinned).toHaveLength(1)
    })
  })
})
