import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import MobileView from '@/components/writer/layout/MobileView.vue'
import { clearChatsInstances, useChats } from '@/composables/useChats'
import { useChatsStore } from '@/stores/chatsStore'

vi.mock('@/stores/db', () => ({ default: {} }))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const KEY = 'ui.mobile-view.story_1.selected-chat'

const ChatHistory = {
  emits: ['select-chat'],
  template: "<div data-history @click=\"$emit('select-chat', 'chat_picked')\" />",
}
const Chat = {
  props: ['chatId'],
  emits: ['new-chat', 'back'],
  template: '<div data-chat :data-id="chatId" @click="$emit(\'new-chat\')" />',
}

const mountView = () =>
  mount(MobileView, {
    props: { storyId: 'story_1', activeMobileTab: 'chat' },
    global: {
      stubs: {
        ChatHistory,
        Chat,
        EditorPanel: true,
        DocumentTree: true,
        NarrationPanel: true,
        ProjectList: true,
        Settings: true,
      },
    },
  })

describe('MobileView chat', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    clearChatsInstances()
    window.sessionStorage.clear()
  })

  it('opens the unstarted chat for a new one, making nothing and remembering nothing', async () => {
    const wrapper = mountView()
    await wrapper.find('[data-history]').trigger('click')
    await wrapper.find('[data-chat]').trigger('click')
    await flushPromises()

    const unstarted = useChats('story_1').unstartedChat.value.id
    expect(wrapper.find('[data-chat]').attributes('data-id')).toBe(unstarted)
    expect(useChatsStore().getChatsForStory('story_1')).toHaveLength(0)
    expect(JSON.parse(window.sessionStorage.getItem(KEY))).toBe('chat_picked')
  })

  it('remembers the chat once it has started', async () => {
    const chats = useChats('story_1')
    const wrapper = mountView()
    await wrapper.find('[data-history]').trigger('click')
    await wrapper.find('[data-chat]').trigger('click')
    const id = chats.unstartedChat.value.id

    chats.startChat()
    await flushPromises()

    expect(JSON.parse(window.sessionStorage.getItem(KEY))).toBe(id)
  })
})
