import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
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

// The projects there are, for the terminals, which end with theirs.
const projects = reactive(new Map([['story_1', {}]]))
vi.mock('@/stores/storiesStore.js', () => ({
  useStoriesStore: () => ({ isInitialized: true, stories: projects, isFresh: () => false }),
}))

const startProject = vi.fn()
vi.mock('@/stores/syncStore.js', () => ({
  useSyncStore: () => ({ start: startProject }),
}))

const { clearChatTabsInstances, useChatTabs } = await import('@/composables/useChatTabs.js')
const { clearChatActivity, reportWorking } = await import('@/composables/useChatActivity.js')
const { clearTerminals } = await import('@/composables/useTerminals.js')

/** The chats there are, newest first, as useChats lists them. */
const haveChats = (...ids) => {
  chats.value = ids.map(id => ({ id }))
}

describe('useChatTabs', () => {
  beforeEach(() => {
    clearChatTabsInstances()
    clearChatActivity()
    clearTerminals()
    for (const key of Object.keys(view)) if (key !== 'id') delete view[key]
    updateView.mockClear()
    startProject.mockClear()
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

    it('opens each chat in a tab of its own, beside the tab showing', () => {
      const api = useChatTabs('story_1')
      api.open('chat_1')
      api.open('chat_3')
      api.open('chat_2')

      expect(api.tabs.value.open).toEqual(['chat_3', 'chat_2', 'chat_1'])
      expect(api.tabs.value.preview).toBeNull()
      expect(view.openChatIds).toEqual(['chat_3', 'chat_2', 'chat_1'])
      expect(view.previewChatId).toBeNull()
    })

    it('keeps a tab left a preview from when a chat could be one', () => {
      Object.assign(view, {
        openChatIds: ['chat_3', 'chat_2'],
        lastChatId: 'chat_2',
        previewChatId: 'chat_2',
      })
      const api = useChatTabs('story_1')
      expect(api.tabs.value.preview).toBeNull()

      api.open('chat_1')
      expect(api.tabs.value.open).toEqual(['chat_3', 'chat_2', 'chat_1'])
      expect(view.previewChatId).toBeNull()
    })
  })

  describe('moving', () => {
    it('puts a tab at another place in the strip, and leaves the one showing', () => {
      const api = useChatTabs('story_1')
      api.open('chat_2')
      api.open('chat_1')

      api.move('chat_3', 2)

      expect(api.tabs.value.open).toEqual(['chat_2', 'chat_1', 'chat_3'])
      expect(api.activeId.value).toBe('chat_1')
      expect(view.openChatIds).toEqual(['chat_2', 'chat_1', 'chat_3'])
    })

    it('writes nothing for a tab moved to where it is', () => {
      const api = useChatTabs('story_1')
      api.open('chat_2')
      updateView.mockClear()

      api.move('chat_2', 1)
      api.move('chat_9', 0)

      expect(updateView).not.toHaveBeenCalled()
    })

    it('leaves the unstarted chat unwritten where it is all there is', () => {
      haveChats()
      const api = useChatTabs('story_1')

      api.move('chat_new', 0)

      expect(api.tabs.value.open).toEqual(['chat_new'])
      expect(updateView).not.toHaveBeenCalled()
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
      api.open('chat_new')

      expect(api.tabs.value.open).toEqual(['chat_3', 'chat_new'])
      expect(api.activeChatId.value).toBe('chat_new')
    })

    it('is shown when the last tab closes, and not written in until used', () => {
      const api = useChatTabs('story_1')
      api.close('chat_3')

      expect(api.activeChatId.value).toBe('chat_new')
      expect(view.openChatIds).toEqual([])

      // Opening a chat from the list leaves no blank tab behind.
      api.open('chat_1')
      expect(api.tabs.value.open).toEqual(['chat_1'])
    })

    it('is written in once sent in', () => {
      const api = useChatTabs('story_1')
      api.close('chat_3')
      api.open('chat_new')

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

  describe('reopening', () => {
    it('shows the chat closed last again, beside the tab showing', () => {
      const api = useChatTabs('story_1')
      api.open('chat_2')
      api.open('chat_1')
      api.close('chat_2')
      api.close('chat_1')
      expect(api.tabs.value.open).toEqual(['chat_3'])

      api.reopen()
      expect(api.tabs.value.open).toEqual(['chat_3', 'chat_1'])
      expect(api.activeChatId.value).toBe('chat_1')

      api.reopen()
      expect(api.tabs.value.open).toEqual(['chat_3', 'chat_1', 'chat_2'])
      expect(view.closedChatIds).toEqual([])
    })

    it('brings back each of the tabs Close others closed', () => {
      const api = useChatTabs('story_1')
      api.open('chat_2')
      api.open('chat_1')
      api.closeOthers('chat_1')

      api.reopen()
      api.reopen()
      expect([...api.tabs.value.open].sort()).toEqual(['chat_1', 'chat_2', 'chat_3'])
    })

    it('passes over a chat not started, which has nothing to bring back', () => {
      const api = useChatTabs('story_1')
      api.open('chat_1')
      api.close('chat_1')
      api.openNew()
      api.close('chat_new')

      api.reopen()
      expect(api.activeChatId.value).toBe('chat_1')
    })

    it('does nothing with no tab closed, nor for a chat deleted since', () => {
      const api = useChatTabs('story_1')
      api.reopen()
      expect(api.tabs.value.open).toEqual(['chat_3'])

      api.open('chat_1')
      api.close('chat_1')
      haveChats('chat_3', 'chat_2')
      api.reopen()
      expect(api.tabs.value.open).toEqual(['chat_3'])
    })
  })

  describe('the caret', () => {
    it('counts each time it is asked for, for the panel to watch', () => {
      const api = useChatTabs('story_1')
      const before = api.focusAsked.value
      api.focus()
      api.focus()
      expect(api.focusAsked.value).toBe(before + 2)
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

  describe('terminals', () => {
    /** The native side's terminals, and the way to say what becomes of one. */
    let native
    /** @type {(id: string, event: object) => void} */
    let say

    beforeEach(() => {
      let made = 0
      native = {
        create: vi.fn(async () => `terminal:${++made}`),
        list: vi.fn().mockResolvedValue([]),
        close: vi.fn().mockResolvedValue(undefined),
        seen: vi.fn().mockResolvedValue(undefined),
        onEvent: vi.fn(listener => {
          say = listener
        }),
      }
      globalThis.__INKSPRITE_DESKTOP__ = { terminals: native }
    })

    afterEach(() => {
      delete globalThis.__INKSPRITE_DESKTOP__
    })

    it('opens a terminal of the project in a tab beside the one showing, and shows it', async () => {
      const api = useChatTabs('story_1')
      api.open('chat_1')
      await api.openTerminal()

      expect(native.create).toHaveBeenCalledWith('story_1')
      expect(api.tabs.value.open).toEqual(['chat_3', 'chat_1', 'terminal:1'])
      expect(api.activeId.value).toBe('terminal:1')
    })

    it('saves a project not saved yet, which the terminal is then found in again', async () => {
      await useChatTabs('story_1').openTerminal()
      expect(startProject).toHaveBeenCalledWith('story_1')
    })

    it('keeps the chat shown before as the chat showing', async () => {
      const api = useChatTabs('story_1')
      api.open('chat_1')
      await api.openTerminal()
      await api.openTerminal()

      expect(api.activeId.value).toBe('terminal:2')
      expect(api.activeChatId.value).toBe('chat_1')
    })

    it('has the unstarted chat as the chat showing where only terminals are open', async () => {
      haveChats()
      const api = useChatTabs('story_1')
      await api.openTerminal()

      expect(api.tabs.value.open).toEqual(['terminal:1'])
      expect(api.activeChatId.value).toBe('chat_new')
    })

    it('ends the shell when its tab is closed, and goes back to the tab before', async () => {
      const api = useChatTabs('story_1')
      api.open('chat_1')
      await api.openTerminal()
      api.close('terminal:1')

      expect(native.close).toHaveBeenCalledWith('terminal:1')
      expect(api.tabs.value.open).toEqual(['chat_3', 'chat_1'])
      expect(api.activeId.value).toBe('chat_1')
    })

    it('closes the tab of a shell that ended, with nothing left to end', async () => {
      const api = useChatTabs('story_1')
      api.open('chat_1')
      await api.openTerminal()
      say('terminal:1', { type: 'exit' })

      expect(native.close).not.toHaveBeenCalled()
      expect(api.tabs.value.open).toEqual(['chat_3', 'chat_1'])
      expect(api.activeId.value).toBe('chat_1')
      expect(view.openChatIds).toEqual(['chat_3', 'chat_1'])
    })

    it('ends the other terminals with Close others', async () => {
      const api = useChatTabs('story_1')
      await api.openTerminal()
      await api.openTerminal()
      api.closeOthers('terminal:2')

      expect(native.close.mock.calls).toEqual([['terminal:1']])
      expect(api.tabs.value.open).toEqual(['terminal:2'])
    })

    it('does not bring a closed terminal back, whose shell has ended, but the chat closed before it', async () => {
      const api = useChatTabs('story_1')
      api.open('chat_1')
      await api.openTerminal()
      api.close('chat_1')
      api.close('terminal:1')
      expect(view.closedChatIds).toEqual(['chat_1'])

      api.reopen()
      expect(api.activeId.value).toBe('chat_1')
    })

    it('remembers the chats Close others closed, and not the terminals', async () => {
      const api = useChatTabs('story_1')
      api.open('chat_1')
      await api.openTerminal()
      await api.openTerminal()
      api.closeOthers('terminal:2')

      expect(api.tabs.value.open).toEqual(['terminal:2'])
      expect([...view.closedChatIds].sort()).toEqual(['chat_1', 'chat_3'])
    })

    it('keeps a terminal’s tab where it was left, while its shell runs', async () => {
      native.list.mockResolvedValue([
        { id: 'terminal:kept', project: 'story_1', title: '', rang: false },
      ])
      Object.assign(view, {
        openChatIds: ['chat_2', 'terminal:kept', 'chat_3'],
        lastChatId: 'terminal:kept',
      })
      const api = useChatTabs('story_1')
      await flushPromises()

      expect(api.tabs.value.open).toEqual(['chat_2', 'terminal:kept', 'chat_3'])
      expect(api.activeId.value).toBe('terminal:kept')
    })

    it('gives a terminal of the project a tab where it has none', async () => {
      native.list.mockResolvedValue([
        { id: 'terminal:kept', project: 'story_1', title: '', rang: false },
      ])
      const api = useChatTabs('story_1')
      await flushPromises()

      expect(api.tabs.value.open).toEqual(['chat_3', 'terminal:kept'])
      expect(api.activeId.value).toBe('chat_3')
    })

    it('shows the unstarted chat beside a terminal that is all there is', async () => {
      haveChats()
      native.list.mockResolvedValue([
        { id: 'terminal:kept', project: 'story_1', title: '', rang: false },
      ])
      const api = useChatTabs('story_1')
      await flushPromises()

      expect(api.tabs.value.open).toEqual(['terminal:kept', 'chat_new'])
      expect(api.activeId.value).toBe('chat_new')
    })

    it('moves a terminal’s tab among the chats’', async () => {
      const api = useChatTabs('story_1')
      await api.openTerminal()

      api.move('terminal:1', 0)

      expect(api.tabs.value.open).toEqual(['terminal:1', 'chat_3'])
      expect(api.activeId.value).toBe('terminal:1')
    })

    it('writes the unstarted chat in when it is moved past a terminal', async () => {
      haveChats()
      native.list.mockResolvedValue([
        { id: 'terminal:kept', project: 'story_1', title: '', rang: false },
      ])
      const api = useChatTabs('story_1')
      await flushPromises()
      expect(api.tabs.value.open).toEqual(['terminal:kept', 'chat_new'])

      api.move('chat_new', 0)

      expect(api.tabs.value.open).toEqual(['chat_new', 'terminal:kept'])
      expect(view.openChatIds).toEqual(['chat_new', 'terminal:kept'])
    })

    it('has no tab for another project’s terminal, which runs on unseen', async () => {
      native.list.mockResolvedValue([
        { id: 'terminal:theirs', project: 'story_2', title: '', rang: false },
      ])
      Object.assign(view, { openChatIds: ['chat_3', 'terminal:theirs'], lastChatId: 'chat_3' })
      const api = useChatTabs('story_1')
      await flushPromises()

      expect(api.tabs.value.open).toEqual(['chat_3'])
      expect(native.close).not.toHaveBeenCalled()
    })

    it('closes a tab only in the project of the terminal that is gone', async () => {
      const api = useChatTabs('story_1')
      await api.openTerminal()
      updateView.mockClear()
      say('terminal:other', { type: 'made', project: 'story_2' })
      say('terminal:other', { type: 'exit' })

      expect(api.tabs.value.open).toEqual(['chat_3', 'terminal:1'])
      expect(updateView).not.toHaveBeenCalled()
    })

    it('drops the tab of a terminal whose shell is gone, once those there are are known', async () => {
      Object.assign(view, {
        openChatIds: ['chat_3', 'terminal:gone'],
        lastChatId: 'terminal:gone',
      })
      const api = useChatTabs('story_1')
      // Taken as stored until the terminals there are are known.
      expect(api.tabs.value.open).toEqual(['chat_3', 'terminal:gone'])
      await flushPromises()

      expect(api.tabs.value.open).toEqual(['chat_3'])
      expect(api.activeId.value).toBe('chat_3')
    })
  })
})
