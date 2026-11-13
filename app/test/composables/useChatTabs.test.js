import { describe, it, expect, beforeEach, vi } from 'vitest'
import { computed, nextTick, reactive, ref } from 'vue'

const chats = ref([])
const unstartedId = ref('chat_new')
const ready = ref(true)

vi.mock('@/composables/useChats.js', () => ({
  useChats: () => ({
    ready,
    chats,
    unstartedChat: computed(() => ({ id: unstartedId.value })),
    isUnstarted: id => id === unstartedId.value,
    getChatById: id => chats.value.find(chat => chat.id === id) ?? null,
  }),
}))

const view = reactive({ id: 'story_1' })
const updateView = vi.fn((_id, changes) => Object.assign(view, changes))
vi.mock('@/stores/projectViewsStore.js', () => ({
  useProjectViewsStore: () => ({
    getView: id => (id === 'story_1' ? view : undefined),
    updateView,
  }),
}))

const { clearChatTabsInstances, useChatTabs } = await import('@/composables/useChatTabs.js')
const { clearChatActivity, reportWorking } = await import('@/composables/useChatActivity.js')

/** The chats there are, newest first, as useChats lists them. */
const haveChats = (...ids) => {
  chats.value = ids.map(id => ({ id }))
}

describe('useChatTabs', () => {
  beforeEach(() => {
    clearChatTabsInstances()
    clearChatActivity()
    for (const key of Object.keys(view)) if (key !== 'id') delete view[key]
    updateView.mockClear()
    unstartedId.value = 'chat_new'
    ready.value = true
    haveChats('chat_3', 'chat_2', 'chat_1')
  })

  describe('opening', () => {
    it('opens a project whose chats were never in tabs on its latest chat', () => {
      expect(useChatTabs('story_1').tabs.value.open).toEqual(['chat_3'])
    })

    it('shows the unstarted chat in a project with none', () => {
      haveChats()
      const api = useChatTabs('story_1')
      expect(api.activeChatId.value).toBe('chat_new')
    })

    it('opens a chat from the list as a preview, which the next takes the place of', () => {
      const api = useChatTabs('story_1')
      api.open('chat_2', { preview: true })
      api.open('chat_1', { preview: true })

      expect(api.tabs.value.open).toEqual(['chat_3', 'chat_1'])
      expect(api.tabs.value.preview).toBe('chat_1')
      expect(view.openChatIds).toEqual(['chat_3', 'chat_1'])
    })

    it('keeps a preview sent in', () => {
      const api = useChatTabs('story_1')
      api.open('chat_2', { preview: true })
      api.keep('chat_2')
      api.open('chat_1', { preview: true })

      expect(api.tabs.value.open).toEqual(['chat_3', 'chat_2', 'chat_1'])
    })

    it('opens anything else kept, beside the tab showing', () => {
      const api = useChatTabs('story_1')
      api.open('chat_1')
      api.open('chat_3')
      api.open('chat_2')

      expect(api.tabs.value.open).toEqual(['chat_3', 'chat_2', 'chat_1'])
      expect(api.tabs.value.preview).toBeNull()
    })
  })

  describe('the unstarted chat', () => {
    it('opens beside the tab showing on New chat, and only once', () => {
      const api = useChatTabs('story_1')
      api.open('chat_2')
      api.open('chat_3')
      api.openNew()
      api.open('chat_2')
      api.openNew()

      expect(api.tabs.value.open).toEqual(['chat_3', 'chat_new', 'chat_2'])
      expect(api.activeChatId.value).toBe('chat_new')
    })

    it('stays in its tab once its first message makes it a chat', () => {
      const api = useChatTabs('story_1')
      api.openNew()
      // The chat it became, under the same id, and a new unstarted one behind it.
      haveChats('chat_new', 'chat_3', 'chat_2', 'chat_1')
      unstartedId.value = 'chat_newer'
      api.keep('chat_new')

      expect(api.tabs.value.open).toEqual(['chat_3', 'chat_new'])
      expect(api.activeChatId.value).toBe('chat_new')
    })

    it('is shown when the last tab closes, and not written in until used', () => {
      const api = useChatTabs('story_1')
      api.close('chat_3')

      expect(api.activeChatId.value).toBe('chat_new')
      expect(view.openChatIds).toEqual([])

      // Opening a chat from the list leaves no blank tab behind.
      api.open('chat_1', { preview: true })
      expect(api.tabs.value.open).toEqual(['chat_1'])
    })

    it('is written in once sent in', () => {
      const api = useChatTabs('story_1')
      api.close('chat_3')
      api.keep('chat_new')

      expect(view.openChatIds).toEqual(['chat_new'])
    })
  })

  describe('closing', () => {
    it('goes back to the tab shown before', () => {
      const api = useChatTabs('story_1')
      api.open('chat_1')
      api.openNew()
      api.close('chat_new')

      expect(api.activeChatId.value).toBe('chat_1')
    })

    it('closes every tab but one', () => {
      const api = useChatTabs('story_1')
      api.open('chat_1')
      api.open('chat_2')
      api.closeOthers('chat_1')

      expect(api.tabs.value.open).toEqual(['chat_1'])
      expect(api.activeChatId.value).toBe('chat_1')
    })

    it('drops the tab of a chat that has gone', () => {
      const api = useChatTabs('story_1')
      api.open('chat_1')
      haveChats('chat_3', 'chat_2')

      expect(api.tabs.value.open).toEqual(['chat_3'])
      expect(api.activeChatId.value).toBe('chat_3')
    })
  })

  describe('unread', () => {
    it('marks a chat the model stops working in while another tab shows', () => {
      const api = useChatTabs('story_1')
      api.open('chat_1')
      api.open('chat_2')

      reportWorking('story_1', 'chat_1', true)
      reportWorking('story_1', 'chat_1', false)

      expect(api.isUnread('chat_1')).toBe(true)
      expect(view.unreadChatIds).toEqual(['chat_1'])
    })

    it('leaves the chat showing unmarked', () => {
      const api = useChatTabs('story_1')
      api.open('chat_1')

      reportWorking('story_1', 'chat_1', true)
      reportWorking('story_1', 'chat_1', false)

      expect(api.isUnread('chat_1')).toBe(false)
    })

    it('marks a chat with no tab, and clears it once it shows', async () => {
      const api = useChatTabs('story_1')

      reportWorking('story_1', 'chat_2', true)
      reportWorking('story_1', 'chat_2', false)
      expect(api.isUnread('chat_2')).toBe(true)

      api.open('chat_2', { preview: true })
      await nextTick()
      expect(api.isUnread('chat_2')).toBe(false)
      expect(view.unreadChatIds).toEqual([])
    })
  })
})
