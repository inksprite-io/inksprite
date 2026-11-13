<template>
  <!-- What a writer changes most in a chat, under its box: the profile it
       runs on, its model and how hard it thinks, and whether its edits wait.
       The rest of the chat's settings are in the settings. -->
  <div class="@container flex items-center gap-1 min-w-0" data-chat-chips>
    <ChatChip
      :aria-label="`Profile: ${selectedProfile?.name ?? ''}`"
      :aria-controls="profileMenuId"
      data-chat-profile-chip
      @click="profileMenu?.toggle($event)"
    >
      <span class="truncate font-medium">{{ selectedProfile?.name }}</span>
    </ChatChip>
    <ProfileMenu :id="profileMenuId" ref="profileMenu" :story-id="storyId" :chat-id="chatId" />

    <!-- The model and the edits to the right, the profile on its own to the
         left, in whatever room is left once each has all it needs. -->
    <ChatModelChip ref="modelChip" class="ml-auto" :story-id="storyId" :chat-id="chatId" />

    <ChatChip
      v-if="editsDocuments"
      :aria-label="`Document edits: ${editsName}`"
      :aria-controls="editsMenuId"
      data-chat-edits-chip
      @click="editsMenu?.toggle($event)"
    >
      <span class="truncate font-medium">{{ editsName }}</span>
    </ChatChip>
    <Menu
      v-if="editsDocuments"
      :id="editsMenuId"
      ref="editsMenu"
      :model="editsItems"
      :popup="true"
      class="text-sm"
    >
      <template #item="{ item, props: itemProps }">
        <a
          class="flex items-center gap-3 px-3 py-1.5 cursor-pointer"
          v-bind="itemProps.action"
          :class="{
            'rounded-[inherit] bg-[var(--p-highlight-background)] !text-[color:var(--p-highlight-color)]':
              item.mode === applyEdits,
          }"
          :aria-current="item.mode === applyEdits ? 'true' : undefined"
          :data-edits="item.mode"
        >
          <span class="flex-1 flex flex-col">
            <span>{{ item.label }}</span>
            <span class="text-xs text-surface-500 dark:text-surface-400">{{ item.detail }}</span>
          </span>
        </a>
      </template>
    </Menu>
  </div>
</template>

<script setup>
import { computed, ref, useId } from 'vue'
import Menu from 'primevue/menu'
import ChatChip from './ChatChip.vue'
import ChatModelChip from './ChatModelChip.vue'
import ProfileMenu from './ProfileMenu.vue'
import { useChatSettings } from '@/composables/useChatSettings'
import { DOCUMENT_EDIT_OPTIONS as EDIT_OPTIONS } from '@/utils/documentEdits.js'
import { groupOn, toolsSwitchedOff } from '@/ai/tools/choice.js'

/**
 * The chips under a chat's message box: its profile, its model and effort,
 * and whether the model suggests its edits or makes them, while it has its
 * document tools to make them with. Each change is the chat's, and its
 * profile's next chats start with it too (useChatSettings).
 *
 * @typedef {Object} Props
 * @property {string} storyId
 * @property {string} chatId - The chat, which can be the story's unstarted one
 */
const props = defineProps({
  storyId: { type: String, required: true },
  chatId: { type: String, required: true },
})

const { chat, selectedProfile, applyEdits, setApplyEdits } = useChatSettings(
  props.storyId,
  () => props.chatId
)

const uid = useId()
const profileMenuId = `chat_profile_chip_${uid}`
const editsMenuId = `chat_edits_chip_${uid}`

/** @type {import('vue').Ref<InstanceType<typeof ProfileMenu>|null>} */
const profileMenu = ref(null)
/** @type {import('vue').Ref<any>} */
const editsMenu = ref(null)
/** @type {import('vue').Ref<InstanceType<typeof ChatModelChip>|null>} */
const modelChip = ref(null)

/** Whether the chat has its document tools, without which it edits nothing. */
const editsDocuments = computed(
  () => !toolsSwitchedOff(chat.value) && groupOn(chat.value, 'documents')
)

const editsName = computed(
  () => (EDIT_OPTIONS.find(one => one.value === applyEdits.value) ?? EDIT_OPTIONS[0]).label
)

/** Whether the model's changes to documents wait for the writer, or go in. */
const editsItems = EDIT_OPTIONS.map(one => ({
  label: one.label,
  detail: one.detail,
  mode: one.value,
  command: () => setApplyEdits(one.value),
}))

defineExpose({
  /**
   * The chat's model and effort, open beside their chip.
   * @param {Event} [event] - The click that asked
   */
  showModels: event => modelChip.value?.show(event),
})
</script>
