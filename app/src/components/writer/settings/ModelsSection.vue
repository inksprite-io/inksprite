<template>
  <!-- The models of every connection. With a chat showing, the one clicked is
       the chat's; the button at a card's end opens the model's settings,
       which every chat on it runs with. -->
  <div class="h-[min(31rem,calc(90vh-13rem))]" data-models-section>
    <ModelPicker
      :provider-id="shown.providerId"
      :model="shown.model"
      :tint="Boolean(chatId)"
      @update:choice="choose"
      @use="choose"
    />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import ModelPicker from '../models/ModelPicker.vue'
import { useChatSettings } from '@/composables/useChatSettings'

/**
 * Settings › Models: the models of the writer's connections, after
 * Connections, as setting up goes. With a chat showing, a click runs it on
 * the model, and starts its profile's next chats there, as the chip under
 * its message box does, whose Other models… opens this. The button at a
 * card's end opens the model's settings, how long a reply may be, its
 * samplers, and on OpenRouter its providers, which reach every chat on it.
 *
 * @typedef {Object} Props
 * @property {string} [storyId] - The project open
 * @property {string} [chatId] - The chat showing in it, which can be its
 *   unstarted one
 */
const props = defineProps({
  storyId: { type: String, default: '' },
  chatId: { type: String, default: '' },
})

const { preset, setModel } = useChatSettings(props.storyId, () => props.chatId)

/** The model clicked, where there is no chat to run on it. */
const open = ref(
  /** @type {{providerId: string|null, model: string|null}} */ ({ providerId: null, model: null })
)

/** The model the list marks: the chat's, or the one last clicked. */
const shown = computed(() =>
  props.chatId
    ? { providerId: preset.value?.providerId ?? null, model: preset.value?.model ?? null }
    : open.value
)

/** @param {{providerId: string|null, model: string|null}} choice */
const choose = choice => {
  if (!props.chatId) open.value = choice
  else if (choice.providerId && choice.model) setModel(choice.providerId, choice.model)
}
</script>
