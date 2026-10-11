<template>
  <div class="h-full w-full min-w-0 bg-surface-0 dark:bg-surface-800">
    <!-- Nothing until the chats have loaded, when the unstarted chat would
         only flash before the saved one took over. -->
    <Chat
      v-if="shownId"
      :key="`chat:${shownId}`"
      :story-id="storyId"
      :chat-id="shownId"
      class="h-full w-full"
      :show-back="showBack"
      @back="$emit('back')"
      @open-chat="$emit('update:chatId', $event.chatId)"
      @new-chat="$emit('update:chatId', chatsApi.unstartedChat.value.id)"
    >
      <template v-if="editorShowing !== null" #header-start>
        <PanelToggle
          panel="editor"
          side="left"
          :showing="editorShowing"
          @toggle="$emit('toggle-editor')"
        />
      </template>
    </Chat>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import Chat from '../chats/Chat.vue'
import PanelToggle from './PanelToggle.vue'
import { useChats } from '@/composables/useChats'

/**
 * The conversation panel. It shows the chat it is given, which may be the
 * story's unstarted one. When that is nothing — or a chat that has since been
 * deleted — it stands the story's most recent one in, so the writer is never
 * left looking at a panel with nothing in it while there is something to
 * read, and the unstarted one in a story with none.
 *
 * @typedef {Object} Props
 * @property {string} storyId
 * @property {string|null} [chatId] - The chat to show
 * @property {boolean|null} [editorShowing] - Whether the editor is showing
 *   beside this panel, for the toggle at the start of the chat's header that
 *   hides and shows it. Null where there is no editor beside it to toggle,
 *   and then there is no toggle.
 * @property {boolean} [showBack] - Whether the header starts with a way back
 *   to the list of chats, where the list is behind this panel: on a phone.
 */
const props = defineProps({
  storyId: { type: String, required: true },
  chatId: { type: String, default: null },
  editorShowing: { type: [Boolean, null], default: null },
  showBack: { type: Boolean, default: false },
})

const emit = defineEmits(['update:chatId', 'toggle-editor', 'back'])

const chatsApi = useChats(props.storyId)
const ready = ref(false)

// Looked up in the live list rather than by id, so a deleted chat reads as gone.
const chat = computed(() => chatsApi.chats.value.find(c => c.id === props.chatId) ?? null)

const unstarted = computed(() => chatsApi.isUnstarted(props.chatId))

// What to show when the chat asked for is not there to show.
const standInId = computed(() => chatsApi.chats.value[0]?.id ?? chatsApi.unstartedChat.value.id)

const shownId = computed(() => {
  if (chat.value || unstarted.value) return props.chatId
  return ready.value ? standInId.value : null
})

watch(
  [ready, shownId],
  () => {
    if (ready.value && shownId.value !== props.chatId) emit('update:chatId', shownId.value)
  },
  { immediate: true }
)

onMounted(async () => {
  await chatsApi.init()
  ready.value = true
})
</script>
