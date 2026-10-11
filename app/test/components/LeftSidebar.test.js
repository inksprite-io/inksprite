import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import LeftSidebar from '@/components/writer/layout/LeftSidebar.vue'

const DocumentTree = {
  props: ['storyId', 'documentId'],
  emits: ['open'],
  template: "<div data-tree @click=\"$emit('open', 'doc_2')\" />",
}
const ChatHistory = {
  props: ['storyId', 'selectedChatId'],
  emits: ['select-chat'],
  template:
    '<div data-list :data-selected="selectedChatId" @click="$emit(\'select-chat\', \'chat_9\')" />',
}
const NarrationPanel = {
  props: ['storyId', 'documentId'],
  template: '<div data-narration :data-document="documentId" />',
}

const CommentsPanel = {
  props: ['storyId', 'documentId'],
  emits: ['open-document'],
  template:
    '<div data-comments :data-document="documentId" @click="$emit(\'open-document\', \'doc_4\')" />',
}

const mountSidebar = props =>
  mount(LeftSidebar, {
    props: { storyId: 'story_1', documentId: 'doc_1', tab: 'outline', ...props },
    global: {
      plugins: [PrimeVue],
      stubs: { DocumentTree, ChatHistory, NarrationPanel, CommentsPanel },
    },
  })

describe('LeftSidebar', () => {
  it('shows the list it is asked for', () => {
    const outline = mountSidebar({ tab: 'outline' })
    expect(outline.find('[data-tree]').exists()).toBe(true)
    expect(outline.find('[data-list]').exists()).toBe(false)

    const chats = mountSidebar({ tab: 'chats', chatId: 'chat_3' })
    expect(chats.find('[data-tree]').exists()).toBe(false)
    expect(chats.find('[data-list]').attributes('data-selected')).toBe('chat_3')

    const narration = mountSidebar({ tab: 'narration', documentId: 'doc_7' })
    expect(narration.find('[data-narration]').attributes('data-document')).toBe('doc_7')
    expect(narration.find('[data-tree]').exists()).toBe(false)

    const comments = mountSidebar({ tab: 'comments', documentId: 'doc_7' })
    expect(comments.find('[data-comments]').attributes('data-document')).toBe('doc_7')
    expect(comments.find('[data-narration]').exists()).toBe(false)
  })

  it('passes on what the writer picked', async () => {
    const outline = mountSidebar({ tab: 'outline' })
    await outline.find('[data-tree]').trigger('click')
    expect(outline.emitted('open-document')).toEqual([['doc_2']])

    const chats = mountSidebar({ tab: 'chats' })
    await chats.find('[data-list]').trigger('click')
    expect(chats.emitted('select-chat')).toEqual([['chat_9']])

    const comments = mountSidebar({ tab: 'comments' })
    await comments.find('[data-comments]').trigger('click')
    expect(comments.emitted('open-document')).toEqual([['doc_4']])
  })
})
