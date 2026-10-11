import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import PrimeVue from 'primevue/config'
import ChatHistory from '../../src/components/writer/chats/ChatHistory.vue'

const { mockReadChatFile, mockImportChat, mockAttach, toast, chatList } = vi.hoisted(() => ({
  mockReadChatFile: vi.fn(),
  mockImportChat: vi.fn(),
  mockAttach: vi.fn(),
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  chatList: { chats: [] },
}))

vi.mock('../../src/composables/useChats', () => ({
  useChats: () => ({
    init: vi.fn(async () => {}),
    chats: ref(chatList.chats),
    chatMessages: ref(new Map()),
    importChat: mockImportChat,
  }),
}))
vi.mock('../../src/composables/useBackup', () => ({
  useBackup: () => ({ readChatFile: mockReadChatFile }),
}))
vi.mock('../../src/composables/useCardChat', () => ({
  useCardChat: () => ({ attach: mockAttach }),
}))
vi.mock('../../src/composables/useToast', () => ({ useToast: () => toast }))

describe('ChatHistory', () => {
  /** Pick a file in the hidden input, as the Import button's chooser would. */
  const pick = async (/** @type {any} */ wrapper) => {
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [{ name: 'chat' }], configurable: true })
    await input.trigger('change')
    await flushPromises()
  }

  const mountHistory = () =>
    mount(ChatHistory, {
      props: { storyId: 'story_1' },
      global: {
        plugins: [PrimeVue],
        stubs: { ChatHistoryCard: true },
        directives: { tooltip: {} },
      },
    })

  beforeEach(() => {
    vi.clearAllMocks()
    chatList.chats = []
    mockImportChat.mockReturnValue({ id: 'chat_new', title: 'Elara - Branch #4' })
  })

  describe('with no chats yet', () => {
    it('offers no search, with nothing to search', () => {
      expect(mountHistory().find('[data-chat-search]').exists()).toBe(false)
    })

    it('says where to start one, without assuming a story', () => {
      const text = mountHistory().text()

      expect(text).toContain('No chats yet')
      expect(text).not.toMatch(/story/i)
    })
  })

  it('offers a search once there are chats', () => {
    chatList.chats = [{ id: 'chat_1', title: 'Plot holes', created: 1 }]

    expect(mountHistory().find('[data-chat-search]').exists()).toBe(true)
  })

  it('takes a SillyTavern chat as well as one of its own', () => {
    expect(mountHistory().find('input[type="file"]').attributes('accept')).toContain('.jsonl')
  })

  describe('importing a chat of its own', () => {
    beforeEach(() => {
      mockReadChatFile.mockResolvedValue({ chat: { title: 'Plot holes' }, messages: [] })
    })

    it('imports it, opens it, and looks for no card', async () => {
      const wrapper = mountHistory()

      await pick(wrapper)

      expect(mockImportChat).toHaveBeenCalledWith({ title: 'Plot holes' }, [], undefined)
      expect(mockAttach).not.toHaveBeenCalled()
      expect(wrapper.emitted('select-chat')).toEqual([['chat_new']])
    })
  })

  describe('importing one from SillyTavern', () => {
    beforeEach(() => {
      mockReadChatFile.mockResolvedValue({
        chat: { title: 'Elara - Branch #4' },
        messages: [],
        character: 'Elara',
        note: '[Slow burn.]',
      })
    })

    it('puts it onto the card for who it was with', async () => {
      mockAttach.mockResolvedValue({ title: 'Elara' })
      const wrapper = mountHistory()

      await pick(wrapper)

      expect(mockAttach).toHaveBeenCalledWith('chat_new', 'Elara', { note: '[Slow burn.]' })
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('onto the Elara card'))
      expect(wrapper.emitted('select-chat')).toEqual([['chat_new']])
    })

    it('says so when there is no one card for them, and imports it anyway', async () => {
      mockAttach.mockResolvedValue(null)
      const wrapper = mountHistory()

      await pick(wrapper)

      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('no one card for Elara'))
      expect(toast.success).not.toHaveBeenCalled()
      expect(wrapper.emitted('select-chat')).toEqual([['chat_new']])
    })
  })

  it('says why when the file is not a chat', async () => {
    mockReadChatFile.mockRejectedValue(new Error('That file is not valid JSON.'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mountHistory()

    await pick(wrapper)

    expect(toast.error).toHaveBeenCalledWith('That file is not valid JSON.')
    expect(mockImportChat).not.toHaveBeenCalled()
  })
})
