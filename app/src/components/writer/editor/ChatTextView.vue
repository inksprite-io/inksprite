<template>
  <PlainText v-if="ready" ref="field" :text="shown" class="h-full w-full" @input="write" />
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import PlainText from './PlainText.vue'
import { useChats } from '@/composables/useChats.js'
import { useChatSettings } from '@/composables/useChatSettings.js'

/**
 * One of a chat's texts in a tab of the editor's: the system prompt it runs
 * under, or its author's note. The same text as in the chat's settings, with
 * room to work in: what is typed here goes where typing there would, and
 * what is typed there shows up here.
 *
 * Loaded on its own, the first time one is opened, so that CodeMirror is not
 * in the app until then.
 *
 * @typedef {Object} Props
 * @property {string} storyId
 * @property {string} chatId
 * @property {import('@/utils/chatTabs.js').ChatText} text
 */
const props = defineProps({
  storyId: { type: String, required: true },
  chatId: { type: String, required: true },
  text: { type: String, required: true },
})

const settings = useChatSettings(props.storyId, () => props.chatId)

// The chats load with the chat panel, which a phone may not have shown yet;
// until then the chat reads as on the project's profile, which it may not be.
const ready = ref(false)
onMounted(async () => {
  await useChats(props.storyId).init()
  ready.value = true
})

const shown = computed(() =>
  props.text === 'prompt' ? settings.prompt.value : settings.note.value || ''
)

/** @param {string} typed */
const write = typed =>
  props.text === 'prompt' ? settings.setPrompt(typed) : settings.setNote(typed)

/** @type {import('vue').Ref<{ openFind: () => boolean }|null>} */
const field = ref(null)

defineExpose({ openFind: () => field.value?.openFind() ?? false })
</script>
