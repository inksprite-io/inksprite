import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ChatPanel from '@/components/writer/layout/ChatPanel.vue'
import { clearChatsInstances, useChats } from '@/composables/useChats'
import { useChatsStore } from '@/stores/chatsStore'

vi.mock('@/stores/db', () => {
  const empty = () => ({
    toArray: vi.fn(async () => []),
    where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
  })
  return { default: { chats: empty(), messages: empty(), stories: empty() } }
})

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const Chat = {
  props: ['chatId', 'showBack'],
  emits: ['new-chat', 'open-chat', 'back'],
  template:
    '<div data-chat :data-id="chatId" :data-back="showBack" @click="$emit(\'new-chat\')"><slot name="header-start" /><button data-back-button @click.stop="$emit(\'back\')" /></div>',
}

const mountPanel = async (chatId, props = {}) => {
  const wrapper = mount(ChatPanel, {
    props: { storyId: 'story_1', chatId, ...props },
    global: { plugins: [PrimeVue], directives: { tooltip: {} }, stubs: { Chat } },
  })
  await flushPromises()
  return wrapper
}

const lastSelection = wrapper => wrapper.emitted('update:chatId')?.at(-1)?.[0]

describe('ChatPanel', () => {
  /** @type {ReturnType<typeof useChatsStore>} */
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    clearChatsInstances()
    store = useChatsStore()
  })

  it('shows the chat it is given', async () => {
    const chat = store.createChat('story_1', 'Plot holes')
    const wrapper = await mountPanel(chat.id)
    expect(wrapper.find('[data-chat]').attributes('data-id')).toBe(chat.id)
    expect(wrapper.emitted('update:chatId')).toBeUndefined()
  })

  it('stands the most recent chat in when it is given none', async () => {
    store.createChat('story_1', 'Older')
    const newer = store.createChat('story_1', 'Newer')
    newer.created += 1000
    const wrapper = await mountPanel(null)
    expect(lastSelection(wrapper)).toBe(newer.id)
  })

  it('shows the unstarted chat when the story has none, editor toggle and all', async () => {
    const wrapper = await mountPanel(null, { editorShowing: false })
    const unstarted = useChats('story_1').unstartedChat.value.id
    expect(lastSelection(wrapper)).toBe(unstarted)
    expect(wrapper.find('[data-chat]').attributes('data-id')).toBe(unstarted)
    expect(wrapper.find('[data-panel-toggle="editor"]').exists()).toBe(true)
    expect(store.getChatsForStory('story_1')).toHaveLength(0)
  })

  it('keeps showing the chat once it has started, under the same id', async () => {
    const chats = useChats('story_1')
    const id = chats.unstartedChat.value.id
    const wrapper = await mountPanel(id)

    chats.startChat()
    await flushPromises()

    expect(wrapper.find('[data-chat]').attributes('data-id')).toBe(id)
    expect(wrapper.emitted('update:chatId')).toBeUndefined()
  })

  it('moves on when the chat it was showing is deleted', async () => {
    const remaining = store.createChat('story_1', 'Keeps')
    const doomed = store.createChat('story_1', 'Goes')
    const wrapper = await mountPanel(doomed.id)

    await store.deleteChat(doomed.id)
    await flushPromises()

    expect(lastSelection(wrapper)).toBe(remaining.id)
  })

  it('opens the unstarted chat from the one open, making nothing yet', async () => {
    const chat = store.createChat('story_1', 'First')
    const wrapper = await mountPanel(chat.id)

    await wrapper.find('[data-chat]').trigger('click')
    await flushPromises()

    expect(lastSelection(wrapper)).toBe(useChats('story_1').unstartedChat.value.id)
    expect(store.getChatsForStory('story_1')).toHaveLength(1)
  })

  it('puts the editor’s toggle at the start of the chat’s header, beside an editor', async () => {
    const chat = store.createChat('story_1', 'One')

    const alone = await mountPanel(chat.id)
    expect(alone.find('[data-panel-toggle="editor"]').exists()).toBe(false)

    const beside = await mountPanel(chat.id, { editorShowing: true })
    const toggle = beside.find('[data-panel-toggle="editor"]')
    expect(toggle.attributes('aria-label')).toBe('Hide editor')
    await toggle.trigger('click')
    expect(beside.emitted('toggle-editor')).toHaveLength(1)
  })

  it('passes the way back to the list on, where the list is behind it', async () => {
    const chat = store.createChat('story_1', 'One')

    const beside = await mountPanel(chat.id)
    expect(beside.find('[data-chat]').attributes('data-back')).toBe('false')

    const phone = await mountPanel(chat.id, { showBack: true })
    expect(phone.find('[data-chat]').attributes('data-back')).toBe('true')
    await phone.find('[data-back-button]').trigger('click')
    expect(phone.emitted('back')).toHaveLength(1)
  })
})
