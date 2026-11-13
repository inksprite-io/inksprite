<template>
  <div class="flex flex-col gap-3">
    <div class="grid grid-cols-2 gap-2">
      <div class="flex flex-col gap-1 min-w-0">
        <SettingLabel label="User" />
        <InputText
          v-model="userName"
          placeholder="{{user}}"
          size="small"
          class="w-full dark:!bg-surface-900"
          aria-label="User"
          data-roleplay="user"
          @input="setUserName(userName)"
        />
      </div>
      <div class="flex flex-col gap-1 min-w-0">
        <SettingLabel label="Character" />
        <InputText
          v-model="characterName"
          placeholder="{{char}}"
          size="small"
          class="w-full dark:!bg-surface-900"
          aria-label="Character"
          data-roleplay="character"
          @input="setCharacterName(characterName)"
        />
      </div>
    </div>

    <div class="flex flex-col gap-1">
      <div class="flex items-center justify-between gap-2">
        <SettingLabel
          label="System prompt"
          description="Sent after the system prompt above, or around it where it says {{original}}."
        />
        <HeaderButton
          icon="pi pi-window-maximize"
          label="Open in editor"
          class="-my-1.5"
          data-action="open-roleplay-prompt"
          @click="openInEditor('roleplay-prompt')"
        />
      </div>
      <Textarea
        v-model="roleplayPrompt"
        size="small"
        class="w-full max-h-48 !overflow-y-auto dark:!bg-surface-900"
        auto-resize
        rows="2"
        aria-label="Roleplay system prompt"
        data-roleplay="prompt"
        @input="setRoleplayPrompt(roleplayPrompt)"
      />
    </div>

    <div class="flex flex-col gap-1">
      <div class="flex items-center justify-between gap-2">
        <SettingLabel
          label="Post-history instructions"
          description="Sent after the author's note, or around it where they say {{original}}."
        />
        <HeaderButton
          icon="pi pi-window-maximize"
          label="Open in editor"
          class="-my-1.5"
          data-action="open-post-history"
          @click="openInEditor('post-history')"
        />
      </div>
      <Textarea
        v-model="postHistory"
        size="small"
        class="w-full max-h-48 !overflow-y-auto dark:!bg-surface-900"
        auto-resize
        rows="2"
        aria-label="Post-history instructions"
        data-roleplay="post-history"
        @input="setPostHistory(postHistory)"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import SettingLabel from '@/components/common/SettingLabel.vue'
import HeaderButton from '../../layout/HeaderButton.vue'
import { useChatSettings } from '@/composables/useChatSettings'
import { useDocuments } from '@/composables/useDocuments'
import { useEditorRequest } from '@/composables/useEditorRequest.js'
import { chatTabId } from '@/utils/chatTabs.js'

/**
 * Who is who in a scene, and what a card asks of every turn, in a roleplay
 * chat: the names `{{user}}` and `{{char}}` become, and a card's own
 * instructions, sent after the profile's. The chat's alone: saving it to its
 * profile leaves these.
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

const { roleplay, setUserName, setCharacterName, setRoleplayPrompt, setPostHistory } =
  useChatSettings(props.storyId, () => props.chatId)

/**
 * One of the roleplay settings as it is being typed, held locally: the store
 * echoes every write back, and a value that arrives mid-keystroke moves the
 * caret. Watched one at a time, so a change to the chat that leaves this one
 * as it was does not put back what the store trimmed.
 * @param {'userName'|'characterName'|'prompt'|'postHistory'} key
 */
const roleplayDraft = key => {
  const text = ref(roleplay.value[key])
  watch(
    () => roleplay.value[key],
    next => {
      if (next !== text.value) text.value = next
    }
  )
  return text
}

const userName = roleplayDraft('userName')
const characterName = roleplayDraft('characterName')
const roleplayPrompt = roleplayDraft('prompt')
const postHistory = roleplayDraft('postHistory')

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
