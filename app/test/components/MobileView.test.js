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

const DocumentTree = { props: ['chatId'], template: '<div data-tree :data-chat-id="chatId" />' }

const mountView = (activeMobileTab = 'chat') =>
  mount(MobileView, {
    props: { storyId: 'story_1', activeMobileTab },
    global: {
      stubs: {
        ChatHistory,
        Chat,
        EditorPanel: true,
        DocumentTree,
        NarrationPanel: true,
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

  it('gives the outline the chat open on the chat tab, to pin documents to', async () => {
    window.sessionStorage.setItem(KEY, JSON.stringify('chat_open'))
    const wrapper = mountView('outline')
    await flushPromises()

    expect(wrapper.find('[data-tree]').attributes('data-chat-id')).toBe('chat_open')
  })
})
