<template>
  <div class="flex flex-col gap-2 px-1">
    <div class="flex items-center gap-1">
      <Select
        v-model="selectedId"
        :options="voices"
        option-label="name"
        option-value="id"
        size="small"
        class="flex-1 min-w-0 dark:!bg-surface-900"
        placeholder="Voice"
        aria-label="Voice"
        data-voice-select
      />
      <Button
        v-tooltip.top="'New voice'"
        type="button"
        icon="pi pi-plus"
        severity="secondary"
        size="small"
        text
        rounded
        aria-label="New voice"
        data-action="add-voice"
        @click="add"
      />
      <Button
        v-tooltip.top="'Delete voice'"
        type="button"
        icon="pi pi-trash"
        severity="danger"
        size="small"
        text
        rounded
        aria-label="Delete voice"
        :disabled="!selected || voices.length < 2"
        data-action="remove-voice"
        @click="remove"
      />
    </div>

    <template v-if="selected">
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-surface-700 dark:text-surface-200" for="voice-name">
          Name
        </label>
        <InputText
          id="voice-name"
          :model-value="selected.name"
          size="small"
          class="w-full dark:!bg-surface-900"
          placeholder="Narrator"
          data-voice-name
          @update:model-value="rename"
          @blur="settleName"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-surface-700 dark:text-surface-200" for="voice-id">
          Voice
        </label>
        <InputText
          id="voice-id"
          :model-value="selected.voice"
          size="small"
          class="w-full font-mono dark:!bg-surface-900"
          placeholder="af_heart+af_nicole(2)"
          data-voice-string
          @update:model-value="update({ voice: String($event ?? '').trim() })"
        />
        <Select
          v-if="serverVoices.length > 0"
          :model-value="null"
          :options="serverVoices"
          size="small"
          class="w-full dark:!bg-surface-900"
          placeholder="Add a voice to the mix…"
          filter
          aria-label="Add a voice to the mix"
          data-voice-mix
          @update:model-value="mixIn"
        />
        <p class="text-xs text-surface-500 dark:text-surface-400">
          Passed to the server as written. Kokoro mixes voices with <code>+</code>, weighted in
          parentheses.
        </p>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-surface-700 dark:text-surface-200" for="voice-speed">
          Speed
        </label>
        <InputNumber
          input-id="voice-speed"
          :model-value="selected.speed ?? 1"
          :min="0.5"
          :max="2"
          :step="0.1"
          :min-fraction-digits="1"
          :max-fraction-digits="2"
          show-buttons
          size="small"
          input-class="w-full dark:!bg-surface-900"
          data-voice-speed
          @update:model-value="update({ speed: Number($event) || 1 })"
        />
      </div>

      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-surface-700 dark:text-surface-200">Colour</span>
        <div class="flex flex-wrap items-center gap-1" role="group" aria-label="Colour">
          <button
            type="button"
            class="w-5 h-5 rounded-full border border-surface-400 dark:border-surface-500 flex items-center justify-center text-[9px] text-surface-500"
            :class="{ 'ring-2 ring-primary-500 ring-offset-1': !selected.color }"
            aria-label="No colour"
            title="No colour"
            :aria-pressed="!selected.color"
            data-color=""
            @click="update({ color: undefined })"
          >
            <i class="pi pi-times" />
          </button>
          <button
            v-for="color in VOICE_COLORS"
            :key="color"
            type="button"
            class="w-5 h-5 rounded-full border border-black/10"
            :class="{ 'ring-2 ring-primary-500 ring-offset-1': selected.color === color }"
            :style="{ backgroundColor: color }"
            :aria-label="`Colour ${color}`"
            :aria-pressed="selected.color === color"
            :data-color="color"
            @click="update({ color })"
          />
        </div>
        <p class="text-xs text-surface-500 dark:text-surface-400">
          Marks this voice's lines in the list, and in the editor while the narration is open.
        </p>
      </div>

      <div class="flex items-center justify-between gap-2">
        <Tag v-if="selected.id === defaultVoiceId" value="Default" severity="secondary" />
        <Button
          v-else
          type="button"
          label="Use as default"
          size="small"
          severity="secondary"
          text
          data-action="set-default"
          @click="$emit('set-default', selected.id)"
        />
        <Button
          type="button"
          label="Preview"
          icon="pi pi-volume-up"
          size="small"
          severity="secondary"
          text
          :loading="previewing"
          :disabled="!selected.voice"
          data-action="preview"
          @click="preview"
        />
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import { VOICE_COLORS } from '@/tts/voices.js'

/**
 * The project's voices: a list to pick from, and the one picked to edit.
 * Every change is written as it is made; the store debounces. One voice is
 * the default, and reads whatever nobody else has been given.
 *
 * @typedef {Object} Props
 * @property {import('@/types/models.js').TtsVoice[]} voices
 * @property {string} defaultVoiceId - The default voice
 * @property {string[]} [serverVoices] - What the server offers, to mix from
 * @property {boolean} [previewing] - Whether a preview is being fetched
 */
const props = defineProps({
  voices: { type: Array, required: true },
  defaultVoiceId: { type: String, required: true },
  serverVoices: { type: Array, default: () => [] },
  previewing: { type: Boolean, default: false },
})

const emit = defineEmits(['add', 'update', 'remove', 'set-default', 'preview'])

/** The voice being edited. */
const selectedId = ref('')

const selected = computed(() => {
  const voices = /** @type {import('@/types/models.js').TtsVoice[]} */ (props.voices)
  return voices.find(voice => voice.id === selectedId.value) ?? null
})

// A voice removed, or a list that has not been looked at yet, settles on
// the default: the one voice every project has.
watch(
  [() => props.voices, () => props.defaultVoiceId],
  () => {
    if (!selected.value) selectedId.value = props.defaultVoiceId
  },
  { immediate: true }
)

/** @param {Partial<import('@/types/models.js').TtsVoice>} updates */
const update = updates => {
  if (selected.value) emit('update', selected.value.id, updates)
}

/** @param {string|null|undefined} name */
const rename = name => update({ name: String(name ?? '') })

/** A voice left with no name gets one, so the list never shows a blank. */
const settleName = () => {
  if (selected.value && !selected.value.name.trim()) update({ name: 'Untitled voice' })
}

/**
 * Put one of the server's voices into the mix: on its own for an empty
 * voice, otherwise joined with `+`.
 * @param {string|null} name
 */
const mixIn = name => {
  if (!name || !selected.value) return
  const current = selected.value.voice.trim()
  update({ voice: current ? `${current}+${name}` : name })
}

const add = () => emit('add')

// The parent creates the voice and it arrives through the list: one longer
// than it was, and the newest is the one to edit.
watch(
  () => props.voices.length,
  (length, previous) => {
    if (length > previous) {
      const voices = /** @type {import('@/types/models.js').TtsVoice[]} */ (props.voices)
      selectedId.value = voices[voices.length - 1].id
    }
  }
)

const remove = () => {
  if (selected.value) emit('remove', selected.value.id)
}

const preview = () => {
  if (selected.value) emit('preview', selected.value)
}

onMounted(() => {
  if (!selected.value) selectedId.value = props.defaultVoiceId
})
</script>
