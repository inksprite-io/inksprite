import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/composables/useChats', () => ({ useChats: vi.fn() }))
const explore = vi.hoisted(() => ({ exploreFor: vi.fn() }))
vi.mock('@/ai/tools/explore.js', async importOriginal => ({
  ...(await importOriginal()),
  ...explore,
}))

describe('/explore in the writer’s turn', () => {
  let chatsApi
  let commands

  beforeEach(async () => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    chatsApi = {
      addMessage: vi.fn().mockReturnValue({ id: 'msg_e', role: 'user', content: '' }),
      updateMessage: vi.fn(),
      streamMessageContent: vi.fn(),
      getMessageById: vi.fn().mockReturnValue({
        value: { id: 'msg_e', segments: [{ type: 'command', command: { name: 'explore' } }] },
      }),
      writeSegment: vi.fn(),
      writeTurn: vi.fn(),
      getMessagesForChat: vi.fn().mockReturnValue({ value: [] }),
    }
    const { useChats } = await import('@/composables/useChats')
    useChats.mockReturnValue(chatsApi)
    const { useChatCommands } = await import('@/composables/useChatCommands')
    commands = useChatCommands('story_1', 'chat_1')
  })

  it('says how far it has got while it runs, and then only what it found', async () => {
    explore.exploreFor.mockImplementation(async (asked, context) => {
      context.progress('1 of 3 requests')
      context.progress('2 of 3 requests')
      return { path: 'Notes/', name: 'Notes/', about: 'The cast, one entry each.' }
    })

    const { spoken } = await commands.submit('/explore Notes', { consult: vi.fn() })

    const written = chatsApi.writeSegment.mock.calls.map(call => call[2])
    expect(written.filter(command => command.pending).map(command => command.progress)).toEqual([
      '1 of 3 requests',
      '2 of 3 requests',
    ])
    const filled = written.at(-1)
    expect(filled).toMatchObject({ label: 'Notes/', result: 'The cast, one entry each.' })
    expect(filled.progress).toBeUndefined()
    expect(filled.pending).toBeUndefined()
    // Settling what there is to read is not asking for a turn.
    expect(spoken).toBe('')
  })
})
