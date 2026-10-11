<template>
  <div class="h-full w-full overflow-hidden bg-surface-100 dark:bg-surface-800">
    <DocumentTree
      v-if="tab === SIDEBAR_TABS.OUTLINE"
      :story-id="storyId"
      :document-id="documentId"
      :chat-id="chatId"
      @open="$emit('open-document', $event)"
      @select-chat="$emit('select-chat', $event)"
    />
    <ChatHistory
      v-else-if="tab === SIDEBAR_TABS.CHATS"
      :story-id="storyId"
      :selected-chat-id="chatId"
      @select-chat="$emit('select-chat', $event)"
    />
    <NarrationPanel
      v-else-if="tab === SIDEBAR_TABS.NARRATION"
      :story-id="storyId"
      :document-id="documentId"
    />
    <CommentsPanel
      v-else-if="tab === SIDEBAR_TABS.COMMENTS"
      :story-id="storyId"
      :document-id="documentId"
      @open-document="$emit('open-document', $event)"
    />
  </div>
</template>

<script setup>
import ChatHistory from '../chats/ChatHistory.vue'
import CommentsPanel from '../comments/CommentsPanel.vue'
import NarrationPanel from '../narration/NarrationPanel.vue'
import DocumentTree from '../tree/DocumentTree.vue'
import { SIDEBAR_TABS } from './layout.js'

/**
 * Where the writer picks what to work on: the project's documents, with
 * the other projects a menu away at the top, its chats, or the comments left
 * in it — or hears the document open in the editor read aloud.
 * Which is showing is chosen on the rail and kept in the story's layout, so
 * it is asked for here rather than held.
 *
 * @typedef {Object} Props
 * @property {string} storyId
 * @property {string} [documentId] - The document open in the editor, highlighted in the tree
 * @property {string|null} [chatId] - The chat open in the chat panel: highlighted in the list,
 *   and what the tree pins a document to
 * @property {import('./layout.js').SidebarTab} tab - Which list is showing
 */
defineProps({
  storyId: { type: String, required: true },
  documentId: { type: String, default: '' },
  chatId: { type: String, default: null },
  tab: { type: String, required: true },
})

defineEmits(['select-chat', 'open-document'])
</script>
