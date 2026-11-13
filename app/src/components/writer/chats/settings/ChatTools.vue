<template>
  <ToolList
    :choice="chat"
    :disabled="!modelToolsEnabled"
    @all="setToolsOn"
    @groups="setToolGroups"
    @tool="setTool"
  >
    <p v-if="modelToolsNote" class="text-xs text-surface-500 dark:text-surface-400" data-tools-note>
      {{ modelToolsNote }}
    </p>
  </ToolList>
</template>

<script setup>
import { computed } from 'vue'
import ToolList from '../../tools/ToolList.vue'
import { useChatSettings } from '@/composables/useChatSettings'
import { useModelCapabilities } from '@/composables/useModelCapabilities'

/**
 * What a chat's model can reach for (`ToolList`). A switch here is the
 * chat's, and goes to its profile too, for the chats started on it next. See
 * `setToolGroups` in useChatSettings. Whether its edits wait is the chip
 * under the message box.
 *
 * @typedef {Object} Props
 * @property {string} storyId
 * @property {string} chatId - The chat, which can be the story's unstarted one
 */
const props = defineProps({
  storyId: { type: String, required: true },
  chatId: { type: String, required: true },
})

const { chat, preset, setToolsOn, setToolGroups, setTool } = useChatSettings(
  props.storyId,
  () => props.chatId
)

const capabilities = useModelCapabilities(
  () => preset.value?.providerId,
  () => preset.value?.model
)

/**
 * Whether the chat's model may be offered tools at all: its settings allow
 * it, and its connection's list doesn't say it can't. The switches only
 * choose among the ones it would otherwise be offered.
 */
const modelToolsEnabled = computed(
  () => preset.value?.toolsEnabled !== false && capabilities.value.tools
)

/** Why the switches are off, when the model is why. */
const modelToolsNote = computed(() => {
  if (!capabilities.value.tools) return "This chat's model can't call tools."
  if (preset.value?.toolsEnabled === false) return "Allow tool use is off for this chat's model."
  return ''
})
</script>
