<template>
  <div class="h-full w-full min-w-0 bg-surface-0 dark:bg-surface-900">
    <!-- Write Mode -->
    <EditorPanel v-if="activeMobileTab === 'write'" :story-id="storyId" class="h-full w-full" />

    <!-- Read Mode -->
    <!-- Outline -->
    <div
      v-else-if="activeMobileTab === 'outline'"
      class="h-full bg-surface-100 dark:bg-surface-800"
    >
      <!-- The chat is the one the chat tab has open, which is what a
           document is pinned to and hidden from here. -->
      <DocumentTree
        :story-id="storyId"
        :document-id="documentId"
        :chat-id="chatId"
        @open="openDocument"
      />
    </div>

    <!-- Chat: the one open, as beside the editor, with the list behind it -->
    <div v-else-if="activeMobileTab === 'chat'" class="h-full bg-surface-100 dark:bg-surface-800">
      <ChatHistory v-if="listing" :story-id="storyId" @select-chat="pickChat" />
      <ChatPanel
        v-else
        :story-id="storyId"
        :chat-id="chatId"
        show-back
        @back="listing = true"
        @update:chat-id="$emit('update:chatId', $event)"
      />
    </div>

    <!-- Narration -->
    <div
      v-else-if="activeMobileTab === 'narration'"
      class="h-full bg-surface-100 dark:bg-surface-800"
    >
      <NarrationPanel :story-id="storyId" :document-id="documentId" />
    </div>

    <!-- Comments: picking one goes to it in the writing view. -->
    <div
      v-else-if="activeMobileTab === 'comments'"
      class="h-full bg-surface-100 dark:bg-surface-800"
    >
      <CommentsPanel :story-id="storyId" :document-id="documentId" @open-document="openDocument" />
    </div>

    <!-- Settings -->
    <div
      v-else-if="activeMobileTab === 'settings'"
      class="h-full bg-surface-100 dark:bg-surface-800"
    >
      <Settings />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import EditorPanel from './EditorPanel.vue'
import ChatPanel from './ChatPanel.vue'
import DocumentTree from '../tree/DocumentTree.vue'
import ChatHistory from '../chats/ChatHistory.vue'
import NarrationPanel from '../narration/NarrationPanel.vue'
import CommentsPanel from '../comments/CommentsPanel.vue'
import Settings from '../settings/Settings.vue'
import { useDocuments } from '@/composables/useDocuments'

/**
 * The phone's views, one at a time. The chat tab opens on the chat open,
 * which is the one the desktop's chat panel would show; the list of chats is
 * behind it, and once gone back to stays until a chat is picked from it.
 *
 * @typedef {Object} Props
 * @property {string} activeMobileTab - The currently active mobile tab
 * @property {string} storyId - The ID of the current story
 * @property {string} [documentId] - The ID of the document being shown (optional)
 * @property {string|null} [chatId] - The chat open, if one has been yet
 */
/** @type {Props} */
const props = defineProps({
  activeMobileTab: {
    type: String,
    default: 'write',
  },
  storyId: {
    type: String,
    required: true,
  },
  documentId: {
    type: String,
    required: false,
  },
  chatId: {
    type: String,
    default: null,
  },
})

const emit = defineEmits(['update:activeMobileTab', 'update:chatId'])

/**
 * Open a document picked from the outline or the comments, and go to where
 * it shows: on a phone those and the editor are different views.
 * @param {string} documentId
 */
const openDocument = documentId => {
  useDocuments(props.storyId).open(documentId)
  emit('update:activeMobileTab', 'write')
}

/** Whether the chat tab is showing the list rather than a chat. */
const listing = ref(false)

/**
 * Open a chat picked from the list.
 * @param {string} chatId
 */
const pickChat = chatId => {
  emit('update:chatId', chatId)
  listing.value = false
}
</script>
