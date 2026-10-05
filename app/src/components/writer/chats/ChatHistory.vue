<template>
  <div class="w-full h-full flex flex-col p-2 px-2">
    <div class="flex items-center justify-between px-2">
      <!-- Header -->
      <h3 class="text-xl font-semibold text-surface-700 dark:text-surface-200">Chats</h3>
      <div class="flex items-center">
        <!-- Import a chat exported from here or elsewhere -->
        <Button
          v-tooltip.bottom="'Import a chat'"
          type="button"
          icon="pi pi-upload"
          severity="secondary"
          size="small"
          rounded
          class="!bg-transparent !border-transparent hover:!bg-surface-700"
          :loading="isImporting"
          @click="fileInput?.click()"
        />
        <!-- New chat, on whatever the project starts chats on. Its header
             is where to put it on something else. -->
        <Button
          v-tooltip.bottom="'New chat'"
          type="button"
          icon="pi pi-plus"
          severity="secondary"
          size="small"
          rounded
          class="!bg-transparent !border-transparent hover:!bg-surface-700"
          aria-label="New chat"
          @click="handleNewChat"
        />
      </div>
    </div>
    <input
      ref="fileInput"
      type="file"
      accept="application/json,.json,.jsonl"
      class="hidden"
      @change="handleImportFile"
    />
    <!-- Search Bar -->
    <div class="w-full py-2">
      <IconField icon-position="left" class="w-full">
        <InputIcon
          class="pi pi-search text-surface-300 dark:text-surface-600"
          :class="{ '!opacity-70': !isSearchEnabled }"
        />
        <InputText
          v-model="searchQuery"
          type="text"
          class="rounded-full! w-full dark:!bg-surface-900"
          :class="{ '!opacity-70': !isSearchEnabled }"
          placeholder="Search chats..."
          :disabled="!isSearchEnabled"
        />
      </IconField>
    </div>
    <!-- Chat History -->
    <ScrollPanel class="flex-1 overflow-auto">
      <!-- Search Results Info -->
      <div
        v-if="isSearching && chatsApi.chats.value.length > 0"
        class="text-xs text-surface-500 dark:text-surface-400 mb-2 px-2"
      >
        Showing {{ searchResults.length }} of {{ chatsApi.chats.value.length }} chats
      </div>

      <!-- Chats List -->
      <div v-if="searchResults.length > 0" class="flex flex-col gap-2">
        <ChatHistoryCard
          v-for="chat in searchResults"
          :key="chat.id"
          :chat-id="chat.id"
          :story-id="props.storyId"
          :active="chat.id === selectedChatId"
          :is-any-menu-open="isAnyMenuOpen"
          @select="handleChatSelect"
          @delete="handleChatDelete"
          @export="handleChatExport"
          @menu-open="handleMenuOpen"
          @menu-closed="handleMenuClosed"
        />
      </div>

      <!-- No Search Results -->
      <div
        v-else-if="isSearching && !hasResults"
        class="flex flex-col items-center justify-center h-full text-surface-400 dark:text-surface-500 p-4"
      >
        <i class="pi pi-search text-4xl mb-3 opacity-50"></i>
        <p class="text-sm text-center mb-3">No chats found</p>
        <p class="text-xs text-center opacity-75">Try adjusting your search terms</p>
      </div>

      <!-- Empty State (no chats at all) -->
      <div
        v-else-if="chatsApi.chats.value.length === 0"
        class="flex flex-col items-center justify-center h-full text-surface-400 dark:text-surface-500 p-4"
      >
        <i class="pi pi-comments text-4xl mb-3 opacity-50"></i>
        <p class="text-sm text-center mb-3">No chats yet</p>
        <p class="text-xs text-center opacity-75">
          Start a conversation to brainstorm ideas for your story.
        </p>
      </div>
    </ScrollPanel>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import Button from 'primevue/button'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import InputText from 'primevue/inputtext'
import ScrollPanel from 'primevue/scrollpanel'

import { useBackup } from '@/composables/useBackup'
import { useCardChat } from '@/composables/useCardChat'
import { useChats } from '@/composables/useChats'
import { useSearch, stripHtml } from '@/composables/useSearch'
import { useToast } from '@/composables/useToast'
import ChatHistoryCard from './ChatHistoryCard.vue'

