<template>
  <div class="flex flex-col gap-3">
    <!-- The two texts are capped alike, since a long one otherwise fills
         the panel; either opens in the editor for room to work in. -->
    <div class="flex flex-col gap-1">
      <div class="flex items-center justify-between gap-2">
        <SettingLabel
          label="System prompt"
          :overridden="promptUnsaved"
          reset-tooltip="Back to the profile's"
          saveable
          :unsaved="promptUnsaved"
          @reset="setPrompt(profilePrompt)"
          @save="savePrompt"
        />
        <HeaderButton
          icon="pi pi-window-maximize"
          label="Open in editor"
          class="-my-1.5"
          data-action="open-prompt"
          @click="openInEditor('prompt')"
        />
      </div>
      <Textarea
        v-model="systemPrompt"
        size="small"
        class="w-full max-h-48 !overflow-y-auto dark:!bg-surface-900"
        auto-resize
        rows="3"
        aria-label="System prompt"
        @input="setPrompt(systemPrompt)"
      />
    </div>

    <div class="flex flex-col gap-1">
      <div class="flex items-center justify-between gap-2">
        <SettingLabel
          label="Author's note"
          description="Sent with each message you write."
          :overridden="noteUnsaved"
          reset-tooltip="Back to the profile's"
          saveable
          :unsaved="noteUnsaved"
          @reset="setNote(selectedProfile?.settings?.rules || '')"
          @save="saveNote"
        />
        <HeaderButton
          icon="pi pi-window-maximize"
          label="Open in editor"
          class="-my-1.5"
          data-action="open-note"
          @click="openInEditor('note')"
        />
      </div>
      <Textarea
        v-model="rules"
        size="small"
        class="w-full max-h-48 !overflow-y-auto dark:!bg-surface-900"
        auto-resize
        rows="3"
        aria-label="Author's note"
        @input="setNote(rules)"
      />
    </div>

    <!-- A roleplay chat's scene: its names, and the instructions sent after
         the prompt and the note. -->
    <ExpandableSection
      v-if="isRoleplay"
      title="Roleplay"
      storage-key="ui.settings.prompts.roleplay"
      subsection
      default-expanded
      content-wrapper-class="flex flex-col"
      data-prompts-roleplay
    >
      <div class="pt-2 pb-1">
        <ChatRoleplay :story-id="storyId" :chat-id="chatId" @close="emit('close')" />
      </div>
    </ExpandableSection>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import Textarea from 'primevue/textarea'
import SettingLabel from '@/components/common/SettingLabel.vue'
import ExpandableSection from '@/components/common/ExpandableSection.vue'
import ChatRoleplay from './ChatRoleplay.vue'
import HeaderButton from '../../layout/HeaderButton.vue'
import { useChatSettings } from '@/composables/useChatSettings'
import { useDocuments } from '@/composables/useDocuments'
import { useEditorRequest } from '@/composables/useEditorRequest.js'
import { chatTabId } from '@/utils/chatTabs.js'

/**
 * A chat's prompts: its system prompt and its author's note. Each is the
 * chat's own until its Save carries it to the profile, or its Reset takes the
 * profile's back; the profile's prompt is read every turn until the chat
 * changes its own. See `useChatSettings`. The profile is at the top of the
 * settings. A roleplay chat's scene is under them (`ChatRoleplay`).
 *
 * @typedef {Object} Props
 * @property {string} storyId
 * @property {string} chatId - The chat, which can be the story's unstarted one
 */
const props = defineProps({
  storyId: { type: String, required: true },
  chatId: { type: String, required: true },
})

/** Asks for the settings to close, for the editor a text was opened in. */
const emit = defineEmits(['close'])

const {
  selectedProfile,
  note,
  setNote,
  isRoleplay,
  prompt: chatPrompt,
  profilePrompt,
  setPrompt,
  promptUnsaved,
  noteUnsaved,
  savePrompt,
  saveNote,
} = useChatSettings(props.storyId, () => props.chatId)

// Edited locally so typing doesn't fight the value the store echoes back,
// which would otherwise jump the caret on every keystroke. See `setPrompt`
// for what an edit does.
const systemPrompt = ref(chatPrompt.value)

watch(chatPrompt, next => {
  if (next !== systemPrompt.value) systemPrompt.value = next
})

/** The chat's author's note, as the turn reads it, edited locally as the prompt is. */
const rules = ref(note.value || '')

watch(
  () => note.value,
  next => {
    if ((next || '') !== rules.value) rules.value = next || ''
  }
)

const editorRequest = useEditorRequest()

/**
 * Open one of the chat's texts in a tab of the editor's own, and the editor
 * with it, for more room than the field here has; the settings close for it.
 * @param {import('@/utils/chatTabs.js').ChatText} text
 */
const openInEditor = text => {
  useDocuments(props.storyId).open(chatTabId(props.chatId, text))
  editorRequest.show()
  emit('close')
}
</script>
