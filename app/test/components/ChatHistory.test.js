import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import PrimeVue from 'primevue/config'
import ChatHistory from '../../src/components/writer/chats/ChatHistory.vue'

const { mockReadChatFile, mockImportChat, mockAttach, toast, chatList, tabs } = vi.hoisted(() => ({
  mockReadChatFile: vi.fn(),
  mockImportChat: vi.fn(),
  mockAttach: vi.fn(),
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  chatList: { chats: [] },
  tabs: {
    open: vi.fn(),
    openNew: vi.fn(),
    active: 'chat_1',
    unread: new Set(),
    working: new Set(),
  },
}))

vi.mock('../../src/composables/useChats', () => ({
  useChats: () => ({
    init: vi.fn(async () => {}),
    chats: ref(chatList.chats),
    chatMessages: ref(new Map()),
    importChat: mockImportChat,
    unstartedChat: ref({ id: 'chat_unstarted' }),
  }),
}))
vi.mock('../../src/composables/useChatTabs.js', () => ({
  useChatTabs: () => ({
    open: tabs.open,
    openNew: tabs.openNew,
    activeChatId: ref(tabs.active),
    isUnread: id => tabs.unread.has(id),
  }),
}))
vi.mock('../../src/composables/useChatActivity.js', () => ({
  isWorking: id => tabs.working.has(id),
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
    tabs.unread = new Set()
    tabs.working = new Set()
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

  describe('as tabs', () => {
    beforeEach(() => {
      chatList.chats = [
        { id: 'chat_1', title: 'Plot holes', created: 1 },
        { id: 'chat_2', title: 'Names', created: 2 },
        { id: 'chat_3', title: 'Ideas', created: 3 },
      ]
    })

    const card = (wrapper, id) =>
      wrapper.findAllComponents({ name: 'ChatHistoryCard' }).find(c => c.props('chatId') === id)

    it('opens a chat picked from it as a preview, and says which', async () => {
      const wrapper = mountHistory()
      card(wrapper, 'chat_2').vm.$emit('select', 'chat_2')

      expect(tabs.open).toHaveBeenCalledWith('chat_2', { preview: true })
      expect(wrapper.emitted('select-chat')).toEqual([['chat_2']])
    })

    it('opens the unstarted chat on New chat', async () => {
      const wrapper = mountHistory()
      await wrapper.find('[aria-label="New chat"]').trigger('click')

      expect(tabs.openNew).toHaveBeenCalled()
      expect(wrapper.emitted('select-chat')).toEqual([['chat_unstarted']])
    })

    it('marks the chat showing, one the model is working in, and one unread', () => {
      tabs.working = new Set(['chat_2'])
      tabs.unread = new Set(['chat_3'])
      const wrapper = mountHistory()

      expect(card(wrapper, 'chat_1').props()).toMatchObject({
        active: true,
        busy: false,
        unread: false,
      })
      expect(card(wrapper, 'chat_2').props()).toMatchObject({ active: false, busy: true })
      expect(card(wrapper, 'chat_3').props()).toMatchObject({ busy: false, unread: true })
    })
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
      expect(tabs.open).toHaveBeenCalledWith('chat_new')
      expect(wrapper.emitted('select-chat')).toEqual([['chat_new']])
    })
  })

  describe('importing one from SillyTavern', () => {
    beforeEach(() => {
      mockReadChatFile.mockResolvedValue({
        chat: { title: 'Elara - Branch #4' },
        messages: [],
        character: 'Elara',
      })
    })

    it('puts it onto the card for who it was with', async () => {
      mockAttach.mockResolvedValue({ card: { title: 'Elara' }, named: 1 })
      const wrapper = mountHistory()

      await pick(wrapper)

      expect(mockAttach).toHaveBeenCalledWith('chat_new', 'Elara')
      expect(toast.warning).not.toHaveBeenCalled()
      expect(wrapper.emitted('select-chat')).toEqual([['chat_new']])
    })

    it('says so when there is no card for them, and imports it anyway', async () => {
      mockAttach.mockResolvedValue({ card: null, named: 0 })
      const wrapper = mountHistory()

      await pick(wrapper)

      expect(toast.warning).toHaveBeenCalledWith(
        "This project has no card for Elara, so the chat isn't linked to one."
      )
      expect(wrapper.emitted('select-chat')).toEqual([['chat_new']])
    })

    it('says so when there are two cards for them', async () => {
      mockAttach.mockResolvedValue({ card: null, named: 2 })
      const wrapper = mountHistory()

      await pick(wrapper)

      expect(toast.warning).toHaveBeenCalledWith(
        "This project has more than one card for Elara, so the chat isn't linked to either."
      )
    })
  })

  it('says why when the file is not a chat', async () => {
    mockReadChatFile.mockRejectedValue(new Error('That file is not valid JSON.'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mountHistory()

    await pick(wrapper)

    expect(toast.error).toHaveBeenCalledWith(
      "The chat couldn't be imported. That file is not valid JSON."
    )
    expect(mockImportChat).not.toHaveBeenCalled()
  })
})
