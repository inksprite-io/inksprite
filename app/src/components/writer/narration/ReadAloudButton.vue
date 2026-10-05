<template>
  <Button
    v-tooltip.top="label"
    :icon="icon"
    text
    rounded
    size="small"
    :class="{ '!text-primary-500': mine }"
    :aria-label="label"
    :aria-pressed="mine"
    data-action="read-aloud"
    @click="toggle"
  />
</template>

<script setup>
import { computed } from 'vue'
import Button from 'primevue/button'
import { useNarration } from '@/composables/useNarration'
import { useSpeech } from '@/composables/useSpeech.js'
import { useToast } from '@/composables/useToast'
import { describeFailure } from '@/tts/client.js'

/**
 * Reads something aloud, and stops reading it: a chat message, say. In one
 * voice, the project's pronunciation hints applied. One thing is read at a
 * time app-wide, so starting here stops whatever else was speaking.
 *
 * @typedef {Object} Props
 * @property {string} storyId - Whose voices and hints
 * @property {string} speechKey - Names what is read, so this button knows when it is the one speaking
 * @property {string} text - Markdown
 * @property {string|null} [voiceId] - The voice to read in; the project's default when absent or gone
 */
const props = defineProps({
  storyId: { type: String, required: true },
  speechKey: { type: String, required: true },
  text: { type: String, required: true },
  voiceId: { type: String, default: null },
})

const narration = useNarration(props.storyId)
const speech = useSpeech()
const toast = useToast()

/** Whether what is being read is this. */
const mine = computed(() => speech.current.value === props.speechKey)

const label = computed(() => (mine.value ? 'Stop reading' : 'Read aloud'))
const icon = computed(() => {
  if (!mine.value) return 'pi pi-volume-up'
  return speech.status.value === 'loading' ? 'pi pi-spinner pi-spin' : 'pi pi-stop-circle'
})

const toggle = async () => {
  if (mine.value) {
    speech.stop()
    return
  }
  try {
    await narration.readAloud(props.speechKey, props.text, props.voiceId)
  } catch (error) {
    toast.error(describeFailure(error, narration.connection.value))
  }
}
</script>
