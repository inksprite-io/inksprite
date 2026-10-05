<template>
  <div class="flex flex-col" role="list" aria-label="Blocks">
    <div
      v-for="(block, index) in blocks"
      :key="index"
      role="listitem"
      class="flex items-center gap-1 pl-1 pr-0.5 py-0.5 rounded-md text-xs border-l-[3px]"
      :class="rowClass(index)"
      :style="{ borderLeftColor: colorOf(index) ?? 'transparent' }"
      :data-block="index"
      :data-state="states[index]"
    >
      <!-- Where the block stands, and once it has been read, the way to
           hear it. -->
      <button
        type="button"
        class="shrink-0 w-5 h-5 flex items-center justify-center rounded-full disabled:cursor-default enabled:hover:bg-surface-300 enabled:dark:hover:bg-surface-600"
        :class="states[index] === 'failed' ? 'text-red-500' : 'text-surface-500'"
        :aria-label="playLabel(index)"
        :title="playLabel(index)"
        :disabled="!canPlay(index)"
        data-action="play"
        @click="$emit('play', index)"
      >
        <i class="pi text-[10px]" :class="STATE_ICONS[states[index]] ?? STATE_ICONS.missing" />
      </button>

      <button
        type="button"
        class="flex-1 min-w-0 text-left line-clamp-2 break-words text-surface-700 dark:text-surface-300"
        :title="block.text"
        :aria-label="`Select block ${index + 1}: ${block.text}`"
        :aria-pressed="selected.has(index)"
        data-action="select"
        @click="select($event, index)"
      >
        {{ block.text }}
      </button>

      <!-- Who speaks it. Named where somebody was given the block; most are
           the default voice's, and saying so on every row would leave no
           room for the words. -->
      <button
        v-if="speakerOf(index)"
        type="button"
        class="shrink-0 max-w-[38%] truncate px-2 py-0.5 rounded-full text-[11px] leading-4 border transition-colors"
        :class="
          colorOf(index)
            ? 'text-surface-800 dark:text-surface-100'
            : 'border-transparent bg-surface-200 text-surface-600 hover:bg-surface-300 dark:bg-surface-700 dark:text-surface-300 dark:hover:bg-surface-600'
        "
        :style="chipStyle(index)"
        :aria-label="speakerLabel(index)"
        :title="speakerLabel(index)"
        :aria-haspopup="true"
        data-action="speaker"
        @click="openMenu($event, index)"
      >
        {{ nameOf(index) }}
      </button>
      <button
        v-else
        type="button"
        class="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-surface-400 hover:bg-surface-300 hover:text-surface-600 dark:hover:bg-surface-600 dark:hover:text-surface-200"
        :aria-label="speakerLabel(index)"
        :title="speakerLabel(index)"
        :aria-haspopup="true"
        data-action="speaker"
        @click="openMenu($event, index)"
      >
        <i class="pi pi-user text-[10px]" />
      </button>

      <button
        type="button"
        class="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-surface-500 disabled:opacity-40 disabled:cursor-default enabled:hover:bg-surface-300 enabled:dark:hover:bg-surface-600"
        :aria-label="generateLabel(index)"
        :title="generateLabel(index)"
        :disabled="busy"
        data-action="generate"
        @click="$emit('generate', index)"
      >
        <i class="pi pi-refresh text-[10px]" />
      </button>
    </div>
    <Menu ref="menu" :model="items" :popup="true" />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import Menu from 'primevue/menu'
import { TINT } from '@/tts/highlight.js'

/**
 * The document as it will be read: its blocks, each with who speaks it and
 * whether it has been read. A block's words select it: with Shift a run of
 * blocks, with Cmd or Ctrl one more or one fewer. A speaker is changed from a
 * menu on a block's chip, and on a selected block the pick is for all of the
 * selection: every paragraph one character speaks, given to their voice at
 * once. The selection is also what Narrate reads, when there is one. The
 * button before a block's words plays from there once there is audio, and the
 * one after reads that block on its own, again if it has been read.
 *
 * @typedef {Object} Props
 * @property {import('@/tts/script.js').Block[]} blocks
 * @property {(string|null)[]} speakers - A voice id per block; null is the default voice's
 * @property {import('@/tts/reading.js').BlockState[]} states - Where each block stands in the reading
 * @property {import('@/types/models.js').TtsVoice[]} voices
 * @property {string} defaultVoiceId - The default voice
 * @property {number[]} [selection] - The blocks selected
 * @property {number|null} [playing] - The block the track is at
 * @property {boolean} [playable] - Whether the track can be played from a block
 * @property {boolean} [busy] - Whether a run is under way, and no other can start
 */
const props = defineProps({
  blocks: { type: Array, required: true },
  speakers: { type: Array, required: true },
  states: { type: Array, required: true },
  voices: { type: Array, required: true },
  defaultVoiceId: { type: String, required: true },
  selection: { type: Array, default: () => [] },
  playing: { type: Number, default: null },
  playable: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
})

const emit = defineEmits(['assign', 'play', 'generate', 'update:selection'])

