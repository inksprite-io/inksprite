import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ConfirmationService from 'primevue/confirmationservice'
import ChatHistoryCard from '../../src/components/writer/chats/ChatHistoryCard.vue'
import { clearChatsInstances } from '../../src/composables/useChats'
import { useApplicationState } from '../../src/composables/useApplicationState'
import { useChatsStore } from '../../src/stores/chatsStore'

vi.mock('../../src/stores/db', () => {
  const empty = () => ({
    where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
  })
  return { default: { chats: empty(), messages: empty() } }
})

vi.mock('../../src/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const mountCard = chatId =>
  mount(ChatHistoryCard, {
    props: { chatId, storyId: 'story_1' },
    global: { plugins: [PrimeVue, ConfirmationService] },
  })

const itemLabels = wrapper => wrapper.props('model').map(item => item.label)

describe('ChatHistoryCard', () => {
  /** @type {import('../../src/types/models.js').Chat} */
  let chat

  beforeEach(() => {
    setActivePinia(createPinia())
    clearChatsInstances()
    chat = useChatsStore().createChat('story_1', 'Plot holes')
  })

  it('opens the chat on a plain click', async () => {
    const wrapper = mountCard(chat.id)

    await wrapper.trigger('click')

    expect(wrapper.emitted('select')).toEqual([[chat.id]])
  })

  it('opens the same actions at the pointer on right-click', async () => {
    const wrapper = mountCard(chat.id)
    const contextMenu = wrapper.findComponent({ name: 'ContextMenu' })

    await wrapper.trigger('contextmenu', { clientX: 40, clientY: 12 })

    expect(contextMenu.emitted('before-show')).toHaveLength(1)
    // One set of actions, whichever way it is asked for.
    expect(itemLabels(contextMenu)).toEqual(itemLabels(wrapper.findComponent({ name: 'Menu' })))
  })

  it('does not open the chat on the click that dismisses its menu', async () => {
    const wrapper = mountCard(chat.id)

    await wrapper.trigger('contextmenu')
    await wrapper.trigger('click')

    expect(wrapper.emitted('select')).toBeUndefined()
    expect(wrapper.emitted('menu-open')).toHaveLength(1)
  })

  it('leaves the browser menu alone inside a rename', async () => {
    const wrapper = mountCard(chat.id)
    const menu = wrapper.findComponent({ name: 'Menu' })
    await menu
      .props('model')
      .find(item => item.label === 'Rename')
      .command()
    await wrapper.vm.$nextTick()

    await wrapper.find('input').trigger('contextmenu')

    // Right-clicking the input is how you paste a title; that is the browser's.
    expect(wrapper.findComponent({ name: 'ContextMenu' }).emitted('before-show')).toBeUndefined()
  })

  it('leaves exporting to the list, which owns the files', () => {
    const wrapper = mountCard(chat.id)
    const menu = wrapper.findComponent({ name: 'Menu' })

    menu
      .props('model')
      .find(item => item.label === 'Export')
      .command()

    expect(wrapper.emitted('export')).toEqual([[chat.id]])
  })

  it('offers an export with the words taken out only with the debug switch on', () => {
    const labels = wrapper =>
      wrapper
        .findComponent({ name: 'Menu' })
        .props('model')
        .map(item => item.label)

    expect(labels(mountCard(chat.id))).not.toContain('Export obfuscated')

    useApplicationState().setDebug(true)
    try {
      const wrapper = mountCard(chat.id)
      expect(labels(wrapper)).toContain('Export obfuscated')
      wrapper
        .findComponent({ name: 'Menu' })
        .props('model')
        .find(item => item.label === 'Export obfuscated')
        .command()
      expect(wrapper.emitted('export')).toEqual([[chat.id, { obfuscated: true }]])
    } finally {
      useApplicationState().setDebug(false)
    }
  })
})
