import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import MobileView from '@/components/writer/layout/MobileView.vue'
import { clearChatsInstances } from '@/composables/useChats'

vi.mock('@/stores/db', () => ({ default: {} }))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const ChatHistory = {
  emits: ['select-chat'],
  template: "<div data-history @click=\"$emit('select-chat', 'chat_picked')\" />",
}
const ChatPanel = {
  props: { chatId: String, showBack: Boolean },
  emits: ['back', 'update:chatId'],
  template:
    '<div data-chat-panel :data-id="chatId" :data-back="showBack" @click="$emit(\'back\')" />',
}

const DocumentTree = { props: ['chatId'], template: '<div data-tree :data-chat-id="chatId" />' }

const mountView = (props = {}) =>
  mount(MobileView, {
    props: { storyId: 'story_1', activeMobileTab: 'chat', ...props },
    global: {
      stubs: {
        ChatHistory,
        ChatPanel,
        EditorPanel: true,
        DocumentTree,
        NarrationPanel: true,
        CommentsPanel: true,
        Settings: true,
      },
    },
  })

describe('MobileView chat', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    clearChatsInstances()
  })

  it('opens on the chat open, with a way back to the list', () => {
    const wrapper = mountView({ chatId: 'chat_open' })

    expect(wrapper.find('[data-history]').exists()).toBe(false)
    expect(wrapper.find('[data-chat-panel]').attributes('data-id')).toBe('chat_open')
    expect(wrapper.find('[data-chat-panel]').attributes('data-back')).toBe('true')
  })

  it('opens on a chat even with none open yet, for the panel to pick one', () => {
    const wrapper = mountView({ chatId: null })

    expect(wrapper.find('[data-history]').exists()).toBe(false)
    expect(wrapper.find('[data-chat-panel]').exists()).toBe(true)
  })

  it('goes back to the list, which stays until a chat is picked from it', async () => {
    const wrapper = mountView({ chatId: 'chat_open' })
    await wrapper.find('[data-chat-panel]').trigger('click')
    expect(wrapper.find('[data-history]').exists()).toBe(true)

    await wrapper.setProps({ activeMobileTab: 'write' })
    await wrapper.setProps({ activeMobileTab: 'chat' })
    expect(wrapper.find('[data-history]').exists()).toBe(true)

    await wrapper.find('[data-history]').trigger('click')
    expect(wrapper.emitted('update:chatId')).toEqual([['chat_picked']])
    expect(wrapper.find('[data-chat-panel]').exists()).toBe(true)
  })

  it('gives the outline the chat open, to pin documents to', async () => {
    const wrapper = mountView({ activeMobileTab: 'outline', chatId: 'chat_open' })
    await flushPromises()

    expect(wrapper.find('[data-tree]').attributes('data-chat-id')).toBe('chat_open')
  })
})
