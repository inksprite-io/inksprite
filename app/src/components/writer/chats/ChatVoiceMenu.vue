<template>
  <!-- On a right click on a turn's Read aloud: the voice that side of the
       chat is read in, and the way to the voices themselves. -->
  <ContextMenu ref="menu" :model="items" data-chat-voice-menu />
</template>

<script setup>
import { computed, ref } from 'vue'
import ContextMenu from 'primevue/contextmenu'
import { useChatSettings } from '@/composables/useChatSettings'
import { useNarration } from '@/composables/useNarration'
import { useSidebarTab } from '@/composables/useSidebarTab.js'

/**
 * The voice a chat is read aloud in, set from a turn's Read aloud: on one of
 * the assistant's, the voice its turns are read in; on one of the writer's,
 * the voice theirs are, which is the assistant's until they choose another.
 * The voices are the project's, made in Narration, which the last item opens.
 *
 * @typedef {Object} Props
 * @property {string} storyId
 * @property {string} chatId - The chat, which can be the story's unstarted one
 */
const props = defineProps({
  storyId: { type: String, required: true },
  chatId: { type: String, required: true },
})

const { chat, update } = useChatSettings(props.storyId, () => props.chatId)
const narration = useNarration(props.storyId)
const sidebarTab = useSidebarTab()

/** @type {import('vue').Ref<any>} */
const menu = ref(null)

/** Whose turn was clicked: its side's voice is the one set. */
const role = ref(/** @type {'user'|'assistant'} */ ('assistant'))

/** The voice the assistant's turns are read in: the chat's, or the project's default. */
const assistantVoiceId = computed(
  () => narration.voiceById(chat.value?.voiceId ?? '')?.id ?? narration.defaultVoiceId.value
)

/** The voice the side clicked is read in now. */
const current = computed(() =>
  role.value === 'user'
    ? (narration.voiceById(chat.value?.userVoiceId ?? '')?.id ?? assistantVoiceId.value)
    : assistantVoiceId.value
)

/** @param {string} voiceId */
const setVoice = voiceId => update(role.value === 'user' ? { userVoiceId: voiceId } : { voiceId })

const items = computed(() => [
  {
    label: 'Set voice',
    items: [
      ...narration.voices.value.map(voice => ({
        label: voice.name,
        // Tinted as a select's choice is; see the style below.
        class: voice.id === current.value ? 'chat-voice-current' : undefined,
        command: () => setVoice(voice.id),
      })),
      { separator: true },
      { label: 'Narration settings…', command: () => sidebarTab.show('narration') },
    ],
  },
])

defineExpose({
  /**
   * Open the menu for a turn.
   * @param {MouseEvent} event
   * @param {string} turnRole - Whose turn it is
   */
  show: (event, turnRole) => {
    role.value = turnRole === 'user' ? 'user' : 'assistant'
    menu.value?.show(event)
  },
})
</script>

<!-- Not scoped: the menu is drawn in the body. -->
<style>
.chat-voice-current > .p-contextmenu-item-content {
  background: var(--p-highlight-background);
  color: var(--p-highlight-color);
}
</style>