/**
 * @typedef {Object} Props
 * @property {string} storyId - The ID of the current story
 * @property {string|null} [selectedChatId] - The chat open beside this list, marked as such
 */
const props = defineProps({
  storyId: { type: String, required: true },
  selectedChatId: { type: String, default: null },
})

const emit = defineEmits(['select-chat'])

const chatsApi = useChats(props.storyId)
const cardChat = useCardChat(props.storyId)
const backup = useBackup()
const toast = useToast()
const isAnyMenuOpen = ref(false)
/** @type {import('vue').Ref<HTMLInputElement|null>} */
const fileInput = ref(null)
const isImporting = ref(false)

// Prepare searchable chat data by combining title with all message content
const searchableChats = computed(() => {
  return chatsApi.chats.value.map(chat => {
    // Get all messages for this chat
    const messages = chatsApi.chatMessages.value.get(chat.id) || []
    // Combine all message contents, stripping HTML and limiting length per message
    const messageContent = messages
      .map(msg => {
        const content = stripHtml(msg.content)
        // Limit each message to 500 chars to avoid performance issues
        return content.length > 500 ? content.substring(0, 500) : content
      })
      .join(' ')

    return {
      ...chat,
      searchableContent: messageContent,
    }
  })
})

// Setup search
const { searchQuery, searchResults, isSearching, hasResults } = useSearch(searchableChats, {
  keys: [
    { name: 'title', weight: 0.5 },
    { name: 'searchableContent', weight: 0.5 },
  ],
  threshold: 0.4,
  minMatchCharLength: 2,
  debounceMs: 300,
})

const isSearchEnabled = computed(() => {
  return chatsApi.chats.value.length > 0
})

/** Open the unstarted chat, which becomes a chat when something is sent in it. */
const handleNewChat = () => emit('select-chat', chatsApi.unstartedChat.value.id)

/**
 * Handle chat selection
 * @param {string} chatId - The ID of the selected chat
 */
const handleChatSelect = chatId => {
  emit('select-chat', chatId)
}

/**
 * Handle chat deletion
 * @param {string} chatId - The ID of the chat to delete
 */
const handleChatDelete = chatId => {
  chatsApi.deleteChat(chatId)
}

/**
 * Save a chat to a file of its own — with its words taken out, when asked.
 * @param {string} chatId
 * @param {{obfuscated?: boolean}} [options]
 */
const handleChatExport = async (chatId, options) => {
  try {
    const { filename } = await backup.downloadChat(chatId, options)
    toast.success(`Saved ${filename}`)
  } catch (error) {
    console.error('Chat export failed:', error)
    toast.error(`Export failed: ${error.message}`)
  }
}

/**
 * Bring a chat file into this story and open it.
 * @param {Event} event
 */
const handleImportFile = async event => {
  const input = /** @type {HTMLInputElement} */ (event.target)
  const file = input.files?.[0]
  // Reset immediately so picking the same file again still fires a change.
  input.value = ''
  if (!file) return

  isImporting.value = true
  try {
    const { chat, messages, prompt, character, note } = await backup.readChatFile(file)
    const imported = chatsApi.importChat(chat, messages, prompt)

    // A chat from SillyTavern knows who it was with and nothing else about
    // them. If that character's card is in the project the chat goes onto it;
    // if not, the writer is told, since the chat will answer as nobody until
    // the card is imported and pinned.
    if (character) {
      const card = await cardChat.attach(imported.id, character, { note })
      if (card) toast.success(`Imported "${imported.title}" onto the ${card.title} card`)
      else toast.warning(`Imported "${imported.title}", but found no one card for ${character}`)
    } else {
      toast.success(`Imported "${imported.title}"`)
    }
    emit('select-chat', imported.id)
  } catch (error) {
    console.error('Chat import failed:', error)
    toast.error(error.message)
  } finally {
    isImporting.value = false
  }
}

/**
 * Handle menu open event
 */
const handleMenuOpen = () => {
  isAnyMenuOpen.value = true
}

/**
 * Handle menu closed event
 */
const handleMenuClosed = () => {
  isAnyMenuOpen.value = false
}

onMounted(async () => {
  await chatsApi.init()
})
</script>
