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
      <DocumentTree :story-id="storyId" :document-id="documentId" @open="openDocument" />
    </div>

    <!-- Chat -->
    <div v-else-if="activeMobileTab === 'chat'" class="h-full bg-surface-100 dark:bg-surface-800">
      <ChatHistory v-if="!selectedChatId" :story-id="storyId" @select-chat="handleChatSelect" />
      <Chat
        v-else
        :key="selectedChatId"
        :story-id="storyId"
        :chat-id="selectedChatId"
        title="Chat Title"
        show-back
        @back="handleChatBack"
        @open-chat="handleOpenChat"
        @new-chat="handleNewChat"
      />
    </div>

    <!-- Narration -->
    <div
      v-else-if="activeMobileTab === 'narration'"
      class="h-full bg-surface-100 dark:bg-surface-800"
    >
      <NarrationPanel :story-id="storyId" :document-id="documentId" />
    </div>

    <!-- Projects -->
    <div
      v-else-if="activeMobileTab === 'projects'"
      class="h-full bg-surface-100 dark:bg-surface-800"
    >
      <ProjectList :story-id="storyId" />
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
import { ref, onMounted, watch } from 'vue'
import { sessionStorage } from '@/utils/sessionStorage'
import EditorPanel from './EditorPanel.vue'
import DocumentTree from '../tree/DocumentTree.vue'
import ChatHistory from '../chats/ChatHistory.vue'
import Chat from '../chats/Chat.vue'
import NarrationPanel from '../narration/NarrationPanel.vue'
import ProjectList from '../projects/ProjectList.vue'
import Settings from '../settings/Settings.vue'
import { useChats } from '@/composables/useChats'
import { useDocuments } from '@/composables/useDocuments'

/**
 * @typedef {Object} Props
 * @property {string} activeMobileTab - The currently active mobile tab
 * @property {string} storyId - The ID of the current story
 * @property {string} [documentId] - The ID of the document being shown (optional)
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
})

const emit = defineEmits(['update:activeMobileTab'])

/**
 * Open a document picked from the outline, and go to where it shows: on a
 * phone the outline and the editor are different views.
 * @param {string} documentId
 */
const openDocument = documentId => {
  useDocuments(props.storyId).open(documentId)
  emit('update:activeMobileTab', 'write')
}

// Chat-specific state
const selectedChatId = ref(null)

/**
 * Handle chat selection from ChatHistory
 * @param {string} chatId - The ID of the selected chat
 */
const handleChatSelect = chatId => {
  selectedChatId.value = chatId
}

// Remembered for a reload, but not while it is the unstarted chat: that id
// means nothing to the next page, and would open on a chat that is not
// there. Once something is sent in it, it is a chat, and remembered then.
const chatsApi = useChats(props.storyId)
watch(
  () => (chatsApi.isUnstarted(selectedChatId.value) ? null : selectedChatId.value),
  chatId => {
    if (chatId) sessionStorage.set(`ui.mobile-view.${props.storyId}.selected-chat`, chatId)
  }
)

/**
 * Handle back navigation from Chat
 */
const handleChatBack = () => {
  selectedChatId.value = null
  const chatIdKey = `ui.mobile-view.${props.storyId}.selected-chat`
  sessionStorage.remove(chatIdKey)
}

/**
 * Handle opening a specific chat (e.g., from fork action)
 * @param {{chatId: string, title: string}} payload - The chat to open
 */
const handleOpenChat = payload => handleChatSelect(payload.chatId)

/** Open the unstarted chat from inside the one open. */
const handleNewChat = () => handleChatSelect(chatsApi.unstartedChat.value.id)

// Load saved state on mount
onMounted(() => {
  const chatIdKey = `ui.mobile-view.${props.storyId}.selected-chat`
  const savedChatId = sessionStorage.get(chatIdKey)
  if (savedChatId) {
    selectedChatId.value = savedChatId
  }
})
</script>