const STATE_ICONS = {
  ready: 'pi-play',
  missing: 'pi-circle',
  running: 'pi-spinner pi-spin',
  failed: 'pi-exclamation-circle',
}

const voices = computed(() => /** @type {import('@/types/models.js').TtsVoice[]} */ (props.voices))
const selected = computed(() => new Set(/** @type {number[]} */ (props.selection)))

/**
 * The voice a block was given, if it was given one that is still there.
 * @param {number} index
 */
const speakerOf = index => voices.value.find(voice => voice.id === props.speakers[index]) ?? null

/** @param {number} index */
const nameOf = index =>
  (speakerOf(index) ?? voices.value.find(voice => voice.id === props.defaultVoiceId))?.name ??
  'Default'

/** @param {number} index */
const speakerLabel = index =>
  speakerOf(index)
    ? `Speaker for block ${index + 1}: ${nameOf(index)}`
    : `Speaker for block ${index + 1}: ${nameOf(index)}, the default`

/**
 * A block is coloured for the speaker it was given. What the default voice
 * reads for want of one is left plain, so the speakers stand out.
 * @param {number} index
 */
const colorOf = index => speakerOf(index)?.color ?? null

/** @param {number} index */
const chipStyle = index => {
  const color = colorOf(index)
  return color ? { backgroundColor: `${color}${TINT}`, borderColor: `${color}99` } : {}
}

/** @param {number} index */
const rowClass = index => {
  if (index === props.playing) return 'bg-primary-100 dark:bg-primary-900/40'
  if (selected.value.has(index)) return 'bg-surface-300/70 dark:bg-surface-600/70'
  return 'hover:bg-surface-200/60 dark:hover:bg-surface-700/60'
}

/** @param {number} index */
const canPlay = index => props.playable && props.states[index] === 'ready'

/** @param {number} index */
const playLabel = index => {
  const state = props.states[index]
  if (state === 'running') return `Block ${index + 1} is being read`
  if (state === 'failed') return `Block ${index + 1} could not be read`
  if (state === 'ready') return `Play from block ${index + 1}`
  return `Block ${index + 1} has not been read`
}

/** @param {number} index */
const generateLabel = index =>
  props.states[index] === 'ready' ? `Read block ${index + 1} again` : `Read block ${index + 1}`

/** Where a run of selected blocks starts from: the last block clicked alone. */
const anchor = ref(-1)

/**
 * A click selects the block, and clicked again lets it go. With Shift, it
 * selects from the last block clicked to this one. With Cmd or Ctrl, it adds
 * the block to the selection or takes it out, leaving the rest.
 *
 * @param {MouseEvent} event
 * @param {number} index
 */
const select = (event, index) => {
  if (event.shiftKey && anchor.value >= 0 && anchor.value < props.blocks.length) {
    const [from, to] = anchor.value < index ? [anchor.value, index] : [index, anchor.value]
    emit(
      'update:selection',
      Array.from({ length: to - from + 1 }, (_, i) => from + i)
    )
    return
  }
  if (event.metaKey || event.ctrlKey) {
    const next = new Set(selected.value)
    if (!next.delete(index)) next.add(index)
    anchor.value = index
    emit(
      'update:selection',
      [...next].sort((a, b) => a - b)
    )
    return
  }
  const only = selected.value.size === 1 && selected.value.has(index)
  anchor.value = only ? -1 : index
  emit('update:selection', only ? [] : [index])
}

/** @type {import('vue').Ref<{toggle: (event: Event) => void}|null>} */
const menu = ref(null)
/** The block whose menu is open. */
const menuFor = ref(-1)

/**
 * The blocks a pick is for: the selection, when the menu was opened on one
 * of several selected blocks, and otherwise the block it was opened on.
 */
const targets = computed(() => {
  if (menuFor.value < 0) return []
  return selected.value.size > 1 && selected.value.has(menuFor.value)
    ? [...selected.value].sort((a, b) => a - b)
    : [menuFor.value]
})

/**
 * Give the blocks the menu is open for a speaker. One menu serves every
 * block, and who it is open for is read when the pick is made.
 *
 * @param {string|null} voiceId
 */
const pick = voiceId => {
  if (targets.value.length > 0) emit('assign', targets.value, voiceId)
}

/**
 * The voices, the default first and marked. Picking the default gives the
 * blocks back rather than naming the voice, so a default changed later takes
 * them with it. Open for several blocks, the menu says so.
 */
const items = computed(() => {
  const fallback = voices.value.find(voice => voice.id === props.defaultVoiceId)
  const others = voices.value.filter(voice => voice.id !== props.defaultVoiceId)
  const choices = [
    { label: `${fallback?.name ?? 'Default'} (default)`, command: () => pick(null) },
    ...others.map(voice => ({ label: voice.name, command: () => pick(voice.id) })),
  ]
  return targets.value.length > 1
    ? [{ label: `Speaker for ${targets.value.length} blocks`, items: choices }]
    : choices
})

/**
 * @param {Event} event
 * @param {number} index
 */
const openMenu = (event, index) => {
  menuFor.value = index
  menu.value?.toggle(event)
}
</script>
